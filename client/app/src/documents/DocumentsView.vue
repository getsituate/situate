<script setup lang="ts">
import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  shallowRef,
  useId,
  watch,
} from "vue";
import { preferences, t } from "@situate/localization";
import { listen } from "@tauri-apps/api/event";
import {
  SituateButton,
  SituateDisclosure,
  SituateEmptyState,
  SituateIcon,
  SituateIconButton,
  SituateInput,
} from "@situate/ui";
import {
  LIBRARY_DETAILS_EXPORT,
  LIBRARY_EXPORTS,
  validateLibraryDescriptor,
  validateLibraryReference,
  validateLibraryResult,
  type DocumentReference,
  type LibraryContinuation,
  type LibraryDescriptor,
  type LibraryDetailField,
  type LibraryDocument,
  type LibraryError,
} from "../ai/document-sources/contract.js";
import type { PluginRuntime } from "../plugins/runtime";
import type { PresentationValue } from "../layout/navigation";
import DocumentReading from "./DocumentReading.vue";
import DocumentThumbnail from "./DocumentThumbnail.vue";
import { previewFormats } from "./document-preview";
import {
  documentThumbnails,
  forgetThumbnail,
  invalidatesThumbnail,
  readLibraryOriginal,
  reconcileThumbnails,
  type ThumbnailInvalidation,
  type ThumbnailSource,
  type ThumbnailTarget,
} from "./document-thumbnails";
import "./documents.css";

const props = defineProps<{
  plugins?: Promise<PluginRuntime | undefined>;
  presentation?: PresentationValue;
}>();
const emit = defineEmits<{
  presentation: [PresentationValue];
  error: [string];
  sources: [string?];
  develop: [];
}>();
const runtime = shallowRef<PluginRuntime>();
const runtimeFailed = ref(false);
void props.plugins
  ?.then((value) => (runtime.value = value))
  .catch(() => (runtimeFailed.value = true));
const installed = computed(
  () =>
    runtime.value?.state.plugins.filter(
      (plugin) => plugin.manifest?.kind === "source",
    ) ?? [],
);
const candidates = computed(() =>
  installed.value.filter(
    (plugin) =>
      plugin.enabled &&
      plugin.manifest?.exports?.some((name) =>
        Object.values(LIBRARY_EXPORTS).some((operation) => operation === name),
      ),
  ),
);
const inventory = computed(() =>
  JSON.stringify(
    candidates.value.map(({ id, status, revision, incarnation, manifest }) => [
      id,
      status,
      revision,
      incarnation,
      manifest?.exports,
    ]),
  ),
);
const busy = ref(false);
const searchInput = ref<InstanceType<typeof SituateInput>>();
const previewHeading = ref<HTMLElement>();
const root = ref<HTMLElement>();
const results = ref<HTMLElement>();
const queryId = useId();
const initial =
  props.presentation &&
  typeof props.presentation === "object" &&
  !Array.isArray(props.presentation)
    ? props.presentation
    : {};
const query = ref(
  "query" in initial && typeof initial.query === "string" ? initial.query : "",
);
const draft = ref(
  "draft" in initial && typeof initial.draft === "string"
    ? initial.draft
    : query.value,
);
const savedScroll =
  "scroll" in initial && typeof initial.scroll === "number"
    ? initial.scroll
    : 0;
const selection = shallowRef<{
  ref: DocumentReference;
  title?: string;
  mimeType?: string;
}>();
try {
  if ("document" in initial)
    selection.value = { ref: validateLibraryReference(initial.document) };
} catch {
  selection.value = undefined;
}
const preview = shallowRef<{
  document: LibraryDocument;
  bytes: Uint8Array<ArrayBuffer>;
}>();
const previewError = ref<LibraryError | "failed">();
const opening = ref(false);
const detailFields = shallowRef<LibraryDetailField[]>([]);
const thumbnails = documentThumbnails(() => runtime.value);
const fileFormat = computed(() => {
  const mimeType =
    preview.value?.document.mimeType ?? selection.value?.mimeType;
  return mimeType && (previewFormats[mimeType] ?? mimeType);
});

