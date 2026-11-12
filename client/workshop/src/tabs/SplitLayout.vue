<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import copy from "../localization/en.tabs.json";
import PaneTile from "./PaneTile.vue";
import {
  dimensions,
  type Layout,
  type TabsAction,
  type TabsState,
  type TopicTab,
} from "./model";
const props = defineProps<{
  node: Layout;
  tab: TopicTab;
  state: TabsState;
  dragging: string | null;
}>();
const emit = defineEmits<{
  action: [action: TabsAction];
  options: [id: string, event: MouseEvent];
  drag: [id: string | null];
}>();
const root = ref<HTMLElement>();
const live = ref<number | null>(null);
const size = ref({ width: 0, height: 0 });
let observer: ResizeObserver | undefined;
let stopResize: (() => void) | undefined;
watch(
  root,
  (element) => {
    observer?.disconnect();
    if (!element) return;
    observer = new ResizeObserver(([entry]) => {
      if (entry)
        size.value = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        };
    });
    observer.observe(element);
  },
  { flush: "post" },
);
onBeforeUnmount(() => {
  observer?.disconnect();
  stopResize?.();
});
const bounds = computed(() => {
  if (props.node.kind !== "split") return { min: 0.1, max: 0.9 };
  const row = props.node.axis === "row";
  const total = (row ? size.value.width : size.value.height) - 10;
  if (total <= 0) return { min: 0.1, max: 0.9 };
  const a = dimensions(props.node.first),
    b = dimensions(props.node.second);
  return {
    min: Math.max(0.1, (row ? a.width : a.height) / total),
    max: Math.min(0.9, 1 - (row ? b.width : b.height) / total),
  };
});
const clamp = (value: number) =>
  Math.max(bounds.value.min, Math.min(bounds.value.max, value));
const ratio = computed(() =>
  clamp(live.value ?? (props.node.kind === "split" ? props.node.ratio : 0.5)),
);
const tracks = computed(() => {
  if (props.node.kind !== "split") return {};
  const a = dimensions(props.node.first),
    b = dimensions(props.node.second);
  const horizontal = props.node.axis === "row";
  // Weights above one fill the remaining space when another track hits its minimum.
  return {
    [horizontal ? "gridTemplateColumns" : "gridTemplateRows"]:
      `minmax(${horizontal ? a.width : a.height}px, ${ratio.value * 100}fr) 10px minmax(${horizontal ? b.width : b.height}px, ${(1 - ratio.value) * 100}fr)`,
  };
});
function resize(event: PointerEvent) {
  if (props.node.kind !== "split" || !root.value || event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  const box = root.value.getBoundingClientRect();
  const row = props.node.axis === "row";
  const total = (row ? box.width : box.height) - 10;
  stopResize?.();
  handle.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    const value =
      ((row ? e.clientX - box.left : e.clientY - box.top) - 5) / total;
    live.value = clamp(value);
  };
  const end = () => {
    const value = live.value;
    stopResize?.();
    if (value !== null)
      emit("action", { type: "resize", id: props.node.id, ratio: value });
  };
  const cancel = () => {
    stopResize?.();
  };
  stopResize = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", cancel);
    if (handle.hasPointerCapture(event.pointerId))
      handle.releasePointerCapture(event.pointerId);
    live.value = null;
    stopResize = undefined;
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", cancel);
}
function key(event: KeyboardEvent) {
  if (props.node.kind !== "split") return;
  let value = ratio.value;
  if (event.key === "Home") value = 0.1;
  else if (event.key === "End") value = 0.9;
  else if (
    (props.node.axis === "row" && event.key === "ArrowLeft") ||
    (props.node.axis === "column" && event.key === "ArrowUp")
  )
    value -= 0.05;
  else if (
    (props.node.axis === "row" && event.key === "ArrowRight") ||
    (props.node.axis === "column" && event.key === "ArrowDown")
  )
    value += 0.05;
  else return;
  event.preventDefault();
  emit("action", { type: "resize", id: props.node.id, ratio: clamp(value) });
}
</script>

<template>
  <PaneTile
    v-if="node.kind === 'pane'"
    :pane="tab.panes[node.id]!"
    :state="state"
    :active="tab.active === node.id"
    :dragging="dragging"
    :maximized="false"
    @action="emit('action', $event)"
    @options="(id, event) => emit('options', id, event)"
    @drag="emit('drag', $event)"
  />
  <div
    v-else
    ref="root"
    class="split-layout"
    :class="node.axis"
    :style="tracks"
  >
    <SplitLayout
      :node="node.first"
      :tab="tab"
      :state="state"
      :dragging="dragging"
      @action="emit('action', $event)"
      @options="(id, event) => emit('options', id, event)"
      @drag="emit('drag', $event)"
    />
    <div
      class="split-handle"
      role="separator"
      tabindex="0"
      :aria-label="copy.resize"
      :aria-description="copy.resizeHelp"
      :aria-orientation="node.axis === 'row' ? 'vertical' : 'horizontal'"
      :aria-valuemin="Math.round(bounds.min * 100)"
      :aria-valuemax="Math.round(bounds.max * 100)"
      :aria-valuenow="Math.round(ratio * 100)"
      @pointerdown.prevent="resize"
      @keydown="key"
      @dblclick="emit('action', { type: 'resize', id: node.id, ratio: 0.5 })"
    >
      <span />
    </div>
    <SplitLayout
      :node="node.second"
      :tab="tab"
      :state="state"
      :dragging="dragging"
      @action="emit('action', $event)"
      @options="(id, event) => emit('options', id, event)"
      @drag="emit('drag', $event)"
    />
  </div>
</template>

<style scoped>
.split-layout {
  display: grid;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.split-handle {
  display: grid;
  place-items: center;
  touch-action: none;
  border-radius: 8px;
  position: relative;
  z-index: 1;
}
.row > .split-handle {
  cursor: col-resize;
}
.column > .split-handle {
  cursor: row-resize;
}
.split-handle span {
  display: block;
  border-radius: 4px;
  background: var(--situate-control-line);
  opacity: 0.55;
}
.row > .split-handle span {
  width: 3px;
  height: 32px;
}
.column > .split-handle span {
  height: 3px;
  width: 32px;
}
.split-handle:hover,
.split-handle:focus-visible {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.split-handle:hover span,
.split-handle:focus-visible span {
  background: var(--situate-accent-strong, var(--situate-violet-deep));
  opacity: 1;
}
</style>
