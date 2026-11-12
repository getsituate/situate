<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import SituatePopover from "./SituatePopover.vue";
const props = withDefaults(
  defineProps<{
    open: boolean;
    label: string;
    anchor?: HTMLElement | null;
    point?: { x: number; y: number };
    initialFocus?: "first" | "last" | "checked";
    closeOnSelect?: boolean;
  }>(),
  { closeOnSelect: true },
);
const emit = defineEmits<{ close: [] }>();
const popup = ref<InstanceType<typeof SituatePopover>>();
let search = "";
let searchedAt = 0;
function items() {
  return [
    ...(popup.value?.element?.querySelectorAll<HTMLButtonElement>(
      '[role^="menuitem"]:not(:disabled):not([aria-disabled="true"])',
    ) ?? []),
  ];
}
function focus(item?: HTMLElement) {
  item?.focus({ preventScroll: true });
  item?.scrollIntoView({ block: "nearest" });
}
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    search = "";
    await nextTick();
    await nextTick();
    const choices = items();
    focus(
      props.initialFocus === "last"
        ? choices.at(-1)
        : props.initialFocus === "checked"
          ? (choices.find(
              (item) => item.getAttribute("aria-checked") === "true",
            ) ?? choices[0])
          : choices[0],
    );
  },
  { immediate: true },
);
function keyboard(event: KeyboardEvent) {
  if (event.key === "Tab") {
    popup.value?.dismiss();
    return;
  }
  const choices = items();
  const index = choices.indexOf(document.activeElement as HTMLButtonElement);
  let target: HTMLButtonElement | undefined;
  if (event.key === "ArrowDown") target = choices[(index + 1) % choices.length];
  else if (event.key === "ArrowUp")
    target = choices[(index - 1 + choices.length) % choices.length];
  else if (event.key === "Home") target = choices[0];
  else if (event.key === "End") target = choices.at(-1);
  else if (
    event.key.length === 1 &&
    event.key !== " " &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    const now = Date.now();
    search = now - searchedAt > 500 ? event.key : search + event.key;
    searchedAt = now;
    const query = [...search].every((char) => char === search[0])
      ? search[0]!
      : search;
    target = [...choices.slice(index + 1), ...choices.slice(0, index + 1)].find(
      (item) =>
        (item.getAttribute("aria-label") ?? item.textContent ?? "")
          .trim()
          .toLocaleLowerCase()
          .startsWith(query.toLocaleLowerCase()),
    );
  } else return;
  event.preventDefault();
  focus(target);
}
function guardDisabled(event: MouseEvent) {
  if (
    (event.target as Element).closest(
      '[role^="menuitem"][aria-disabled="true"]',
    )
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
function select(event: MouseEvent) {
  const item = (event.target as Element).closest<HTMLButtonElement>(
    '[role^="menuitem"]',
  );
  if (!item) return;
  if (item.disabled || item.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  if (props.closeOnSelect)
    popup.value?.dismiss(popup.value.element?.contains(document.activeElement));
}
defineExpose({
  get element() {
    return popup.value?.element;
  },
});
</script>
<template>
  <SituatePopover
    ref="popup"
    :open="open"
    :anchor="anchor"
    :point="point"
    :label="label"
    role="menu"
    class="situate-menu"
    @close="emit('close')"
    @keydown="keyboard"
    @click.capture="guardDisabled"
    @click="select"
  >
    <slot />
  </SituatePopover>
</template>
<style>
.situate-menu {
  padding: 4px;
}
.situate-menu [role^="menuitem"] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  white-space: normal;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.situate-menu [role^="menuitem"]:disabled,
.situate-menu [aria-disabled="true"] {
  opacity: 0.5;
  cursor: default;
}
.situate-menu [aria-checked="true"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.situate-menu [role^="menuitem"]:focus-visible {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-violet-deep));
  outline-offset: var(--situate-focus-offset);
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.situate-menu [role="separator"] {
  height: 1px;
  margin: 4px 8px;
  background: var(--situate-line);
}
@media (hover: hover) {
  .situate-menu
    [role^="menuitem"]:not(:disabled):not([aria-disabled="true"]):hover {
    background: var(--situate-paper);
  }
}
</style>
