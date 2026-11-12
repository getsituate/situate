<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { popupBounds } from "./popup-bounds";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{ text: string; disabled?: boolean; anchor?: HTMLElement }>(),
  { disabled: false },
);
const emit = defineEmits<{ describe: [id: string | undefined] }>();
const id = useId();
const element = ref<HTMLElement>();
const visible = ref(false);
const popupHost = computed(
  () => (props.anchor ?? activeAnchor.value)?.closest("dialog") ?? "body",
);
watch(visible, (value) => emit("describe", value ? id : undefined));
const activeAnchor = ref<HTMLElement>();
let timer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
let pointerInside = false;
let focused = false;
let dismissed = false;
let touch = false;
function clearTimer() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}
function position() {
  const popup = element.value;
  if (!popup || !activeAnchor.value) return;
  const rect = activeAnchor.value.getBoundingClientRect();
  const { left, top, right, bottom } = popupBounds(popup);
  popup.style.maxWidth = `${Math.max(0, Math.min(280, right - left))}px`;
  popup.style.maxHeight = `${Math.max(0, bottom - top)}px`;
  const size = popup.getBoundingClientRect();
  popup.style.left = `${Math.max(left, Math.min(right - size.width, rect.left + (rect.width - size.width) / 2))}px`;
  const above = rect.top - size.height - 6;
  popup.style.top = `${Math.max(top, Math.min(bottom - size.height, above >= top ? above : rect.bottom + 6))}px`;
}
function hide() {
  clearTimer();
  visible.value = false;
  observer?.disconnect();
  observer = undefined;
  document.removeEventListener("keydown", keydown, true);
  document.removeEventListener("scroll", scrolled, true);
  window.removeEventListener("resize", hide);
  window.visualViewport?.removeEventListener("resize", viewportChanged);
  window.visualViewport?.removeEventListener("scroll", viewportChanged);
}
function scrolled(event: Event) {
  if (event.target instanceof Node && element.value?.contains(event.target))
    return;
  viewportChanged();
}
function viewportChanged() {
  if (!focused || !activeAnchor.value || !element.value) {
    hide();
    return;
  }
  const rect = activeAnchor.value.getBoundingClientRect();
  const bounds = popupBounds(element.value);
  if (
    rect.bottom < bounds.top ||
    rect.top > bounds.bottom ||
    rect.right < bounds.left ||
    rect.left > bounds.right
  )
    hide();
  else position();
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dismissed = true;
    hide();
  }
}
async function show() {
  clearTimer();
  if (props.disabled || !props.text || dismissed || touch) return;
  visible.value = true;
  await nextTick();
  if (!visible.value) return;
  element.value?.showPopover?.();
  position();
  if (typeof ResizeObserver !== "undefined") {
    observer?.disconnect();
    observer = new ResizeObserver(position);
    if (element.value) observer.observe(element.value);
    if (activeAnchor.value) observer.observe(activeAnchor.value);
  }
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("scroll", scrolled, true);
  window.addEventListener("resize", hide);
  window.visualViewport?.addEventListener("resize", viewportChanged);
  window.visualViewport?.addEventListener("scroll", viewportChanged);
}
function enter(event: PointerEvent) {
  touch = event.pointerType === "touch";
  if (touch) return;
  activeAnchor.value = event.currentTarget as HTMLElement;
  pointerInside = true;
  dismissed = false;
  clearTimer();
  timer = setTimeout(() => {
    void show();
  }, 450);
}
function leave() {
  pointerInside = false;
  clearTimer();
  if (!focused) timer = setTimeout(hide, 120);
}
function focus(event: FocusEvent) {
  activeAnchor.value = event.currentTarget as HTMLElement;
  focused = activeAnchor.value.matches(":focus-visible");
  if (!focused) return;
  touch = false;
  dismissed = false;
  clearTimer();
  timer = setTimeout(() => {
    void show();
  }, 450);
}
function blur() {
  focused = false;
  if (!pointerInside) hide();
}
const triggerAttrs = computed(() => ({
  "aria-describedby": visible.value ? id : undefined,
  onPointerenter: enter,
  onPointerleave: leave,
  onPointerdown: (event: PointerEvent) => {
    focused = false;
    touch = event.pointerType === "touch";
    dismissed = true;
    hide();
  },
  onClick: () => {
    dismissed = true;
    hide();
  },
  onFocus: focus,
  onBlur: blur,
}));
let detachAnchor: (() => void) | undefined;
watch(
  () => props.anchor,
  (node) => {
    detachAnchor?.();
    hide();
    if (!node) return;
    const listeners: [string, EventListener][] = [
      ["pointerenter", (event) => enter(event as PointerEvent)],
      ["pointerleave", leave],
      [
        "pointerdown",
        (event) => triggerAttrs.value.onPointerdown(event as PointerEvent),
      ],
      ["focus", (event) => focus(event as FocusEvent)],
      ["blur", blur],
      ["click", () => triggerAttrs.value.onClick()],
    ];
    for (const [name, handler] of listeners)
      node.addEventListener(name, handler);
    detachAnchor = () => {
      for (const [name, handler] of listeners)
        node.removeEventListener(name, handler);
    };
  },
  { immediate: true },
);
watch(() => [props.disabled, props.text], hide);
onBeforeUnmount(() => {
  detachAnchor?.();
  hide();
  emit("describe", undefined);
});
</script>

<template>
  <slot :trigger-attrs="triggerAttrs" />
  <Teleport :to="popupHost">
    <span
      v-if="visible"
      :id="id"
      ref="element"
      role="tooltip"
      popover="manual"
      class="situate-tooltip"
      @pointerenter="clearTimer"
      @pointerleave="leave"
      >{{ text }}</span
    >
  </Teleport>
</template>

<style scoped>
.situate-tooltip {
  position: fixed;
  inset: auto;
  margin: 0;
  box-sizing: border-box;
  width: max-content;
  overflow: auto;
  overscroll-behavior: contain;
  padding: var(--situate-space-2) var(--situate-space-3);
  border: 1px solid transparent;
  border-radius: var(--situate-radius-control);
  background: var(--situate-ink);
  color: var(--situate-surface);
  font-family: var(--situate-font-body);
  font-size: var(--situate-text-caption);
  font-weight: 400;
  line-height: 1.5;
  overflow-wrap: anywhere;
  text-align: start;
  z-index: 100;
}
@media (forced-colors: active) {
  .situate-tooltip {
    border-color: CanvasText;
  }
}
</style>