interface SourcePage {
  plugin: string;
  descriptor?: LibraryDescriptor;
  thumbnailSource?: ThumbnailSource;
  thumbnailsReady?: Promise<unknown>;
  items: LibraryDocument[];
  next?: LibraryContinuation;
  incomplete?: boolean;
  failed?: boolean;
}
const pages = shallowRef<SourcePage[]>([]);
const rows = computed(() =>
  pages.value.flatMap(
    ({ descriptor, thumbnailSource, thumbnailsReady, items, failed }) =>
      items.map((item) => {
        const imageKey = thumbnailKey(item, descriptor, thumbnailSource);
        return {
          item,
          label: descriptor?.label ?? "",
          key: keyFor(item.ref),
          thumbnailKey: imageKey,
          thumbnail:
            descriptor && !failed && canPreview(item.mimeType)
              ? ({
                  item,
                  descriptor,
                  source: thumbnailSource,
                  ready: thumbnailsReady,
                  key: imageKey,
                } satisfies ThumbnailTarget)
              : undefined,
        };
      }),
  ),
);
const partial = computed(() =>
  pages.value.some((source) => source.failed || source.incomplete),
);
const more = computed(() => pages.value.some((source) => source.next));
const failedSource = computed(() => pages.value.some((page) => page.failed));
const sourceName = computed(
  () =>
    pages.value.find(
      (source) => source.plugin === selection.value?.ref.source.pluginId,
    )?.descriptor?.label ??
    installed.value.find(
      (source) => source.id === selection.value?.ref.source.pluginId,
    )?.manifest?.name ??
    "",
);
const canPreview = (type: string) => Object.hasOwn(previewFormats, type);
watch(
  rows,
  (values) =>
    thumbnails.replace(
      values.flatMap((row) => (row.thumbnail ? [row.thumbnail] : [])),
    ),
  { flush: "sync" },
);
watch(opening, (value) => thumbnails.pause(value), { flush: "sync" });
let listTurn = 0;
let openTurn = 0;
let controller: AbortController | undefined;
let restore = true;
let trigger: HTMLElement | null = null;
function previewErrorText(code: LibraryError | "failed") {
  switch (code) {
    case "not-found":
      return t("documents.notFound");
    case "permission":
      return t("documents.permission");
    case "authentication":
      return t("documents.authentication");
    case "unsupported":
      return t("documents.unsupported");
    case "too-large":
      return t("documents.tooLarge");
    case "failed":
      return t("documents.failed");
    default:
      return t("documents.unavailable");
  }
}

