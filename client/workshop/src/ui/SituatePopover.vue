<script setup lang="ts">
import { inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { selectEnvironment } from "./select-context";
defineOptions({ inheritAttrs: false });
const props = defineProps<{
  open: boolean;
  label: string;
  anchor?: HTMLElement | null;
  point?: { x: number; y: number };
}>();
const emit = defineEmits<{ close: [] }>();
const element = ref<HTMLElement>();
const modalHost = ref<HTMLElement>();
const environment = inject(selectEnvironment, undefined);
function boundary() {
  return (
    (props.anchor ?? element.value)?.closest("dialog") ??
    environment?.popupBoundary?.value ??
    environment?.popupTarget?.value
  );
}
let invoker: HTMLElement | null = null;
let observer: ResizeObserver | undefined;
let closing = false;
function position() {
  const popup = element.value;
  if (!props.open || !popup) return;
  const anchor = props.anchor?.getBoundingClientRect();
  const bounds = boundary()?.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = Math.max(bounds?.left ?? 0, viewport?.offsetLeft ?? 0) + 8;
  const top = Math.max(bounds?.top ?? 0, viewport?.offsetTop ?? 0) + 8;
  const right =
    Math.min(
      bounds?.right ?? innerWidth,
      (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth),
    ) - 8;
  const bottom =
    Math.min(
      bounds?.bottom ?? innerHeight,
      (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight),
    ) - 8;
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
  popup.style.maxHeight = `${Math.max(0, bottom - top)}px`;
  const y = props.point?.y ?? (anchor?.bottom ?? top) + 4;
  const above = (anchor?.top ?? top) - popup.offsetHeight - 4;
  popup.style.left = `${Math.max(left, Math.min(right - popup.offsetWidth, props.point?.x ?? (anchor?.right ?? left + popup.offsetWidth) - popup.offsetWidth))}px`;
  popup.style.top = `${Math.max(top, Math.min(bottom - popup.offsetHeight, !props.point && y + popup.offsetHeight > bottom ? above : y))}px`;
}
function dismiss(restore = true) {
  if (closing || !props.open) return;
  closing = true;
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
function beforeToggle(event: Event) {
  if ((event as ToggleEvent).newState === "closed" && props.open && !closing) {
    closing = true;
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
  if (props.open) {
    closing = false;
    element.value?.showPopover();
    position();
    if (closing) return;
    const first = element.value?.querySelector<HTMLElement>(
      '[autofocus], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
    );
    (first ?? element.value)?.focus({ preventScroll: true });
  } else {
    if (element.value?.contains(document.activeElement) && invoker?.isConnected)
      invoker.focus({ preventScroll: true });
    closing = true;
    element.value?.hidePopover();
  }
}
watch(() => props.open, sync);
watch(() => props.point, position);
onMounted(() => {
  void sync();
  observer = new ResizeObserver(position);
  if (element.value) observer.observe(element.value);
  const bounds = boundary();
  if (bounds) observer.observe(bounds);
  if (props.anchor) observer.observe(props.anchor);
  window.addEventListener("resize", position);
  document.addEventListener("scroll", position, true);
  window.visualViewport?.addEventListener("resize", position);
  window.visualViewport?.addEventListener("scroll", position);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", position);
  document.removeEventListener("scroll", position, true);
  window.visualViewport?.removeEventListener("resize", position);
  window.visualViewport?.removeEventListener("scroll", position);
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
      popover="auto"
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
