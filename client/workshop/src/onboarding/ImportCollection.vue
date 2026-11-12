<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { SituateIcon, SituateInput, SituateButton } from "../ui";
import ImportPagination from "./ImportPagination.vue";
import type { EditorFile } from "../editor/model";
import {
  fileCount,
  importIndex,
  importPage,
  importCollectionThreshold,
  importRows,
  searchImports,
} from "./import-browser";
import copy from "../localization/en.import-result.json";
const props = defineProps<{ files: EditorFile[]; selected: string | null }>();
const emit = defineEmits<{ select: [key: string] }>();
const id = useId();
const index = computed(() => importIndex(props.files));
const expanded = ref(
  new Set(
    index.value.live.length > importCollectionThreshold
      ? []
      : index.value.folders.keys(),
  ),
);
const pages = ref(new Map<string, number>());
const query = ref("");
const searchControl = ref<InstanceType<typeof SituateInput>>();
const search = computed(() => searchControl.value?.element);
const searchTools = ref<HTMLElement>();
const list = ref<HTMLElement>();
const needle = computed(() => query.value.trim());
const resultPage = ref(0);
const matches = computed(() => searchImports(index.value, needle.value));
const results = computed(() => importPage(matches.value, resultPage.value));
const rows = computed(() =>
  importRows(index.value, expanded.value, pages.value),
);
const searching = computed(
  () => index.value.live.length > importCollectionThreshold || !!query.value,
);
watch(needle, async () => {
  resultPage.value = 0;
  await nextTick();
  if (document.activeElement === search.value)
    search.value?.scrollIntoView({ block: "nearest" });
});
function openFile(key: string, event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  emit("select", key);
}
function toggle(path: string) {
  if (expanded.value.has(path)) expanded.value.delete(path);
  else expanded.value.add(path);
}
async function page(folder: string, value: number) {
  pages.value.set(folder, value);
  await nextTick();
  const first = [
    ...(list.value?.querySelectorAll<HTMLButtonElement>(
      "button[data-parent]",
    ) ?? []),
  ].find((button) => button.dataset.parent === folder);
  const folderButton = [
    ...(list.value?.querySelectorAll<HTMLButtonElement>(".folder-entry") ?? []),
  ].find((button) => button.title === folder);
  first?.focus({ preventScroll: true });
  (folderButton ?? list.value)?.scrollIntoView({ block: "start" });
}
async function searchPage(value: number) {
  resultPage.value = value;
  await nextTick();
  list.value?.focus({ preventScroll: true });
  searchTools.value?.scrollIntoView({ block: "start" });
}
function clear() {
  query.value = "";
  search.value?.focus();
}
</script>
<template>
  <div class="import-collection">
    <div v-if="searching" ref="searchTools" class="collection-search">
      <label :for="`${id}-search`">{{ copy.search }}</label>
      <div>
        <SituateInput
          appearance="plain"
          ref="searchControl"
          :id="`${id}-search`"
          v-model="query"
          type="search"
          :placeholder="copy.searchPlaceholder"
        />
        <SituateButton variant="plain" v-if="query" @click="clear">{{
          copy.clearSearch
        }}</SituateButton>
      </div>
    </div>
    <p
      v-if="needle"
      class="result-count"
      :role="results.last ? undefined : 'status'"
    >
      {{ results.label }}
    </p>
    <nav
      ref="list"
      class="file-tree"
      :aria-label="needle ? copy.searchResults : copy.files"
      tabindex="-1"
    >
      <template v-if="needle">
        <SituateButton
          variant="plain"
          v-for="entry in results.entries"
          :key="entry.key"
          class="entry search-result"
          :aria-label="entry.name"
          :aria-describedby="`${id}-${entry.key}-path`"
          :title="entry.path"
          :aria-current="selected === entry.key ? 'true' : undefined"
          aria-haspopup="dialog"
          @click="openFile(entry.key, $event)"
        >
          <SituateIcon name="notes" />
          <span class="search-name"
            ><span class="name">{{ entry.name }}</span
            ><span :id="`${id}-${entry.key}-path`" class="result-path">{{
              entry.path
            }}</span></span
          >
        </SituateButton>
        <p v-if="!matches.length" class="empty">{{ copy.noMatches }}</p>
      </template>
      <template v-else>
        <template
          v-for="(row, i) in rows"
          :key="row.kind === 'entry' ? row.entry.key : `page:${row.folder}`"
        >
          <div
            v-if="row.kind === 'entry'"
            class="tree-row"
            :data-depth="row.depth"
          >
            <SituateButton
              variant="plain"
              class="entry"
              :class="`${row.entry.kind}-entry`"
              :data-parent="row.entry.parent"
              :style="{
                paddingInlineStart: `${8 + Math.min(row.depth, 4) * 12}px`,
              }"
              :aria-label="row.entry.name"
              :title="row.entry.path"
              :aria-expanded="
                row.entry.kind === 'folder'
                  ? expanded.has(row.entry.path)
                  : undefined
              "
              :aria-describedby="
                row.entry.kind === 'folder' ? `${id}-${i}-count` : undefined
              "
              :aria-current="selected === row.entry.key ? 'true' : undefined"
              :aria-haspopup="row.entry.kind === 'file' ? 'dialog' : undefined"
              @click="
                row.entry.kind === 'folder'
                  ? toggle(row.entry.path)
                  : openFile(row.entry.key, $event)
              "
            >
              <span
                v-if="row.entry.kind === 'folder'"
                class="chevron"
                :class="{ expanded: expanded.has(row.entry.path) }"
                aria-hidden="true"
                >›</span
              >
              <SituateIcon
                :name="row.entry.kind === 'folder' ? 'folder' : 'notes'"
              />
              <span class="name">{{ row.entry.name }}</span>
              <span
                v-if="row.entry.kind === 'folder'"
                :id="`${id}-${i}-count`"
                class="folder-count"
                aria-hidden="true"
                >{{ fileCount(row.entry.count) }}</span
              >
            </SituateButton>
          </div>
          <ImportPagination
            v-else
            :scope="row.folder || copy.files"
            :label="row.label"
            :page="row.page"
            :last="row.last"
            :depth="row.depth"
            @change="page(row.folder, $event)"
          />
        </template>
        <p v-if="!index.live.length" class="empty">{{ copy.noFiles }}</p>
      </template>
    </nav>
    <ImportPagination
      v-if="needle && results.last"
      :scope="copy.searchResults"
      :label="results.label"
      :page="results.page"
      :last="results.last"
      @change="searchPage"
    />
  </div>
