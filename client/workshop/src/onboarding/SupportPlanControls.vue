<script setup lang="ts">
import { useId } from "vue";
import { SituateButton, SituateSelect } from "../ui";
import copy from "../localization/en.support-plan.json";
import type { OnboardingAction, OnboardingState } from "./model";
const fieldId = useId();
defineProps<{ state: OnboardingState }>();
const emit = defineEmits<{ action: [action: OnboardingAction] }>();
</script>
<template>
  <section class="support-controls">
    <p>{{ copy.controls.detail }}</p>
    <label :for="`${fieldId}-outcome`">
      {{ copy.controls.outcome }}
      <SituateSelect
        :id="`${fieldId}-outcome`"
        :aria-label="copy.controls.outcome"
        :value="state.support.outcome"
        @change="
          emit('action', {
            type: 'support-settings',
            outcome: ($event.target as HTMLSelectElement)
              .value as OnboardingState['support']['outcome'],
          })
        "
      >
        <option value="success">{{ copy.controls.success }}</option>
        <option value="wait">{{ copy.controls.wait }}</option>
        <option value="failure">{{ copy.controls.failure }}</option>
      </SituateSelect>
    </label>
    <label :for="`${fieldId}-example`">
      {{ copy.controls.example }}
      <SituateSelect
        :id="`${fieldId}-example`"
        :aria-label="copy.controls.example"
        :value="state.support.example"
        @change="
          emit('action', {
            type: 'support-settings',
            example: ($event.target as HTMLSelectElement)
              .value as OnboardingState['support']['example'],
          })
        "
      >
        <option value="standard">{{ copy.controls.standard }}</option>
        <option value="fewer">{{ copy.controls.fewer }}</option>
        <option value="none">{{ copy.controls.none }}</option>
      </SituateSelect>
    </label>
    <label
      v-if="state.support.phase === 'ready' && state.support.proposals.length"
      :for="`${fieldId}-save-outcome`"
    >
      {{ copy.controls.saveOutcome }}
      <SituateSelect
        :id="`${fieldId}-save-outcome`"
        :aria-label="copy.controls.saveOutcome"
        :value="state.support.saveOutcome"
        @change="
          emit('action', {
            type: 'support-settings',
            saveOutcome: ($event.target as HTMLSelectElement)
              .value as OnboardingState['support']['saveOutcome'],
          })
        "
      >
        <option value="success">{{ copy.controls.saveSuccess }}</option>
        <option value="failure">{{ copy.controls.saveFailure }}</option>
      </SituateSelect>
    </label>
    <template v-if="state.support.phase === 'working'">
      <SituateButton
        variant="plain"
        @click="
          emit('action', {
            type: 'support-complete',
            attempt: state.support.attempt,
          })
        "
      >
        {{ copy.controls.complete }}
      </SituateButton>
      <SituateButton
        variant="plain"
        @click="
          emit('action', {
            type: 'support-fail',
            attempt: state.support.attempt,
          })
        "
      >
        {{ copy.controls.fail }}
      </SituateButton>
    </template>
    <SituateButton
      variant="plain"
      @click="emit('action', { type: 'support-reload' })"
      >{{ copy.controls.refresh }}</SituateButton
    >
    <p>{{ copy.controls.refreshHelp }}</p>
  </section>
</template>
<style scoped>
.support-controls,
label {
  display: grid;
  gap: 12px;
}
p {
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
}
button {
  min-height: 44px;
}
</style>
