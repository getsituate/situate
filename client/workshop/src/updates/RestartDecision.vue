<script setup lang="ts">
import { useId } from "vue";
import { SituateButton, SituateDialog } from "../ui";
withDefaults(
  defineProps<{
    title: string;
    description: string;
    cancelLabel: string;
    confirmLabel?: string;
    danger?: boolean;
    id?: string;
  }>(),
  { danger: false },
);
const emit = defineEmits<{ close: []; confirm: [] }>();
const generated = `restart-${useId().replace(/[^a-z0-9-]/gi, "")}`;
function trapTab(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget as HTMLDialogElement;
  const items = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]),textarea,summary",
    ),
  ).filter((item) => item.getClientRects().length);
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[
    (index + (event.shiftKey ? -1 : 1) + items.length) % items.length
  ]?.focus();
}
</script>
<template>
  <SituateDialog
    :open="true"
    class="restart-decision"
    :aria-labelledby="`${id ?? generated}-title`"
    :aria-describedby="`${id ?? generated}-description`"
    @cancel.prevent="emit('close')"
    @keydown="trapTab"
  >
    <template #header
      ><h2 :id="`${id ?? generated}-title`">{{ title }}</h2></template
    >
    <p :id="`${id ?? generated}-description`">{{ description }}</p>
    <slot />
    <template #actions>
      <SituateButton variant="secondary" autofocus @click="emit('close')">{{
        cancelLabel
      }}</SituateButton>
      <slot name="before-confirm" />
      <SituateButton
        v-if="confirmLabel"
        :variant="danger ? 'danger' : 'primary'"
        @click="emit('confirm')"
        >{{ confirmLabel }}</SituateButton
      >
    </template>
  </SituateDialog>
</template>
<style scoped>
.restart-decision {
  width: min(560px, calc(100% - 36px));
}
.restart-decision :deep(.situate-dialog-actions) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.restart-decision :deep(.situate-dialog-actions:has(> :nth-child(3))) {
  display: flex;
}
@media (max-width: 580px) {
  .restart-decision :deep(.situate-dialog-actions) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