</template>
<style scoped>
.import-collection {
  min-width: 0;
}
.result-count {
  margin: 0 0 12px;
  color: var(--situate-muted);
  font-size: 13px;
}
.collection-search {
  margin-bottom: 12px;
  scroll-margin-block: 16px;
}
.collection-search label {
  display: block;
  font-size: 13px;
  margin-bottom: 6px;
}
.collection-search > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
input {
  box-sizing: border-box;
  min-width: 0;
  flex: 1 1 150px;
  min-height: 44px;
  width: 100%;
  border: 1px solid var(--situate-control-line);
  border-radius: 10px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  padding: 10px 12px;
  font: inherit;
  font-size: 16px;
}
.file-tree {
  min-width: 0;
  scroll-margin-block: 16px;
}
.tree-row {
  min-width: 0;
  margin-block: 2px;
}
.entry {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 8px;
  border: 0;
  border-radius: var(--situate-radius-small);
  background: transparent;
  color: var(--situate-muted);
  text-align: start;
  font-size: 13px;
}
.entry:hover,
.entry[aria-current="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.entry[aria-current="true"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.folder-entry {
  color: var(--situate-ink);
  scroll-margin-block: 16px;
}
.entry :deep(svg) {
  width: 17px;
  height: 17px;
  flex: none;
}
.name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}
.chevron {
  width: 10px;
  flex: none;
  font-size: 18px;
}
.chevron.expanded {
  transform: rotate(90deg);
}
.folder-count {
  color: var(--situate-muted);
  margin-inline-start: auto;
  flex: none;
  font-size: 12px;
}
.search-name {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.result-path {
  font-size: 12px;
  line-height: 1.5;
  color: var(--situate-muted);
  overflow-wrap: anywhere;
}
.search-result {
  align-items: start;
  padding-block: 10px;
}
.search-result :deep(svg) {
  margin-top: 2px;
}
.collection-search button {
  border: 1px solid var(--situate-control-line);
  border-radius: 24px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  min-height: 44px;
  padding: 8px 12px;
}
button {
  font-family: inherit;
  cursor: pointer;
}
button:focus-visible,
input:focus-visible,
.file-tree:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.empty {
  font-size: 14px;
  line-height: 1.5;
  padding: 8px;
}
</style>
