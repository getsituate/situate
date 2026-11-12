<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { SituateIconButton, SituateDialog } from "../ui";
defineProps<{
  title: string;
  focusClose?: boolean;
  closeLabel?: string;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<InstanceType<typeof SituateDialog>>();
const titleId = useId();
let invoker: HTMLElement | null = null;
onMounted(async () => {
  invoker = document.activeElement as HTMLElement | null;
  dialog.value?.element?.showModal();
  await nextTick();
  (
    (dialog.value?.element?.querySelector("[autofocus]") ??
      dialog.value?.element?.querySelector(
        '[role="menuitem"], input, select, textarea',
      )) as HTMLElement | null
  )?.focus();
});
onBeforeUnmount(() => {
  dialog.value?.element?.close();
  if (invoker?.isConnected) invoker.focus();
});
function backdrop(event: MouseEvent) {
  if (event.target !== dialog.value?.element) return;
  const box = dialog.value!.element!.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    emit("close");
}
</script>
<template>
  <SituateDialog
    ref="dialog"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('close')"
    @click="backdrop"
  >
    <template #header>
      <h2 :id="titleId">{{ title }}</h2>
      <SituateIconButton
        icon="close"
        :label="closeLabel ?? 'Close dialog'"
        :autofocus="focusClose"
        tabindex="0"
        @click="emit('close')"
      />
    </template>
    <slot />
  </SituateDialog>
</template>
<style scoped>
dialog {
  color: var(--situate-ink);
  width: min(480px, calc(100% - 32px));
  max-height: 85dvh;
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-dialog);
  background: var(--situate-surface);
  box-shadow: 0 24px 80px #30203e26;
  font-family: var(--situate-font-body);
}
dialog::backdrop {
  background: #30203e40;
}
</style>
