<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { SituateIconButton, SituateDialog } from "@situate/ui";
import { t } from "@situate/localization";
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
        :label="closeLabel ?? t('dictation.closeDialog')"
        :autofocus="focusClose"
        tabindex="0"
        @click="emit('close')"
      />
    </template>
    <slot />
  </SituateDialog>
</template>
