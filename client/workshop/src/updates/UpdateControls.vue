<script setup lang="ts">
import {
  SituateButton,
  SituateCheckbox,
  SituateSelect,
  SituateInput,
} from "../ui";
import copy from "../localization/en.updates.json" with { type: "json" };
import type { UpdateAction, UpdateChannel, UpdateState } from "./model";
defineProps<{ state: UpdateState }>();
const emit = defineEmits<{ action: [action: UpdateAction] }>();
</script>
<template>
  <div class="update-controls">
    <p class="design-note">{{ copy.controls.description }}</p>
    <label
      >{{ copy.controls.channel }}
      <SituateSelect
        :value="state.channel"
        @change="
          emit('action', {
            type: 'channel',
            channel: ($event.target as HTMLSelectElement)
              .value as UpdateChannel,
          })
        "
      >
        <option value="direct">{{ copy.controls.direct }}</option>
        <option value="homebrew">{{ copy.controls.homebrew }}</option>
        <option value="store">{{ copy.controls.store }}</option>
      </SituateSelect>
    </label>
    <template v-if="state.channel === 'direct'">
      <label v-if="state.phase === 'checking'"
        >{{ copy.controls.state }}
        <SituateSelect
          :value="state.result"
          @change="
            emit('action', {
              type: 'result',
              value: ($event.target as HTMLSelectElement)
                .value as UpdateState['result'],
            })
          "
        >
          <option value="available">{{ copy.controls.available }}</option>
          <option value="current">{{ copy.controls.current }}</option>
          <option value="offline">{{ copy.controls.offline }}</option>
        </SituateSelect>
      </label>
      <SituateButton
        v-if="state.phase === 'checking'"
        size="small"
        @click="emit('action', { type: 'finish-check' })"
        >{{ copy.controls.completeCheck }}</SituateButton
      >
      <template v-if="state.phase === 'downloading'">
        <label
          >{{ copy.controls.progress }} · {{ state.progress }}%<SituateInput
            appearance="plain"
            type="range"
            min="0"
            max="100"
            :value="state.progress"
            @input="
              emit('action', {
                type: 'progress',
                value: Number(($event.target as HTMLInputElement).value),
              })
            "
        /></label>
        <SituateButton
          size="small"
          @click="emit('action', { type: 'finish-download' })"
          >{{ copy.controls.completeDownload }}</SituateButton
        >
      </template>
      <template
        v-if="
          state.phase === 'ready' &&
          state.preparation !== 'pending' &&
          state.preparation !== 'blocked'
        "
      >
        <label class="check"
          ><SituateCheckbox
            :model-value="state.running"
            @update:model-value="
              emit('action', { type: 'running', value: $event })
            "
          />{{ copy.controls.running }}</label
        >
        <label class="check"
          ><SituateCheckbox
            :model-value="state.unsynced"
            @update:model-value="
              emit('action', { type: 'unsynced', value: $event })
            "
          />{{ copy.controls.unsynced }}</label
        >
      </template>
      <template v-if="state.preparation === 'pending'">
        <label
          >{{ copy.controls.preparationReason }}
          <SituateSelect
            :value="state.preparationReason"
            @change="
              emit('action', {
                type: 'preparation-reason',
                value: ($event.target as HTMLSelectElement)
                  .value as UpdateState['preparationReason'],
              })
            "
          >
            <option
              v-for="(label, reason) in copy.controls.preparationReasons"
              :key="reason"
              :value="reason"
            >
              {{ label }}
            </option>
          </SituateSelect>
        </label>
        <SituateButton
          size="small"
          @click="emit('action', { type: 'finish-preparation' })"
          >{{ copy.controls.finishPreparation }}</SituateButton
        >
        <SituateButton
          size="small"
          variant="secondary"
          @click="emit('action', { type: 'fail-preparation' })"
          >{{ copy.controls.failPreparation }}</SituateButton
        >
      </template>
      <SituateButton
        v-if="state.preparation === 'blocked'"
        size="small"
        @click="emit('action', { type: 'settle-writes' })"
        >{{ copy.controls.settleWrites }}</SituateButton
      >
      <SituateButton
        v-if="state.dialog === 'sync'"
        size="small"
        @click="emit('action', { type: 'finish-sync' })"
        >{{ copy.controls.completeSync }}</SituateButton
      >
      <SituateButton
        v-if="state.phase === 'installing'"
        size="small"
        @click="emit('action', { type: 'finish-install' })"
        >{{ copy.controls.completeInstall }}</SituateButton
      >
    </template>
    <SituateButton
      v-else
      size="small"
      @click="emit('action', { type: 'external-update' })"
      >{{ copy.controls.externalUpdate }}</SituateButton
    >
    <SituateButton
      v-if="!state.dialog"
      variant="secondary"
      size="small"
      @click="emit('action', { type: 'show-notes' })"
      >{{ copy.controls.notes }}</SituateButton
    >
  </div>
</template>
<style scoped>
.update-controls {
  display: grid;
  gap: 16px;
}
label {
  display: grid;
  gap: 8px;
  font-size: 13px;
}
.check {
  display: flex;
  align-items: center;
  gap: 10px;
}
.design-note {
  margin: 0;
  color: var(--situate-muted);
  font-size: 13px;
  line-height: 1.6;
}
input[type="range"] {
  width: 100%;
  accent-color: var(--situate-accent-strong);
}
</style>
