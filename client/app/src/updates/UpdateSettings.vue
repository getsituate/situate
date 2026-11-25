<script setup lang="ts">
import { useId, computed, shallowRef, watch } from "vue";
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
const id = useId();
type RestartConfirmation = { artifactId: string; force: boolean };
const confirmation = shallowRef<RestartConfirmation | null>(null);
let ordinaryAttempt: string | null = null;
const running = computed(
  () =>
    updates.runningActions ||
    updateRequestError.value === "native.updates.runningActions" ||
    updates.error === "native.updates.runningActions",
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
const canForce = computed(
  () =>
    canInstall.value && updates.error === "native.updates.preparationFailed",
);
watch(
  [canInstall, () => updates.artifactId],
  () => {
    confirmation.value = null;
  },
  { flush: "sync" },
);
watch(
  () => updates.artifactId,
  () => {
    ordinaryAttempt = null;
  },
  { flush: "sync" },
);
watch([() => updates.phase, () => updates.error], ([phase, error]) => {
  if (phase === "preparing" || ordinaryAttempt === null) return;
  const artifactId = ordinaryAttempt;
  ordinaryAttempt = null;
  if (phase !== "install-failed" || !canInstall.value) return;
  if (canForce.value) confirmation.value = { artifactId, force: true };
  else if (error === "native.updates.runningActions")
    confirmation.value = { artifactId, force: false };
});
async function requestInstall(event: MouseEvent, force = false): Promise<void> {
  if (
    !canInstall.value ||
    updateRequestPending.value ||
    updates.artifactId === null
  )
    return;
  (event.currentTarget as HTMLButtonElement).focus();
  const artifactId = updates.artifactId;
  if (force ? canForce.value : running.value) {
    confirmation.value = { artifactId, force };
  } else if (!force) {
    await install(artifactId, false, false);
  }
}
const confirmInstall = computed(() => {
  const target = confirmation.value;
  return async () => {
    if (
      !target ||
      target !== confirmation.value ||
      updateRequestPending.value ||
      !canInstall.value ||
      (target.force && !canForce.value)
    )
      return;
    confirmation.value = null;
    await install(target.artifactId, true, target.force);
  };
});
async function install(
  artifactId: string,
  abortRunning: boolean,
  force: boolean,
): Promise<void> {
  ordinaryAttempt = force ? null : artifactId;
  if (await installUpdate(artifactId, abortRunning, force)) return;
  if (ordinaryAttempt !== artifactId) return;
  ordinaryAttempt = null;
  if (
    canInstall.value &&
    updateRequestError.value === "native.updates.runningActions"
  )
    confirmation.value = { artifactId, force: false };
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
        <p v-if="canInstall">{{ t("updates.readyDetail") }}</p>
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
            @click="requestInstall"
            >{{
              t(
                updates.phase === "ready"
                  ? "updates.install"
                  : "updates.retryInstall",
              )
            }}</SituateButton
          >
          <SituateButton
            v-if="canForce"
            variant="secondary"
            :disabled="updateRequestPending"
            @click="requestInstall($event, true)"
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
      :open="confirmation !== null"
      :aria-labelledby="`update-restart-title-${id}`"
      :aria-describedby="`update-restart-description-${id}`"
      @cancel.prevent="confirmation = null"
    >
      <template #header
        ><h2 :id="`update-restart-title-${id}`">
          {{
            t(
              confirmation?.force
                ? "updates.forceTitle"
                : "updates.restartTitle",
            )
          }}
        </h2></template
      >
      <p :id="`update-restart-description-${id}`">
        {{
          t(
            confirmation?.force
              ? "updates.forceWarning"
              : "updates.restartWorking",
          )
        }}
      </p>
      <p>{{ t("updates.restartCaution") }}</p>
      <p v-if="updateRequestError" role="alert">
        {{ localizeError(updateRequestError) }}
      </p>
      <template #actions>
        <SituateButton
          variant="secondary"
          autofocus
          :disabled="updateRequestPending"
          @click="confirmation = null"
          >{{ t("updates.later") }}</SituateButton
        >
        <SituateButton
          variant="danger"
          :disabled="
            updateRequestPending ||
            !canInstall ||
            (confirmation?.force && !canForce)
          "
          @click="confirmInstall"
          >{{
            t(
              confirmation?.force
                ? "updates.forceConfirm"
                : "updates.abortConfirm",
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
