<script setup lang="ts">
import { modelLabel } from "./runtime";
import { t } from "@situate/localization";
import { SituateButton, SituateProgress } from "@situate/ui";
import { dictation as state, retryProvisioning } from "./runtime";
</script>
<template>
  <section class="dictation-settings">
    <p class="scope">{{ t("dictation.scope") }}</p>
    <div class="download-status">
      <div role="status" aria-atomic="true">
        <p class="download-state">{{ modelLabel() }}</p>
        <p v-if="state.model === 'waiting'" class="download-help">
          {{ t("dictation.waitingDetail") }}
        </p>
        <p v-if="state.model === 'failed'" class="download-help">
          {{ t("dictation.downloadRecovery") }}
        </p>
        <p v-if="state.model === 'storage'" class="download-help">
          {{ t("dictation.storageRecovery") }}
        </p>
      </div>
      <div
        v-if="
          state.model === 'downloading' ||
          (state.model === 'waiting' && state.progress > 0)
        "
        class="progress-row"
      >
        <SituateProgress
          :value="state.progress"
          :label="t('dictation.downloading')"
        />
        <span>{{ state.progress }}%</span>
      </div>
      <SituateButton
        v-if="state.model === 'failed' || state.model === 'storage'"
        variant="secondary"
        @click="retryProvisioning()"
        >{{ t("dictation.retry") }}</SituateButton
      >
    </div>
    <p class="privacy">{{ t("dictation.privacy") }}</p>
  </section>
</template>
<style scoped>
.dictation-settings {
  max-width: 480px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
p {
  margin: 0;
}
.scope,
.privacy {
  color: var(--situate-muted);
  font-size: 13px;
}
.scope {
  margin-bottom: 16px;
}
.download-state {
  font-size: 16px;
  font-weight: 600;
}
.download-help {
  margin-top: 8px;
}
.progress-row {
  display: flex;
  gap: 12px;
  align-items: center;
  font-variant-numeric: tabular-nums;
  margin-top: 12px;
}
.progress-row :deep(.situate-progress) {
  flex: 1;
  min-width: 0;
}
.download-status button {
  margin-top: 12px;
}
.privacy {
  margin-top: 20px;
}
</style>
