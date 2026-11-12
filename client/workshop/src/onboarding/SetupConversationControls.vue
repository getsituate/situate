<script setup lang="ts">
import { SituateButton, SituateCheckbox, SituateSelect } from "../ui";
import FinaleControls from "../workspaces/setup-journey/finale/FinaleControls.vue";
import type { OnboardingAction } from "./model";
import copy from "../localization/en.setup-conversation.json";
import type {
  SetupConversationState,
  SetupConversationAction,
  ResponseOutcome,
} from "./conversation-setup";
defineProps<{ state: SetupConversationState }>();
const emit = defineEmits<{ action: [action: SetupConversationAction] }>();
function finale(action: OnboardingAction) {
  if (action.type === "finale-time")
    emit("action", { type: "finale-time", timeMs: action.timeMs });
  else if (
    action.type === "finale-replay" ||
    action.type === "finale-finish" ||
    action.type === "finale-pause"
  )
    emit("action", { type: action.type });
}
</script>
<template>
  <section class="conversation-controls">
    <p>{{ copy.controls.note }}</p>
    <FinaleControls
      v-if="state.finale.status === 'playing'"
      :state="state.finale"
      @action="finale"
    />
    <template v-else>
      <label
        ><SituateCheckbox
          :checked="state.manual"
          @change="
            emit('action', {
              type: 'manual',
              value: ($event.target as HTMLInputElement).checked,
            })
          "
        />{{ copy.controls.manual }}</label
      >
      <template v-if="state.pending">
        <label for="conversation-response">{{ copy.controls.outcome }}</label>
        <SituateSelect
          id="conversation-response"
          :value="state.outcome"
          @change="
            emit('action', {
              type: 'outcome',
              value: ($event.target as HTMLSelectElement)
                .value as ResponseOutcome,
            })
          "
        >
          <option value="success">{{ copy.controls.success }}</option>
          <option v-if="state.pending.kind === 'method'" value="question">
            {{ copy.controls.question }}
          </option>
          <option v-if="state.pending.kind === 'import'" value="blocked">
            {{ copy.controls.blocked }}
          </option>
          <option v-if="state.pending.kind === 'import'" value="partial">
            {{ copy.controls.partial }}
          </option>
          <option value="failure">{{ copy.controls.failure }}</option>
        </SituateSelect>
        <SituateButton
          variant="secondary"
          @click="emit('action', { type: 'complete', run: state.pending!.run })"
          >{{ copy.controls.complete }}</SituateButton
        >
      </template>
      <label
        ><SituateCheckbox
          :checked="state.motionPaused"
          @change="
            emit('action', {
              type: 'motion',
              value: ($event.target as HTMLInputElement).checked,
            })
          "
        />{{ copy.controls.pauseMotion }}</label
      >
    </template>
  </section>
</template>
<style scoped>
.conversation-controls {
  display: grid;
  gap: 12px;
}
p {
  font-size: 12px;
  line-height: 1.6;
  color: var(--situate-muted);
  margin: 0;
}
label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
</style>
