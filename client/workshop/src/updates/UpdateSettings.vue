<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { SituateButton, SituateIcon, SituateProgress } from "../ui";
import copy from "../localization/en.updates.json" with { type: "json" };
import type { UpdateState, UpdateAction } from "./model";
const props = defineProps<{ state: UpdateState }>();
const emit = defineEmits<{ action: [action: UpdateAction] }>();
function requestInstall(event: MouseEvent) {
  (event.currentTarget as HTMLButtonElement).focus();
  emit("action", { type: "request-install" });
}
function requestForce(event: MouseEvent) {
  (event.currentTarget as HTMLButtonElement).focus();
  emit("action", { type: "request-force" });
}
const failureHeading = ref<HTMLHeadingElement>();
watch(
  () => props.state.preparation,
  async (preparation) => {
    if (preparation === "failed" || preparation === "blocked") {
      await nextTick();
      failureHeading.value?.focus();
    }
  },
);
const preparationFailed = computed(() =>
  ["failed", "blocked"].includes(props.state.preparation),
);
const title = computed(
  () =>
    ({
      current: copy.latest,
      checking: copy.checking,
      downloading: copy.downloadTitle,
      ready: copy.readyTitle,
      installing: copy.installing,
      "check-failed": copy.checkFailed,
    })[props.state.phase],
);
const visibleTitle = computed(() =>
  props.state.preparation === "pending"
    ? copy.preparingTitle
    : preparationFailed.value
      ? copy.preparationFailed
      : title.value,
);
const detail = computed(
  () =>
    ({
      current: copy.latestDetail,
      checking: copy.checkingDetail,
      downloading: copy.downloadDetail,
      ready: copy.readyDetail,
      installing: copy.installingDetail,
      "check-failed": copy.checkFailedDetail,
    })[props.state.phase],
);
</script>
<template>
  <div class="update-settings" v-if="state.channel === 'direct'">
    <p class="update-scope">{{ copy.scope }}</p>
    <div class="installed-version">
      <span>{{ copy.currentVersion }}</span
      ><strong>{{ state.installed }}</strong>
    </div>
    <section class="update-status" :aria-label="copy.title">
      <div class="status-symbol" aria-hidden="true">
        <SituateIcon
          :name="
            state.phase === 'current'
              ? 'tasks'
              : state.phase === 'ready'
                ? 'update'
                : 'info'
          "
        />
      </div>
      <div class="status-body">
        <h3 ref="failureHeading" tabindex="-1">
          {{ visibleTitle }}
        </h3>
        <p
          v-if="['ready', 'downloading', 'installing'].includes(state.phase)"
          class="target-version"
        >
          {{ copy.version.replace("{version}", state.available) }}
        </p>
        <template v-if="preparationFailed">
          <p role="alert">
            {{ copy.preparationReasons[state.preparationReason] }}
          </p>
          <p>{{ copy.stoppedChats }}</p>
          <p
            v-if="
              state.preparation === 'blocked' &&
              state.preparationReason === 'stop-failed'
            "
          >
            {{ copy.manualInstallation }}
          </p>
        </template>
        <p v-else-if="state.preparation === 'pending'">
          {{ state.forced ? copy.forcePreparingDetail : copy.preparingDetail }}
        </p>
        <p v-else>{{ detail }}</p>
        <div v-if="state.phase === 'downloading'" class="download-progress">
          <SituateProgress :value="state.progress" :label="copy.progress" />
          <div class="progress-meta">
            <span>{{
              copy.downloaded
                .replace("{done}", String(Math.round(state.progress * 1.28)))
                .replace("{total}", "128")
            }}</span
            ><strong>{{ state.progress }}%</strong>
          </div>
        </div>
        <div class="status-actions">
          <SituateButton
            v-if="state.phase === 'current' || state.phase === 'check-failed'"
            variant="secondary"
            @click="emit('action', { type: 'check' })"
            >{{ copy.check }}</SituateButton
          >
          <SituateButton
            v-if="state.phase === 'ready'"
            :disabled="
              state.preparation === 'blocked' || state.preparation === 'pending'
            "
            @click="requestInstall"
            >{{
              state.preparation === "pending"
                ? copy.preparingTitle
                : state.preparation === "blocked"
                  ? copy.waitForWrites
                  : state.preparation === "failed"
                    ? copy.retryPreparation
                    : copy.install
            }}</SituateButton
          >
          <SituateButton
            v-if="state.preparation === 'failed'"
            variant="secondary"
            @click="requestForce"
            >{{ copy.force }}</SituateButton
          >
          <span v-if="state.phase === 'current'" class="last-check">{{
            copy.lastCheck
          }}</span>
        </div>
        <span role="status" class="sr-only">{{ visibleTitle }}</span>
      </div>
    </section>
    <section class="update-release">
      <div class="release-heading">
        <h3>{{ copy.history }}</h3>
      </div>
      <SituateButton
        variant="secondary"
        @click="
          ($event.currentTarget as HTMLElement).focus();
          emit('action', { type: 'show-notes' });
        "
        >{{ copy.readNotes }}</SituateButton
      >
    </section>
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
  line-height: 1.65;
  font-size: 14px;
  max-width: 48ch;
}
.status-body .target-version {
  color: var(--situate-ink);
  font-size: 13px;
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.status-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}
.status-actions:not(:empty) {
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
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--situate-muted);
}
.progress-meta strong {
  color: var(--situate-ink);
  font-weight: 500;
}
.release-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.release-heading h3 {
  font-size: 16px;
}
.release-heading > span {
  font-size: 12px;
  color: var(--situate-muted);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
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
