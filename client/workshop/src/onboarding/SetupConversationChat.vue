<script setup lang="ts">
import { computed, ref } from "vue";
import ChatView from "../chat/ChatView.vue";
import { createChatState } from "../chat/model";
import { activeQuestion } from "../chat/question";
import copy from "../localization/en.setup-conversation.json";
import type {
  SetupConversationState,
  SetupConversationAction,
} from "./conversation-setup";
const props = defineProps<{
  state: SetupConversationState;
  hideHeader?: boolean;
  showNavigation?: boolean;
  navigationId?: string;
  navigationOpen?: boolean;
}>();
const emit = defineEmits<{
  action: [action: SetupConversationAction];
  "open-navigation": [event: MouseEvent];
  read: [path: string];
}>();
const view = ref<InstanceType<typeof ChatView>>();
const base = createChatState("chat-existing");
const chat = computed(() => ({
  ...base,
  phase: props.state.pending
    ? ("working" as const)
    : props.state.stopped
      ? ("cancelled" as const)
      : props.state.error === "method"
        ? ("error" as const)
        : ("complete" as const),
  draft: props.state.draft,
}));
const phaseLabel = computed(() =>
  props.state.phase === "import"
    ? copy.importStatus
    : props.state.phase === "support"
      ? copy.supportStatus
      : props.state.phase === "done"
        ? copy.doneStatus
        : copy.methodStatus,
);
defineExpose({ focusTitle: () => view.value?.focusTitle() });
</script>
<template>
  <div class="setup-conversation" :data-setup-phase="state.phase">
    <ChatView
      ref="view"
      :state="chat"
      :conversation="{
        title: copy.title,
        events: state.transcript,
        working:
          state.pending?.kind === 'import'
            ? copy.workingImport
            : copy.workingMethod,
        stopped: copy.cancelled,
        error: copy.preparationFailed,
      }"
      hide-model-choice
      start-at-latest
      :hide-header="hideHeader"
      :retry-enabled="!activeQuestion(state.transcript)"
      :send-enabled="true"
      :show-navigation="showNavigation"
      :navigation-id="navigationId"
      :navigation-open="navigationOpen"
      @open-navigation="emit('open-navigation', $event)"
      @update:state="emit('action', { type: 'draft', value: $event.draft })"
      @send="emit('action', { type: 'send' })"
      @stop="emit('action', { type: 'stop' })"
      @retry="emit('action', { type: 'retry' })"
      @answer="emit('action', { type: 'answer', response: $event })"
      @file="emit('read', $event)"
      ><template #actions
        ><span class="phase-label">{{ phaseLabel }}</span></template
      ></ChatView
    >
  </div>
</template>
<style scoped>
.setup-conversation {
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}
.phase-label {
  color: var(--situate-muted);
  font-size: 12px;
  max-width: 150px;
  text-align: right;
}
:deep(.chat-thread) {
  padding-top: 20px;
}
:deep(.chat-footer) {
  background: var(--situate-surface);
}
</style>
