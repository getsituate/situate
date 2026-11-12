<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  gestureScore,
  idleEyes,
  INITIAL_REST_MS,
  nextGesture,
  restAfter,
  type Variant,
} from "./gestures";
import { bendAt, limbPath } from "./curves";

const props = withDefaults(
  defineProps<{
    busy: boolean;
    paused?: boolean;
    variant?: Variant;
  }>(),
  { paused: false, variant: "mixed" },
);

const root = ref<SVGSVGElement>();
const body = ref<SVGGElement>();
const eyes = ref<SVGPathElement>();
const left = ref<SVGPathElement>();
const right = ref<SVGPathElement>();
let media: MediaQueryList | undefined;
let observer: IntersectionObserver | undefined;
let visible = false;
let mounted = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let animations: Animation[] = [];
let index = 0;
let frame = 0;

function stop() {
  clearTimeout(timer);
  timer = undefined;
  animations.forEach((animation) => animation.cancel());
  animations = [];
  cancelAnimationFrame(frame);
  frame = 0;
  left.value?.setAttribute("d", limbPath(7, 0));
  right.value?.setAttribute("d", limbPath(25, 0));
}

function eligible() {
  return (
    mounted &&
    props.busy &&
    !props.paused &&
    media &&
    !media.matches &&
    document.visibilityState === "visible" &&
    visible &&
    root.value?.isConnected &&
    typeof body.value?.animate === "function" &&
    typeof eyes.value?.animate === "function"
  );
}

function schedule(delay: number) {
  animations = [
    eyes.value!.animate(idleEyes(index), {
      duration: delay,
      easing: "linear",
      fill: "none",
      iterations: 1,
    }),
  ];
  timer = setTimeout(() => {
    stop();
    if (!eligible()) return;
    const direction = (index + Math.floor(index / 10)) % 2 ? -1 : 1;
    const score = gestureScore(
      nextGesture(props.variant, index),
      direction,
      Math.floor(index / 10) % 3,
    );
    const options: KeyframeAnimationOptions = {
      duration: score.duration,
      easing: "linear",
      fill: "none",
      iterations: 1,
    };
    // Ease each beat independently, including the small holds between glances.
    const eased = (frames: Keyframe[]) =>
      frames.map((frame) => ({
        ...frame,
        easing: "cubic-bezier(.22,.7,.25,1)",
      }));
    const bodyAnimation = body.value!.animate(eased(score.body), options);
    animations = [
      bodyAnimation,
      eyes.value!.animate(eased(score.eyes), options),
    ];
    function bend() {
      if (!eligible()) {
        stop();
        return;
      }
      const progress = Number(bodyAnimation.currentTime ?? 0) / score.duration;
      left.value?.setAttribute("d", limbPath(7, bendAt(score.left, progress)));
      right.value?.setAttribute(
        "d",
        limbPath(25, bendAt(score.right, progress)),
      );
      frame = requestAnimationFrame(bend);
    }
    frame = requestAnimationFrame(bend);
    timer = setTimeout(() => {
      stop();
      if (eligible()) schedule(restAfter(index++));
    }, score.duration);
  }, delay);
}

function reconcile() {
  stop();
  if (eligible()) schedule(INITIAL_REST_MS);
}

watch(
  () => [props.busy, props.paused, props.variant],
  () => {
    index = 0;
    reconcile();
  },
  { flush: "sync" },
);

onMounted(() => {
  mounted = true;
  media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  media?.addEventListener("change", reconcile);
  document.addEventListener("visibilitychange", reconcile);
  // Without intersection observation, retain the still mark rather than animate unseen content.
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === root.value);
      if (!entry) return;
      const next =
        entry.isIntersecting &&
        entry.intersectionRect.width > 0 &&
        entry.intersectionRect.height > 0;
      if (next === visible) return;
      visible = next;
      reconcile();
    });
    observer.observe(root.value!);
  }
});

onBeforeUnmount(() => {
  mounted = false;
  stop();
  observer?.disconnect();
  media?.removeEventListener("change", reconcile);
  document.removeEventListener("visibilitychange", reconcile);
});
</script>

<template>
  <svg
    ref="root"
    class="mini-bend-playful"
    width="32"
    height="32"
    viewBox="-3 -3 38 38"
    aria-hidden="true"
    focusable="false"
  >
    <g ref="body" class="mini-bend-playful__body">
      <path
        d="M7 15V13a9 9 0 0 1 18 0v2"
        fill="none"
        stroke="currentColor"
        stroke-width="7"
        stroke-linecap="round"
      />
      <path
        ref="left"
        class="mini-bend-playful__left"
        :d="limbPath(7, 0)"
        fill="none"
        stroke="currentColor"
        stroke-width="7"
        stroke-linecap="round"
      />
      <path
        ref="right"
        class="mini-bend-playful__right"
        :d="limbPath(25, 0)"
        fill="none"
        stroke="currentColor"
        stroke-width="7"
        stroke-linecap="round"
      />
      <path
        ref="eyes"
        d="M13 11v3m6-3v3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </g>
  </svg>
</template>

<style scoped>
.mini-bend-playful {
  display: inline-block;
  flex: none;
  width: clamp(28px, var(--mini-bend-playful-size, 32px), 36px);
  height: clamp(28px, var(--mini-bend-playful-size, 32px), 36px);
  vertical-align: middle;
  overflow: hidden;
  pointer-events: none;
}
.mini-bend-playful__body {
  transform-box: view-box;
  transform-origin: 19px 32px;
}
.mini-bend-playful__body > path:last-child {
  transform-box: fill-box;
  transform-origin: center;
}
@media (prefers-reduced-motion: reduce) {
  .mini-bend-playful g,
  .mini-bend-playful path {
    transform: none !important;
  }
}
</style>
