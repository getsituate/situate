<script setup lang="ts">
import { computed } from "vue";
import { SituateButton, SituateDialog, SituateIcon } from "../ui";
import copy from "../localization/en.updates.json" with { type: "json" };
import ReleaseHistory from "./ReleaseHistory.vue";
import RestartDecision from "./RestartDecision.vue";
import type { UpdateState, UpdateAction } from "./model";
const props = defineProps<{ state: UpdateState }>();
const emit = defineEmits<{ action: [action: UpdateAction] }>();
const notes = computed(() => props.state.dialog === "release-notes");
const heading = computed(() =>
  notes.value
    ? copy.history
    : props.state.dialog === "sync"
      ? copy.syncWaiting
      : props.state.dialog === "force"
        ? copy.forceTitle
        : copy.restartTitle,
);
function close() {
  emit("action", { type: "close-dialog" });
}
</script>
<template>
  <RestartDecision
    v-if="state.dialog === 'restart'"
    id="update-dialog"
    :title="copy.restartTitle"
    :description="state.running ? copy.restartWorking : copy.restartIdle"
    :cancel-label="copy.later"
    :confirm-label="
      state.unsynced
        ? copy.withoutSync
        : state.running
          ? copy.abortConfirm
          : copy.confirm
    "
    :danger="state.running"
    @close="close"
    @confirm="emit('action', { type: 'confirm-install' })"
  >
    <p v-if="state.running" class="interruption-detail">
      {{ copy.restartCaution }}
    </p>
    <p v-if="state.unsynced" class="sync-notice">
      <SituateIcon name="info" />{{ copy.unsynced }}
    </p>
    <template v-if="state.unsynced" #before-confirm>
      <SituateButton
        variant="secondary"
        @click="emit('action', { type: 'confirm-install', synchronize: true })"
        >{{ copy.sync }}</SituateButton
      >
    </template>
  </RestartDecision>
  <SituateDialog
    v-else
    :open="!!state.dialog"
    appearance="default"
    class="update-dialog"
    :class="{
      'release-dialog': notes,
      'restart-dialog': state.dialog === 'force',
    }"
    aria-labelledby="update-dialog-title"
    :aria-describedby="notes ? undefined : 'update-dialog-description'"
    @cancel.prevent="close"
  >
    <template #header>
      <div>
        <h2 id="update-dialog-title">{{ heading }}</h2>
      </div>
    </template>
    <template v-if="notes">
      <ReleaseHistory :state="state" />
    </template>
    <template v-else-if="state.dialog === 'force'">
      <p id="update-dialog-description">{{ copy.forceWarning }}</p>
      <p class="interruption-detail">{{ copy.restartCaution }}</p>
    </template>
    <p v-else id="update-dialog-description">{{ copy.syncDetail }}</p>
    <template #actions>
      <SituateButton v-if="notes" autofocus @click="close">{{
        copy.close
      }}</SituateButton>
      <template v-else-if="state.dialog === 'force'">
        <SituateButton variant="secondary" autofocus @click="close">{{
          copy.later
        }}</SituateButton>
        <SituateButton
          variant="danger"
          @click="emit('action', { type: 'confirm-force' })"
          >{{ copy.forceConfirm }}</SituateButton
        >
      </template>
      <SituateButton v-else variant="secondary" autofocus @click="close">{{
        copy.cancelSync
      }}</SituateButton>
    </template>
  </SituateDialog>
</template>
<style scoped>
.update-dialog {
  width: min(560px, calc(100% - 36px));
}
.restart-dialog :deep(.situate-dialog-actions) {
  display: grid;
  grid-template-columns: auto auto;
  justify-content: end;
}
@media (max-width: 580px) {
  .restart-dialog :deep(.situate-dialog-actions) {
    grid-template-columns: minmax(0, 1fr);
    justify-content: stretch;
  }
}
.release-dialog {
  width: min(800px, calc(100% - 48px));
  padding: clamp(20px, 3vw, 30px);
}
.release-dialog[open] {
  display: flex;
  flex-direction: column;
  max-height: min(
    calc(100dvh - 32px),
    calc(var(--app-content-height, 100dvh) - 32px)
  );
  overflow: hidden;
  height: min(
    880px,
    calc(100dvh - 48px),
    calc(var(--app-content-height, 100dvh) - 48px)
  );
}
.release-dialog :deep(.situate-dialog-actions) {
  flex-shrink: 0;
  padding-top: 20px;
  border-top: 1px solid var(--situate-line);
}
@media (max-width: 600px) {
  .release-dialog {
    width: calc(100% - 24px);
    padding: 20px;
  }
}
.interruption-detail {
  color: var(--situate-muted);
}
.sync-notice {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
  border-radius: 12px;
  background: var(--situate-accent-soft);
}
</style>
