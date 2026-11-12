<script setup lang="ts">
import { SituateButton } from "../ui";
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import finaleCopy from "../localization/en.setup-finale.json";
import { useFinalePlayback } from "./setup-journey/finale/use-finale-playback";
import SetupFrame from "./SetupFrame.vue";
import FirstEntry from "./FirstEntry.vue";
import FirstSetup from "./FirstSetup.vue";
import {
  accentStyle,
  type FirstEntryState,
  type FirstEntryAction,
} from "./first-entry";
import type { AiState } from "../ai/model";
import type { OnboardingState, OnboardingAction } from "../onboarding/model";
import type { RunAction, Workspace } from "./api";
import { setupStep } from "./setup-transition";
import { useSetupTransition } from "./use-setup-transition";
import { setupCopy as c } from "./setup-content";
import { c as onboardingCopy } from "../onboarding/content";
const props = defineProps<{
  state: FirstEntryState;
  ai: AiState;
  onboarding: OnboardingState;
  workspace: Workspace | null;
  name: string;
  run: RunAction;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{
  action: [action: FirstEntryAction];
  ai: [state: AiState];
  "update:name": [name: string];
  onboarding: [action: OnboardingAction];
  "finale-progress": [time: number];
  "finale-finished": [];
  cancel: [];
}>();
const root = ref<HTMLElement>();
const snapshot = computed(() => ({
  state: props.state,
  ai: props.ai,
  onboarding: props.onboarding,
  workspace: props.workspace,
  name: props.name,
  busy: props.busy,
  error: props.error,
}));
const source = shallowRef({
  ...snapshot.value,
  state: {
    ...props.state,
    step: "create" as const,
    created: false,
  } as FirstEntryState,
});
const clock = useSetupTransition(
  root,
  () => props.state.paused || props.state.step === "paused",
  () => props.state.transitionTime ?? null,
  () => props.state.openingTime ?? null,
);
const celebrating = computed(
  () => props.onboarding.finale.status === "playing",
);
const finaleSource = shallowRef<typeof snapshot.value>({
  ...snapshot.value,
  state: { ...props.state, step: "working" as const, created: true },
  onboarding: { ...props.onboarding, step: "plan" as const, confirmed: false },
});
const finaleClock = useFinalePlayback(
  root,
  () => props.onboarding.finale,
  () => props.state.paused || props.onboarding.motionPaused,
  () => emit("finale-finished"),
);
watch(finaleClock.time, (time) => {
  if (celebrating.value) emit("finale-progress", time);
});
watch(
  celebrating,
  (active) => {
    if (active) {
      emit("finale-progress", finaleClock.time.value);
      void nextTick(() =>
        root.value
          ?.querySelector<HTMLButtonElement>(".finale-skip")
          ?.focus({ preventScroll: true }),
      );
    }
  },
  { immediate: true },
);
const frame = computed(() =>
  !celebrating.value && clock.mode.value === "step" && clock.active.value
    ? clock.frame.value
    : undefined,
);
const opening = computed(() =>
  props.state.step === "create" ? clock.opening.value : undefined,
);
const shown = computed(() =>
  celebrating.value
    ? finaleSource.value
    : frame.value && !frame.value.incoming
      ? source.value
      : snapshot.value,
);
const step = computed(() =>
  celebrating.value ? 4 : setupStep(props.state, props.onboarding),
);
watch(
  () => props.state.openingTime,
  (time) => {
    if (
      props.state.step === "create" &&
      (props.state.openingAvailable || time != null) &&
      clock.mode.value !== "opening"
    )
      clock.startOpening();
  },
  { immediate: true },
);
watch(
  () => shown.value.state.step + shown.value.onboarding.step,
  () => {
    void nextTick(() => {
      const panel = root.value?.querySelector<HTMLElement>(".setup-panel");
      if (panel) panel.scrollTop = 0;
      if (window.innerWidth <= 700) {
        const surface = root.value?.querySelector<HTMLElement>(".setup-frame");
        if (surface) surface.scrollTop = 0;
      }
    });
  },
);
watch(snapshot, (next, previous) => {
  const before = setupStep(previous.state, previous.onboarding),
    after = setupStep(next.state, next.onboarding);
  if (celebrating.value) {
    if (previous.onboarding.finale.status !== "playing")
      finaleSource.value = previous;
    clock.finish();
    return;
  }
  if (
    next.state.openingRun !== previous.state.openingRun &&
    next.state.step === "create"
  ) {
    clock.startOpening();
  } else if (before !== after) {
    source.value = previous;
    clock.start(before, after);
  } else if (next.state.transitionRun !== previous.state.transitionRun) {
    source.value = {
      ...next,
      state: { ...next.state, step: "create", created: false },
    };
    clock.start(0, 1);
  } else if (
    next.ai.screen !== previous.ai.screen ||
    next.state.step === "paused"
  )
    clock.finish();
});
</script>
<template>
  <div
    ref="root"
    class="workspace-setup"
    :class="{ 'is-finalizing': celebrating }"
    :data-finale-time="celebrating ? finaleClock.time.value : undefined"
    :style="accentStyle(state.accent)"
    :data-transition-time="clock.frame.value.time"
    :data-transitioning="!!frame"
    :data-opening-time="opening?.time"
    :data-opening="!!opening && clock.active.value"
  >
    <SetupFrame
      continuous
      :focused="
        shown.state.step === 'working' &&
        shown.onboarding.step === 'source-chat'
      "
      :finale-time="celebrating ? finaleClock.time.value : undefined"
      :step="frame?.activeStep ?? step"
      :transition="frame"
      :opening="opening"
      :progress-reveal="opening?.reveal ?? 1"
      :workspace="shown.state.created ? workspace?.name : undefined"
      :paused="state.paused"
      :blocked="state.check === 'failed'"
    >
      <template
        v-if="
          !state.created &&
          shown.onboarding.context &&
          !['access', 'method', 'proposal'].includes(shown.onboarding.step)
        "
        #aside
      >
        <div class="setup-keepsake">
          <span>{{ onboardingCopy.journey.keepsake }}</span>
          <blockquote>{{ shown.onboarding.context }}</blockquote>
        </div>
      </template>
      <template v-if="celebrating" #finale-actions>
        <SituateButton
          variant="plain"
          class="finale-pause"
          :aria-pressed="onboarding.finale.paused"
          @click="emit('onboarding', { type: 'finale-pause' })"
        >
          {{ onboarding.finale.paused ? finaleCopy.resume : finaleCopy.pause }}
        </SituateButton>
        <SituateButton
          variant="plain"
          class="finale-skip"
          @click="finaleClock.finish"
        >
          {{ finaleCopy.skip }} <span aria-hidden="true">↗</span>
        </SituateButton>
      </template>
      <template v-if="shown.state.created" #actions>
        <SituateButton
          variant="plain"
          v-if="state.created && state.step !== 'paused'"
          class="finish-later"
          @click="emit('action', { type: 'pause-setup' })"
        >
          {{ c.pause }}
        </SituateButton>
      </template>
      <div
        class="transition-panel"
        :class="{
          'source-chat-panel':
            shown.state.step === 'working' &&
            shown.onboarding.step === 'source-chat',
        }"
        :inert="frame && !frame.incoming ? true : undefined"
        :style="
          frame
            ? {
                opacity: frame.panelOpacity,
                transform: `translateY(${frame.panelY}px)`,
              }
            : undefined
        "
      >
        <FirstEntry
          v-if="shown.state.step === 'create'"
          embedded
          :state="shown.state"
          :run="run"
          :busy="shown.busy"
          :error="shown.error"
          :name="shown.name"
          @update:name="emit('update:name', $event)"
          @action="emit('action', $event)"
          @cancel="emit('cancel')"
        />
        <FirstSetup
          v-else
          embedded
          :state="shown.state"
          :ai="shown.ai"
          :onboarding="shown.onboarding"
          :workspace="shown.workspace?.name ?? shown.name"
          @action="emit('action', $event)"
          @ai="emit('ai', $event)"
        >
          <slot :onboarding="shown.onboarding" />
        </FirstSetup>
      </div>
    </SetupFrame>
  </div>
