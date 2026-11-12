<script setup lang="ts">
import { SituateButton, SituateCheckbox, SituateSelect } from "../ui";
import c from "../localization/en.error-recovery.json";
import type { RecoveryAction, RecoveryState } from "./model";
defineProps<{ state: RecoveryState }>();
const emit = defineEmits<{ action: [action: RecoveryAction] }>();
</script>
<template>
  <div class="recovery-controls">
    <p>{{ c.controls.note }}</p>
    <label for="recovery-reload-result">{{ c.controls.retry }}</label>
    <SituateSelect
      id="recovery-reload-result"
      :value="String(state.reloadSucceeds)"
      @change="
        emit('action', {
          type: 'reloadSucceeds',
          value: ($event.target as HTMLSelectElement).value === 'true',
        })
      "
      ><option value="true">{{ c.controls.success }}</option>
      <option value="false">{{ c.controls.failure }}</option></SituateSelect
    >
    <label for="recovery-mail-result">{{ c.controls.mail }}</label>
    <SituateSelect
      id="recovery-mail-result"
      :value="state.mail"
      @change="
        emit('action', {
          type: 'mail',
          value: ($event.target as HTMLSelectElement)
            .value as RecoveryState['mail'],
        })
      "
      ><option value="available">{{ c.controls.available }}</option>
      <option value="missing">{{ c.controls.missing }}</option>
      <option value="offline">{{ c.controls.offline }}</option></SituateSelect
    >
    <label for="recovery-save-result">{{ c.controls.save }}</label>
    <SituateSelect
      id="recovery-save-result"
      :value="String(state.saveSucceeds)"
      @change="
        emit('action', {
          type: 'saveSucceeds',
          value: ($event.target as HTMLSelectElement).value === 'true',
        })
      "
      ><option value="true">{{ c.controls.success }}</option>
      <option value="false">{{ c.controls.failure }}</option></SituateSelect
    >
    <label class="still"
      ><SituateCheckbox
        :checked="state.still"
        @change="
          emit('action', {
            type: 'still',
            value: ($event.target as HTMLInputElement).checked,
          })
        "
      />{{ c.controls.still }}</label
    >
    <SituateButton
      variant="secondary"
      @click="emit('action', { type: 'repeat' })"
      >{{ c.controls.repeat }}</SituateButton
    >
    <p>{{ c.controls.seen }}</p>
  </div>
</template>
<style scoped>
.recovery-controls {
  display: grid;
  gap: 12px;
}
p {
  margin: 0;
  line-height: 1.55;
}
.still {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 44px;
}
</style>
