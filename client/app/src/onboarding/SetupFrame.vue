<script setup lang="ts">
import "@situate/localization/onboarding";
import { computed, inject, nextTick, onMounted, ref, useId, watch } from "vue";
import { t } from "@situate/localization";
import wordmark from "../../../../design/brand/assets/wordmark.svg";
const finaleCopy = computed(() => ({
  heading: t("onboarding.finale.heading"),
}));
import { useFinaleStage } from "./setup-journey/finale/use-finale-stage";
import SetupProgress from "./SetupProgress.vue";
import SetupTaskContent from "./SetupTaskContent";
import SetupIllustration from "./SetupIllustration.vue";
import type { SetupTransitionFrame } from "./setup-transition";
import type { OpeningFrame } from "./setup-journey/opening";
import { useSetupTransition } from "./use-setup-transition";
import { creationTransition } from "./creation-transition";
const c = computed(() => ({ eyebrow: t("onboarding.frame.eyebrow") }));
const props = defineProps<{
  finaleTime?: number;
  animateOpening?: boolean;
  initialFrom?: number;
  embedded?: boolean;
  focused?: boolean;
  continuous?: boolean;
  transition?: SetupTransitionFrame;
  opening?: OpeningFrame;
  progressReveal?: number;
  step?: number;
  workspace?: string;
  paused?: boolean;
  blocked?: boolean;
  labelledby?: string;
}>();
const root = ref<HTMLElement>(),
  art = ref<HTMLElement>(),
  panel = ref<HTMLElement>();
