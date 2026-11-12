<script setup lang="ts">
import { SituateInput, SituateButton } from "../ui";
import { useId } from "vue";
import copy from "../localization/en.form-working.json";
import { progressInspectionLimit } from "./estimated-progress";
defineProps<{ timeMs: number | null }>();
const emit = defineEmits<{ time: [timeMs: number | null] }>();
const id = useId();
</script>
<template>
  <div class="working-controls">
    <label :for="id">{{ copy.controls.title }}</label>
    <SituateInput
      appearance="plain"
      :id="id"
      type="range"
      min="0"
      :max="progressInspectionLimit"
      step="100"
      :value="timeMs ?? 0"
      @input="emit('time', Number(($event.target as HTMLInputElement).value))"
    />
    <output>{{
      timeMs === null
        ? copy.controls.playing
        : `${(timeMs / 1000).toFixed(1)} s`
    }}</output>
    <SituateButton variant="plain" @click="emit('time', null)">{{
      copy.controls.live
    }}</SituateButton>
    <p>{{ copy.controls.detail }}</p>
  </div>
</template>
<style scoped>
.working-controls {
  display: grid;
  gap: 8px;
}
button {
  min-height: 44px;
  font: inherit;
}
p {
  font-size: 13px;
  line-height: 1.5;
}
</style>
