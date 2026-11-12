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
} from "../ui";
import c from "../localization/en.assignment-files.json";
import { fileDiff, diffParts } from "./assignment-diff";
import {
  changePath,
  inspectionChanges,
  type AssignmentChange,
  type AssignmentInspectionState,
  type InspectionNavigation,
} from "./assignment-files";

const props = withDefaults(
  defineProps<{ state: AssignmentInspectionState; allowExpand?: boolean }>(),
  { allowExpand: true },
);
const emit = defineEmits<{
  "update:state": [state: AssignmentInspectionState];
}>();
const root = ref<HTMLElement>();
const title = ref<HTMLElement>();
const detailTitle = ref<HTMLElement>();
const listScroll = ref<HTMLElement>();
const diffScroll = ref<HTMLElement>();
const filter = ref<InstanceType<typeof SituateInput>>();
const split = ref(false);
const navigation = computed(() => props.state.changes);
const matches = computed(() => inspectionChanges(props.state));
const selectedChange = computed(() =>
  [...props.state.recordedChanges, ...props.state.observations].find(
    (entry) => entry.id === navigation.value.selected,
  ),
);
const selectedIndex = computed(() =>
  matches.value.findIndex((entry) => entry.id === navigation.value.selected),
);
const pageSize = 100;
const page = computed(() =>
  Math.min(
    navigation.value.page ?? 0,
    Math.max(0, Math.ceil(matches.value.length / pageSize) - 1),
  ),
);
const pageEntries = computed(() =>
  matches.value.slice(page.value * pageSize, (page.value + 1) * pageSize),
);
const pageLabel = computed(() =>
  c.page
    .replace("{start}", String(page.value * pageSize + 1))
    .replace(
      "{end}",
      String(Math.min((page.value + 1) * pageSize, matches.value.length)),
    )
    .replace("{total}", String(matches.value.length)),
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
const label = (entry: AssignmentChange) =>
  `${c.operations[entry.operation]} · ${changePath(entry)}`;
const issue = computed(() => {
  const revisions = [selectedChange.value?.before, selectedChange.value?.after];
  if (revisions.some((item) => item?.status === "unavailable"))
    return c.unavailable;
  if (revisions.some((item) => item?.status === "unsupported"))
    return c.unsupported;
  return "";
});
const comparison = computed(() =>
  selectedChange.value && !issue.value
    ? fileDiff(
        selectedChange.value.before?.text ?? "",
        selectedChange.value.after?.text ?? "",
      )
    : null,
);
const revealed = ref<Record<number, number>>({});
const lineLimit = ref(400);
const parts = computed(() =>
  diffParts(comparison.value?.rows ?? [], revealed.value),
);
const visibleParts = computed(() => parts.value.slice(0, lineLimit.value));
function update(patch: Partial<InspectionNavigation>) {
  emit("update:state", {
    ...props.state,
    mode: "changes",
    changes: { ...navigation.value, ...patch },
  });
}
async function toggleExpanded() {
  emit("update:state", { ...props.state, expanded: !props.state.expanded });
  await nextTick();
  focusTitle();
}
function focusTitle() {
  (navigation.value.pane === "file"
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
  update({
    selected,
    pane: "file",
    page: nextPage,
    listScroll: nextPage === page.value ? navigation.value.listScroll : 0,
    fileScroll:
      navigation.value.selected === selected ? navigation.value.fileScroll : 0,
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
  update({ pane: "tree" });
  await nextTick();
  (rowElement(navigation.value.selected) ?? filter.value?.element)?.focus({
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
function rememberScroll(kind: "listScroll" | "fileScroll") {
  const element = kind === "listScroll" ? listScroll.value : diffScroll.value;
  if (element && element.scrollTop !== navigation.value[kind])
    update({ [kind]: element.scrollTop });
}
watch(
  () => [
    navigation.value.pane,
    navigation.value.status,
    navigation.value.selected,
    page.value,
  ],
  async () => {
    await nextTick();
    if (listScroll.value)
      listScroll.value.scrollTop = navigation.value.listScroll;
    if (diffScroll.value)
      diffScroll.value.scrollTop = navigation.value.fileScroll;
  },
  { immediate: true },
);
watch(
  () => [
    navigation.value.selected,
    selectedChange.value?.before?.text,
    selectedChange.value?.after?.text,
  ],
  () => {
    revealed.value = {};
    lineLimit.value = 400;
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
defineExpose({ focusTitle, showTree });
</script>

<template>
  <section ref="root" class="assignment-files" :aria-label="c.title">
    <header class="inspection-header">
      <h3 ref="title" tabindex="-1">{{ c.title }}</h3>
      <span class="change-count">{{
        c.count.replace(
          "{count}",
          String(state.recordedChanges.length + state.observations.length),
        )
      }}</span>
      <SituateIconButton
        v-if="allowExpand || state.expanded"
        :icon="state.expanded ? 'restore' : 'expand'"
        :label="state.expanded ? c.restore : c.expand"
        :aria-pressed="!!state.expanded"
        @click="toggleExpanded"
      />
    </header>
    <div v-if="navigation.status !== 'ready'" class="feedback">
      <p v-if="navigation.status === 'loading'" role="status">
        {{ c.loading }}
      </p>
      <template v-else-if="navigation.status === 'error'">
        <p role="alert">{{ c.error }}</p>
        <SituateButton
          variant="secondary"
          @click="update({ status: 'loading' })"
          >{{ c.retry }}</SituateButton
        >
      </template>
      <p v-else>{{ c.emptyChanges }}</p>
    </div>
    <div
      v-else
      class="inspection-body"
      :class="{ 'detail-active': navigation.pane === 'file', split }"
    >
      <section class="list-pane" :aria-label="c.fileList">
        <div class="inspection-tools">
          <SituateInput
            ref="filter"
            type="search"
            :aria-label="c.filter"
            :placeholder="c.filter"
            :value="navigation.query"
            @input="
              update({
                query: ($event.target as HTMLInputElement).value,
                page: 0,
                listScroll: 0,
              })
            "
          />
          <SituateButton
            v-if="navigation.query"
            variant="ghost"
            size="small"
            @click="update({ query: '', page: 0, listScroll: 0 })"
            >{{ c.clear }}</SituateButton
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
                  entry.id === navigation.selected ? 'true' : undefined
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
                  ><strong>{{ pathName(changePath(entry)) }}</strong
                  ><span class="file-directory">{{
                    pathDirectory(changePath(entry))
                  }}</span
                  ><span
                    v-if="(duplicates.get(changePath(entry)) ?? 0) > 1"
                    class="record-range"
                    >{{ entry.before?.revision ?? "∅" }} →
                    {{ entry.after?.revision ?? "∅" }}</span
                  ></span
                >
                <span
                  v-if="entry.provenance.attribution === 'uncertain'"
                  class="uncertain-mark"
                  :aria-label="c.observedShort"
                  >?</span
                >
              </SituateButton>
            </li>
          </ul>
          <p v-if="!matches.length" class="feedback">
            {{ navigation.query ? c.noMatches : c.emptyChanges }}
          </p>
        </div>
        <footer v-if="matches.length > pageSize" class="list-pagination">
          <SituateIconButton
            icon="back"
            :label="c.previousPage"
            :disabled="page === 0"
            @click="update({ page: page - 1, listScroll: 0 })"
          />
          <span>{{ pageLabel }}</span>
          <SituateIconButton
            icon="forward"
            :label="c.nextPage"
            :disabled="(page + 1) * pageSize >= matches.length"
            @click="update({ page: page + 1, listScroll: 0 })"
          />
        </footer>
      </section>
      <section class="detail-pane" :aria-label="c.diff">
        <template v-if="selectedChange">
          <div class="diff-toolbar">
            <SituateButton
              v-if="!split"
              variant="plain"
              class="back"
              @click="showTree"
              ><SituateIcon name="back" />{{ c.back }}</SituateButton
            >
            <span class="change-position">{{
              selectedIndex >= 0
                ? `${selectedIndex + 1} / ${matches.length}`
                : ""
            }}</span>
            <SituateIconButton
              icon="back"
              :label="c.previous"
              :disabled="selectedIndex <= 0"
              @click="adjacent(-1)"
            />
            <SituateIconButton
              icon="forward"
              :label="c.next"
              :disabled="
                selectedIndex < 0 || selectedIndex >= matches.length - 1
              "
              @click="adjacent(1)"
            />
          </div>
          <header class="diff-heading">
            <h4 ref="detailTitle" tabindex="-1" dir="ltr">
              {{ changePath(selectedChange) }}
            </h4>
            <p
              v-if="selectedChange.operation === 'renamed'"
              class="renamed-path"
              dir="ltr"
            >
              {{ selectedChange.before?.path }} →
              {{ selectedChange.after?.path }}
            </p>
            <div class="diff-meta">
              <span>{{ c.operations[selectedChange.operation] }}</span>
              <span
                v-if="comparison"
                class="added-count"
                :aria-label="
                  c.addedLines.replace('{count}', String(comparison.added))
                "
                >+{{ comparison.added }}</span
              >
              <span
                v-if="comparison"
                class="removed-count"
                :aria-label="
                  c.removedLines.replace('{count}', String(comparison.removed))
                "
                >−{{ comparison.removed }}</span
              >
              <span class="revision-range" dir="ltr"
                >{{ selectedChange.before?.revision ?? "∅" }} →
                {{ selectedChange.after?.revision ?? "∅" }}</span
              >
            </div>
          </header>
          <p
            v-if="selectedChange.provenance.attribution === 'uncertain'"
            class="change-notice"
            role="note"
          >
            {{ c.uncertain }}
          </p>
          <p v-if="issue" class="feedback" role="status">{{ issue }}</p>
          <template v-else-if="comparison">
            <p v-if="comparison.simplified" class="change-notice">
              {{ c.simplified }}
            </p>
            <p v-if="!comparison.added && !comparison.removed" class="feedback">
              {{
                selectedChange.operation === "added"
                  ? c.emptyAdded
                  : selectedChange.operation === "deleted"
                    ? c.emptyDeleted
                    : c.noContent
              }}
            </p>
            <div
              v-else
              ref="diffScroll"
              class="diff-scroll"
              tabindex="0"
              :aria-label="c.diff"
              @scroll="rememberScroll('fileScroll')"
              dir="ltr"
            >
              <table class="diff-lines" :aria-label="c.diff">
                <tbody>
                  <template
                    v-for="part in visibleParts"
                    :key="part.kind + part.index"
                  >
                    <tr v-if="part.kind === 'gap'" class="diff-gap">
                      <td colspan="4">
                        <SituateButton
                          variant="plain"
                          @click="
                            revealed[part.index] =
                              (revealed[part.index] ?? 0) + 200
                          "
                          >{{
                            c.context.replace("{count}", String(part.count))
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
                          <code>{{ part.row.text || " " }}</code>
                        </td>
                      </tr>
                      <tr v-if="part.row.noNewline" class="newline-note">
                        <td colspan="4">{{ c.noNewline }}</td>
                      </tr>
                    </template>
                  </template>
                </tbody>
              </table>
              <SituateButton
                v-if="visibleParts.length < parts.length"
                variant="ghost"
                class="more-lines"
                @click="lineLimit += 400"
                >{{ c.moreLines }}</SituateButton
              >
            </div>
          </template>
        </template>
        <p v-else class="feedback choose-file">{{ c.choose }}</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.assignment-files {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--situate-surface);
  color: var(--situate-ink);
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
  border-radius: 4px;
}
.file-row:hover {
  background: var(--situate-paper);
}
.file-row[aria-current] {
  background: var(--situate-accent-soft);
}
.file-status {
  flex: 0 0 14px;
  font: 600 12px var(--situate-font-mono);
  color: var(--situate-muted);
}
.file-status.added,
.added-count {
  color: #315e49;
}
.file-status.deleted,
.removed-count {
  color: #80534f;
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
  background: #edf5ee;
  color: #315e49;
}
.diff-line.removed {
  background: #faf0ed;
  color: #80534f;
}
.diff-gap {
  background: var(--situate-paper);
}
.diff-gap button {
  padding: 8px 16px;
  min-height: 36px;
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
:is(button, input, [tabindex]):focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -3px;
}
@media (pointer: coarse) {
  .diff-gap button {
    min-height: 44px;
  }
}
</style>
