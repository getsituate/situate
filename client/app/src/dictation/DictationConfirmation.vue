<script setup lang="ts">
import { computed } from "vue";
import { t } from "@situate/localization";
import { SituateButton, SituateDialogActions } from "@situate/ui";
import DictationModal from "./DictationModal.vue";
import { confirmation, dictation } from "./runtime";
const owner = computed(() =>
  dictation.owner?.id === confirmation.value?.id ? dictation.owner : null,
);
const recording = computed(() => owner.value?.phase !== "transcribing");
const outcome = computed(() =>
  confirmation.value?.inserted
    ? t("dictation.completedDetail")
    : {
        noSpeech: t("dictation.noSpeech"),
        failed: t("dictation.failed"),
        denied: t("dictation.denied"),
        interrupted: t("dictation.interrupted"),
        permission: t("dictation.permission"),
        model: t("dictation.missing"),
      }[confirmation.value?.notice ?? "interrupted"],
);
</script>
<template>
  <DictationModal
    v-if="confirmation"
    :title="
      t(
        owner
          ? 'dictation.leaveTitle'
          : confirmation.inserted
            ? 'dictation.completedTitle'
            : 'dictation.title',
      )
    "
    @close="confirmation.decide(false)"
  >
    <p role="status">
      {{
        owner
          ? t(
              recording
                ? "dictation.leaveRecording"
                : "dictation.leaveTranscribing",
            )
          : outcome
      }}
    </p>
    <SituateDialogActions>
      <SituateButton
        variant="secondary"
        autofocus
        @click="confirmation.decide(false)"
        >{{
          t(
            owner
              ? recording
                ? "dictation.stayRecording"
                : "dictation.stayTranscribing"
              : "dictation.stay",
          )
        }}</SituateButton
      >
      <SituateButton
        :variant="owner ? 'danger' : 'primary'"
        @click="confirmation.decide(true)"
        >{{
          t(owner ? "dictation.discard" : "dictation.continue")
        }}</SituateButton
      >
    </SituateDialogActions>
  </DictationModal>
</template>
<style scoped>
p {
  line-height: 1.6;
  margin: 20px 0;
}
</style>
