<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import SituateDialogActions from "./SituateDialogActions.vue";
const props = withDefaults(
  defineProps<{ appearance?: "default" | "plain"; open?: boolean }>(),
  {
    open: undefined,
    appearance: "default",
  },
);
const element = ref<HTMLDialogElement>();
watch(
  [element, () => props.open],
  ([dialog, open]) => {
    if (!dialog || open === undefined) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  },
  { flush: "post" },
);
onBeforeUnmount(() => {
  if (element.value?.open) element.value.close();
});
defineExpose({
  element,
  showModal: () => element.value?.showModal(),
  close: (returnValue?: string) => element.value?.close(returnValue),
  focus: (options?: FocusOptions) => element.value?.focus(options),
});
</script>

<template>
  <dialog
    ref="element"
    :class="appearance === 'plain' ? undefined : 'situate-dialog'"
  >
    <header v-if="$slots.header" class="situate-dialog__header">
      <slot name="header" />
    </header>
    <slot />
    <SituateDialogActions v-if="$slots.actions">
      <slot name="actions" />
    </SituateDialogActions>
  </dialog>
</template>

<style scoped>
.situate-dialog {
  box-sizing: border-box;
  width: min(520px, calc(100% - 36px));
  max-height: min(85dvh, calc(var(--app-viewport-height, 100dvh) - 24px));
  overflow: auto;
  padding: clamp(24px, 3vw, 30px);
  border: var(--situate-stroke-divider) solid var(--situate-control-line);
  border-radius: var(--situate-space-6);
  background: var(--situate-surface);
  color: var(--situate-ink);
  font-family: var(--situate-font-body);
  font-size: var(--situate-text-body);
  font-weight: 400;
  line-height: 1.55;
  letter-spacing: normal;
  overflow-wrap: anywhere;
}
.situate-dialog :deep(.situate-button) {
  font-size: var(--situate-text-small);
  font-weight: 600;
  line-height: 1.55;
}
.situate-dialog::backdrop {
  background: color-mix(in srgb, var(--situate-ink) 35%, transparent);
}
.situate-dialog .situate-dialog__header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.situate-dialog
  :deep(
    :is(p, li, dt, dd):not(
      :where([data-dialog-document], [data-dialog-document] *)
    )
  ) {
  font-family: var(--situate-font-body);
  font-size: var(--situate-text-body);
  font-weight: 400;
  line-height: 1.55;
  letter-spacing: normal;
}
.situate-dialog
  :deep(p:not(:where([data-dialog-document], [data-dialog-document] *))) {
  margin-block: 12px;
}
.situate-dialog
  :deep(
    :is(h1, h2, h3, h4, h5, h6, legend, :where([data-dialog-section])):not(
      :where([data-dialog-document], [data-dialog-document] *)
    )
  ) {
  margin-block: 20px 8px;
  font-family: var(--situate-font-body);
  font-size: var(--situate-text-body);
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: normal;
}
.situate-dialog > :slotted(h2),
.situate-dialog > :slotted(h3),
.situate-dialog .situate-dialog__header :deep(:is(h1, h2, h3)),
.situate-dialog :deep([data-dialog-title]) {
  margin: 0 0 16px;
  font-family: var(--situate-font-body);
  font-size: var(--situate-text-lead);
  font-weight: 650;
  line-height: 1.3;
  letter-spacing: normal;
  overflow-wrap: anywhere;
}
.situate-dialog .situate-dialog__header :deep(:is(h1, h2, h3)) {
  margin: 0;
}
.situate-dialog > :slotted(h2 + p),
.situate-dialog > :slotted(h3 + p),
.situate-dialog .situate-dialog__header + :deep(p),
.situate-dialog
  :deep(
    p:first-child:not(:where([data-dialog-document], [data-dialog-document] *))
  ) {
  margin-top: 0;
}
.situate-dialog
  :deep(
    [data-dialog-help]:not(
      :where([data-dialog-document], [data-dialog-document] *)
    )
  ) {
  font-family: var(--situate-font-body);
  font-size: var(--situate-text-small);
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: normal;
  color: var(--situate-muted);
}
</style>