function keyFor(ref: DocumentReference) {
  return JSON.stringify([ref.source.pluginId, ref.source.instanceId, ref.id]);
}
function thumbnailSourceFor(
  plugin: (typeof candidates.value)[number],
  descriptor: LibraryDescriptor,
): ThumbnailSource | undefined {
  if (plugin.incarnation)
    return {
      ...descriptor.source,
      incarnation: plugin.incarnation,
      scopeId: descriptor.scope.id,
    };
}
function thumbnailKey(
  item: LibraryDocument,
  descriptor?: LibraryDescriptor,
  source?: ThumbnailSource,
) {
  return JSON.stringify([
    keyFor(item.ref),
    item.ref.identity,
    item.ref.revision,
    item.mimeType,
    descriptor?.scope.id,
    source?.incarnation,
  ]);
}
function retain() {
  emit("presentation", {
    query: query.value,
    draft: draft.value,
    scroll: results.value?.scrollTop ?? 0,
    ...(selection.value ? { document: { ...selection.value.ref } } : {}),
  });
}
async function describe(plugin: (typeof candidates.value)[number]) {
  const exports = plugin.manifest?.exports ?? [];
  if (
    plugin.status !== "loaded" ||
    !Object.values(LIBRARY_EXPORTS).every((name) => exports.includes(name))
  )
    throw new Error();
  const value = await runtime.value?.invokeDocumentSource(
    plugin.id,
    LIBRARY_EXPORTS.describe,
    {},
  );
  return validateLibraryDescriptor(value, plugin.id, exports);
}
async function fetchPage(
  plugin: (typeof candidates.value)[number],
  term: string,
  previous?: SourcePage,
): Promise<SourcePage> {
  let state: SourcePage = previous ?? { plugin: plugin.id, items: [] };
  try {
    const descriptor = state.descriptor ?? (await describe(plugin));
    state = {
      ...state,
      descriptor,
      thumbnailSource: thumbnailSourceFor(plugin, descriptor),
    };
    const operation = term ? "search" : "list";
    const args = {
      limit: Math.min(descriptor.limits.maxItems, 24),
      ...(term ? { query: term } : {}),
      ...(state.next ? { continuation: state.next } : {}),
    };
    const value = await runtime.value?.invokeDocumentSource(
      plugin.id,
      LIBRARY_EXPORTS[operation],
      args,
    );
    const result = validateLibraryResult(descriptor, operation, args, value);
    if (result.status === "error")
      return { ...state, descriptor, failed: true };
    const items = new Map(state.items.map((item) => [keyFor(item.ref), item]));
    for (const item of result.items) items.set(keyFor(item.ref), item);
    return {
      ...state,
      failed: false,
      items: [...items.values()],
      next: result.next,
      incomplete:
        result.status === "partial" &&
        (result.reason === "source-partial" || !result.next),
    };
  } catch {
    return { ...state, failed: true };
  }
}
async function load(append = false, action = false) {
  const turn = ++listTurn;
  const term = query.value;
  if (!append) pages.value = [];
  busy.value = true;
  const sources = candidates.value;
  const previous = pages.value;
  const fetched = await Promise.all(
    sources.map((plugin) => {
      const state = previous.find((source) => source.plugin === plugin.id);
      return append && state && !state.next
        ? state
        : fetchPage(plugin, term, state);
    }),
  );
  if (turn !== listTurn) return;
  const active = runtime.value;
  if (active) {
    const ready = Promise.all(
      fetched.flatMap(({ thumbnailSource, thumbnailsReady }) =>
        thumbnailSource && !thumbnailsReady
          ? [reconcileThumbnails(active.scope, thumbnailSource)]
          : [],
      ),
    );
    for (const source of fetched) {
      if (!source.thumbnailsReady) source.thumbnailsReady = ready;
    }
  }
  pages.value = fetched;
  busy.value = false;
  if (restore && sources.length) {
    restore = false;
    await nextTick();
    if (results.value) results.value.scrollTop = savedScroll;
  }
  if (action && fetched.some((source) => source.failed))
    emit(
      "error",
      t(term ? "documents.searchFailed" : "documents.browseFailed"),
    );
}
function search(term = draft.value.trim()) {
  draft.value = term;
  query.value = term;
  if (results.value) results.value.scrollTop = 0;
  retain();
  void load(false, true);
}
function clearSearch() {
  search("");
  searchInput.value?.focus({ preventScroll: true });
}

