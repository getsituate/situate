<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { SituateButton, SituateDialog, SituateProgress } from "@situate/ui";
import {
  t,
  localizeError,
  formatDateTime,
  formatNumber,
  type MessageKey,
} from "@situate/localization";
import {
  updates,
  updateReady,
  updateRequestError,
  updateRequestPending,
  checkUpdates,
  installUpdate,
  type UpdatePhase,
} from "./runtime";
import UpdateSymbol from "./UpdateSymbol.vue";
import ReleaseHistoryAccess from "./ReleaseHistoryAccess.vue";
const confirming = ref(false);
const confirmedTarget = ref<{ artifactId: string } | null>(null);
const confirmRunning = ref(false);
const confirmForced = ref(false);
const running = computed(
  () =>
    updates.runningActions ||
    updateRequestError.value === "native.updates.runningActions",
);
const phaseKeys: Record<UpdatePhase, MessageKey> = {
  current: "updates.phase.current",
  checking: "updates.phase.checking",
  downloading: "updates.phase.downloading",
  ready: "updates.phase.ready",
  preparing: "updates.phase.preparing",
  installing: "updates.phase.installing",
  "check-failed": "updates.phase.check-failed",
  "download-failed": "updates.phase.download-failed",
  "install-failed": "updates.phase.install-failed",
  "recovery-required": "updates.phase.recovery-required",
};
const title = computed(() => {
  const key: MessageKey =
    updates.phase === "current" && updates.lastSuccessfulCheck === null
      ? "updates.check"
      : phaseKeys[updates.phase];
  return t(key);
});
const progress = computed(() =>
  updates.totalBytes && updates.totalBytes > 0
    ? Math.min(
        100,
        Math.max(0, (updates.downloadedBytes / updates.totalBytes) * 100),
      )
    : null,
);
function megabytes(bytes: number): string {
  return formatNumber(bytes / 1_000_000, undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}
const canInstall = computed(() => updateReady());
watch(
  [canInstall, () => updates.artifactId],
  () => {
    confirming.value = false;
    confirmedTarget.value = null;
  },
  { flush: "sync" },
);
const confirmInstall = computed(() => {
  const target = confirmedTarget.value;
  const forced = confirmForced.value;
  return () => install(target, forced);
});
function confirm(event: MouseEvent, force = false): void {
  (event.currentTarget as HTMLButtonElement).focus();
  if (!canInstall.value || updates.artifactId === null) return;
  confirmedTarget.value = { artifactId: updates.artifactId };
  confirmRunning.value = running.value;
  confirmForced.value = force;
  confirming.value = true;
}
async function confirmForce(event: MouseEvent): Promise<void> {
  const dialog = (event.currentTarget as HTMLButtonElement).closest("dialog");
  confirmForced.value = true;
  await nextTick();
  dialog?.querySelector<HTMLButtonElement>("button[autofocus]")?.focus();
}
async function install(
  target: { artifactId: string } | null,
  forced: boolean,
): Promise<void> {
  if (
    !confirming.value ||
    !canInstall.value ||
    target === null ||
    target !== confirmedTarget.value ||
    forced !== confirmForced.value ||
    target.artifactId !== updates.artifactId
  )
    return;
  if (running.value && !confirmRunning.value && !forced) {
    confirmRunning.value = true;
    return;
  }
  const installed = await installUpdate(
    target.artifactId,
    confirmRunning.value,
    forced,
  );
  if (target !== confirmedTarget.value) return;
  if (updateRequestError.value === "native.updates.runningActions")
    confirmRunning.value = true;
  if (installed || updateRequestError.value !== "native.updates.runningActions")
    confirming.value = false;
}
</script>
<template>
  <div v-if="updates.supported" class="update-settings">
    <p class="update-scope">{{ t("updates.scope") }}</p>
    <div class="installed-version">
      <span>{{ t("updates.installed") }}</span
      ><strong>{{ updates.installedVersion }}</strong>
    </div>
    <section class="update-status" :aria-label="t('updates.title')">
      <div class="status-symbol"><UpdateSymbol /></div>
      <div class="status-body">
        <h3 aria-live="polite">{{ title }}</h3>
        <p v-if="updates.availableVersion" class="target-version">
          {{ t("updates.version", { version: updates.availableVersion }) }}
        </p>
        <p v-if="updates.phase !== 'recovery-required'">
          {{ t(updateReady() ? "updates.readyDetail" : "updates.background") }}
        </p>
        <div v-if="updates.phase === 'downloading'" class="download-progress">
          <SituateProgress :value="progress" :label="t('updates.progress')" />
          <p class="progress-meta">
            {{
              updates.totalBytes !== null && updates.totalBytes > 0
                ? t("updates.megabytesTotal", {
                    done: megabytes(updates.downloadedBytes),
                    total: megabytes(updates.totalBytes),
                  })
                : t("updates.megabytes", {
                    megabytes: megabytes(updates.downloadedBytes),
                  })
            }}
          </p>
        </div>
        <p v-if="updates.error || updateRequestError" role="alert">
          {{ localizeError(updateRequestError || updates.error) }}
        </p>
        <p v-if="updates.phase === 'recovery-required'">
          {{ t("updates.recoveryDetail") }}
        </p>
        <div class="status-actions">
          <SituateButton
            v-if="
              ['current', 'check-failed', 'download-failed'].includes(
                updates.phase,
              )
            "
            variant="secondary"
            :disabled="updateRequestPending"
            @click="checkUpdates()"
            >{{
              t(
                updates.phase === "download-failed"
                  ? "updates.retryDownload"
                  : "updates.check",
              )
            }}</SituateButton
          >
          <SituateButton
            v-if="canInstall"
            :disabled="updateRequestPending"
            @click="confirm"
            >{{
              t(
                updates.phase === "ready"
                  ? "updates.install"
                  : "updates.retryInstall",
              )
            }}</SituateButton
          >
          <SituateButton
            v-if="
              canInstall && updates.error === 'native.updates.preparationFailed'
            "
            variant="secondary"
            :disabled="updateRequestPending"
            @click="confirm($event, true)"
            >{{ t("updates.force") }}</SituateButton
          >
          <span
            v-if="updates.lastSuccessfulCheck !== null"
            class="last-check"
            >{{
              t("updates.lastCheck", {
                time: formatDateTime(new Date(updates.lastSuccessfulCheck)),
              })
            }}</span
          >
        </div>
      </div>
    </section>
    <SituateDialog
      :open="confirming"
      aria-labelledby="update-restart-title"
      aria-describedby="update-restart-description"
      @cancel.prevent="!updateRequestPending && (confirming = false)"
    >
      <template #header
        ><h2 id="update-restart-title">
          {{ t(confirmForced ? "updates.forceTitle" : "updates.restartTitle") }}
        </h2></template
      >
      <p id="update-restart-description">
        {{
          t(
            confirmForced
              ? "updates.forceWarning"
              : confirmRunning
                ? "updates.restartWorking"
                : "updates.restartIdle",
          )
        }}
      </p>
      <p v-if="confirmRunning || confirmForced">
        {{ t("updates.restartCaution") }}
      </p>
      <p v-if="updateRequestError" role="alert">
        {{ localizeError(updateRequestError) }}
      </p>
      <template #actions>
        <SituateButton
          variant="secondary"
          autofocus
          :disabled="updateRequestPending"
          @click="confirming = false"
          >{{ t("updates.later") }}</SituateButton
        >
        <SituateButton
          v-if="!confirmForced"
          variant="secondary"
          :disabled="updateRequestPending || !canInstall"
          @click="confirmForce"
          >{{ t("updates.force") }}</SituateButton
        >
        <SituateButton
          :variant="confirmRunning || confirmForced ? 'danger' : 'primary'"
          :disabled="updateRequestPending || !canInstall"
          @click="confirmInstall"
          >{{
            t(
              confirmForced
                ? "updates.forceConfirm"
                : confirmRunning
                  ? "updates.abortConfirm"
                  : "updates.install",
            )
          }}</SituateButton
        >
      </template>
    </SituateDialog>
    <ReleaseHistoryAccess />
  </div>
</template>
<style scoped>
.update-settings {
  max-width: 700px;
}
.update-scope {
  color: var(--situate-muted);
  font-size: 13px;
  margin: -8px 0 32px;
}
.installed-version {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--situate-muted);
  font-size: 14px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--situate-line);
}
.installed-version strong {
  color: var(--situate-ink);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.update-status {
  display: flex;
  gap: 18px;
  margin: 28px 0 38px;
  padding: 26px;
  border: 1px solid var(--situate-line);
  border-radius: 20px;
  background: var(--situate-paper);
}
.status-symbol {
  display: grid;
  place-items: center;
  flex: none;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  color: var(--situate-accent-strong);
  background: var(--situate-accent-soft);
}
.status-body {
  flex: 1;
  min-width: 0;
}
h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.4;
  font-weight: 600;
}
.status-body p {
  margin: 8px 0 0;
  color: var(--situate-muted);
  max-width: 48ch;
}
.status-body p:not(:where(.situate-dialog *)) {
  line-height: 1.65;
  font-size: 14px;
}
.status-body .target-version {
  color: var(--situate-ink);
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.status-body .target-version:not(:where(.situate-dialog *)) {
  font-size: 13px;
}
.status-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-top: 22px;
}
.last-check {
  font-size: 12px;
  color: var(--situate-muted);
}
.download-progress {
  margin-top: 24px;
}
.progress-meta {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--situate-muted);
}
@media (max-width: 600px) {
  .update-status {
    padding: 18px;
    gap: 12px;
  }
  .status-symbol {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }
}
</style>
