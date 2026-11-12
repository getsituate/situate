<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  SituateButton,
  SituateInput,
  SituateIconButton,
  SituateIcon,
} from "@situate/ui";
import { t } from "@situate/localization";
import "@situate/localization/assignment-changes";
import { fileDiff, diffParts } from "./assignment-diff";
import SourceText from "../files/SourceText.vue";
import { highlightLines, type SourceToken } from "../files/source-highlighting";
import {
  changePath,
  inspectionChanges,
  type AssignmentChange,
  createChangesNavigation,
  type AssignmentChangesState,
  type ChangesNavigation,
} from "./assignment-changes";

const props = withDefaults(
  defineProps<{
    state: AssignmentChangesState;
    navigation?: ChangesNavigation;
    expanded?: boolean;
    allowExpand?: boolean;
  }>(),
  { expanded: false, allowExpand: true },
);
const emit = defineEmits<{
  select: [id: string];
  navigate: [navigation: ChangesNavigation];
  retry: [];
  expand: [expanded: boolean];
}>();
const localNavigation = ref<ChangesNavigation>({
  ...(props.navigation ?? createChangesNavigation()),
});
watch(
  () => props.navigation,
  (value) => {
    if (value) localNavigation.value = { ...value };
  },
  { deep: true },
);
const root = ref<HTMLElement>();
const title = ref<HTMLElement>();
const detailTitle = ref<HTMLElement>();
const listScroll = ref<HTMLElement>();
const diffScroll = ref<HTMLElement>();
const filter = ref<InstanceType<typeof SituateInput>>();
const split = ref(false);
const currentNavigation = computed(() => localNavigation.value);
const matches = computed(() =>
  inspectionChanges(props.state.changes, currentNavigation.value.query),
);
const selectedChange = computed(() =>
  props.state.changes.find(
    (entry) => entry.id === currentNavigation.value.selected,
  ),
);
const selectedIndex = computed(() =>
  matches.value.findIndex(
    (entry) => entry.id === currentNavigation.value.selected,
  ),
);
const pageSize = 100;
const page = computed(() =>
  Math.min(
    currentNavigation.value.page ?? 0,
    Math.max(0, Math.ceil(matches.value.length / pageSize) - 1),
  ),
);
const pageEntries = computed(() =>
  matches.value.slice(page.value * pageSize, (page.value + 1) * pageSize),
);
const pageLabel = computed(() =>
  t("assignmentChanges.page", {
    start: page.value * pageSize + 1,
    end: Math.min((page.value + 1) * pageSize, matches.value.length),
    total: matches.value.length,
  }),
);
const duplicates = computed(() => {
  const counts = new Map<string, number>();
  for (const item of matches.value)
    counts.set(changePath(item), (counts.get(changePath(item)) ?? 0) + 1);
  return counts;
});
const pathName = (path: string) => path.split("/").at(-1) ?? path;
const pathDirectory = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
const code = { added: "A", modified: "M", deleted: "D", renamed: "R" };
function operationLabel(operation: AssignmentChange["operation"]) {
  switch (operation) {
    case "added":
      return t("assignmentChanges.added");
    case "modified":
      return t("assignmentChanges.modified");
    case "deleted":
      return t("assignmentChanges.deleted");
    case "renamed":
      return t("assignmentChanges.renamed");
  }
}
const label = (entry: AssignmentChange) =>
  t("assignmentChanges.changeLabel", {
    action: operationLabel(entry.operation),
    name: changePath(entry),
  });
