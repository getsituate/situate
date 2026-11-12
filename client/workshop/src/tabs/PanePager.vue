<script setup lang="ts">
import { SituateButton } from "../ui";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import copy from "../localization/en.tabs.json";

const props = defineProps<{
  panes: { id: string; title: string }[];
  active: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const viewport = ref<HTMLElement>();
const width = ref(0);
const displacement = ref(0);
const dragging = ref(false);
const index = computed(() =>
  Math.max(
    0,
    props.panes.findIndex((pane) => pane.id === props.active),
  ),
);
const step = computed(() => width.value * 0.5);
const translation = computed(
  () => width.value * 0.25 - index.value * step.value + displacement.value,
);
const summary = computed(
  () => `${props.panes[index.value]?.title ?? ""} · ${position(index.value)}`,
);
let gesture: { pointer: number; x: number; y: number } | null = null;
let suppressClick = false;
let observer: ResizeObserver | undefined;

function position(at: number) {
  return copy.panePosition
    .replace("{current}", String(at + 1))
    .replace("{total}", String(props.panes.length));
}
function cancel() {
  const pointer = gesture?.pointer;
  gesture = null;
  dragging.value = false;
  displacement.value = 0;
  if (pointer !== undefined && viewport.value?.hasPointerCapture(pointer))
    viewport.value.releasePointerCapture(pointer);
}
function start(event: PointerEvent) {
  if (!event.isPrimary) {
    cancel();
    return;
  }
  if (event.button !== 0) return;
  cancel();
  suppressClick = false;
  gesture = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
}
function move(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const x = event.clientX - gesture.x,
    y = event.clientY - gesture.y;
  if (!dragging.value) {
    if (Math.abs(y) > 8 && Math.abs(y) >= Math.abs(x)) {
      cancel();
      return;
    }
    if (Math.abs(x) < 8 || Math.abs(x) < Math.abs(y) * 1.2) return;
    dragging.value = true;
    suppressClick = true;
    viewport.value?.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  const atBoundary =
    (index.value === 0 && x > 0) ||
    (index.value === props.panes.length - 1 && x < 0);
  displacement.value = atBoundary
    ? Math.max(-32, Math.min(32, x * 0.2))
    : Math.max(-step.value, Math.min(step.value, x));
}
function lostCapture(event: PointerEvent) {
  // Touch starts with implicit capture on the button; transferring it to the strip is not cancellation.
  if (
    event.target === viewport.value &&
    gesture?.pointer === event.pointerId &&
    !viewport.value.hasPointerCapture(event.pointerId)
  )
    cancel();
}
function end(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  const distance = displacement.value;
  const commit =
    dragging.value && Math.abs(distance) >= Math.min(56, step.value * 0.25);
  cancel();
  if (commit) select(index.value + (distance < 0 ? 1 : -1));
}
function select(at: number, focus = false) {
  const pane = props.panes[at];
  if (!pane || at === index.value) return;
  const keepFocus = focus || !!viewport.value?.contains(document.activeElement);
  emit("select", pane.id);
  if (keepFocus)
    void nextTick(() =>
      viewport.value
        ?.querySelector<HTMLElement>('[aria-current="true"]')
        ?.focus({ preventScroll: true }),
    );
}
function click(event: MouseEvent, at: number) {
  if (suppressClick && event.detail !== 0) {
    event.preventDefault();
    return;
  }
  select(at, true);
}
function key(event: KeyboardEvent) {
  if (event.key === "Escape") {
    cancel();
    return;
  }
  const target =
    event.key === "ArrowLeft"
      ? index.value - 1
      : event.key === "ArrowRight"
        ? index.value + 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? props.panes.length - 1
            : null;
  if (target === null) return;
  event.preventDefault();
  cancel();
  select(target, true);
}
watch(
  [() => props.active, () => props.panes.map((pane) => pane.id).join("|")],
  cancel,
);
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    cancel();
    width.value = entry.contentRect.width;
  });
  if (viewport.value) {
    width.value = viewport.value.clientWidth;
    observer.observe(viewport.value);
  }
});
onBeforeUnmount(() => {
  cancel();
  observer?.disconnect();
});
</script>

<template>
  <div
    class="pane-pager"
    role="group"
    :aria-label="copy.panes"
    :aria-description="copy.paneSwipeHelp"
  >
    <div
      ref="viewport"
      class="pager-viewport"
      :class="{ dragging }"
      @pointerdown="start"
      @pointermove="move"
      @pointerup="end"
      @pointercancel="cancel"
      @lostpointercapture="lostCapture"
      @keydown="key"
      @dragstart.prevent
    >
      <div
        class="pager-track"
        :style="{ transform: `translateX(${translation}px)` }"
      >
        <SituateButton
          variant="plain"
          v-for="(pane, at) in panes"
          :key="pane.id"
          type="button"
          :aria-current="at === index ? 'true' : undefined"
          :aria-hidden="Math.abs(at - index) > 1 ? true : undefined"
          :tabindex="at === index ? 0 : -1"
          :aria-label="`${pane.title} · ${position(at)}`"
          :title="pane.title"
          @click="click($event, at)"
        >
          <span>{{ pane.title }}</span
          ><small v-if="at === index" class="pager-position" aria-hidden="true"
            >{{ at + 1 }}/{{ panes.length }}</small
          >
        </SituateButton>
      </div>
    </div>
    <span role="status" aria-live="polite" aria-atomic="true" class="sr-only">{{
      summary
    }}</span>
  </div>
</template>

<style scoped>
.pane-pager {
  flex: 0 0 auto;
  min-width: 0;
  background: var(--situate-surface);
}
.pager-viewport {
  overflow: hidden;
  width: 100%;
  touch-action: pan-y pinch-zoom;
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
}
.pager-viewport.dragging {
  cursor: grabbing;
}
.pager-track {
  display: flex;
  width: 100%;
  transition: transform 180ms ease-out;
}
.dragging .pager-track {
  transition: none;
}
.pager-track button {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 0 0 50%;
  min-width: 0;
  min-height: 44px;
  gap: 6px;
  padding: 8px;
  border: 0;
  background: transparent;
  font-size: 14px;
  color: var(--situate-muted);
  border-radius: 8px;
}
.pager-track button[aria-current="true"] {
  color: var(--situate-ink);
  font-weight: 600;
}
.pager-track button:focus-visible {
  outline-offset: var(--situate-focus-offset);
}
.pager-track button span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pager-position {
  flex: 0 0 auto;
  font-weight: 400;
  font-size: 11px;
  text-align: center;
  color: var(--situate-muted);
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .pager-track {
    transition: none;
  }
}
</style>