const creation = inject(creationTransition, undefined);
const restoreTaskFocus = creation?.restoreFocus ?? ref(false);
function taskBlur(event: FocusEvent) {
  if (
    event.relatedTarget instanceof Node &&
    !panel.value?.contains(event.relatedTarget)
  )
    restoreTaskFocus.value = false;
}
const headingId = `finale-heading-${useId()}`;
const clock = useSetupTransition(
  root,
  () => !!props.paused || !!props.blocked || props.finaleTime !== undefined,
  () => null,
);
const visualTransition = computed(
  () =>
    props.transition ??
    creation?.frame.value ??
    (clock.mode.value === "step" && clock.active.value
      ? clock.frame.value
      : undefined),
);
const visualOpening = computed(
  () =>
    props.opening ??
    (clock.mode.value === "opening" && clock.active.value
      ? clock.opening.value
      : undefined),
);
watch(
  () => !!creation?.frame.value && (!!props.paused || !!props.blocked),
  (suppressed) => {
    if (suppressed) creation?.finish();
  },
  { immediate: true },
);
watch(
  () => props.step,
  (step, previous) => {
    if (step === undefined || previous === undefined || step === previous)
      return;
    if (creation?.frame.value) return;
    if (clock.active.value || step < previous) clock.finish();
    else clock.start(previous, step);
  },
);
watch(
  () => !!visualTransition.value,
  async (active) => {
    if (active) {
      const focused = document.activeElement;
      const taskFocused = !!focused && !!panel.value?.contains(focused);
      restoreTaskFocus.value ||= taskFocused;
      if (taskFocused && focused instanceof HTMLElement) focused.blur();
    } else if (restoreTaskFocus.value) {
      restoreTaskFocus.value = false;
      await nextTick();
      if (
        visualTransition.value ||
        finale.value ||
        document.activeElement !== document.body
      )
        return;
      const target =
        panel.value?.querySelector<HTMLElement>("h1, h2") ?? panel.value;
      target?.setAttribute("tabindex", "-1");
      target?.focus({ preventScroll: true });
    }
  },
  { flush: "pre", immediate: true },
);
onMounted(() => {
  if (creation?.frame.value) return;
  if (props.animateOpening && props.step === 0) clock.startOpening();
  else if (props.initialFrom !== undefined && props.step !== undefined)
    clock.start(props.initialFrom, props.step);
});
const {
  frame: finale,
  scroll,
  placeholderHeight,
} = useFinaleStage(root, art, () => props.finaleTime);
const uiStyle = computed(() =>
  finale.value
    ? {
        opacity: finale.value.uiOpacity,
        transform: `translateY(${-scroll.value}px)`,
      }
    : undefined,
);
</script>
<template>
  <div
    ref="root"
    :class="
      embedded
        ? ['setup-content', { 'focused-chat': focused }]
        : [
            'setup-frame',
            {
              continuous: continuous !== false,
              'focused-chat': focused,
              'finale-frame': !!finale,
              'finale-compact': finale && finale.height < 450,
              'finale-tiny': finale && finale.height < 320,
            },
          ]
    "
  >
    <div
      v-if="finale"
      class="finale-backdrop"
      :style="{ opacity: finale.backdropOpacity }"
    />
    <slot v-if="embedded" />
    <template v-else>
      <header
        v-if="!finale"
        class="frame-header"
        :style="uiStyle"
        :inert="finale ? true : undefined"
        :aria-hidden="finale ? true : undefined"
      >
        <div class="frame-identity">
          <img
            :src="wordmark"
            :alt="t('onboarding.brand')"
            width="126"
            height="38"
          />
        </div>
        <div class="frame-actions">
          <slot name="actions"
            ><span class="frame-eyebrow">{{ c.eyebrow }}</span></slot
          >
        </div>
      </header>
      <div
        v-if="!finale && progressReveal !== undefined"
        class="progress-reveal"
        :style="{
          gridTemplateRows: `${visualOpening?.reveal ?? progressReveal}fr`,
          ...uiStyle,
        }"
        :aria-hidden="progressReveal === 0 || finale ? 'true' : undefined"
        :inert="progressReveal === 0 || finale ? true : undefined"
      >
        <div class="progress-content">
          <SetupProgress
            v-if="step !== undefined"
            :step="visualTransition?.activeStep ?? step"
            :transition="visualTransition"
            :style="{
              opacity: visualOpening?.progressOpacity ?? progressReveal,
              transform: `translateY(${visualOpening?.progressY ?? 0}px)`,
            }"
          />
        </div>
      </div>
      <SetupProgress
        v-else-if="!finale && step !== undefined"
        :step="visualTransition?.activeStep ?? step"
        :transition="visualTransition"
      />
      <div
        class="frame-stage"
        :class="{
          'with-progress': step !== undefined,
          'managed-progress': progressReveal !== undefined,
        }"
      >
        <aside
          ref="art"
          v-show="!focused"
          class="frame-art"
          :style="finale ? { height: `${placeholderHeight}px` } : undefined"
        >
          <div
            class="art-canvas"
            :style="finale ? { opacity: finale.overlayOpacity } : undefined"
          >
            <slot name="illustration"
              ><SetupIllustration
                :step="step ?? 0"
                :paused="paused"
                :blocked="blocked"
                :transition="visualTransition"
                :opening="visualOpening"
                :finale="finale"
            /></slot>
          </div>
          <div
            v-if="!finale"
            :style="
              finale && placeholderHeight === 0 ? { opacity: 0 } : uiStyle
            "
            :aria-hidden="finale ? true : undefined"
          >
            <slot name="aside" />
          </div>
        </aside>
        <section
          v-if="!finale"
          ref="panel"
          class="setup-panel"
          @focusin="restoreTaskFocus = true"
          @focusout="taskBlur"
          :data-transition-phase="visualTransition?.phase ?? 'idle'"
          :aria-labelledby="labelledby"
          :style="
            uiStyle ??
            (visualTransition
              ? {
                  opacity: visualTransition.panelOpacity,
                  transform: `translateY(${visualTransition.panelY}px)`,
                  visibility:
                    visualTransition.panelOpacity === 0 ? 'hidden' : undefined,
                }
              : undefined)
          "
          :inert="finale || visualTransition ? true : undefined"
          :aria-hidden="finale || visualTransition ? true : undefined"
        >
          <SetupTaskContent :transition="visualTransition"
            ><slot
          /></SetupTaskContent>
        </section>
      </div>
      <section
        v-if="finale"
        class="finale-announcement"
        :aria-labelledby="headingId"
      >
        <div class="finale-copy" :style="{ opacity: finale.titleOpacity }">
          <p>{{ workspace }}</p>
          <h1 :id="headingId">{{ finaleCopy.heading }}</h1>
        </div>
        <div class="finale-actions"><slot name="finale-actions" /></div>
      </section>
    </template>
  </div>
