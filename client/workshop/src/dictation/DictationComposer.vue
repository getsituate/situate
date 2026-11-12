<script setup lang="ts">
import { computed, ref, useId } from "vue";
import ChatComposer from "../components/ChatComposer.vue";
import DictationActivity from "./DictationActivity.vue";
import { SituateIcon, SituateIconButton } from "../ui";
import { copy } from "./content";
import {
  draftFor,
  modelLabel,
  type DictationState,
  type DictationAction,
} from "./model";
const props = defineProps<{
  state: DictationState;
  owner: string;
  covered: boolean;
}>();
const emit = defineEmits<{ action: [action: DictationAction] }>();
const composer = ref<InstanceType<typeof ChatComposer>>();
const c = computed(() => copy(props.state.language));
const draft = computed(() => draftFor(props.state, props.owner));
const phase = computed(() =>
  props.state.session?.owner === props.owner ? props.state.session.phase : null,
);
const elsewhere = computed(() => !!props.state.session && !phase.value);
const offline = computed(
  () => !props.state.connected || props.state.network === "offline",
);
const statusId = useId();
const status = computed(() => {
  if (props.state.feedback?.owner === props.owner) return "";
  if (phase.value) return c.value[phase.value];
  if (draft.value.notice) return c.value[draft.value.notice];
  return offline.value ? c.value.offline : "";
});
const microphoneReason = computed(() =>
  elsewhere.value
    ? c.value.elsewhere
    : phase.value
      ? c.value[phase.value]
      : modelLabel(props.state),
);
const primaryDisabled = computed(
  () =>
    phase.value !== "recording" &&
    (!!phase.value || offline.value || !draft.value.text.trim()),
);
const primaryLabel = computed(() =>
  phase.value === "recording"
    ? c.value.stop
    : draft.value.working
      ? c.value.queue
      : c.value.send,
);
function primary() {
  if (primaryDisabled.value) return;
  emit("action", {
    type: phase.value === "recording" ? "mic" : "send",
    owner: props.owner,
  });
}
defineExpose({ focus: () => composer.value?.focus() });
</script>
<template>
  <div
    class="dictation-composer"
    :lang="state.language"
    :class="{ recording: phase === 'recording' }"
  >
    <ChatComposer
      ref="composer"
      :model-value="draft.text"
      :selection="draft.selection"
      :description="status ? statusId : undefined"
      :readonly="false"
      :enabled="!offline"
      :submit-blocked="!!phase"
      :unavailable-reason="phase ? c.busySend : c.offline"
      :label="c.message"
      :placeholder="c.message"
      :send-label="draft.working ? c.queue : c.send"
      compact
      @edit="emit('action', { type: 'edit', owner, ...$event })"
      @selection="
        emit('action', { type: 'selection', owner, selection: $event })
      "
      @send="emit('action', { type: 'send', owner })"
    >
      <template #microphone>
        <DictationActivity
          v-if="phase === 'recording' || phase === 'transcribing'"
          :key="state.session!.id"
          :phase="phase"
          :speech="state.speech"
          :paused="state.motionPaused"
          :covered="covered"
          :title="status"
        />
        <SituateIconButton
          v-else
          :icon="state.model === 'ready' ? 'mic' : 'info'"
          :label="state.model === 'ready' ? c.record : c.settings"
          :disabled="elsewhere || phase === 'permission'"
          :unavailable-reason="microphoneReason"
          :class="{
            'dictation-unavailable': elsewhere || phase === 'permission',
          }"
          @click="
            ($event.currentTarget as HTMLElement).focus();
            emit('action', { type: 'mic', owner });
          "
        />
        <SituateIconButton
          v-if="draft.working"
          :label="c.agentStop"
          @click="emit('action', { type: 'stop-agent', owner })"
          ><span class="stop-mark" aria-hidden="true"
        /></SituateIconButton>
      </template>
      <template #send>
        <SituateIconButton
          :icon="phase === 'recording' ? undefined : 'arrow'"
          :label="primaryLabel"
          variant="primary"
          :disabled="primaryDisabled"
          :unavailable-reason="
            phase ? c.busySend : offline ? c.offline : c.empty
          "
          @click="primary"
        >
          <span
            v-if="phase === 'recording'"
            class="stop-mark"
            aria-hidden="true"
          />
          <SituateIcon v-else name="arrow" />
        </SituateIconButton>
      </template>
    </ChatComposer>
    <span :id="statusId" class="sr-only" role="status" aria-atomic="true">{{
      status
    }}</span>
  </div>
</template>
<style scoped>
.dictation-composer {
  container-type: inline-size;
}
.dictation-composer :deep(.chat-composer) {
  margin-top: 0;
}
.recording :deep(.input-line) {
  border-color: var(--situate-accent-strong);
}
.dictation-unavailable {
  opacity: 0.45;
}
.stop-mark {
  width: 12px;
  height: 12px;
  background: currentColor;
  border-radius: 2px;
}
@container (max-width: 340px) {
  :deep(.input-line) {
    flex-wrap: wrap;
  }
  :deep(textarea) {
    flex-basis: 100%;
  }
  :deep(.input-line > button) {
    display: none;
  }
  :deep(.input-actions) {
    margin-inline-start: auto;
  }
}
</style>
