<script setup lang="ts">
import SituateMenu from "../ui/SituateMenu.vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import {
  SituateIcon,
  SituateIconButton,
  SituateResizeHandle,
  SituateButton,
  SituateInput,
  SituateCheckbox,
} from "../ui";
import SituateSelect from "../ui/SituateSelect.vue";
import EditorDialog from "../editor/EditorDialog.vue";
import DocumentBrowse from "./DocumentBrowse.vue";
import DocumentPreview from "./DocumentPreview.vue";
import DocumentFilters from "./DocumentFilters.vue";
import DocumentTagCreate from "./DocumentTagCreate.vue";
import DocumentTagDelete from "./DocumentTagDelete.vue";
import { beginTagCreation } from "./tags";
import DocumentThumbnail from "./DocumentThumbnail.vue";
import { c } from "./content";
import { workshopNavigation } from "../workshop/content";
import {
  clearSelection,
  clone,
  incomplete,
  results,
  saveView,
  selectDocument,
  tagPath,
  type DocumentDialog,
  type DocumentsState,
} from "./model";
import "./documents.css";
const props = defineProps<{
  state: DocumentsState;
  mobile?: boolean;
  navigationId?: string;
  navigationOpen?: boolean;
  showNavigation?: boolean;
}>();
const emit = defineEmits<{
  "update:state": [state: DocumentsState];
  openNavigation: [event: MouseEvent];
  sources: [action: "list" | "create" | "detail", id?: string];
}>();
const state = shallowRef(props.state);
const sidebarWidth = ref(props.state.sidebarWidth);
const resizingSidebar = ref(false);
watch(
  () => props.state,
  (s) => {
    state.value = s;
    if (!resizingSidebar.value) sidebarWidth.value = s.sidebarWidth;
  },
  { flush: "sync" },
);
const root = ref<HTMLElement>();
const resizeHandle = ref<InstanceType<typeof SituateResizeHandle>>();
const availableWidth = ref(840);
const sidebarMaximum = computed(() =>
  Math.max(
    224,
    Math.min(
      480,
      Math.floor(availableWidth.value) - (state.value.selected ? 820 : 568),
    ),
  ),
);
const displayedSidebarWidth = computed(() =>
  Math.max(224, Math.min(sidebarMaximum.value, sidebarWidth.value)),
);
let observer: ResizeObserver | undefined;
function recoverSidebarFocus(lostFocus = false) {
  const sidebar = root.value?.querySelector<HTMLElement>(
    ".doc-library-navigation",
  );
  if (!sidebar || sidebar.getClientRects().length) return;
  resizeHandle.value?.cancel();
  if (lostFocus || sidebar.contains(document.activeElement)) {
    const browse = root.value?.querySelector<HTMLElement>(
      ".doc-browse-trigger",
    );
    (browse?.getClientRects().length
      ? browse
      : root.value?.querySelector<HTMLElement>("[data-doc-title]")
    )?.focus({ preventScroll: true });
  }
}
function sidebarFocusOut(event: FocusEvent) {
  if (
    !event.relatedTarget &&
    !(event.currentTarget as HTMLElement).getClientRects().length
  )
    void nextTick(() => recoverSidebarFocus(true));
}
onMounted(() => {
  void nextTick(() => {
    const results = root.value?.querySelector<HTMLElement>(".doc-results");
    const collection =
      root.value?.querySelector<HTMLElement>(".doc-collection");
    if (results) results.scrollTop = state.value.scroll.results;
    if (collection) collection.scrollTop = state.value.scroll.collection;
    if (state.value.returnFocus) {
      const selector = state.value.selected
        ? "[data-document-heading]"
        : state.value.returnFocus === "actions"
          ? ".doc-header-action"
          : "#doc-query";
      const target =
        root.value?.querySelector<HTMLElement>(selector) ??
        root.value?.querySelector<HTMLElement>(
          ".doc-empty-collection button, [data-doc-title]",
        );
      target?.focus({ preventScroll: true });
      update((s) => {
        s.returnFocus = null;
      });
    }
  });
  if (!root.value || typeof ResizeObserver === "undefined") return;
  availableWidth.value = root.value.clientWidth;
  observer = new ResizeObserver(([entry]) => {
    if (entry) availableWidth.value = entry.contentRect.width;
    void nextTick(recoverSidebarFocus);
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => [state.value.selected, state.value.layout, props.mobile],
  () => void nextTick(recoverSidebarFocus),
);
function sidebarDragging(active: boolean) {
  resizingSidebar.value = active;
  if (!active) sidebarWidth.value = state.value.sidebarWidth;
}
function saveSidebarWidth(width: number) {
  update((s) => {
    s.sidebarWidth = width;
  });
}
function change(s: DocumentsState) {
  state.value = s;
  emit("update:state", s);
}
function update(fn: (s: DocumentsState) => void) {
  const s = clone(state.value);
  fn(s);
  change(s);
}
const matches = computed(() => results(state.value));
const savedViewName = computed(
  () =>
    state.value.saved.find((view) => view.id === state.value.activeSaved)?.name,
);
const filtered = computed(
  () =>
    !!(
      state.value.query ||
      state.value.untagged ||
      state.value.filter.tags.length
    ),
);
const currentDoc = computed(() =>
  state.value.documents.find((d) => d.id === state.value.selected),
);
function value(event: Event) {
  return (event.target as HTMLInputElement).value;
}
async function clearSearch() {
  update(clearSelection);
  await nextTick();
  root.value?.querySelector<HTMLInputElement>("#doc-query")?.focus();
}
function search() {
  update((s) => {
    s.query = s.draftQuery;
    s.selected = null;
    s.opening = null;
    s.activeSaved = null;
    s.searchState = "ready";
    s.sort = "relevance";
    s.notice = "";
  });
}
function dialog(kind: DocumentDialog, event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus();
  update((s) => {
    s.dialog = kind;
    if (kind === "save") {
      s.draftName = "";
      s.query = s.draftQuery;
      s.searchState = "ready";
    }
  });
}
function newTag(event: MouseEvent, forDocument = false) {
  (event.currentTarget as HTMLElement).focus();
  update((s) => beginTagCreation(s, forDocument));
}
function collectionActions(event: MouseEvent | KeyboardEvent) {
  const button = event.currentTarget as HTMLElement;
  button.focus();
  const rect = button.getBoundingClientRect();
  update((s) => {
    s.collectionMenu = { x: rect.left, y: rect.bottom };
  });
}
function tagActions(id: string, event: MouseEvent) {
  const button = event.currentTarget as HTMLElement;
  button.focus();
  const rect = button.getBoundingClientRect();
  update((s) => {
    s.tagMenu = { id, x: rect.left, y: rect.bottom };
  });
}
function requestTagDeletion() {
  update((s) => {
    if (!s.tagMenu) return;
    s.tagDeletion = { id: s.tagMenu.id, descendants: false, error: null };
    s.tagMenu = null;
  });
}
async function afterTagDeletion(id: string | null) {
  await nextTick();
  const selectors = [
    id ? `[data-tag-actions="${CSS.escape(id)}"]` : "",
    ".doc-tag-heading button",
    ".doc-browse-trigger",
    "[data-doc-title]",
  ].filter(Boolean);
  for (const selector of selectors) {
    const target = [
      ...(root.value?.querySelectorAll<HTMLElement>(selector) ?? []),
    ].find((element) => element.getClientRects().length);
    if (target) {
      target.focus();
      break;
    }
  }
}
async function inspect(id: string) {
  update((s) => selectDocument(s, id));
  await nextTick();
  root.value?.querySelector<HTMLElement>("[data-document-heading]")?.focus();
}
async function closePreview() {
  const id = state.value.selected;
  update((s) => {
    s.selected = null;
    s.opening = null;
  });
  await nextTick();
  root.value?.querySelector<HTMLElement>(`[data-document="${id}"]`)?.focus();
}
function sources(action: "list" | "create" | "detail", id?: string) {
  update((s) => {
    s.collectionMenu = null;
    s.returnFocus = s.selected
      ? "preview"
      : action === "list"
        ? "actions"
        : "query";
    s.scroll = {
      collection:
        root.value?.querySelector<HTMLElement>(".doc-collection")?.scrollTop ??
        0,
      results:
        root.value?.querySelector<HTMLElement>(".doc-results")?.scrollTop ?? 0,
    };
  });
  emit("sources", action, id);
}
</script>
<template>
  <main
    ref="root"
    class="documents-view"
    :class="{
      'documents-mobile': mobile,
      'documents-focused': state.layout === 'focused',
      'documents-selected': !!state.selected,
    }"
  >
    <div class="doc-workspace-heading">
      <SituateIconButton
        v-if="showNavigation"
        icon="menu"
        :label="workshopNavigation.openNavigation"
        :aria-controls="navigationId"
        :aria-expanded="navigationOpen"
        @click="emit('openNavigation', $event)"
      />
      <SituateIcon name="notes" class="doc-heading-icon" />
      <h1 tabindex="-1" data-doc-title>{{ c.title }}</h1>
      <SituateIconButton
        icon="more"
        :label="c.collectionActions"
        class="doc-header-action"
        aria-haspopup="menu"
        :aria-expanded="!!state.collectionMenu"
        :aria-controls="state.collectionMenu ? 'doc-actions-menu' : undefined"
        @click="collectionActions"
        @keydown.down.prevent="collectionActions"
        @keydown.up.prevent="collectionActions"
      />
    </div>
    <div v-if="!state.sources.length" class="doc-empty-collection">
      <SituateIcon name="notes" />
      <h2>{{ c.empty }}</h2>
      <p>{{ c.emptyHelp }}</p>
      <SituateButton variant="primary" size="small" @click="sources('create')">
        + {{ c.connect }}
      </SituateButton>
    </div>
    <div v-else class="doc-collection-shell">
      <aside
        id="doc-tag-sidebar"
        class="doc-library-navigation"
        :style="{ flexBasis: `${displayedSidebarWidth}px` }"
        @focusout="sidebarFocusOut"
      >
        <div class="doc-sidebar-scroll">
          <DocumentBrowse
            :state="state"
            @change="change"
            @new-tag="newTag"
            @tag-actions="tagActions"
          />
        </div>
        <SituateResizeHandle
          ref="resizeHandle"
          :model-value="displayedSidebarWidth"
          :min="224"
          :max="sidebarMaximum"
          :reset-value="272"
          :label="c.resizeSidebar"
          controls="doc-tag-sidebar"
          @update:model-value="sidebarWidth = $event"
          @change="saveSidebarWidth"
          @dragging="sidebarDragging"
        />
      </aside>
      <section class="doc-collection">
        <div class="doc-search-area">
          <form class="doc-search" role="search" @submit.prevent="search">
            <label for="doc-query" class="sr-only">{{ c.search }}</label>
            <div class="doc-search-box">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                aria-hidden="true"
              >
                <circle cx="10" cy="10" r="6" />
                <path d="m15 15 5 5" /></svg
              ><SituateInput
                appearance="plain"
                id="doc-query"
                type="search"
                enterkeyhint="search"
                :placeholder="c.searchHint"
                :value="state.draftQuery"
                @input="
                  update((s) => {
                    s.draftQuery = value($event);
                  })
                "
              /><SituateButton
                variant="plain"
                type="submit"
                tabindex="0"
                :aria-label="c.search"
              >
                <SituateIcon name="enter" />
              </SituateButton>
            </div>
            <SituateButton
              variant="plain"
              type="button"
              class="doc-toolbar-button doc-browse-trigger"
              @click="dialog('browse', $event)"
            >
              {{ c.browse }}
            </SituateButton>
          </form>
          <DocumentFilters :state="state" @change="change">
            <div class="doc-filter-actions">
              <SituateButton
                variant="plain"
                v-if="filtered"
                class="doc-toolbar-button doc-clear"
                type="button"
                :aria-label="c.clear"
                :title="c.clear"
                @click="clearSearch"
              >
                {{ c.clearShort }}
              </SituateButton>
              <SituateButton
                variant="plain"
                class="doc-toolbar-button doc-save-view"
                @click="dialog('save', $event)"
              >
                {{ c.save }}
              </SituateButton>
            </div>
          </DocumentFilters>
        </div>
        <div class="doc-results-heading">
          <div class="doc-results-context">
            <h2 v-if="savedViewName">{{ savedViewName }}</h2>
            <div class="doc-results-summary">
              <span role="status" class="doc-search-status">
                <span
                  v-if="state.searchState === 'loading'"
                  class="doc-search-spinner"
                  aria-hidden="true"
                ></span>
                {{
                  state.searchState === "ready"
                    ? c.documentCount(matches.length)
                    : state.searchState === "error"
                      ? c.searchErrorStatus
                      : c.loading
                }}
              </span>
              <SituateButton
                variant="plain"
                v-if="incomplete(state)"
                class="doc-freshness"
                :aria-label="c.reviewFreshness"
                @click="sources('list')"
              >
                <SituateIcon name="info" />
                <span>{{ c.freshness }}</span>
              </SituateButton>
            </div>
          </div>
          <SituateSelect
            appearance="toolbar"
            class="doc-sort"
            :aria-label="c.sort"
            :value="state.sort"
            @change="
              update((s) => {
                s.sort = value($event) as DocumentsState['sort'];
              })
            "
            ><option value="newest">{{ c.newest }}</option>
            <option value="relevance">
              {{ c.relevance }}
            </option></SituateSelect
          >
        </div>
        <p
          v-if="state.notice === 'saved' || state.notice === 'tags'"
          role="status"
          class="doc-inline-status"
        >
          {{ state.notice === "saved" ? c.savedMessage : c.tagSaved }}
        </p>
        <div class="doc-results" :aria-busy="state.searchState === 'loading'">
          <div
            v-if="state.searchState === 'loading'"
            class="doc-skeleton"
            aria-hidden="true"
          >
            <div></div>
            <div></div>
            <div></div>
          </div>
          <div
            v-else-if="state.searchState === 'error'"
            class="doc-empty"
            role="alert"
          >
            <h3>{{ c.searchFailed }}</h3>
            <SituateButton
              variant="secondary"
              size="small"
              @click="
                update((s) => {
                  s.searchState = 'ready';
                })
              "
            >
              {{ c.retry }}
            </SituateButton>
          </div>
          <div v-else-if="!matches.length" class="doc-empty">
            <h3>{{ c.noResults }}</h3>
            <p>{{ c.noResultsHelp }}</p>
            <p v-if="incomplete(state)">{{ c.incompleteHelp }}</p>
            <SituateButton
              variant="secondary"
              size="small"
              @click="update(clearSelection)"
            >
              {{ c.clear }}
            </SituateButton>
          </div>
          <ul v-else class="doc-gallery">
            <li v-for="doc in matches" :key="doc.id">
              <SituateButton
                variant="plain"
                type="button"
                class="doc-result"
                :data-document="doc.id"
                :aria-current="state.selected === doc.id ? 'true' : undefined"
                @click="inspect(doc.id)"
              >
                <DocumentThumbnail
                  :document="doc"
                  :mode="state.thumbnailMode"
                />
                <span class="doc-result-content"
                  ><strong>{{ doc.title }}</strong
                  ><span class="doc-result-meta"
                    >{{
                      state.sources.find((s) => s.id === doc.source)?.name
                    }}
                    · {{ doc.date }}</span
                  ><span
                    v-if="state.query && doc.excerpt"
                    class="doc-excerpt"
                    >{{ doc.excerpt }}</span
                  ><span class="doc-result-tags"
                    ><span v-for="id in doc.tags.slice(0, 3)" :key="id">{{
                      state.tags.find((t) => t.id === id)?.name
                    }}</span
                    ><span v-if="!doc.tags.length">{{ c.noTags }}</span></span
                  ><span
                    v-if="doc.availability !== 'available'"
                    class="doc-result-status"
                    >{{
                      doc.availability === "other-device"
                        ? c.otherDevice
                        : c.offline
                    }}</span
                  ><span
                    v-if="doc.preparation !== 'ready'"
                    class="doc-result-status"
                    >{{
                      doc.preparation === "pending"
                        ? c.preparing
                        : c.preparationFailed
                    }}</span
                  ></span
                >
              </SituateButton>
            </li>
          </ul>
        </div>
      </section>
      <DocumentPreview
        v-if="currentDoc"
        :state="state"
        @change="change"
        @close="closePreview"
        @source="sources('detail', $event)"
      />
    </div>
    <EditorDialog
      v-if="state.dialog"
      :title="
        state.dialog === 'browse'
          ? c.browseTitle
          : state.dialog === 'save'
            ? c.saveTitle
            : c.tagTitle
      "
      class="doc-dialog"
      @close="
        update((s) => {
          s.dialog = null;
        })
      "
    >
      <DocumentBrowse
        v-if="state.dialog === 'browse'"
        :state="state"
        @change="change"
        @new-tag="newTag"
        @tag-actions="tagActions"
      />
      <form
        v-else-if="state.dialog === 'save'"
        @submit.prevent="update(saveView)"
      >
        <p>{{ c.viewHint }}</p>
        <label for="doc-view-name">{{ c.viewName }}</label
        ><SituateInput
          id="doc-view-name"
          autofocus
          required
          :value="state.draftName"
          @input="
            update((s) => {
              s.draftName = value($event);
            })
          "
        />
        <label class="doc-check"
          ><SituateCheckbox
            appearance="plain"
            type="checkbox"
            :checked="state.draftPinned"
            @change="
              update((s) => {
                s.draftPinned = !s.draftPinned;
              })
            "
          />{{ c.pin }}</label
        >
        <div class="doc-dialog-actions">
          <SituateButton
            variant="primary"
            size="small"
            type="submit"
            :disabled="!state.draftName.trim()"
          >
            {{ c.saveConfirm }}</SituateButton
          ><SituateButton
            variant="ghost"
            size="small"
            type="button"
            class="doc-text"
            @click="
              update((s) => {
                s.dialog = null;
              })
            "
          >
            {{ c.cancel }}
          </SituateButton>
        </div>
      </form>
      <form
        v-else-if="state.dialog === 'tags' && currentDoc"
        @submit.prevent="
          update((s) => {
            const doc = s.documents.find((d) => d.id === s.selected)!;
            doc.tags = [...s.draftTags];
            s.dialog = null;
            s.notice = 'tags';
          })
        "
      >
        <SituateButton
          variant="secondary"
          size="small"
          type="button"
          @click="newTag($event, true)"
        >
          <SituateIcon name="plus" />{{ c.newTag }}
        </SituateButton>
        <p
          v-if="state.notice === 'tag-created' && state.createdTagId"
          class="doc-muted"
          role="status"
        >
          {{ c.tagCreated(tagPath(state.tags, state.createdTagId)) }}
        </p>
        <p v-if="!state.tags.length" class="doc-muted">
          {{ c.noWorkspaceTags }}
        </p>
        <label v-for="tag in state.tags" :key="tag.id" class="doc-check"
          ><SituateCheckbox
            appearance="plain"
            type="checkbox"
            :checked="state.draftTags.includes(tag.id)"
            @change="
              update((s) => {
                s.draftTags = s.draftTags.includes(tag.id)
                  ? s.draftTags.filter((t) => t !== tag.id)
                  : [...s.draftTags, tag.id];
              })
            "
          />{{ tagPath(state.tags, tag.id) }}</label
        >
        <div class="doc-dialog-actions">
          <SituateButton variant="primary" size="small" type="submit">
            {{ c.tagSave }}</SituateButton
          ><SituateButton
            variant="ghost"
            size="small"
            type="button"
            class="doc-text"
            @click="
              update((s) => {
                s.dialog = null;
              })
            "
          >
            {{ c.cancel }}
          </SituateButton>
        </div>
      </form>
    </EditorDialog>
    <SituateMenu
      v-if="state.collectionMenu"
      id="doc-actions-menu"
      :label="c.collectionActions"
      :open="true"
      :close-on-select="false"
      :point="state.collectionMenu"
      @close="
        update((s) => {
          s.collectionMenu = null;
        })
      "
    >
      <div>
        <SituateButton
          variant="plain"
          type="button"
          role="menuitem"
          tabindex="-1"
          class="doc-nav-item doc-collection-action"
          @click="sources('list')"
        >
          {{ c.sources }}
        </SituateButton>
      </div>
    </SituateMenu>
    <SituateMenu
      v-if="state.tagMenu"
      :label="c.tagActions(tagPath(state.tags, state.tagMenu.id))"
      :open="true"
      :close-on-select="false"
      :point="state.tagMenu"
      class="doc-tag-menu"
      @close="
        update((s) => {
          s.tagMenu = null;
        })
      "
    >
      <div :aria-label="c.tagActions(tagPath(state.tags, state.tagMenu.id))">
        <SituateButton
          variant="plain"
          type="button"
          role="menuitem"
          tabindex="-1"
          class="doc-nav-item"
          @click="requestTagDeletion"
        >
          {{ c.deleteTag }}
        </SituateButton>
      </div>
    </SituateMenu>
    <DocumentTagDelete
      v-if="state.tagDeletion"
      :state="state"
      @change="change"
      @closed="afterTagDeletion"
    />
    <DocumentTagCreate
      v-if="state.tagCreation"
      :state="state"
      @change="change"
    />
  </main>
</template>
