<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { t } from "@situate/localization";
const props = withDefaults(
  defineProps<{
    modelValue: number;
    min: number;
    max: number;
    resetValue: number;
    label: string;
    controls: string;
    orientation?: "vertical" | "horizontal";
  }>(),
  { orientation: "vertical" },
);
const emit = defineEmits<{
  "update:modelValue": [value: number];
  change: [value: number];
  dragging: [value: boolean];
}>();
const handle = ref<HTMLElement>();
const dragging = ref(false);
const maximum = computed(() => Math.max(props.min, props.max));
function clamp(value: number) {
  return Math.round(Math.max(props.min, Math.min(maximum.value, value)));
}
const value = computed(() => clamp(props.modelValue));
let drag:
  | { pointer: number; coordinate: number; value: number; direction: number }
  | undefined;
let frame = 0;
let pending: number | undefined;
function coordinate(event: PointerEvent) {
  return props.orientation === "vertical" ? event.clientX : event.clientY;
}
function direction() {
  return props.orientation === "vertical" &&
    handle.value &&
    getComputedStyle(handle.value).direction === "rtl"
    ? -1
    : 1;
}
function flush() {
  cancelAnimationFrame(frame);
  if (pending !== undefined) {
    const next = clamp(pending);
    if (next !== value.value) emit("update:modelValue", next);
    pending = undefined;
  }
}
function start(event: PointerEvent) {
  if (event.button !== 0 || event.isPrimary === false || drag) return;
  event.preventDefault();
  handle.value?.focus();
  drag = {
    pointer: event.pointerId,
    coordinate: coordinate(event),
    value: value.value,
    direction: direction(),
  };
  handle.value?.setPointerCapture(event.pointerId);
  dragging.value = true;
  emit("dragging", true);
}
function move(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return;
  pending = drag.value + (coordinate(event) - drag.coordinate) * drag.direction;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(flush);
}
function release() {
  const pointer = drag?.pointer;
  drag = undefined;
  dragging.value = false;
  if (pointer !== undefined && handle.value?.hasPointerCapture(pointer))
    handle.value.releasePointerCapture(pointer);
}
function finish(event: PointerEvent) {
  if (!drag || drag.pointer !== event.pointerId) return;
  const next = clamp(
    drag.value + (coordinate(event) - drag.coordinate) * drag.direction,
  );
  const changed = next !== drag.value;
  pending = next;
  flush();
  release();
  if (changed) emit("change", next);
  emit("dragging", false);
}
function cancel() {
  if (!drag) return;
  const initial = clamp(drag.value);
  cancelAnimationFrame(frame);
  pending = undefined;
  release();
  emit("update:modelValue", initial);
  emit("dragging", false);
}
function reset() {
  emit("update:modelValue", clamp(props.resetValue));
  emit("change", clamp(props.resetValue));
}
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape" && drag) {
    event.preventDefault();
    event.stopPropagation();
    cancel();
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || drag) return;
  const step = event.shiftKey ? 32 : 8;
  const previous = props.orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
  const next = props.orientation === "vertical" ? "ArrowRight" : "ArrowDown";
  const amount =
    event.key === previous
      ? -step * direction()
      : event.key === next
        ? step * direction()
        : 0;
  const target =
    event.key === "Home"
      ? props.min
      : event.key === "End"
        ? maximum.value
        : event.key === "Enter"
          ? props.resetValue
          : amount
            ? value.value + amount
            : undefined;
  if (target === undefined) return;
  event.preventDefault();
  if (amount && clamp(target) === value.value) return;
  emit("update:modelValue", clamp(target));
  emit("change", clamp(target));
}
defineExpose({ cancel });
onMounted(() => window.addEventListener("blur", cancel));
onBeforeUnmount(() => {
  window.removeEventListener("blur", cancel);
  cancelAnimationFrame(frame);
  pending = undefined;
  release();
});
</script>
<template>
  <div
    ref="handle"
    class="situate-resize-handle"
    :class="orientation"
    :data-dragging="dragging || undefined"
    role="separator"
    tabindex="0"
    :aria-label="label"
    :aria-controls="controls"
    :aria-description="t('ui.resize.help')"
    :aria-orientation="orientation"
    :aria-valuemin="min"
    :aria-valuemax="maximum"
    :aria-valuenow="value"
    :aria-valuetext="t('ui.resize.pixels', { value })"
    :title="label"
    @pointerdown="start"
    @pointermove="move"
    @pointerup="finish"
    @pointercancel="cancel"
    @lostpointercapture="cancel"
    @keydown="keyboard"
    @dblclick="reset"
  />
</template>
<style scoped>
.situate-resize-handle {
  position: absolute;
  z-index: 3;
  touch-action: none;
  user-select: none;
}
.vertical {
  inset-block: 0;
  inset-inline-end: -12px;
  width: 24px;
  cursor: col-resize;
}
.horizontal {
  inset-inline: 0;
  bottom: -12px;
  height: 24px;
  cursor: row-resize;
}
.situate-resize-handle::after {
  content: "";
  position: absolute;
  border-radius: 4px;
  background: var(--situate-control-line);
}
.vertical::after {
  width: 3px;
  height: 40px;
  left: calc(50% - 1.5px);
  top: calc(50% - 20px);
}
.horizontal::after {
  height: 3px;
  width: 40px;
  top: calc(50% - 1.5px);
  left: calc(50% - 20px);
}
.situate-resize-handle:hover::after,
.situate-resize-handle[data-dragging]::after,
.situate-resize-handle:focus:where(
    html:not([data-input-modality="pointer"]) *
  ):where(:focus-visible, [data-input-modality="keyboard"] *)::after {
  background: var(--situate-accent-strong, var(--situate-violet-deep));
}
.situate-resize-handle:focus {
  outline: none;
}
@media (forced-colors: active) {
  .situate-resize-handle::after {
    background: ButtonText;
  }
  .situate-resize-handle:focus:where(
      html:not([data-input-modality="pointer"]) *
    )::after {
    background: Highlight;
  }
}
</style>
