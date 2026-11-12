<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { SituateResizeHandle } from "@situate/ui";
import { t } from "@situate/localization";
import PaneTile from "./PaneTile.vue";
import { dimensions } from "./geometry";
import type { LayoutNode } from "../tree";
import type { LayoutIntent, TopicTab, Pane } from "../model";
import type { ViewTarget } from "../navigation";
const props = defineProps<{
  node: LayoutNode;
  tab: TopicTab;
  titleFor: (target: ViewTarget) => string;
  dragging: string | null;
}>();
defineSlots<{
  pane(props: { pane: Pane; tab: TopicTab; active: boolean }): unknown;
}>();
const emit = defineEmits<{
  intent: [intent: LayoutIntent];
  options: [id: string, event: MouseEvent];
  drag: [id: string | null];
}>();
const root = ref<HTMLElement>();
const regionId = useId();
const live = ref<number | null>(null);
const size = ref({ width: 0, height: 0 });
let observer: ResizeObserver | undefined;
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
});
const bounds = computed(() => {
  if (props.node.kind !== "split") return { min: 0, max: 1, total: 1 };
  const row = props.node.axis === "row";
  const a = dimensions(props.node.first);
  const b = dimensions(props.node.second);
  const first = row ? a.width : a.height;
  const second = row ? b.width : b.height;
  const total = Math.max(
    first + second,
    (row ? size.value.width : size.value.height) - 10,
  );
  return { min: first / total, max: 1 - second / total, total };
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
function previewResize(pixels: number) {
  live.value = clamp(pixels / bounds.value.total);
}
function commitResize(pixels: number) {
  if (props.node.kind !== "split") return;
  emit("intent", {
    type: "resize",
    tabId: props.tab.id,
    splitId: props.node.id,
    ratio: clamp(pixels / bounds.value.total),
  });
  live.value = null;
}
</script>

<template>
  <PaneTile
    v-if="node.kind === 'pane'"
    :pane="tab.panes.find((pane) => pane.id === node.id)!"
    :title-for="titleFor"
    :active="tab.activePaneId === node.id"
    :dragging="dragging"
    :maximized="false"
    :tab="tab"
    @intent="emit('intent', $event)"
    @options="(id, event) => emit('options', id, event)"
    @drag="emit('drag', $event)"
    ><template #pane="slotProps"
      ><slot name="pane" v-bind="slotProps" /></template
  ></PaneTile>
  <div
    v-else
    ref="root"
    :id="regionId"
    class="split-layout"
    :class="node.axis"
    :style="tracks"
  >
    <SplitLayout
      :node="node.first"
      :tab="tab"
      :title-for="titleFor"
      :dragging="dragging"
      @intent="emit('intent', $event)"
      @options="(id, event) => emit('options', id, event)"
      @drag="emit('drag', $event)"
      ><template #pane="slotProps"
        ><slot name="pane" v-bind="slotProps" /></template
    ></SplitLayout>
    <SituateResizeHandle
      class="split-handle"
      :model-value="ratio * bounds.total"
      :min="bounds.min * bounds.total"
      :max="bounds.max * bounds.total"
      :reset-value="bounds.total / 2"
      :label="t('layoutUi.resize')"
      :controls="regionId"
      :orientation="node.axis === 'row' ? 'vertical' : 'horizontal'"
      @update:model-value="previewResize"
      @change="commitResize"
      @dragging="
        (active) => {
          if (!active) live = null;
        }
      "
    />
    <SplitLayout
      :node="node.second"
      :tab="tab"
      :title-for="titleFor"
      :dragging="dragging"
      @intent="emit('intent', $event)"
      @options="(id, event) => emit('options', id, event)"
      @drag="emit('drag', $event)"
      ><template #pane="slotProps"
        ><slot name="pane" v-bind="slotProps" /></template
    ></SplitLayout>
  </div>
</template>

<style scoped>
.split-layout {
  display: grid;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.split-layout > .split-handle {
  position: relative;
  inset: auto;
  justify-self: center;
  align-self: center;
}
.row > .split-handle {
  width: 24px;
  height: 100%;
}
.column > .split-handle {
  width: 100%;
  height: 24px;
}
</style>
