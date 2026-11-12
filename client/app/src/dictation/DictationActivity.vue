<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  phase: "recording" | "transcribing";
  level?: number;
  covered: boolean;
}>();
const root = ref<HTMLElement>();
const scales = ref(Array<number>(7).fill(0.125));
let media: MediaQueryList | undefined;
let observer: IntersectionObserver | undefined;
let dialogs: MutationObserver | undefined;
let visible = false;
let animations: Animation[] = [];
let frame: number | undefined;
let previous = 0;
let amplitude = 0;
let clock = 0;

function draw() {
  scales.value = Array.from(
    { length: 7 },
    (_, index) =>
      0.125 +
      amplitude *
        0.8 *
        (0.35 + 0.65 * Math.abs(Math.sin(index * 1.7 + clock * 5.5))),
  );
}
function allowed() {
  return (
    !props.covered &&
    !document.querySelector("dialog[open]") &&
    visible &&
    media &&
    !media.matches &&
    document.visibilityState === "visible" &&
    root.value?.isConnected
  );
}
function target() {
  return Number.isFinite(props.level)
    ? Math.max(0, Math.min(1, props.level ?? 0))
    : 0;
}
function tick(now: number) {
  frame = undefined;
  if (!allowed() || props.phase !== "recording") return;
  const elapsed = previous ? Math.min(now - previous, 64) : 16;
  previous = now;
  clock += elapsed / 1000;
  const value = target();
  const settling = value > amplitude ? 45 : 140;
  amplitude += (value - amplitude) * (1 - Math.exp(-elapsed / settling));
  if (value === 0 && amplitude < 0.005) amplitude = 0;
  draw();
  if (value > 0 || amplitude > 0) frame = requestAnimationFrame(tick);
  else previous = 0;
}
function startRecording() {
  if (
    props.phase === "recording" &&
    allowed() &&
    frame === undefined &&
    typeof requestAnimationFrame === "function"
  )
    frame = requestAnimationFrame(tick);
}
function stop() {
  animations.forEach((animation) => animation.cancel());
  animations = [];
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
  previous = 0;
  amplitude = 0;
  draw();
}
function reconcile() {
  stop();
  if (!allowed()) return;
  if (props.phase === "recording") {
    startRecording();
  } else {
    const elements = Array.from(
      root.value!.querySelectorAll<HTMLElement>(".processing-dot"),
    );
    if (!elements.every((element) => typeof element.animate === "function"))
      return;
    animations = elements.map((element, index) =>
      element.animate(
        [{ opacity: 0.3 }, { opacity: 1, offset: 0.35 }, { opacity: 0.3 }],
        {
          duration: 1200,
          delay: index * 160,
          iterations: Infinity,
          easing: "linear",
        },
      ),
    );
  }
}
draw();
watch(() => [props.phase, props.covered], reconcile, { flush: "post" });
watch(() => props.level, startRecording);
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
  <div ref="root" class="dictation-activity" :class="phase" aria-hidden="true">
    <template v-if="phase === 'recording'">
      <span
        v-for="(scale, index) in scales"
        :key="`bar-${index}`"
        class="wave-bar"
        :style="{ transform: `scaleY(${scale})` }"
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
