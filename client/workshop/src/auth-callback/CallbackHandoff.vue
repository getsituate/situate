<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import rest from "../brand/bend/svg/rest-welcome.svg?raw";
import card from "../brand/assets/card.svg";
import performance, { type BendRig } from "../brand/bend/performance";
import { handoffDuration, handoffFrame } from "./score";

const props = defineProps<{
  replay: number;
  paused: boolean;
  timeMs: number | null;
  still: boolean;
  visibilityTarget?: HTMLElement | null;
}>();
const emit = defineEmits<{ frame: [timeMs: number] }>();
const root = ref<SVGSVGElement>();
const actor = ref<SVGGElement>();
const receipt = ref<SVGGElement>();
const prefix = `callback-${useId().replace(/[^a-z0-9-]/gi, "")}`;
const artwork = rest.replaceAll("bend-rest-welcome", prefix);
let rig: BendRig | undefined;
let preference: MediaQueryList | undefined;
let observer: IntersectionObserver | undefined;
let frame: number | undefined;
let previous: number | undefined;
let elapsed = props.timeMs ?? 0;
let visible = true;
let alive = false;

function draw() {
  const pose = handoffFrame(elapsed);
  rig?.set(pose.actor);
  receipt.value?.setAttribute(
    "transform",
    `translate(${pose.receipt.x} ${pose.receipt.y}) rotate(${pose.receipt.rotation} 163 287)`,
  );
  root.value?.setAttribute("data-time", String(Math.round(pose.time)));
  emit("frame", pose.time);
}
function stop() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
  previous = undefined;
  root.value?.setAttribute("data-playing", "false");
}
function tick(now: number) {
  frame = undefined;
  if (!alive) return;
  if (previous !== undefined)
    elapsed = Math.min(handoffDuration, elapsed + now - previous);
  previous = now;
  draw();
  if (elapsed >= handoffDuration) {
    stop();
    return;
  }
  frame = requestAnimationFrame(tick);
}
function reconcile() {
  if (!alive) return;
  if (props.still || preference?.matches) {
    stop();
    elapsed = handoffDuration;
    draw();
    return;
  }
  if (
    props.paused ||
    !visible ||
    document.visibilityState !== "visible" ||
    elapsed >= handoffDuration
  ) {
    stop();
    return;
  }
  if (frame === undefined) {
    root.value?.setAttribute("data-playing", "true");
    frame = requestAnimationFrame(tick);
  }
}
watch(
  () => props.replay,
  () => {
    stop();
    elapsed = props.timeMs ?? 0;
    draw();
    reconcile();
  },
);
watch(
  () => props.timeMs,
  (time) => {
    if (time === null) return;
    stop();
    elapsed = time;
    draw();
    reconcile();
  },
);
watch(() => [props.paused, props.still], reconcile);
watch(
  () => props.visibilityTarget,
  (target) => {
    if (!observer) return;
    observer.disconnect();
    observer.observe(target ?? root.value!);
  },
);
onMounted(() => {
  rig = performance.create(actor.value!.querySelector("svg")!);
  alive = true;
  preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  preference?.addEventListener("change", reconcile);
  document.addEventListener("visibilitychange", reconcile);
  if (typeof IntersectionObserver !== "undefined") {
    visible = false;
    observer = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      reconcile();
    });
    observer.observe(props.visibilityTarget ?? root.value!);
  }
  draw();
  reconcile();
});
onBeforeUnmount(() => {
  alive = false;
  stop();
  observer?.disconnect();
  preference?.removeEventListener("change", reconcile);
  document.removeEventListener("visibilitychange", reconcile);
  rig?.destroy();
});
</script>

<template>
  <svg
    ref="root"
    class="callback-handoff"
    viewBox="0 0 560 430"
    aria-hidden="true"
    focusable="false"
    data-playing="false"
  >
    <path
      d="M85 304C48 216 98 100 227 86C361 71 466 155 473 266C479 352 409 383 278 380C164 377 109 361 85 304Z"
      fill="var(--situate-lilac)"
    />
    <circle cx="420" cy="101" r="35" fill="var(--situate-lemon)" />
    <path
      d="M398 73C405 80 413 84 425 85"
      fill="none"
      stroke="var(--situate-surface)"
      stroke-width="3"
      stroke-linecap="round"
    />
    <path
      d="M65 337C112 301 145 331 184 347S259 376 300 360"
      fill="none"
      stroke="var(--situate-ribbon-depth)"
      stroke-width="30"
      stroke-linecap="round"
    />
    <path
      d="M65 329C112 293 145 323 184 339S259 368 300 352"
      fill="none"
      stroke="var(--situate-tangerine)"
      stroke-width="30"
      stroke-linecap="round"
    />
    <path
      d="M65 319C112 283 145 313 184 329S259 358 300 342"
      fill="none"
      stroke="var(--situate-peach)"
      stroke-width="2"
      stroke-linecap="round"
    />
    <g transform="translate(187 19) scale(1.16)">
      <g ref="actor" v-html="artwork" />
    </g>
    <g ref="receipt" transform="rotate(-8 163 287)">
      <image :href="card" x="65" y="210" width="196" height="140" />
    </g>
    <path
      d="M370 360C400 333 438 328 491 353"
      fill="none"
      stroke="var(--situate-cobalt)"
      stroke-width="19"
      stroke-linecap="round"
    />
    <path
      d="M370 354C400 327 438 322 491 347"
      fill="none"
      stroke="var(--situate-sky)"
      stroke-width="19"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.callback-handoff {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}
</style>
