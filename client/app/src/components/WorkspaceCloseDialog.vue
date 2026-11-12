<script setup lang="ts">
import { ref } from "vue";
import { SituateButton, SituateDialog } from "@situate/ui";
import { t } from "@situate/localization";

defineProps<{ selectingModel: boolean; busy: boolean }>();
const emit = defineEmits<{ cancel: []; abort: [] }>();
const dialog = ref<InstanceType<typeof SituateDialog>>();
defineExpose({
  get element() {
    return dialog.value?.element;
  },
});
</script>
<template>
  <SituateDialog
    ref="dialog"
    aria-labelledby="close-ai-title"
    @cancel.prevent="emit('cancel')"
  >
    <h2 id="close-ai-title">
      {{
        selectingModel
          ? t("navigation.closeThisWorkspace")
          : t("navigation.aResponseIsRunning")
      }}
    </h2>
    <p v-if="selectingModel">
      {{ t("navigation.closingWaitsForTheModelChoiceToFinishSaving") }}
    </p>
    <p v-else>
      {{ t("navigation.abortNowAndCloseThisWorkspaceRequestsAlreadyReceived") }}
    </p>
    <template #actions>
      <SituateButton
        variant="secondary"
        type="button"
        :disabled="busy"
        @click="emit('cancel')"
      >
        {{ t("navigation.cancel") }}
      </SituateButton>
      <SituateButton
        :variant="selectingModel ? 'primary' : 'danger'"
        type="button"
        :disabled="busy"
        @click="emit('abort')"
      >
        {{
          selectingModel
            ? t("navigation.waitAndClose")
            : t("navigation.abortNowAndClose")
        }}
      </SituateButton>
    </template>
  </SituateDialog>
</template>
