<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DictationState } from "./model";

import {
  phraseDuration,
  recordingFrames,
  restingFrame,
} from "./activity-motion";

const props = withDefaults(
  defineProps<{
    phase: "recording" | "transcribing";
    speech: DictationState["speech"];
    covered: boolean;
    paused?: boolean;
  }>(),
  { paused: false },
);
const root = ref<HTMLElement>();
let media: MediaQueryList | undefined;
let observer: IntersectionObserver | undefined;
let visible = false;
let animations: Animation[] = [];
let dialogs: MutationObserver | undefined;
let position = 0;
let previousPhase = props.phase;
function stop() {
  const time = animations[0]?.currentTime;
  if (typeof time === "number") position = time;
  animations.forEach((animation) => animation.cancel());
  animations = [];
}
function reconcile() {
  stop();
  if (previousPhase !== props.phase) position = 0;
  previousPhase = props.phase;
  if (
    props.paused ||
    props.covered ||
    document.querySelector("dialog[open]") ||
    !visible ||
    !media ||
    media.matches ||
    document.visibilityState !== "visible" ||
    !root.value?.isConnected
  )
    return;
  const elements = Array.from(root.value.querySelectorAll<HTMLElement>("span"));
  if (!elements.every((element) => typeof element.animate === "function"))
    return;
  if (props.phase === "recording") {
    if (props.speech === "silence") return;
    animations = elements.map((element, index) =>
      element.animate(recordingFrames(props.speech, index), {
        duration: phraseDuration,
        iterations: Infinity,
        easing: "linear",
      }),
    );
  } else {
    animations = elements.map((element, index) =>
      element.animate(
        [
          { opacity: 0.3 },
          { opacity: 1, offset: 0.35 },
          { opacity: 0.3, offset: 0.7 },
          { opacity: 0.3 },
        ],
        {
          duration: 1200,
          delay: index * 160,
          iterations: Infinity,
          easing: "linear",
        },
      ),
    );
  }
  animations.forEach((animation) => (animation.currentTime = position));
}
watch(
  () => [props.phase, props.speech, props.covered, props.paused],
  reconcile,
  { flush: "post" },
);
onMounted(() => {
  media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener("change", reconcile);
  document.addEventListener("visibilitychange", reconcile);
  dialogs = new MutationObserver(reconcile);
  dialogs.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === root.value);
      if (!entry) return;
      visible =
        entry.isIntersecting &&
        entry.intersectionRect.width > 0 &&
        entry.intersectionRect.height > 0;
      reconcile();
    });
    observer.observe(root.value!);
  }
});
onBeforeUnmount(() => {
  stop();
  observer?.disconnect();
  dialogs?.disconnect();
  media?.removeEventListener("change", reconcile);
  document.removeEventListener("visibilitychange", reconcile);
});
</script>

<template>
  <div
    ref="root"
    class="dictation-activity"
    :class="phase"
    :data-speech="phase === 'recording' ? speech : undefined"
    aria-hidden="true"
  >
    <template v-if="phase === 'recording'">
      <span
        v-for="index in 7"
        :key="`bar-${index}`"
        class="wave-bar"
        :style="restingFrame(speech, index - 1)"
      />
    </template>
    <template v-else>
      <span v-for="index in 3" :key="`dot-${index}`" class="processing-dot" />
    </template>
  </div>
</template>

<style scoped>
.dictation-activity {
  width: var(--situate-target-min);
  height: var(--situate-target-min);
  flex: 0 0 var(--situate-target-min);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  overflow: hidden;
}
.wave-bar {
  flex: 0 0 3px;
  height: 24px;
  border-radius: 2px;
  background: currentColor;
}
.transcribing {
  gap: 4px;
}
.processing-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
</style>