</template>
<style scoped>
.setup-frame {
  --setup-accent: var(--situate-violet-deep);
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
  min-height: 0;
  padding: 28px clamp(18px, 4vw, 56px) 36px;
  background: var(--situate-paper);
  color: var(--situate-ink);
}
html[data-workspace-accent]:not([data-workspace-accent="violet"]) .setup-frame {
  --setup-accent: var(--situate-accent);
}
.setup-frame :deep(.situate-button--normal:not(:disabled)) {
  background: var(--setup-accent);
  color: var(--situate-accent-on, var(--situate-surface));
  border-color: var(--situate-ink);
}
.frame-header {
  max-width: 1280px;
  margin: auto;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.frame-identity {
  display: flex;
  align-items: center;
  gap: 24px;
  min-width: 0;
}
.frame-identity img {
  width: 126px;
  height: auto;
  flex: none;
}
.frame-eyebrow {
  font-size: 12px;
  color: var(--situate-muted);
  font-weight: 600;
}
.frame-actions {
  flex: none;
}
.frame-stage {
  max-width: 1280px;
  min-height: calc(100% - 72px);
  margin: 24px auto 0;
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
  gap: clamp(24px, 5vw, 72px);
  align-items: center;
}
.frame-stage.with-progress {
  min-height: calc(100% - 156px);
  margin-top: 36px;
  align-items: start;
}
.progress-reveal {
  display: grid;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  flex: none;
}
.progress-content {
  display: flow-root;
  min-width: 0;
  min-height: 0;
}
.frame-stage.managed-progress {
  align-items: start;
  margin-top: 24px;
}
@media (min-width: 701px) {
  .progress-content :deep(.setup-steps) {
    padding-bottom: 12px;
  }
}
.frame-art {
  min-width: 0;
  align-self: start;
  position: sticky;
  top: 24px;
  margin-top: 16px;
}
.setup-panel {
  container: setup-task / inline-size;
  min-width: 0;
  background: var(--situate-surface);
  border: 1px solid var(--situate-line);
  border-radius: 28px;
  padding: clamp(24px, 3vw, 40px);
}
@media (min-width: 701px) {
  .continuous {
    display: flex;
    flex-direction: column;
  }
  .continuous .frame-header,
  .continuous :deep(.setup-steps) {
    width: 100%;
    flex: none;
  }
  .continuous .frame-stage {
    width: 100%;
    flex: 1;
    min-height: 0;
  }
  .continuous .frame-art {
    position: static;
  }
  .continuous .setup-panel {
    max-height: 100%;
    overflow: auto;
  }
}
@media (max-width: 850px) {
  .frame-stage {
    grid-template-columns: minmax(0, 0.65fr) minmax(0, 1.35fr);
    gap: 20px;
  }
}
@media (max-width: 700px) {
  .setup-frame {
    padding: 16px 16px 28px;
  }
  .frame-stage,
  .frame-stage.with-progress,
  .frame-stage.managed-progress {
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    margin-top: 16px;
    gap: 16px;
  }
  .frame-art {
    position: static;
    width: min(62vw, 240px);
    justify-self: center;
    margin: 0;
  }
  .frame-identity {
    flex-wrap: wrap;
    gap: 4px 16px;
  }
  .frame-eyebrow {
    display: none;
  }
  .setup-panel {
    padding: 24px 20px;
    border-radius: 24px;
  }
}
@media (max-height: 500px) and (max-width: 700px) {
  .frame-art {
    display: none;
  }
}
.finale-frame {
  background: transparent;
  overflow: clip;
}
.finale-frame .frame-art {
  display: block;
  position: static;
}
.finale-frame .art-canvas,
.finale-backdrop {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.finale-backdrop {
  background: var(--situate-paper);
}
.finale-frame .art-canvas {
  z-index: 2;
}
.finale-copy {
  position: absolute;
  z-index: 3;
  top: clamp(24px, 7vh, 72px);
  left: 20px;
  right: 20px;
  text-align: center;
  pointer-events: none;
}
.finale-copy p {
  font-size: 14px;
  font-weight: 550;
  max-width: min(480px, 85%);
  margin: 0 auto 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.finale-copy h1 {
  max-width: 760px;
  margin: 0 auto;
  font-size: clamp(32px, 5.4vw, 70px);
  line-height: 1.03;
  letter-spacing: -0.045em;
  text-wrap: balance;
}
.finale-actions {
  position: absolute;
  z-index: 4;
  bottom: 20px;
  right: 24px;
  left: 24px;
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}
.finale-compact .finale-copy {
  top: 12px;
}
.finale-compact .finale-copy p {
  display: none;
}
.finale-compact .finale-copy h1 {
  font-size: 26px;
}
.finale-tiny .finale-copy {
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@media (max-width: 700px) {
  .finale-copy {
    top: 24px;
  }
  .finale-actions {
    bottom: 16px;
    left: 16px;
    right: 16px;
    justify-content: center;
  }
}
.setup-content.focused-chat {
  height: 100%;
}
.setup-frame.focused-chat {
  padding: 16px;
  overflow: hidden;
}
.focused-chat .frame-header,
.focused-chat .progress-reveal,
.focused-chat > :deep(.setup-steps) {
  display: none;
}
.focused-chat .frame-stage {
  display: block;
  margin: 0 auto;
  height: 100%;
  min-height: 0;
  width: 100%;
}
.focused-chat .setup-panel {
  height: 100%;
  padding: 0;
  overflow: hidden;
  border-radius: 20px;
}
@media (max-width: 700px), (max-height: 500px) {
  .setup-frame.focused-chat {
    padding: 0;
  }
  .focused-chat .setup-panel {
    border: 0;
    border-radius: 0;
  }
}
</style>
