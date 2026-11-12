<script setup lang="ts">
import { SituateCheckbox, SituateButton } from "../ui";
import { computed } from "vue";
import { securityCopy, inventoryCopy } from "./content";
import { visibleRestriction } from "./security";
import { currentWorkspace } from "./model";
import {
  aiScreenLabel,
  applyOutcome,
  availableOutcomes,
  type AiState,
} from "./model";
import { useAiState } from "./use-ai-state";
const props = defineProps<{ state: AiState; connectionWorkspace?: string }>();
const emit = defineEmits<{ "update:state": [state: AiState] }>();
const { state, update } = useAiState(props, emit);
const outcomes = computed(() => availableOutcomes(state.value));
function outcome(id: string) {
  update((next) => applyOutcome(next, id));
}
</script>
<template>
  <section class="ai-controls" aria-label="AI controls">
    <p>
      {{ connectionWorkspace ?? state.workspace }} · {{ aiScreenLabel(state) }}
    </p>
    <p>
      Use example values only. Provider sign-in, clipboard actions, credential
      commands, storage and chat handoffs do not contact services or change your
      device.
    </p>
    <label v-if="['providers', 'methods'].includes(state.screen)">
      <SituateCheckbox
        type="checkbox"
        :checked="state.explorationMode"
        @change="
          update((next) => {
            next.explorationMode = ($event.target as HTMLInputElement).checked;
          })
        "
      />
      {{ inventoryCopy.exploration }}
    </label>
    <p v-if="state.screen === 'restriction'">
      {{ securityCopy.version }}: {{ visibleRestriction(state)?.version }}.
      Source links report their requested destination here without opening a
      website.
    </p>
    <SituateButton
      variant="secondary"
      size="small"
      v-if="
        currentWorkspace(state).connection?.provider === 'example-orbit' &&
        state.restrictionVersion === 1 &&
        ['settings', 'chat', 'success', 'restored'].includes(state.screen)
      "
      type="button"
      @click="outcome('restriction-changed')"
    >
      {{ securityCopy.warningControl }}
    </SituateButton>
    <SituateButton
      variant="secondary"
      size="small"
      v-if="state.screen === 'chat'"
      type="button"
      @click="outcome('conversation-synced')"
    >
      Receive a reply from another device
    </SituateButton>
    <p v-if="state.screen === 'session-unavailable'">
      Orbit Example is fictional. This example blocks a method known to end
      another device’s session; it does not describe a verified restriction of a
      supported provider.
    </p>
    <div v-if="outcomes.length" class="outcomes" aria-label="Pending outcome">
      <SituateButton
        variant="secondary"
        size="small"
        v-for="item in outcomes"
        :key="item.id"
        type="button"
        :data-outcome="item.id"
        @click="outcome(item.id)"
      >
        {{ item.label }}
      </SituateButton>
    </div>
    <SituateButton
      variant="secondary"
      size="small"
      v-if="state.abandonedAttempt !== null || state.screen === 'cancelled'"
      type="button"
      @click="outcome('late')"
    >
      Late return after cancellation
    </SituateButton>
    <SituateButton
      variant="secondary"
      size="small"
      v-if="!connectionWorkspace"
      type="button"
      @click="outcome('reopen')"
    >
      Reopen current workspace
    </SituateButton>
    <p v-if="state.handoff" role="status">{{ state.handoff }}</p>
  </section>
</template>
<style scoped>
.ai-controls,
.outcomes {
  display: grid;
  gap: 12px;
}
p {
  margin: 0;
  color: var(--situate-muted);
  font: 14px/1.5 var(--situate-font-body);
}
button {
  text-align: left;
}
</style>