</template>
<style scoped>
.workspace-setup {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.transition-panel {
  min-width: 0;
}
.source-chat-panel {
  height: 100%;
  min-height: 0;
}
.setup-keepsake {
  margin: 24px 20px 0;
  padding-left: 16px;
  border-left: 3px solid var(--situate-tangerine);
}
.setup-keepsake span {
  font-size: 12px;
  color: var(--situate-muted);
}
.setup-keepsake blockquote {
  margin: 8px 0 0;
  font-size: 15px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.workspace-setup.is-finalizing {
  position: absolute;
  inset: 0;
  z-index: 5;
}
.finale-skip,
.finale-pause {
  min-height: 44px;
  padding: 10px 18px;
  border-radius: 999px;
  border: 1px solid var(--situate-control-line);
  background: var(--situate-paper);
  color: var(--situate-ink);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}
.finale-skip {
  background: var(--situate-violet-deep);
  color: var(--situate-surface);
  border-color: var(--situate-violet-deep);
}
.finale-skip span {
  margin-left: 12px;
}
.finale-skip:focus-visible,
.finale-pause:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-ink);
  outline-offset: var(--situate-focus-offset);
}
.finish-later {
  min-height: 44px;
  border: 1px solid var(--situate-control-line);
  border-radius: 99px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  padding: 10px 20px;
  font: inherit;
  cursor: pointer;
}
.finish-later:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-ink);
  outline-offset: var(--situate-focus-offset);
}
</style>
