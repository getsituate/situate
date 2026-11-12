<script setup lang="ts">
import { SituateInput, SituateButton } from "../ui";
import { computed } from "vue";
import { welcomeStudy } from "../onboarding/welcome-studies";
import { transitionDuration } from "./setup-transition";
import { openingDuration } from "./setup-journey/opening";
import { setupCopy as c } from "./setup-content";
import type { FirstEntryState, FirstEntryAction } from "./first-entry";
const props = defineProps<{ state: FirstEntryState }>();
const study = computed(() => welcomeStudy(props.state.welcomeStudy));
const emit = defineEmits<{ action: [action: FirstEntryAction] }>();
</script>
<template>
  <section class="first-entry-controls">
    <h2>First visit · {{ state.step }}</h2>
    <p>
      Folders, creation and sign-in are simulated. No account or filesystem is
      accessed. The accent belongs to this workspace and can also be changed in
      its appearance settings.
    </p>
    <div v-if="state.step === 'intro' && study">
      <label for="welcome-time">Animation frame</label>
      <SituateInput
        appearance="plain"
        id="welcome-time"
        type="range"
        min="0"
        :max="study.durationMs"
        step="50"
        :value="state.welcomeTime ?? 0"
        @input="
          emit('action', {
            type: 'welcome-time',
            timeMs: Number(($event.target as HTMLInputElement).value),
          })
        "
      />
      <p>
        {{
          state.welcomeTime === null
            ? state.paused
              ? "Paused"
              : "Playing"
            : `${(state.welcomeTime / 1000).toFixed(2)} s`
        }}
        · {{ (study.durationMs / 1000).toFixed(1) }} s total
      </p>
      <SituateButton
        variant="plain"
        @click="emit('action', { type: 'welcome-replay' })"
      >
        Replay animation
      </SituateButton>
    </div>
    <SituateButton
      variant="plain"
      v-if="state.step === 'intro'"
      @click="emit('action', { type: 'step', step: 'create' })"
    >
      Finish welcome
    </SituateButton>
    <div v-if="state.openingAvailable && state.step === 'create'">
      <label for="setup-opening-time">{{ c.openingFrame }}</label>
      <SituateInput
        appearance="plain"
        id="setup-opening-time"
        type="range"
        min="0"
        :max="openingDuration"
        step="10"
        :value="state.openingTime ?? openingDuration"
        @input="
          emit('action', {
            type: 'opening-time',
            timeMs: Number(($event.target as HTMLInputElement).value),
          })
        "
      />
      <p>
        {{
          state.openingTime === null
            ? c.livePlayback
            : `${state.openingTime} ms`
        }}
        · {{ c.transitionDuration(openingDuration) }}
      </p>
      <SituateButton
        variant="plain"
        @click="emit('action', { type: 'opening-replay' })"
      >
        {{ c.replayOpening }}
      </SituateButton>
    </div>
    <div v-if="state.transitionAvailable && state.step === 'ai'">
      <label for="setup-transition-time">{{ c.transitionFrame }}</label>
      <SituateInput
        appearance="plain"
        id="setup-transition-time"
        type="range"
        min="0"
        :max="transitionDuration"
        step="10"
        :value="state.transitionTime ?? transitionDuration"
        @input="
          emit('action', {
            type: 'transition-time',
            timeMs: Number(($event.target as HTMLInputElement).value),
          })
        "
      />
      <p>
        {{
          state.transitionTime === null
            ? c.livePlayback
            : `${state.transitionTime} ms`
        }}
        · {{ c.transitionDuration(transitionDuration) }}
      </p>
      <SituateButton
        variant="plain"
        @click="emit('action', { type: 'transition-replay' })"
      >
        {{ c.replayTransition }}
      </SituateButton>
    </div>
    <template v-if="state.step === 'ai'">
      <p>
        Provider authentication and model verification are separate simulated
        outcomes. No test request is sent. Preview reloads retain this session;
        reloading the controls does not persist a real workspace.
      </p>
      <template v-if="state.check === 'pending'">
        <SituateButton
          variant="plain"
          @click="
            emit('action', {
              type: 'model-result',
              ok: true,
              attempt: state.attempt,
            })
          "
        >
          Model check succeeded
        </SituateButton>
        <SituateButton
          variant="plain"
          @click="
            emit('action', {
              type: 'model-result',
              ok: false,
              attempt: state.attempt,
            })
          "
        >
          Model check failed
        </SituateButton>
      </template>
    </template>
  </section>
</template>
<style scoped>
p {
  line-height: 1.5;
  font-size: 13px;
}
button {
  min-height: 44px;
  margin: 4px;
}
</style>
