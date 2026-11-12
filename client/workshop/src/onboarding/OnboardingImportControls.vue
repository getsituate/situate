<script setup lang="ts">
import { SituateButton } from "../ui";
import {
  importWorking,
  type OnboardingState,
  type OnboardingAction,
} from "./model";
defineProps<{ state: OnboardingState }>();
defineEmits<{ action: [action: OnboardingAction] }>();
</script>
<template>
  <section>
    <p>
      Import outcomes use a three-file synthetic source. Completion is manual;
      elapsed time does not finish work.
    </p>
    <template v-if="importWorking(state)"
      ><SituateButton
        variant="plain"
        @click="$emit('action', { type: 'progress-import' })"
      >
        Make the first file available</SituateButton
      ><SituateButton
        variant="plain"
        @click="$emit('action', { type: 'complete-import' })"
      >
        Complete import</SituateButton
      ><SituateButton
        variant="plain"
        @click="$emit('action', { type: 'fail-import' })"
      >
        Interrupt import
      </SituateButton></template
    ><SituateButton
      variant="plain"
      v-if="state.connected"
      @click="$emit('action', { type: 'interrupt' })"
    >
      Block shared provider</SituateButton
    ><SituateButton
      variant="plain"
      v-else
      @click="
        $emit('action', {
          type: 'patch',
          patch: { connectionOutcome: 'success' },
        })
      "
    >
      Allow connection recovery
    </SituateButton>
  </section>
</template>
<style scoped>
section {
  display: grid;
  gap: 8px;
}
p {
  font-size: 0.875rem;
  line-height: 1.5;
}
button {
  font: inherit;
  min-height: 40px;
}
</style>