const issue = computed(() => {
  const change = selectedChange.value;
  if (!change) return "";
  if (
    (change.operation !== "added" && !change.before) ||
    (change.operation !== "deleted" && !change.after)
  )
    return t("assignmentChanges.unavailable");
  const revisions = [change.before, change.after];
  if (revisions.some((item) => item?.status === "loading"))
    return t("assignmentChanges.loading");
  if (revisions.some((item) => item?.status === "unavailable"))
    return t("assignmentChanges.unavailable");
  if (revisions.some((item) => item?.status === "unsupported"))
    return t("assignmentChanges.unsupported");
  return "";
});
const comparison = computed(() =>
  selectedChange.value && !issue.value
    ? fileDiff(
        selectedChange.value.before?.status === "available"
          ? selectedChange.value.before.text
          : "",
        selectedChange.value.after?.status === "available"
          ? selectedChange.value.after.text
          : "",
      )
    : null,
);
const highlighted = computed(() => {
  const change = selectedChange.value;
  return {
    before:
      change?.before?.status === "available"
        ? highlightLines(change.before.text, change.before.path)
        : [],
    after:
      change?.after?.status === "available"
        ? highlightLines(change.after.text, change.after.path)
        : [],
  };
});
function rowTokens(row: {
  kind: string;
  before: number | null;
  after: number | null;
  text: string;
}): SourceToken[] {
  const side = row.kind === "removed" ? "before" : "after";
  const line = side === "before" ? row.before : row.after;
  return (
    (line && highlighted.value[side][line - 1]) || [{ text: row.text || " " }]
  );
}
const parts = computed(() =>
  diffParts(comparison.value?.rows ?? [], currentNavigation.value.revealed),
);
const visibleParts = computed(() =>
  parts.value.slice(0, currentNavigation.value.lineLimit),
);
function update(patch: Partial<ChangesNavigation>) {
  localNavigation.value = { ...currentNavigation.value, ...patch };
  emit("navigate", { ...localNavigation.value });
}
async function toggleExpanded() {
  emit("expand", !props.expanded);
  await nextTick();
  focusTitle();
}
function focusTitle() {
  (currentNavigation.value.pane === "file"
    ? (detailTitle.value ?? title.value)
    : title.value
  )?.focus();
}
function rowElement(id: string) {
  return [
    ...(root.value?.querySelectorAll<HTMLButtonElement>("[data-change-id]") ??
      []),
  ].find((button) => button.dataset.changeId === id);
}
async function select(selected: string, focusDetail = true) {
  const index = matches.value.findIndex((entry) => entry.id === selected);
  const nextPage = Math.max(0, Math.floor(index / pageSize));
  emit("select", selected);
  update({
    selected,
    pane: focusDetail ? "file" : "list",
    page: nextPage,
    listScroll:
      nextPage === page.value ? currentNavigation.value.listScroll : 0,
    fileScroll:
      currentNavigation.value.selected === selected
        ? currentNavigation.value.fileScroll
        : 0,
  });
  await nextTick();
  if (focusDetail) {
    if (split.value)
      rowElement(selected)?.scrollIntoView?.({ block: "nearest" });
    focusTitle();
  } else {
    const row = rowElement(selected);
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  }
}
async function showTree() {
  update({ pane: "list" });
  await nextTick();
  (
    rowElement(currentNavigation.value.selected) ?? filter.value?.element
  )?.focus({
    preventScroll: true,
  });
}
function adjacent(direction: number) {
  const entry = matches.value[selectedIndex.value + direction];
  if (entry) void select(entry.id);
}
function keyboard(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const id = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-change-id]",
  )?.dataset.changeId;
  if (!id) return;
  const index = matches.value.findIndex((entry) => entry.id === id);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? matches.value.length - 1
        : index + (event.key === "ArrowDown" ? 1 : -1);
  event.preventDefault();
  if (matches.value[next]) void select(matches.value[next].id, false);
}
async function revealContext(index: number) {
  update({
    revealed: {
      ...currentNavigation.value.revealed,
      [index]: (currentNavigation.value.revealed[index] ?? 0) + 200,
    },
  });
  await nextTick();
  diffScroll.value?.focus({ preventScroll: true });
}
async function showMoreLines() {
  update({ lineLimit: currentNavigation.value.lineLimit + 400 });
  await nextTick();
  diffScroll.value?.focus({ preventScroll: true });
}
function rememberScroll(kind: "listScroll" | "fileScroll") {
  const element = kind === "listScroll" ? listScroll.value : diffScroll.value;
  if (element && element.scrollTop !== currentNavigation.value[kind])
    update({ [kind]: element.scrollTop });
}
watch(
  () => [
    currentNavigation.value.pane,
    props.state.status,
    currentNavigation.value.selected,
    page.value,
  ],
  async () => {
    await nextTick();
    if (listScroll.value)
      listScroll.value.scrollTop = currentNavigation.value.listScroll;
    if (diffScroll.value)
      diffScroll.value.scrollTop = currentNavigation.value.fileScroll;
  },
  { immediate: true },
);
watch([() => currentNavigation.value.selected, () => comparison.value], () =>
  update({ revealed: {}, lineLimit: 400 }),
);
watch(
  () => [props.state.status, selectedChange.value],
  () => {
    if (
      props.state.status === "ready" &&
      !selectedChange.value &&
      currentNavigation.value.selected
    )
      update({ selected: "", pane: "list", fileScroll: 0 });
  },
);
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(([entry]) => {
      split.value = entry.contentRect.width >= 720;
    });
    observer.observe(root.value!);
  }
});
onBeforeUnmount(() => observer?.disconnect());
defineExpose({ focusTitle, showList: showTree });
</script>

