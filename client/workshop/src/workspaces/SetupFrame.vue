<script setup lang="ts">
import { computed, ref, useId } from "vue";
import wordmark from "../brand/assets/wordmark.svg";
import finaleCopy from "../localization/en.setup-finale.json";
import { useFinaleStage } from "./setup-journey/finale/use-finale-stage";
import SetupProgress from "./SetupProgress.vue";
import SetupIllustration from "./SetupIllustration.vue";
import type { SetupTransitionFrame } from "./setup-transition";
import type { OpeningFrame } from "./setup-journey/opening";
import { entryCopy as c } from "./first-entry";
const props = defineProps<{
  finaleTime?: number;
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
  art = ref<HTMLElement>();
const headingId = `finale-heading-${useId()}`;
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
              continuous,
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
        class="frame-header"
        :style="uiStyle"
        :inert="finale ? true : undefined"
        :aria-hidden="finale ? true : undefined"
      >
        <div class="frame-identity">
          <img :src="wordmark" alt="Situate" width="126" height="38" /><span
            v-if="workspace"
            >{{ workspace }}</span
          >
        </div>
        <div class="frame-actions">
          <slot name="actions"
            ><span class="frame-eyebrow">{{ c.eyebrow }}</span></slot
          >
        </div>
      </header>
      <div
        v-if="progressReveal !== undefined"
        class="progress-reveal"
        :style="{ gridTemplateRows: `${progressReveal}fr`, ...uiStyle }"
        :aria-hidden="progressReveal === 0 || finale ? 'true' : undefined"
        :inert="progressReveal === 0 || finale ? true : undefined"
      >
        <div class="progress-content">
          <SetupProgress
            v-if="step !== undefined"
            :step="step"
            :transition="transition"
            :style="{
              opacity: opening?.progressOpacity ?? progressReveal,
              transform: `translateY(${opening?.progressY ?? 0}px)`,
            }"
          />
        </div>
      </div>
      <SetupProgress
        v-else-if="step !== undefined"
        :step="step"
        :transition="transition"
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
                :transition="transition"
                :opening="opening"
                :finale="finale"
            /></slot>
          </div>
          <div
            :style="
              finale && placeholderHeight === 0 ? { opacity: 0 } : uiStyle
            "
            :aria-hidden="finale ? true : undefined"
          >
            <slot name="aside" />
          </div>
        </aside>
        <section
          class="setup-panel"
          :aria-labelledby="labelledby"
          :style="uiStyle"
          :inert="finale ? true : undefined"
          :aria-hidden="finale ? true : undefined"
        >
          <slot />
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
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
  min-height: 0;
  padding: 28px clamp(18px, 4vw, 56px) 36px;
  background: var(--situate-paper);
  color: var(--situate-ink);
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
.frame-identity span {
  font-size: 13px;
  overflow-wrap: anywhere;
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
  .frame-identity span {
    flex-basis: 100%;
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
