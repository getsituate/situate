<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { popupBounds } from "./popup-bounds";
defineOptions({ inheritAttrs: false });
const props = defineProps<{
  open: boolean;
  label: string;
  anchor?: HTMLElement | null;
  point?: { x: number; y: number };
  align?: "start" | "end";
  maxHeight?: number;
}>();
const emit = defineEmits<{ close: [] }>();
const element = ref<HTMLElement>();
const modalHost = ref<HTMLElement>();
let invoker: HTMLElement | null = null;
let observer: ResizeObserver | undefined;
let closing = false;
let disposed = false;
function position() {
  const popup = element.value;
  if (!props.open || !popup) return;
  const anchor = props.anchor?.getBoundingClientRect();
  const { left, top, right, bottom } = popupBounds(popup);
  if (
    anchor &&
    (anchor.bottom < top ||
      anchor.top > bottom ||
      anchor.right < left ||
      anchor.left > right)
  ) {
    dismiss();
    return;
  }
  popup.style.maxWidth = `${Math.max(0, right - left)}px`;
  popup.style.maxHeight = `${Math.max(0, Math.min(bottom - top, props.maxHeight ?? Infinity))}px`;
  const y = props.point?.y ?? (anchor?.bottom ?? top) + 4;
  const above = (anchor?.top ?? top) - popup.offsetHeight - 4;
  const x =
    props.point?.x ??
    (props.align === "start"
      ? (anchor?.left ?? left)
      : (anchor?.right ?? left + popup.offsetWidth) - popup.offsetWidth);
  popup.style.left = `${Math.max(left, Math.min(right - popup.offsetWidth, x))}px`;
  popup.style.top = `${Math.max(top, Math.min(bottom - popup.offsetHeight, !props.point && y + popup.offsetHeight > bottom ? above : y))}px`;
}
function dismiss(restore = true) {
  if (closing || !props.open) return;
  closing = true;
  stopTracking();
  if (restore && invoker?.isConnected) invoker.focus({ preventScroll: true });
  element.value?.hidePopover();
  emit("close");
}
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  } else if (event.key === "Tab") {
    const controls = [
      ...(element.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
      ) ?? []),
    ];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (!edge || document.activeElement === edge) dismiss();
  }
}
// Native light dismissal also consumes the pointer release that opens a context menu.
function outside(event: PointerEvent) {
  if (!props.open || !props.point) return;
  const target = event.target as Node;
  if (!element.value?.contains(target) && !props.anchor?.contains(target))
    dismiss(false);
}
function blur() {
  if (props.point) dismiss(false);
}
function beforeToggle(event: Event) {
  if ((event as ToggleEvent).newState === "closed" && props.open && !closing) {
    closing = true;
    stopTracking();
    if (
      (element.value?.contains(document.activeElement) ||
        document.activeElement === document.body) &&
      invoker?.isConnected
    )
      invoker.focus({ preventScroll: true });
    emit("close");
  }
}
async function sync() {
  if (props.open) {
    invoker = props.anchor ?? (document.activeElement as HTMLElement | null);
    modalHost.value =
      invoker?.closest<HTMLElement>("dialog[open]") ?? undefined;
  }
  await nextTick();
  if (disposed) return;
  if (!element.value?.isConnected) {
    stopTracking();
    return;
  }
  if (props.open) {
    closing = false;
    element.value?.showPopover();
    position();
    if (closing) return;
    startTracking();
    const first = element.value?.querySelector<HTMLElement>(
      '[autofocus], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
    );
    (first ?? element.value)?.focus({ preventScroll: true });
  } else {
    stopTracking();
    if (element.value?.contains(document.activeElement) && invoker?.isConnected)
      invoker.focus({ preventScroll: true });
    closing = true;
    element.value?.hidePopover();
  }
}
watch(() => props.open, sync);
watch([() => props.point, () => props.align, () => props.maxHeight], position);
watch(
  () => props.anchor,
  async (anchor) => {
    if (disposed || !props.open) return;
    stopTracking();
    if (!anchor && !props.point) {
      dismiss();
      return;
    }
    invoker = anchor ?? null;
    modalHost.value = anchor?.closest<HTMLElement>("dialog[open]") ?? undefined;
    await nextTick();
    if (disposed || !props.open || !element.value?.isConnected) return;
    position();
    if (!closing) startTracking();
  },
);
function startTracking() {
  stopTracking();
  if (disposed || !props.open || !element.value?.isConnected) return;
  observer = new ResizeObserver(position);
  if (element.value) observer.observe(element.value);
  for (
    let ancestor = props.anchor ?? element.value.parentElement;
    ancestor;
    ancestor = ancestor.parentElement
  )
    observer.observe(ancestor);
  window.addEventListener("resize", position);
  window.addEventListener("blur", blur);
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("scroll", position, true);
  window.visualViewport?.addEventListener("resize", position);
  window.visualViewport?.addEventListener("scroll", position);
}
function stopTracking() {
  observer?.disconnect();
  observer = undefined;
  window.removeEventListener("resize", position);
  window.removeEventListener("blur", blur);
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("scroll", position, true);
  window.visualViewport?.removeEventListener("resize", position);
  window.visualViewport?.removeEventListener("scroll", position);
}
onMounted(sync);
onBeforeUnmount(() => {
  disposed = true;
  stopTracking();
  if (element.value?.contains(document.activeElement) && invoker?.isConnected)
    invoker.focus({ preventScroll: true });
});
defineExpose({ element, dismiss });
</script>
<template>
  <Teleport :to="modalHost ?? 'body'" :disabled="!modalHost">
    <div
      ref="element"
      role="dialog"
      tabindex="-1"
      :popover="point ? 'manual' : 'auto'"
      class="situate-popover"
      :aria-label="label"
      v-bind="$attrs"
      @beforetoggle="beforeToggle"
      @keydown="keyboard"
    >
      <slot />
    </div>
  </Teleport>
</template>
<style scoped>
.situate-popover {
  position: fixed;
  inset: auto;
  box-sizing: border-box;
  width: 280px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--situate-line);
  border-radius: 12px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  font: 14px/1.5 var(--situate-font-body);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--situate-ink) 10%, transparent);
}
</style>
