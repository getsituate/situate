<script setup lang="ts">
import { computed } from "vue";
import {
  SituateButton,
  SituateSelect,
  SituateInput,
  SituateTextarea,
  SituateSwitch,
} from "../ui";
import { c } from "./content";
import type { DictationState, DictationAction, Network } from "./model";
const props = defineProps<{
  state: DictationState;
  surface: "chat" | "download" | "session" | "notice";
  owner: string;
  fileError: boolean;
}>();
const emit = defineEmits<{
  action: [action: DictationAction];
  quit: [];
  fileError: [value: boolean];
}>();
const session = computed(() => props.state.session);
function value(event: Event) {
  return (event.target as HTMLInputElement).value;
}
</script>
<template>
  <section class="dictation-controls">
    <h2>{{ c.controls.title }}</h2>
    <p>{{ c.controls.note }}</p>
    <label
      >{{ c.controls.language }}
      <SituateSelect
        :value="state.language"
        @change="
          emit('action', {
            type: 'language',
            value: value($event) as 'en' | 'de',
          })
        "
        ><option value="en">English</option>
        <option value="de">Deutsch</option></SituateSelect
      >
    </label>
    <template v-if="surface === 'download'">
      <label
        >{{ c.controls.network }}
        <SituateSelect
          :value="state.network"
          @change="
            emit('action', { type: 'network', value: value($event) as Network })
          "
        >
          <option
            v-for="network in [
              'wifi',
              'metered',
              'ethernet',
              'cellular',
              'offline',
            ] as const"
            :key="network"
            :value="network"
          >
            {{ c.controls[network] }}
          </option>
        </SituateSelect>
      </label>
      <template v-if="state.model === 'downloading'">
        <label
          >{{ c.controls.progress
          }}<SituateInput
            type="number"
            min="0"
            max="100"
            :value="state.progress"
            @input="
              emit('action', { type: 'progress', value: Number(value($event)) })
            "
        /></label>
        <SituateButton
          @click="emit('action', { type: 'model', value: 'preparing' })"
          >{{ c.controls.downloadFinish }}</SituateButton
        >
        <SituateButton
          @click="emit('action', { type: 'model', value: 'failed' })"
          >{{ c.controls.downloadFail }}</SituateButton
        >
        <SituateButton
          @click="emit('action', { type: 'model', value: 'storage' })"
          >{{ c.controls.storageFail }}</SituateButton
        >
      </template>
      <SituateButton
        v-if="state.model === 'preparing'"
        @click="emit('action', { type: 'model', value: 'ready' })"
        >{{ c.controls.ready }}</SituateButton
      >
    </template>
    <template v-if="surface === 'chat' || surface === 'session'">
      <label>
        <SituateSwitch
          :model-value="!state.motionPaused"
          @update:model-value="
            emit('action', { type: 'motion-paused', value: !$event })
          "
        />{{ c.controls.animate }}
      </label>
    </template>
    <template v-if="surface === 'chat'">
      <label
        >{{ c.controls.permission }}
        <SituateSelect
          :value="state.permission"
          :disabled="!!session"
          @change="
            emit('action', {
              type: 'permission',
              value: value($event) as DictationState['permission'],
            })
          "
        >
          <option value="allowed">{{ c.controls.allowed }}</option>
          <option value="ask">{{ c.controls.ask }}</option>
          <option value="denied">{{ c.controls.denied }}</option>
        </SituateSelect>
      </label>
      <label
        ><SituateSwitch
          :model-value="state.connected"
          @update:model-value="
            emit('action', { type: 'connected', value: $event })
          "
        />{{ c.controls.connected }}</label
      >
      <label
        ><SituateSwitch
          :model-value="state.drafts[owner]?.working"
          @update:model-value="
            emit('action', { type: 'working', owner, value: $event })
          "
        />{{ c.controls.agent }}</label
      >
    </template>
    <template v-if="session?.phase === 'permission'">
      <SituateButton
        @click="emit('action', { type: 'permission', value: 'allowed' })"
        >{{ c.controls.grant }}</SituateButton
      >
      <SituateButton
        @click="emit('action', { type: 'permission', value: 'denied' })"
        >{{ c.controls.deny }}</SituateButton
      >
    </template>
    <label v-if="session?.phase === 'recording'">
      {{ c.controls.speech }}
      <SituateSelect
        :value="state.speech"
        @change="
          emit('action', {
            type: 'speech',
            value: value($event) as DictationState['speech'],
          })
        "
      >
        <option value="speaking">{{ c.controls.speaking }}</option>
        <option value="quiet">{{ c.controls.quiet }}</option>
        <option value="silence">{{ c.controls.silence }}</option>
      </SituateSelect>
    </label>
    <template v-if="session?.phase === 'transcribing'">
      <label
        >{{ c.controls.result
        }}<SituateTextarea
          :value="state.result"
          rows="3"
          @input="emit('action', { type: 'result', value: value($event) })"
      /></label>
      <SituateButton
        @click="
          emit('action', {
            type: 'complete',
            id: session.id,
            outcome: 'success',
          })
        "
        >{{ c.controls.finish }}</SituateButton
      >
      <SituateButton
        @click="
          emit('action', {
            type: 'complete',
            id: session.id,
            outcome: 'noSpeech',
          })
        "
        >{{ c.controls.noSpeech }}</SituateButton
      >
      <SituateButton
        @click="
          emit('action', {
            type: 'complete',
            id: session.id,
            outcome: 'failed',
          })
        "
        >{{ c.controls.fail }}</SituateButton
      >
      <SituateButton @click="emit('action', { type: 'interrupt' })">{{
        c.controls.lost
      }}</SituateButton>
    </template>
    <template v-if="session && surface !== 'notice'">
      <label
        ><SituateSwitch
          :model-value="fileError"
          @update:model-value="emit('fileError', $event)"
        />{{ c.controls.fileError }}</label
      >
      <SituateButton @click="emit('action', { type: 'background' })">{{
        c.controls.background
      }}</SituateButton>
      <SituateButton @click="emit('quit')">{{ c.controls.quit }}</SituateButton>
    </template>
  </section>
</template>
<style scoped>
.dictation-controls {
  display: grid;
  gap: 12px;
}
.dictation-controls h2,
.dictation-controls p {
  margin: 0;
}
.dictation-controls p {
  font-size: 13px;
  color: var(--situate-muted);
}
label {
  display: grid;
  gap: 6px;
}
label:has(input[type="checkbox"]) {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 44px;
}
</style>
