<script setup lang="ts">
import {
  SituateButton,
  SituateCheckbox,
  SituateInput,
  SituateSelect,
} from "../ui";
import c from "../localization/en.auth-callback.json";
import { handoffDuration } from "./score";
import type { CallbackAction, CallbackState, CallbackStatus } from "./model";

defineProps<{ state: CallbackState }>();
const emit = defineEmits<{ action: [action: CallbackAction] }>();
</script>

<template>
  <div class="callback-controls">
    <p>{{ c.controls.note }}</p>
    <label for="callback-status">{{ c.controls.state }}</label>
    <SituateSelect
      id="callback-status"
      :value="state.status"
      @change="
        emit('action', {
          type: 'status',
          status: ($event.target as HTMLSelectElement).value as CallbackStatus,
        })
      "
    >
      <option v-for="(label, status) in c.states" :key="status" :value="status">
        {{ label }}
      </option>
    </SituateSelect>
    <template v-if="state.status === 'received'">
      <div class="callback-playback">
        <SituateButton @click="emit('action', { type: 'replay' })">{{
          c.controls.replay
        }}</SituateButton>
        <SituateButton
          :aria-pressed="state.paused"
          @click="emit('action', { type: 'pause' })"
        >
          {{ state.paused ? c.controls.resume : c.controls.pause }}
        </SituateButton>
      </div>
      <label for="callback-frame">{{ c.controls.frame }}</label>
      <SituateInput
        appearance="plain"
        id="callback-frame"
        type="range"
        min="0"
        :max="handoffDuration"
        step="10"
        :value="state.timeMs ?? handoffDuration"
        @input="
          emit('action', {
            type: 'seek',
            timeMs: Number(($event.target as HTMLInputElement).value),
          })
        "
      />
      <p class="callback-frame-value">
        {{
          state.timeMs === null
            ? c.controls.live.replace(
                "{duration}",
                String(handoffDuration / 1000),
              )
            : c.controls.at
                .replace("{time}", String(state.timeMs))
                .replace("{duration}", String(handoffDuration))
        }}
      </p>
      <label class="callback-still">
        <SituateCheckbox
          :checked="state.still"
          @change="
            emit('action', {
              type: 'still',
              value: ($event.target as HTMLInputElement).checked,
            })
          "
        />
        {{ c.controls.still }}
      </label>
    </template>
  </div>
</template>

<style scoped>
.callback-controls {
  display: grid;
  gap: 12px;
}
.callback-controls p {
  margin: 0 0 8px;
  line-height: 1.55;
}
.callback-frame-value {
  font-size: 13px;
  color: var(--situate-muted);
}
.callback-playback {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.callback-still {
  display: flex;
  align-items: center;
  gap: 10px;
}
input[type="range"] {
  min-height: 44px;
  width: 100%;
  accent-color: var(--situate-violet-deep);
}
</style>
