<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import drawing from "../brand/bend/svg/rest-unsure.svg?raw";
const props = defineProps<{ still: boolean; seen: boolean }>();
const emit = defineEmits<{ played: [] }>();
const id = `recovery-bend-${useId().replace(/[^a-z0-9-]/gi, "")}`;
const animate = ref(!props.seen && !props.still);
let preference: MediaQueryList | undefined;
function settle() {
  animate.value = false;
}
function reduceMotion() {
  if (preference?.matches) settle();
}
watch(
  () => props.still,
  (still) => {
    if (still) settle();
  },
);
const art = computed(() => drawing.replaceAll("bend-rest-unsure", id));
onMounted(() => {
  preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduceMotion();
  preference.addEventListener("change", reduceMotion);
  document.addEventListener("visibilitychange", settle);
  emit("played");
});
onBeforeUnmount(() => {
  preference?.removeEventListener("change", reduceMotion);
  document.removeEventListener("visibilitychange", settle);
});
</script>
<template>
  <div
    class="recovery-bend"
    :class="{ gesture: animate && !still }"
    aria-hidden="true"
    @animationend="settle"
  >
    <svg class="recovery-scene" viewBox="0 0 440 230" fill="none">
      <ellipse cx="220" cy="119" rx="102" ry="102" class="scene-ground" />
      <path
        d="M38 176c38 0 40-52 74-52s44 76 109 76c67 0 85-55 117-55"
        class="scene-thread"
      />
      <path d="m344 145 20 0" class="scene-thread loose-end" />
      <g transform="translate(62 76) rotate(-17 26 30)">
        <rect width="52" height="66" rx="9" class="scene-paper" />
        <path d="M14 20h24M14 31h17M14 42h12" class="scene-ink" />
      </g>
      <g transform="translate(330 70) rotate(16 22 27)">
        <path
          d="M0 9a9 9 0 0 1 9-9h26a9 9 0 0 1 9 9v16l-9 7 9 6v8a9 9 0 0 1-9 9H9a9 9 0 0 1-9-9Z"
          class="scene-paper warm-paper"
        />
        <path d="M13 16h18M13 26h10" class="scene-ink" />
      </g>
      <ellipse cx="224" cy="216" rx="70" ry="5" class="scene-shadow" />
    </svg>
    <div class="recovery-figure" v-html="art" />
  </div>
</template>
<style scoped>
.recovery-bend {
  position: relative;
  width: 100%;
  height: 230px;
  pointer-events: none;
  overflow: hidden;
}
.recovery-scene {
  position: absolute;
  display: block;
  width: 440px;
  height: 230px;
  left: calc(50% - 220px);
}
.scene-ground {
  fill: var(--situate-lilac);
  opacity: 0.55;
}
.scene-thread {
  stroke: var(--situate-violet);
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.4;
}
.loose-end {
  stroke-dasharray: 3 6;
}
.scene-paper {
  fill: var(--situate-surface);
  stroke: var(--situate-control-line);
  stroke-width: 1.2;
}
.warm-paper {
  fill: var(--situate-peach);
  stroke: none;
}
.scene-ink {
  stroke: var(--situate-ink);
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.45;
}
.scene-shadow {
  fill: var(--situate-violet-deep);
  opacity: 0.09;
}
.recovery-figure {
  position: absolute;
  width: 300px;
  height: 300px;
  top: -39px;
  left: calc(50% - 150px);
}
.recovery-figure :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.recovery-figure :deep([data-bend-part="figure"]) {
  transform: translateY(2px) rotate(2deg);
}
.recovery-figure :deep([data-bend-part="face"]) {
  transform: translateY(3px);
}
.gesture :deep([data-bend-part="figure"]) {
  animation: recovery-droop 1s ease-out 1;
}
.gesture :deep([data-bend-part="face"]) {
  animation: recovery-gaze 1s ease-out 1;
}
@keyframes recovery-droop {
  from {
    transform: translateY(0) rotate(0deg);
  }
  to {
    transform: translateY(2px) rotate(2deg);
  }
}
@keyframes recovery-gaze {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(3px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .gesture :deep([data-bend-part]) {
    animation: none;
  }
}
</style>