async function openDocument(userAction = false) {
  const turn = ++openTurn;
  controller?.abort();
  controller = new AbortController();
  const controllerForRead = controller;
  const signal = controllerForRead.signal;
  preview.value = undefined;
  previewError.value = undefined;
  const target = selection.value;
  if (!target) {
    opening.value = false;
    return;
  }
  opening.value = true;
  const plugin = candidates.value.find(
    ({ id }) => id === target.ref.source.pluginId,
  );
  if (
    !plugin &&
    !runtimeFailed.value &&
    props.plugins &&
    (!runtime.value || runtime.value.state.status === "loading")
  )
    return;
  try {
    if (!plugin) {
      previewError.value = "unavailable";
      return;
    }
    if (target.mimeType && !canPreview(target.mimeType)) {
      previewError.value = "unsupported";
      return;
    }
    const page = pages.value.find((source) => source.plugin === plugin.id);
    const descriptor = page?.descriptor ?? (await describe(plugin));
    const active = runtime.value;
    if (turn !== openTurn || !active) return;
    if (descriptor.source.instanceId !== target.ref.source.instanceId) {
      previewError.value = "not-found";
      return;
    }
    const row = rows.value.find(({ key }) => key === keyFor(target.ref));
    const expected =
      row?.item.ref.revision === target.ref.revision
        ? row?.thumbnail
        : undefined;
    const publishThumbnail = expected && thumbnails.prepare(expected.key);
    const result = await readLibraryOriginal(
      active,
      descriptor,
      target.ref,
      signal,
    );
    if (turn !== openTurn) return;
    if (result.status === "error") {
      if (
        result.error.code === "unavailable" ||
        result.error.code === "authentication" ||
        invalidatesThumbnail(result.error.code)
      ) {
        thumbnails.forget(plugin.id, target.ref.id);
      }
      if (invalidatesThumbnail(result.error.code)) {
        const source = thumbnailSourceFor(plugin, descriptor);
        if (source) void forgetThumbnail(active.scope, source, target.ref.id);
      }
      previewError.value = result.error.code;
      if (userAction && result.error.code !== "cancelled")
        emit("error", previewErrorText(result.error.code));
      return;
    }
    if (!canPreview(result.document.mimeType)) {
      previewError.value = "unsupported";
      return;
    }
    const bytes = await active.readDocumentBytes(result.original, signal);
    if (turn !== openTurn) return;
    if (expected?.item.mimeType === result.document.mimeType)
      publishThumbnail?.(bytes);
    preview.value = { document: result.document, bytes };
  } catch {
    if (turn === openTurn) previewFailed(userAction);
  } finally {
    if (turn === openTurn) opening.value = false;
    controllerForRead.abort();
  }
}
function previewFailed(notify = true) {
  preview.value = undefined;
  previewError.value = "failed";
  if (notify) emit("error", t("documents.failed"));
}
async function select(item: LibraryDocument, event: Event) {
  trigger = event.currentTarget as HTMLElement;
  selection.value = item;
  retain();
  void openDocument(true);
  await nextTick();
  previewHeading.value?.focus({ preventScroll: true });
}
async function closePreview() {
  selection.value = undefined;
  void openDocument();
  retain();
  await nextTick();
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  else if (searchInput.value) searchInput.value.focus({ preventScroll: true });
  else root.value?.focus({ preventScroll: true });
}
function sources(id?: string) {
  retain();
  emit("sources", id);
}
let loadedInventory: string | undefined;
watch(
  [inventory, () => runtime.value?.state.status, runtimeFailed],
  () => {
    if (runtime.value?.state.status === "loading") {
      if (loadedInventory !== inventory.value) {
        ++openTurn;
        controller?.abort();
        preview.value = undefined;
        opening.value = !!selection.value;
      }
      return;
    }
    const changed = loadedInventory !== inventory.value;
    loadedInventory = inventory.value;
    if (changed) void load();
    if (selection.value && (changed || opening.value)) void openDocument();
  },
  { immediate: true },
);
watch(
  [selection, inventory, () => preferences.value.language],
  async ([target, , locale], _, onCleanup) => {
    detailFields.value = [];
    const plugin = candidates.value.find(
      ({ id }) => id === target?.ref.source.pluginId,
    );
    if (!target || !plugin?.manifest?.exports?.includes(LIBRARY_DETAILS_EXPORT))
      return;
    const request = new AbortController();
    const { signal } = request;
    onCleanup(() => request.abort());
    try {
      const descriptor =
        pages.value.find((source) => source.plugin === plugin.id)?.descriptor ??
        (await describe(plugin));
      if (
        signal.aborted ||
        descriptor.source.instanceId !== target.ref.source.instanceId
      )
        return;
      const args = { ref: target.ref, locale };
      const value = await runtime.value?.invokeDocumentSource(
        plugin.id,
        LIBRARY_DETAILS_EXPORT,
        args,
        signal,
      );
      if (signal.aborted) return;
      const result = validateLibraryResult(descriptor, "details", args, value);
      if (result.status === "ok") detailFields.value = result.fields;
    } catch {
      // Supplementary metadata can be unavailable without affecting the original.
    }
  },
  { immediate: true },
);
const removeInvalidationListener = listen<ThumbnailInvalidation>(
  "document-thumbnails-invalidated",
  ({ payload }) => {
    if (payload.scope !== runtime.value?.scope) return;
    thumbnails.forget(
      payload.pluginId,
      payload.document?.id,
      payload.document?.source,
    );
    if (!payload.document) {
      const selected = selection.value;
      if (selected?.ref.source.pluginId !== payload.pluginId) {
        void load();
        return;
      }
      const turn = ++openTurn;
      controller?.abort();
      preview.value = undefined;
      previewError.value = undefined;
      opening.value = true;
      void load().then(() => {
        if (turn === openTurn) void openDocument();
      });
    }
  },
).catch(() => undefined);
onUnmounted(() => {
  ++listTurn;
  ++openTurn;
  controller?.abort();
  thumbnails.close();
  void removeInvalidationListener.then((remove) => remove?.());
});
</script>

