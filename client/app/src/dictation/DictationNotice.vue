<script setup lang="ts">
import { modelLabel } from "./runtime";
import { computed } from "vue";
import { t } from "@situate/localization";
import { SituateButton, SituateDialogActions } from "@situate/ui";
import DictationModal from "./DictationModal.vue";
import { dictation, type Notice } from "./runtime";
const props = defineProps<{ notice: Notice }>();
const emit = defineEmits<{ dismiss: []; settings: [] }>();
const message = computed(
  () =>
    ({
      model: modelLabel(),
      permission: t("dictation.permission"),
      denied: t("dictation.denied"),
      noSpeech: t("dictation.noSpeech"),
      failed: t("dictation.failed"),
      interrupted: t("dictation.interrupted"),
    })[props.notice],
);
const detail = computed(() => {
  if (props.notice === "denied") return t("dictation.deniedDetail");
  if (props.notice === "permission") return t("dictation.permissionDetail");
  if (props.notice !== "model") return "";
  return t(
    dictation.model === "storage"
      ? "dictation.storageRecovery"
      : dictation.model === "failed"
        ? "dictation.downloadRecovery"
        : dictation.model === "waiting"
          ? "dictation.waitingDetail"
          : dictation.model === "preparing"
            ? "dictation.preparingDetail"
            : "dictation.scopeDetail",
  );
});
</script>
<template>
  <DictationModal
    class="dictation-notice"
    :title="t('dictation.title')"
    @close="emit('dismiss')"
  >
    <div role="status" aria-atomic="true">
      <p>{{ message }}</p>
      <p v-if="detail">{{ detail }}</p>
    </div>
    <SituateDialogActions>
      <SituateButton
        variant="secondary"
        autofocus
        tabindex="0"
        @click="emit('dismiss')"
        >{{ t("dictation.dismiss") }}</SituateButton
      >
      <SituateButton
        v-if="notice === 'model'"
        tabindex="0"
        @click="emit('settings')"
        >{{ t("dictation.settings") }}</SituateButton
      >
    </SituateDialogActions>
  </DictationModal>
</template>
<style scoped>
.dictation-notice {
  box-sizing: border-box;
  max-height: min(85dvh, calc(var(--app-content-height, 100dvh) - 32px));
  inset-block-end: max(
    0px,
    calc(var(--app-viewport-height, 100dvh) - var(--app-content-height, 100dvh))
  );
}
p {
  margin: 20px 0;
  line-height: 1.6;
}
</style>
