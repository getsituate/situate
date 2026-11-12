<script setup lang="ts">
import { computed } from "vue";
import EditorDialog from "../editor/EditorDialog.vue";
import { SituateButton } from "../ui";
import { copy } from "./content";
import type { DictationState } from "./model";
const props = defineProps<{
  state: DictationState;
  fileBlocked: boolean;
  agentWorking: boolean;
}>();
const emit = defineEmits<{ decide: [discard: boolean]; reviewFile: [] }>();
const c = computed(() => copy(props.state.language));
const recording = computed(() => props.state.session?.phase !== "transcribing");
</script>
<template>
  <EditorDialog
    :title="
      fileBlocked
        ? c.fileBlockedTitle
        : state.session
          ? c.leaveTitle
          : c.completedTitle
    "
    @close="emit('decide', false)"
  >
    <div :lang="state.language">
      <p role="status">
        {{
          fileBlocked
            ? c.fileBlockedDetail
            : state.session
              ? recording
                ? c.leaveRecording
                : c.leaveTranscribing
              : c.completedDetail
        }}
      </p>
      <p v-if="agentWorking && !fileBlocked">{{ c.agentCloseDetail }}</p>
      <div class="dialog-actions">
        <SituateButton
          variant="secondary"
          autofocus
          @click="emit('decide', false)"
          >{{
            fileBlocked
              ? c.stay
              : state.session
                ? recording
                  ? c.stayRecording
                  : c.stayTranscribing
                : c.stay
          }}</SituateButton
        >
        <SituateButton
          v-if="fileBlocked"
          variant="primary"
          @click="emit('reviewFile')"
          >{{ c.reviewFile }}</SituateButton
        >
        <SituateButton v-else variant="primary" @click="emit('decide', true)">{{
          state.session ? c.discard : c.continue
        }}</SituateButton>
      </div>
    </div>
  </EditorDialog>
</template>
<style scoped>
.dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>
