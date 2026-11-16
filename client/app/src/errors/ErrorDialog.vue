<script setup lang="ts">
import { useId } from "vue";
import { t } from "@situate/localization";
import { SituateButton, SituateDialog } from "@situate/ui";
defineProps<{ open: boolean; message: string }>();
const emit = defineEmits<{ dismiss: [] }>();
const id = useId();
</script>

<template>
  <SituateDialog
    v-if="open"
    class="error-dialog"
    :open="open"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-message`"
    @cancel.prevent="emit('dismiss')"
  >
    <template #header>
      <h2 :id="`${id}-title`">{{ t("errorRecovery.operationTitle") }}</h2>
    </template>
    <p :id="`${id}-message`" role="alert">{{ message }}</p>
    <template #actions>
      <SituateButton variant="secondary" autofocus @click="emit('dismiss')">
        {{ t("errorRecovery.dismiss") }}
      </SituateButton>
      <slot name="actions" />
    </template>
  </SituateDialog>
</template>
