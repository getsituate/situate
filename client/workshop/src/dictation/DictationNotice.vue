<script setup lang="ts">
import { computed, onUnmounted } from "vue";
import EditorDialog from "../editor/EditorDialog.vue";
import { SituateButton } from "../ui";
import { copy } from "./content";
import { modelLabel, type DictationState, type Feedback } from "./model";
const props = defineProps<{ state: DictationState; feedback: Feedback }>();
const emit = defineEmits<{
  dismiss: [];
  settings: [];
  closed: [owner: string];
}>();
onUnmounted(() => emit("closed", props.feedback.owner));
const c = computed(() => copy(props.state.language));
const message = computed(() =>
  props.feedback.kind === "model"
    ? modelLabel(props.state)
    : c.value[props.feedback.kind],
);
const detail = computed(() => {
  if (props.feedback.kind === "denied") return c.value.deniedDetail;
  if (props.feedback.kind === "permission") return c.value.permissionDetail;
  if (props.feedback.kind !== "model") return "";
  return props.state.model === "storage"
    ? c.value.storageRecovery
    : props.state.model === "failed"
      ? c.value.downloadRecovery
      : props.state.model === "waiting"
        ? c.value.waitingDetail
        : props.state.model === "preparing"
          ? c.value.preparingDetail
          : c.value.scopeDetail;
});
</script>
<template>
  <EditorDialog
    class="dictation-notice"
    :title="c.title"
    :close-label="c.closeDialog"
    :lang="state.language"
    @close="emit('dismiss')"
  >
    <div role="status" aria-atomic="true">
      <p>{{ message }}</p>
      <p v-if="detail">{{ detail }}</p>
    </div>
    <div class="notice-actions">
      <SituateButton
        variant="secondary"
        autofocus
        tabindex="0"
        @click="emit('dismiss')"
        >{{ c.dismiss }}</SituateButton
      >
      <SituateButton
        v-if="feedback.kind === 'model'"
        tabindex="0"
        @click="emit('settings')"
        >{{ c.settings }}</SituateButton
      >
    </div>
  </EditorDialog>
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
.notice-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