<template>
  <section
    ref="root"
    class="assignment-changes"
    :aria-label="t('assignmentChanges.title')"
  >
    <header class="inspection-header">
      <h3 ref="title" tabindex="-1">{{ t("assignmentChanges.title") }}</h3>
      <span class="change-count">{{
        t("assignmentChanges.count", { count: state.changes.length })
      }}</span>
      <SituateIconButton
        v-if="allowExpand || expanded"
        :icon="expanded ? 'restore' : 'expand'"
        :label="
          expanded
            ? t('assignmentChanges.restore')
            : t('assignmentChanges.expand')
        "
        :aria-pressed="!!expanded"
        @click="toggleExpanded"
      />
    </header>
    <div v-if="state.status !== 'ready'" class="feedback">
      <p v-if="state.status === 'loading'" role="status">
        {{ t("assignmentChanges.loading") }}
      </p>
      <p v-else-if="state.status === 'unavailable'" role="status">
        {{ t("assignmentChanges.unavailable") }}
      </p>
      <template v-else-if="state.status === 'error'">
        <p role="alert">{{ t("assignmentChanges.error") }}</p>
        <SituateButton variant="secondary" @click="emit('retry')">{{
          t("assignmentChanges.retry")
        }}</SituateButton>
      </template>
    </div>
    <div
      v-else
      class="inspection-body"
      :class="{ 'detail-active': currentNavigation.pane === 'file', split }"
    >
      <section class="list-pane" :aria-label="t('assignmentChanges.fileList')">
        <div class="inspection-tools">
          <SituateInput
            ref="filter"
            type="search"
            :aria-label="t('assignmentChanges.filter')"
            :placeholder="t('assignmentChanges.filter')"
            :model-value="currentNavigation.query"
            @update:model-value="
              update({
                query: String($event),
                page: 0,
                listScroll: 0,
              })
            "
          />
          <SituateButton
            v-if="currentNavigation.query"
            variant="ghost"
            size="small"
            @click="update({ query: '', page: 0, listScroll: 0 })"
            >{{ t("assignmentChanges.clear") }}</SituateButton
          >
        </div>
        <div
          ref="listScroll"
          class="inspection-scroll"
          @scroll="rememberScroll('listScroll')"
          @keydown="keyboard"
        >
          <ul class="file-list">
            <li v-for="entry in pageEntries" :key="entry.id">
              <SituateButton
                variant="plain"
                class="file-row"
                :data-change-id="entry.id"
                :aria-label="label(entry)"
                :title="changePath(entry)"
                :aria-current="
                  entry.id === currentNavigation.selected ? 'true' : undefined
                "
                @click="select(entry.id)"
              >
                <span
                  class="file-status"
                  :class="entry.operation"
                  aria-hidden="true"
                  >{{ code[entry.operation] }}</span
                >
                <span class="file-name"
                  ><strong data-localization-content="user">{{
                    pathName(changePath(entry))
                  }}</strong
                  ><span
                    class="file-directory"
                    data-localization-content="user"
                    >{{ pathDirectory(changePath(entry)) }}</span
                  ><span
                    v-if="(duplicates.get(changePath(entry)) ?? 0) > 1"
                    class="record-range"
                    data-localization-content="identity"
                    >{{ entry.before?.revision ?? "∅" }} →
                    {{ entry.after?.revision ?? "∅" }}</span
                  ></span
                >
                <span
                  v-if="entry.attribution === 'uncertain'"
                  class="uncertain-mark"
                  :aria-label="t('assignmentChanges.observedShort')"
                  >?</span
                >
              </SituateButton>
            </li>
          </ul>
          <p v-if="!matches.length" class="feedback">
            {{
              currentNavigation.query
                ? t("assignmentChanges.noMatches")
                : t("assignmentChanges.emptyChanges")
            }}
          </p>
        </div>
        <footer v-if="matches.length > pageSize" class="list-pagination">
          <SituateIconButton
            icon="back"
            :label="t('assignmentChanges.previousPage')"
            :disabled="page === 0"
            @click="update({ page: page - 1, listScroll: 0 })"
          />
          <span>{{ pageLabel }}</span>
          <SituateIconButton
            icon="forward"
            :label="t('assignmentChanges.nextPage')"
            :disabled="(page + 1) * pageSize >= matches.length"
            @click="update({ page: page + 1, listScroll: 0 })"
          />
        </footer>
      </section>
      <section class="detail-pane" :aria-label="t('assignmentChanges.diff')">
        <template v-if="selectedChange">
          <div class="diff-toolbar">
            <SituateButton
              v-if="!split"
              variant="plain"
              class="back"
              @click="showTree"
              ><SituateIcon name="back" />{{
                t("assignmentChanges.back")
              }}</SituateButton
            >
            <span
              class="change-position"
              data-localization-content="formatted"
              >{{
                selectedIndex >= 0
                  ? `${selectedIndex + 1} / ${matches.length}`
                  : ""
              }}</span
            >
            <SituateIconButton
              icon="back"
              :label="t('assignmentChanges.previous')"
              :disabled="selectedIndex <= 0"
              @click="adjacent(-1)"
            />
            <SituateIconButton
              icon="forward"
              :label="t('assignmentChanges.next')"
              :disabled="
                selectedIndex < 0 || selectedIndex >= matches.length - 1
              "
              @click="adjacent(1)"
            />
          </div>
          <header class="diff-heading">
            <h4
              ref="detailTitle"
              tabindex="-1"
              dir="ltr"
              data-localization-content="user"
            >
              {{ changePath(selectedChange) }}
            </h4>
            <p
              v-if="selectedChange.operation === 'renamed'"
              class="renamed-path"
              dir="ltr"
              data-localization-content="user"
            >
              {{ selectedChange.before?.path }} →
              {{ selectedChange.after?.path }}
            </p>
            <div class="diff-meta">
              <span>{{ operationLabel(selectedChange.operation) }}</span>
              <span
                v-if="comparison"
                class="added-count"
                :aria-label="
                  t('assignmentChanges.addedLines', { count: comparison.added })
                "
                >+{{ comparison.added }}</span
              >
              <span
                v-if="comparison"
                class="removed-count"
                :aria-label="
                  t('assignmentChanges.removedLines', {
                    count: comparison.removed,
                  })
                "
                >−{{ comparison.removed }}</span
              >
              <span
                class="revision-range"
                dir="ltr"
                data-localization-content="identity"
                >{{ selectedChange.before?.revision ?? "∅" }} →
                {{ selectedChange.after?.revision ?? "∅" }}</span
              >
            </div>
          </header>
          <p
            v-if="selectedChange.attribution === 'uncertain'"
            class="change-notice"
            role="note"
          >
            {{ t("assignmentChanges.uncertain") }}
          </p>
          <div v-if="issue" class="feedback">
            <p role="status">{{ issue }}</p>
            <SituateButton
              v-if="
                selectedChange.before?.status === 'unavailable' ||
                selectedChange.after?.status === 'unavailable'
              "
              variant="secondary"
              @click="emit('retry')"
              >{{ t("assignmentChanges.retry") }}</SituateButton
            >
          </div>
          <template v-else-if="comparison">
            <p v-if="comparison.simplified" class="change-notice">
              {{ t("assignmentChanges.simplified") }}
            </p>
            <p v-if="!comparison.added && !comparison.removed" class="feedback">
              {{
                selectedChange.operation === "added"
                  ? t("assignmentChanges.emptyAdded")
                  : selectedChange.operation === "deleted"
                    ? t("assignmentChanges.emptyDeleted")
                    : t("assignmentChanges.noContent")
              }}
            </p>
            <div
              v-else
              ref="diffScroll"
              class="diff-scroll"
              tabindex="0"
              :aria-label="t('assignmentChanges.diff')"
              @scroll="rememberScroll('fileScroll')"
              dir="ltr"
            >
              <table
                class="diff-lines"
                :aria-label="t('assignmentChanges.diff')"
              >
                <tbody>
                  <template
                    v-for="part in visibleParts"
                    :key="part.kind + part.index"
                  >
                    <tr v-if="part.kind === 'gap'" class="diff-gap">
                      <td colspan="4">
                        <SituateButton
                          variant="plain"
                          @click="revealContext(part.index)"
                          >{{
                            t("assignmentChanges.context", {
                              count: part.count,
                            })
                          }}</SituateButton
                        >
                      </td>
                    </tr>
                    <template v-else>
                      <tr class="diff-line" :class="part.row.kind">
                        <td class="line-number" aria-hidden="true">
                          {{ part.row.before }}
                        </td>
                        <td class="line-number" aria-hidden="true">
                          {{ part.row.after }}
                        </td>
                        <td class="diff-sign">
                          {{
                            part.row.kind === "added"
                              ? "+"
                              : part.row.kind === "removed"
                                ? "−"
                                : " "
                          }}
                        </td>
                        <td class="line-content">
                          <code
                            ><SourceText :tokens="rowTokens(part.row)"
                          /></code>
                        </td>
                      </tr>
                      <tr v-if="part.row.noNewline" class="newline-note">
                        <td colspan="4">
                          {{ t("assignmentChanges.noNewline") }}
                        </td>
                      </tr>
                    </template>
                  </template>
                </tbody>
              </table>
              <SituateButton
                v-if="visibleParts.length < parts.length"
                variant="ghost"
                class="more-lines"
                @click="showMoreLines"
                >{{ t("assignmentChanges.moreLines") }}</SituateButton
              >
            </div>
          </template>
        </template>
        <p v-else class="feedback choose-file">
          {{ t("assignmentChanges.choose") }}
        </p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.assignment-changes {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--situate-surface);
  color: var(--situate-ink);
  font-family: var(--situate-font-body);
  font-size: 13px;
  line-height: 1.5;
}
.inspection-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 6px 12px 6px 16px;
  border-bottom: 1px solid var(--situate-line);
}
h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.change-count {
  color: var(--situate-muted);
  font-size: 12px;
  flex: 1;
}
.inspection-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.list-pane,
.detail-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.detail-pane {
  display: none;
}
.detail-active .list-pane {
  display: none;
}
.detail-active .detail-pane {
  display: flex;
}
.split .list-pane {
  display: flex;
  flex: 0 0 280px;
  border-inline-end: 1px solid var(--situate-line);
}
.split .detail-pane {
  display: flex;
}
.inspection-tools {
  padding: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.inspection-tools input {
  width: 100%;
  min-width: 0;
}
.inspection-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.file-list {
  list-style: none;
  margin: 0;
  padding: 0 4px 8px;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  width: 100%;
  min-height: 48px;
  padding: 6px 12px;
  text-align: start;
  cursor: pointer;
  border-radius: var(--situate-radius-small);
}
.file-row:hover {
  background: var(--situate-paper);
}
.file-row[aria-current] {
  background: var(--situate-lilac);
}
.file-status {
  flex: 0 0 14px;
  font: 600 12px var(--situate-font-mono);
  color: var(--situate-muted);
}
.file-status.added,
.added-count {
  color: var(--situate-cobalt);
}
.file-status.deleted,
.removed-count {
  color: var(--situate-ink);
}
.file-name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.file-name strong {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-directory {
  font-size: 11px;
  color: var(--situate-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: ltr;
  text-align: start;
}
.record-range {
  color: var(--situate-muted);
  font: 11px var(--situate-font-mono);
  overflow-wrap: anywhere;
}
.uncertain-mark {
  color: var(--situate-muted);
  font-weight: 600;
}
.list-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-top: 1px solid var(--situate-line);
  font-size: 12px;
}
.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--situate-line);
}
.back {
  border: 0;
  background: transparent;
  color: var(--situate-muted);
  font: inherit;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  min-height: 44px;
  padding: 6px 8px;
}
.back :deep(svg) {
  width: 16px;
  height: 16px;
}
.change-position {
  margin-inline-start: auto;
  font-size: 11px;
  color: var(--situate-muted);
}
.diff-heading {
  padding: 14px 16px;
  border-bottom: 1px solid var(--situate-line);
}
h4 {
  margin: 0;
  font: 500 12px/1.6 var(--situate-font-mono);
  overflow-wrap: anywhere;
}
.renamed-path {
  font-size: 11px;
  color: var(--situate-muted);
  overflow-wrap: anywhere;
  margin: 8px 0;
}
.diff-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  color: var(--situate-muted);
  margin-top: 8px;
}
.added-count,
.removed-count {
  font-family: var(--situate-font-mono);
}
.revision-range {
  margin-inline-start: auto;
  overflow-wrap: anywhere;
  font-family: var(--situate-font-mono);
}
.feedback {
  padding: 16px;
  margin: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.choose-file {
  margin: auto;
  color: var(--situate-muted);
}
.change-notice {
  padding: 12px 16px;
  margin: 0;
  border-bottom: 1px solid var(--situate-line);
  font-size: 12px;
}
.diff-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.diff-lines {
  border-collapse: collapse;
  width: 100%;
  font: 12px/1.8 var(--situate-font-mono);
}
.diff-line td {
  padding: 0;
  vertical-align: top;
}
.line-number {
  min-width: 34px;
  width: 34px;
  padding-inline: 6px !important;
  text-align: right;
  color: var(--situate-muted);
  user-select: none;
}
.diff-sign {
  min-width: 20px;
  width: 20px;
  text-align: center;
  user-select: none;
}
.line-content {
  padding-inline: 4px 20px !important;
  white-space: pre;
}
.line-content code {
  font: inherit;
}
.diff-line.added {
  background: color-mix(
    in srgb,
    var(--situate-sky) 12%,
    var(--situate-surface)
  );
  color: var(--situate-cobalt);
}
.diff-line.removed {
  background: color-mix(
    in srgb,
    var(--situate-peach) 25%,
    var(--situate-surface)
  );
  color: var(--situate-ink);
}
.diff-gap {
  background: var(--situate-paper);
}
.diff-gap button {
  padding: 8px 16px;
  min-height: var(--situate-target-min);
  background: transparent;
  color: var(--situate-muted);
  border: 0;
  font: 12px var(--situate-font-body);
  cursor: pointer;
  text-align: start;
}
.newline-note td {
  padding: 4px 16px;
  font: 11px var(--situate-font-body);
  color: var(--situate-muted);
}
.more-lines {
  margin: 12px;
}
:is(button, input, [tabindex]):focus:where(
    html:not([data-input-modality="pointer"]) *
  ) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -3px;
}
h3,
h4 {
  padding: var(--situate-space-1);
}
@media (pointer: coarse) {
  .diff-gap button {
    min-height: 44px;
  }
}
</style>