<template>
  <main
    ref="root"
    class="documents-view"
    :class="{ 'documents-selected': selection }"
    :aria-label="t('documents.title')"
    tabindex="-1"
  >
    <div v-if="candidates.length || selection" class="doc-shell">
      <section class="doc-collection">
        <div class="doc-search-area">
          <form class="doc-search" role="search" @submit.prevent="search()">
            <div class="doc-search-box">
              <SituateIcon name="search" />
              <label :for="queryId" class="sr-only">{{
                t("documents.search")
              }}</label>
              <SituateInput
                ref="searchInput"
                :id="queryId"
                v-model="draft"
                appearance="plain"
                type="search"
                :maxlength="4096"
                enterkeyhint="search"
                :placeholder="t('documents.searchHint')"
              />
              <SituateButton
                v-if="query || draft"
                variant="plain"
                type="button"
                tabindex="0"
                :aria-label="t('documents.clear')"
                @click="clearSearch"
              >
                <SituateIcon name="close" />
              </SituateButton>
              <SituateButton
                variant="plain"
                type="submit"
                tabindex="0"
                :aria-label="t('documents.search')"
              >
                <SituateIcon name="search" />
              </SituateButton>
            </div>
          </form>
        </div>
        <div class="doc-results-heading">
          <div>
            <span role="status">{{
              busy
                ? t("documents.loading")
                : t("documents.count", { count: rows.length })
            }}</span>
            <SituateButton
              v-if="partial"
              variant="plain"
              class="doc-freshness"
              @click="sources()"
              ><SituateIcon name="info" />{{
                t("documents.incomplete")
              }}</SituateButton
            >
          </div>
        </div>
        <div ref="results" class="doc-results" :aria-busy="busy">
          <ul v-if="rows.length" class="doc-gallery">
            <li v-for="{ item, label, key, thumbnailKey } in rows" :key="key">
              <SituateButton
                variant="plain"
                class="doc-result"
                :aria-current="
                  selection && keyFor(selection.ref) === key
                    ? 'true'
                    : undefined
                "
                @click="select(item, $event)"
              >
                <DocumentThumbnail
                  :thumbnail-key="thumbnailKey"
                  :format="item.mimeType.split('/')[1]?.toUpperCase() ?? ''"
                  :image="thumbnails.images.get(thumbnailKey)"
                  :observe="thumbnails.observe"
                />
                <span class="doc-result-content"
                  ><strong data-localization-content="external">{{
                    item.title
                  }}</strong
                  ><span
                    class="doc-muted"
                    data-localization-content="identity"
                    >{{ label }}</span
                  ><span
                    v-if="item.excerpt"
                    class="doc-excerpt"
                    data-localization-content="external"
                    >{{ item.excerpt }}</span
                  ></span
                >
              </SituateButton>
            </li>
          </ul>
          <SituateEmptyState
            v-else-if="!busy && !partial"
            class="doc-status"
            :title="t(query ? 'documents.noResults' : 'documents.noDocuments')"
          />
          <SituateButton
            v-if="more && !busy"
            variant="secondary"
            class="doc-more"
            @click="load(true, true)"
            >{{ t("documents.loadMore") }}</SituateButton
          >
          <SituateButton
            v-if="!busy && failedSource"
            variant="secondary"
            class="doc-more"
            @click="load(false, true)"
            >{{ t("documents.retry") }}</SituateButton
          >
        </div>
      </section>
      <section
        v-if="selection"
        class="doc-preview"
        :aria-label="t('documents.preview')"
      >
        <header class="doc-preview-heading">
          <SituateButton
            variant="ghost"
            class="doc-preview-back"
            @click="closePreview"
            >‹ {{ t("documents.back") }}</SituateButton
          >
          <SituateIconButton
            icon="close"
            :label="t('documents.close')"
            class="doc-preview-close"
            @click="closePreview"
          />
          <h2 ref="previewHeading" tabindex="-1">
            <span
              v-if="preview || selection.title"
              data-localization-content="external"
              >{{ preview?.document.title ?? selection.title }}</span
            >
            <span v-else>{{ t("documents.preview") }}</span>
          </h2>
          <p
            v-if="sourceName"
            class="doc-muted"
            data-localization-content="identity"
          >
            {{ sourceName }}
          </p>
        </header>
        <div class="doc-preview-scroll">
          <div v-if="previewError" class="doc-status doc-preview-error">
            <p role="status">{{ previewErrorText(previewError) }}</p>
            <SituateButton
              v-if="previewError === 'unavailable' || previewError === 'failed'"
              variant="secondary"
              @click="openDocument(true)"
              >{{ t("documents.retry") }}</SituateButton
            >
            <SituateButton
              v-if="
                previewError !== 'unsupported' && previewError !== 'too-large'
              "
              variant="ghost"
              @click="sources(selection.ref.source.pluginId)"
              >{{ t("documents.sources") }}</SituateButton
            >
          </div>
          <DocumentReading
            v-else
            :key="`${keyFor(selection.ref)}:${selection.ref.revision ?? ''}`"
            :bytes="preview?.bytes"
            :title="preview?.document.title ?? selection.title"
            :mime-type="preview?.document.mimeType ?? selection.mimeType"
            @failed="previewFailed()"
          />
          <section
            v-if="fileFormat || detailFields.length"
            class="doc-metadata"
          >
            <SituateDisclosure open>
              <template #label>{{ t("documents.details") }}</template>
              <dl>
                <template v-if="fileFormat">
                  <dt>{{ t("documents.type") }}</dt>
                  <dd data-localization-content="external">{{ fileFormat }}</dd>
                </template>
                <template v-for="field in detailFields" :key="field.id">
                  <dt data-localization-content="external">
                    {{ field.label }}
                  </dt>
                  <dd data-localization-content="external">
                    {{ field.value }}
                  </dd>
                </template>
              </dl>
            </SituateDisclosure>
          </section>
        </div>
      </section>
    </div>
    <p
      v-else-if="
        props.plugins &&
        (!runtime || runtime.state.status === 'loading') &&
        !runtimeFailed
      "
      role="status"
      class="doc-status"
    >
      {{ t("documents.loading") }}
    </p>
    <SituateEmptyState
      v-else-if="!runtimeFailed"
      class="doc-empty-collection"
      :description="
        t(installed.length ? 'documents.noCompatible' : 'documents.emptyHelp')
      "
    >
      <template #title>
        <SituateIcon name="notes" />
        <h2>{{ t("documents.empty") }}</h2>
      </template>
      <template #actions>
        <SituateButton
          v-if="installed.length"
          variant="primary"
          size="small"
          @click="sources()"
        >
          {{ t("documents.sources") }}
        </SituateButton>
        <SituateButton
          v-else
          variant="primary"
          size="small"
          @click="emit('develop')"
        >
          <span aria-hidden="true">+</span> {{ t("documents.createSource") }}
        </SituateButton>
      </template>
    </SituateEmptyState>
    <SituateEmptyState
      v-else
      class="doc-status"
      :title="t('documents.noCompatibleTitle')"
      :description="t('documents.noCompatible')"
    >
      <template #actions>
        <SituateButton
          variant="primary"
          @click="installed.length ? sources() : emit('develop')"
          >{{
            t(installed.length ? "documents.sources" : "documents.connect")
          }}</SituateButton
        >
      </template>
    </SituateEmptyState>
  </main>
</template>
