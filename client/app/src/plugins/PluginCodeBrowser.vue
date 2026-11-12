<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  useId,
  watch,
} from "vue";
import { invoke } from "@tauri-apps/api/core";
import { t, localizeError } from "@situate/localization";
import { SituateIcon, SituateButton, SituateInput } from "@situate/ui";
import SituateErrorScreen from "../components/SituateErrorScreen.vue";
import { codeRows, createCodeBrowser } from "./code-browser";
import SourceText from "../files/SourceText.vue";
import { highlightSource } from "../files/source-highlighting";
const props = defineProps<{
  scope: string;
  pluginId: string;
  refreshKey?: unknown;
}>();
const emit = defineEmits<{ pane: [value: "tree" | "file"] }>();
const id = useId();
const title = ref<HTMLElement>();
const filter = ref<InstanceType<typeof SituateInput>>();
const documentPane = ref<HTMLElement>();
const state = reactive(createCodeBrowser());
const files = ref<{ path: string; isDirectory: boolean }[]>([]);
const text = ref("");
const tokens = computed(() => highlightSource(text.value, state.selected));
const reading = ref(false);
const unsupported = computed(() =>
  /\.(?:png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|wasm|woff2?|ttf|otf|mp[34]|wav)$/i.test(
    state.selected,
  ),
);
const error = ref<unknown>();
let generation = 0;
let selection = 0;
const rows = computed(() =>
  codeRows(
    files.value.filter((f) => !f.isDirectory),
    state,
    files.value.filter((f) => f.isDirectory).map((f) => f.path),
  ),
);
const file = computed(() =>
  files.value.find((f) => f.path === state.selected && !f.isDirectory),
);
function update(patch: Partial<typeof state>) {
  Object.assign(state, patch);
  emit("pane", state.status === "ready" ? state.pane : "tree");
}
async function select(path: string, focus = true) {
  const current = generation,
    request = ++selection;
  const scope = props.scope,
    pluginId = props.pluginId;
  update({ selected: path, ...(focus ? { pane: "file" as const } : {}) });
  text.value = "";
  reading.value = true;
  await nextTick();
  if (generation !== current || request !== selection) return;
  if (focus) title.value?.focus();
  if (documentPane.value) documentPane.value.scrollTop = 0;
  if (unsupported.value) {
    reading.value = false;
    return;
  }
  try {
    const reply = await invoke<{ text: string }>("plugins_source", {
      scope,
      request: { operation: "read", pluginId, path },
    });
    if (generation === current && request === selection)
      text.value = reply.text;
  } catch (cause) {
    if (generation === current && request === selection) {
      error.value = cause;
      update({ status: "error" });
    }
  } finally {
    if (generation === current && request === selection) reading.value = false;
  }
}
function toggle(path: string) {
  state.expanded = state.expanded.includes(path)
    ? state.expanded.filter((p) => p !== path)
    : [...state.expanded, path];
}
async function showTree() {
  update({ pane: "tree" });
  await nextTick();
  filter.value?.element?.focus();
}
const retry = ref(0);
watch(
  () => [props.scope, props.pluginId, props.refreshKey, retry.value],
  async (_, previous) => {
    const current = ++generation;
    ++selection;
    const changed =
      !previous ||
      previous[0] !== props.scope ||
      previous[1] !== props.pluginId;
    if (changed) {
      Object.assign(state, createCodeBrowser());
      files.value = [];
      text.value = "";
    }
    update({ status: "loading" });
    try {
      const reply = await invoke<{
        files: { path: string; isDirectory: boolean }[];
      }>("plugins_source", {
        scope: props.scope,
        request: { operation: "files", pluginId: props.pluginId },
      });
      if (generation !== current) return;
      files.value = reply.files;
      update({ status: "ready" });
      if (file.value) await select(state.selected, false);
      else update({ selected: "", pane: "tree" });
    } catch (cause) {
      if (generation === current) {
        error.value = cause;
        update({ status: "error" });
      }
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  ++generation;
  ++selection;
});
defineExpose({ showTree });
</script>
<template>
  <section
    class="plugin-code-browser code-sidebar"
    :aria-label="t('pluginDevelopment.files')"
  >
    <div v-if="state.status !== 'ready'" class="code-feedback">
      <p v-if="state.status === 'loading'" role="status">
        {{ t("pluginDevelopment.loadingFiles") }}
      </p>
      <template
        v-else-if="
          state.status === 'error' && error === 'native.plugins.readFailed'
        "
      >
        <p role="alert">{{ localizeError(error) }}</p>
        <SituateButton variant="secondary" size="small" @click="retry++">{{
          t("pluginDevelopment.retryFiles")
        }}</SituateButton>
      </template>
      <SituateErrorScreen
        v-else-if="state.status === 'error'"
        :message="localizeError(error)"
      />
      <p v-else>{{ t("pluginDevelopment.noCodeFiles") }}</p>
    </div>
    <div
      v-else
      class="code-layout"
      :class="{ 'code-show-tree': state.pane === 'tree' }"
    >
      <aside
        class="code-tree-pane"
        :aria-label="t('pluginDevelopment.codeFolder')"
        @focusin="state.pane !== 'tree' && update({ pane: 'tree' })"
      >
        <header v-if="file" class="code-tree-header">
          <SituateButton
            variant="plain"
            v-if="file"
            class="code-mobile-button"
            @click="select(state.selected)"
          >
            {{ t("pluginDevelopment.backToFile") }}
          </SituateButton>
        </header>
        <SituateInput
          appearance="plain"
          ref="filter"
          class="code-filter"
          type="search"
          :aria-label="t('pluginDevelopment.filterFiles')"
          :placeholder="t('pluginDevelopment.fileFilter')"
          :value="state.query"
          @input="update({ query: ($event.target as HTMLInputElement).value })"
        />
        <nav class="code-tree" :aria-label="t('pluginDevelopment.fileTree')">
          <SituateButton
            variant="plain"
            v-for="row in rows"
            :key="row.path"
            class="code-entry"
            :style="{ paddingInlineStart: `${8 + row.depth * 12}px` }"
            :aria-expanded="row.folder ? row.expanded : undefined"
            :aria-current="
              !row.folder && row.path === state.selected ? 'true' : undefined
            "
            :title="row.path"
            @click="row.folder ? toggle(row.path) : select(row.path)"
          >
            <span
              v-if="row.folder"
              class="code-chevron"
              :class="{ expanded: row.expanded }"
              aria-hidden="true"
              >›</span
            >
            <SituateIcon :name="row.folder ? 'folder' : 'notes'" /><span
              data-localization-content="user"
              >{{ row.name }}</span
            >
          </SituateButton>
          <div v-if="!rows.length" class="code-empty">
            <p>
              {{
                state.query
                  ? t("pluginDevelopment.noMatchingFiles")
                  : t("pluginDevelopment.noCodeFiles")
              }}
            </p>
            <SituateButton
              variant="ghost"
              size="small"
              v-if="state.query"
              class="plugin-text"
              @click="update({ query: '' })"
            >
              {{ t("pluginDevelopment.clearFileFilter") }}
            </SituateButton>
          </div>
        </nav>
      </aside>
      <section
        class="code-document"
        :aria-label="t('pluginDevelopment.fileContent')"
        @focusin="state.pane !== 'file' && update({ pane: 'file' })"
      >
        <header class="code-document-header">
          <div class="code-location">
            <p v-if="file?.path.includes('/')" data-localization-content="user">
              {{ file.path.split("/").slice(0, -1).join(" / ") }}
            </p>
            <h3 data-localization-content="user" ref="title" tabindex="-1">
              {{ file?.path.split("/").at(-1) || t("pluginDevelopment.files") }}
            </h3>
          </div>
        </header>
        <div
          ref="documentPane"
          class="code-document-scroll"
          tabindex="0"
          :aria-label="t('pluginDevelopment.fileContent')"
          :id="id"
        >
          <p v-if="!file" class="code-empty">
            {{ t("pluginDevelopment.chooseFile") }}
          </p>
          <div v-else-if="unsupported" class="code-empty">
            <h4>{{ t("pluginDevelopment.binaryFile") }}</h4>
            <p>{{ t("pluginDevelopment.noFilePreview") }}</p>
          </div>
          <p v-else-if="reading" role="status">
            {{ t("pluginDevelopment.loadingFiles") }}
          </p>
          <pre
            v-else
            class="code-source"
            :aria-label="t('pluginDevelopment.fileSource')"
          ><SourceText :tokens="tokens"/></pre>
        </div>
      </section>
    </div>
  </section>
</template>
<style scoped>
.plugin-code-browser {
  container: plugin-code / inline-size;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--situate-surface);
  overflow: hidden;
  min-width: 0;
}
.code-layout {
  display: grid;
  grid-template-columns: 228px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.code-tree-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: color-mix(
    in srgb,
    var(--situate-paper) 45%,
    var(--situate-surface)
  );
  border-right: 1px solid var(--situate-line);
}
.code-tree-header {
  padding: 6px 16px;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--situate-muted);
}
.code-filter {
  min-width: 0;
  min-height: 44px;
  margin: 0 16px 16px;
  padding: 10px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-small);
  background: transparent;
  font: inherit;
  font-size: 13px;
}
.code-sidebar .code-filter {
  margin-top: 16px;
  font-size: 16px;
}
.code-sidebar .code-layout {
  grid-template-columns: minmax(0, 1fr);
}
.code-sidebar .code-tree-pane {
  display: none;
  border: 0;
}
.code-sidebar .code-show-tree .code-tree-pane {
  display: flex;
}
.code-sidebar .code-show-tree .code-document {
  display: none;
}
.code-sidebar .code-mobile-button {
  display: block;
}
.code-tree {
  overflow: auto;
  flex: 1;
  min-height: 0;
  padding: 0 10px 24px;
}
.code-entry {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 44px;
  padding: 8px;
  margin-block: 2px;
  border: 0;
  border-radius: var(--situate-radius-small);
  background: transparent;
  color: var(--situate-muted);
  text-align: start;
  font: inherit;
  font-size: 13px;
}
.code-entry svg {
  flex-shrink: 0;
  width: 17px;
  height: 17px;
}
.code-entry > span:last-child {
  overflow-wrap: anywhere;
  min-width: 0;
}
.code-entry[aria-expanded] {
  color: var(--situate-ink);
}
.code-entry:hover,
.code-entry[aria-current] {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.code-entry[aria-current] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.code-chevron {
  width: 10px;
  font-size: 18px;
  flex-shrink: 0;
}
.code-chevron.expanded {
  transform: rotate(90deg);
}
.code-document {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.code-document-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  min-height: 56px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--situate-line);
}
.code-location {
  min-width: 0;
  flex: 1;
}
.code-location p {
  margin: 0;
  font-size: 11px;
  color: var(--situate-muted);
}
.code-location h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.code-mobile-button {
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  padding: 8px 12px;
  font: inherit;
  font-size: 13px;
  color: var(--situate-muted);
}
.code-mobile-button {
  display: none;
}
.code-document-scroll {
  overflow: auto;
  min-height: 0;
  flex: 1;
}
.plugin-code-browser .code-source {
  font: 13px/1.7 var(--situate-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  padding: 24px;
}
.code-feedback,
.code-empty {
  padding: 24px;
  font-size: 14px;
  color: var(--situate-muted);
}
:is(button, input, [tabindex]):focus:where(
    html:not([data-input-modality="pointer"]) *
  ) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
</style>
