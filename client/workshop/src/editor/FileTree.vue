<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import { SituateIcon, SituateButton } from "../ui";
import { liveFiles, type EditorState, type ItemTarget } from "./model";
const props = defineProps<{ state: EditorState; readonly?: boolean }>();
const emit = defineEmits<{
  select: [key: string];
  toggle: [path: string];
  actions: [target: ItemTarget, point: { x: number; y: number }];
}>();
interface Row {
  key: string;
  label: string;
  depth: number;
  target: ItemTarget;
  expanded?: boolean;
  dirty?: string;
}
const rows = computed(() => {
  const result: Row[] = [],
    query = props.state.filter.trim().toLowerCase();
  const files = liveFiles(props.state).filter((file) =>
    file.name.toLowerCase().includes(query),
  );
  function fill(folder: string, depth: number) {
    for (const path of props.state.folders
      .filter((path) => path.split("/").slice(0, -1).join("/") === folder)
      .sort()) {
      if (
        query &&
        !files.some(
          (file) => file.folder === path || file.folder.startsWith(path + "/"),
        )
      )
        continue;
      const expanded = !!query || props.state.expanded.includes(path);
      result.push({
        key: "folder:" + path,
        label: path.split("/").at(-1)!,
        depth,
        target: { kind: "folder", path },
        expanded,
      });
      if (expanded) fill(path, depth + 1);
    }
    for (const file of files
      .filter((file) => file.folder === folder)
      .sort((a, b) => a.name.localeCompare(b.name)))
      result.push({
        key: file.key,
        label: file.name,
        depth,
        target: { kind: "file", key: file.key },
        dirty:
          file.draft !== file.content
            ? file.saveError
              ? "Couldn’t save"
              : "Saving…"
            : undefined,
      });
  }
  fill("", 0);
  return result;
});
const root: ItemTarget = { kind: "folder", path: "" };
let timer: ReturnType<typeof setTimeout> | undefined,
  start: { x: number; y: number; pointer: number } | null = null,
  suppress = false;
function cancel() {
  clearTimeout(timer);
  start = null;
}
onBeforeUnmount(cancel);
function actions(target: ItemTarget, event: MouseEvent | KeyboardEvent) {
  if (props.readonly) return;
  cancel();
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget as HTMLElement;
  const anchor =
    element.querySelector<HTMLButtonElement>(".row-menu") || element;
  anchor.focus();
  const rect = anchor.getBoundingClientRect();
  emit(
    "actions",
    target,
    event instanceof MouseEvent && event.clientX
      ? { x: event.clientX, y: event.clientY }
      : { x: rect.right, y: rect.bottom },
  );
}
function key(target: ItemTarget, event: KeyboardEvent) {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
    actions(target, event);
}
function down(target: ItemTarget, event: PointerEvent) {
  if (props.readonly) return;
  cancel();
  suppress = false;
  if (
    !["touch", "pen"].includes(event.pointerType) ||
    !event.isPrimary ||
    event.button !== 0
  )
    return;
  start = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
  const element = event.currentTarget as HTMLElement;
  timer = setTimeout(() => {
    suppress = true;
    element.querySelector<HTMLElement>(".row-menu")?.focus();
    emit("actions", target, { x: event.clientX, y: event.clientY });
    start = null;
  }, 550);
}
function move(event: PointerEvent) {
  if (
    start &&
    event.pointerId === start.pointer &&
    Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
  )
    cancel();
}
function click(event: MouseEvent) {
  if (suppress) {
    event.preventDefault();
    event.stopPropagation();
    suppress = false;
  }
}
function select(row: Row) {
  if (row.target.kind === "file") emit("select", row.target.key);
  else emit("toggle", row.target.path);
}
</script>
<template>
  <nav
    class="file-tree"
    aria-label="Files and folders"
    tabindex="0"
    @contextmenu.self="actions(root, $event)"
    @keydown.self="key(root, $event)"
    @pointerdown.capture="!$event.isPrimary && cancel()"
    @pointerdown.self="down(root, $event)"
    @pointermove="move"
    @pointerup="cancel"
    @pointercancel="cancel"
    @pointerleave="cancel"
    @scroll="cancel"
    @click.capture="click"
  >
    <div
      v-for="row in rows"
      :key="row.key"
      class="tree-row"
      :data-current="row.key === state.currentKey"
      @contextmenu="actions(row.target, $event)"
      @keydown="key(row.target, $event)"
      @pointerdown.stop="down(row.target, $event)"
    >
      <SituateButton
        variant="plain"
        type="button"
        class="entry"
        :class="row.target.kind + '-entry'"
        :style="{ paddingInlineStart: 8 + row.depth * 12 + 'px' }"
        :aria-current="
          row.target.kind === 'file' && row.key === state.currentKey
            ? 'true'
            : undefined
        "
        :aria-expanded="row.expanded"
        :title="row.label"
        @click="select(row)"
      >
        <span
          v-if="row.target.kind === 'folder'"
          class="chevron"
          :class="{ expanded: row.expanded }"
          >›</span
        >
        <SituateIcon
          :name="row.target.kind === 'folder' ? 'folder' : 'notes'"
        /><span class="name">{{ row.label }}</span
        ><span v-if="row.dirty" :title="row.dirty">{{
          row.dirty === "Saving…" ? "•" : "!"
        }}</span>
      </SituateButton>
      <SituateButton
        variant="plain"
        type="button"
        v-if="!readonly"
        class="row-menu"
        :aria-label="'Actions for ' + row.label"
        aria-haspopup="menu"
        @click="actions(row.target, $event)"
      >
        ···
      </SituateButton>
    </div>
    <p v-if="!rows.length" class="tree-empty">
      {{
        state.filter ? "No matching files. Try another name." : "No files yet."
      }}
    </p>
  </nav>
</template>
<style scoped>
.file-tree {
  overflow: auto;
  flex: 1;
  min-height: 0;
  padding: 0 10px 24px;
  -webkit-touch-callout: none;
}
.tree-row {
  display: flex;
  min-width: 0;
  min-height: 44px;
  border-radius: var(--situate-radius-small);
  margin-block: 2px;
}
.tree-row[data-current="true"],
.tree-row:hover {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.entry {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 8px;
  border: 0;
  border-radius: var(--situate-radius-small);
  background: transparent;
  text-align: start;
  font-size: 13px;
  color: var(--situate-muted);
}
.entry :deep(svg) {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}
.folder-entry {
  color: var(--situate-ink);
}
.name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.entry[aria-current="true"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.chevron {
  width: 10px;
  flex-shrink: 0;
  font-size: 18px;
}
.chevron.expanded {
  transform: rotate(90deg);
}
.row-menu {
  flex: 0 0 44px;
  min-height: 44px;
  border: 0;
  border-radius: var(--situate-radius-control);
  background: transparent;
  color: var(--situate-muted);
  font-weight: 600;
  font-size: 20px;
}
button {
  cursor: pointer;
  touch-action: pan-y;
  user-select: none;
  font-family: inherit;
}
button:focus-visible,
.file-tree:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.tree-empty {
  padding: 20px 12px;
  font-size: 13px;
  color: var(--situate-muted);
}
</style>
