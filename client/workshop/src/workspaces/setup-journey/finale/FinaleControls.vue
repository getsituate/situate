<script setup lang="ts">
import { SituateInput, SituateButton } from "../../../ui";
import copy from "../../../localization/en.setup-finale.json";
import type { OnboardingAction } from "../../../onboarding/model";
import { finaleDuration, type FinaleState } from "./score";
defineProps<{ state: FinaleState }>();
const emit = defineEmits<{ action: [action: OnboardingAction] }>();
const c = copy.controls;
</script>
<template>
  <section>
    <label for="setup-finale-time">{{ c.frame }}</label>
    <SituateInput
      appearance="plain"
      id="setup-finale-time"
      type="range"
      min="0"
      :max="finaleDuration"
      step="10"
      :value="state.timeMs ?? 0"
      @input="
        emit('action', {
          type: 'finale-time',
          timeMs: Number(($event.target as HTMLInputElement).value),
        })
      "
    />
    <p>
      {{ state.timeMs === null ? c.live : `${state.timeMs} ms` }} ·
      {{ finaleDuration }} ms
    </p>
    <div class="beats">
      <SituateButton
        variant="plain"
        v-for="[label, time] in [
          [c.celebrate, 1750],
          [c.invite, 2550],
          [c.paper, 4000],
          [c.workspace, finaleDuration],
        ]"
        :key="String(label)"
        @click="emit('action', { type: 'finale-time', timeMs: Number(time) })"
      >
        {{ label }}
      </SituateButton>
    </div>
    <SituateButton
      variant="plain"
      @click="emit('action', { type: 'finale-replay' })"
    >
      {{ c.replay }}
    </SituateButton>
    <SituateButton
      variant="plain"
      @click="emit('action', { type: 'finale-finish' })"
    >
      {{ c.finish }}
    </SituateButton>
  </section>
</template>
<style scoped>
section {
  display: grid;
  gap: 12px;
}
.beats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
button {
  font: inherit;
  min-height: 40px;
}
p {
  font-size: 0.875rem;
  margin: 0;
}
</style>
