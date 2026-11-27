<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from "vue";
import {
  SituateIcon,
  SituateIconButton,
  SituateButton,
  SituateInput,
  SituateEmptyState,
} from "../ui";
import SituateSelect from "../ui/SituateSelect.vue";
import DocumentPreview from "./DocumentPreview.vue";
import DocumentThumbnail from "./DocumentThumbnail.vue";
import { c } from "./content";
import { workshopNavigation } from "../workshop/content";
import {
  clearSelection,
  clone,
  closeDocument,
  incomplete,
  results,
  selectDocument,
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
watch(
  () => props.state,
  (s) => {
    state.value = s;
  },
  { flush: "sync" },
);
const root = ref<HTMLElement>();
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
        : state.value.returnFocus === "freshness"
          ? ".doc-freshness"
          : "#doc-query";
      const target =
        root.value?.querySelector<HTMLElement>(selector) ??
        root.value?.querySelector<HTMLElement>(
          "#doc-query, .doc-empty-collection button",
        ) ??
        root.value;
      target?.focus({ preventScroll: true });
      update((s) => {
        s.returnFocus = null;
      });
    }
  });
});
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
const hasQuery = computed(
  () => !!(state.value.query || state.value.draftQuery),
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
    closeDocument(s);
    s.searchState = "ready";
    s.sort = s.query.trim() ? "relevance" : "newest";
  });
}
async function inspect(id: string) {
  update((s) => selectDocument(s, id));
  await nextTick();
  root.value?.querySelector<HTMLElement>("[data-document-heading]")?.focus();
}
async function closePreview() {
  const id = state.value.selected;
  update(closeDocument);
  await nextTick();
  root.value?.querySelector<HTMLElement>(`[data-document="${id}"]`)?.focus();
}
function sources(action: "list" | "create" | "detail", id?: string) {
  update((s) => {
    s.returnFocus = s.selected
      ? "preview"
      : action === "list"
        ? "freshness"
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
      'documents-selected': !!state.selected,
    }"
    :aria-label="c.title"
    tabindex="-1"
  >
    <SituateIconButton
      v-if="showNavigation && !state.sources.length"
      class="doc-empty-navigation"
      icon="menu"
      :label="workshopNavigation.openNavigation"
      :aria-controls="navigationId"
      :aria-expanded="navigationOpen"
      @click="emit('openNavigation', $event)"
    />
    <SituateEmptyState
      v-if="!state.sources.length"
      class="doc-empty-collection"
      :description="c.emptyHelp"
    >
      <template #title>
        <SituateIcon name="notes" />
        <h2>{{ c.empty }}</h2>
      </template>
      <template #actions>
        <SituateButton
          variant="primary"
          size="small"
          @click="sources('create')"
        >
          + {{ c.connect }}
        </SituateButton>
      </template>
    </SituateEmptyState>
    <div v-else class="doc-collection-shell">
      <section class="doc-collection">
        <div class="doc-search-area">
          <form class="doc-search" role="search" @submit.prevent="search">
            <SituateIconButton
              v-if="showNavigation"
              icon="menu"
              :label="workshopNavigation.openNavigation"
              :aria-controls="navigationId"
              :aria-expanded="navigationOpen"
              @click="emit('openNavigation', $event)"
            />
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
              />
              <SituateButton
                v-if="hasQuery"
                variant="plain"
                type="button"
                class="doc-clear"
                tabindex="0"
                :aria-label="c.clear"
                @click="clearSearch"
              >
                <SituateIcon name="close" />
              </SituateButton>
              <SituateButton
                variant="plain"
                type="submit"
                tabindex="0"
                :aria-label="c.search"
              >
                <SituateIcon name="enter" />
              </SituateButton>
            </div>
          </form>
        </div>
        <div class="doc-results-heading">
          <div class="doc-results-context">
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
          <SituateEmptyState
            v-else-if="!matches.length"
            class="doc-empty"
            :description="c.noResultsHelp"
          >
            <template #title>
              <h3>{{ c.noResults }}</h3>
            </template>
            <p v-if="incomplete(state)">{{ c.incompleteHelp }}</p>
            <template #actions>
              <SituateButton
                variant="secondary"
                size="small"
                @click="clearSearch"
              >
                {{ c.clear }}
              </SituateButton>
            </template>
          </SituateEmptyState>
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
  </main>
</template>
