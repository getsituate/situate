<script setup lang="ts">
import { SituateDialog, SituateIconButton } from "@situate/ui";
import { t } from "@situate/localization";
import { computed, onMounted, onBeforeUnmount, useTemplateRef } from "vue";
defineProps<{ title: string; wide?: boolean; busy?: boolean }>();
const emit = defineEmits<{ dismiss: [] }>();
const dialogControl =
  useTemplateRef<InstanceType<typeof SituateDialog>>("dialogControl");
const dialog = computed(() => dialogControl.value?.element);
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <SituateDialog
    ref="dialogControl"
    class="file-dialog"
    :class="{ 'wide-dialog': wide }"
    :aria-label="title"
    @cancel.prevent="!busy && emit('dismiss')"
  >
    <template #header>
      <h2>{{ title }}</h2>
      <SituateIconButton
        icon="close"
        :label="t('files.closeDialog')"
        :disabled="busy"
        @click="emit('dismiss')"
      />
    </template>
    <div class="dialog-layout"><slot /></div>
  </SituateDialog>
</template>
