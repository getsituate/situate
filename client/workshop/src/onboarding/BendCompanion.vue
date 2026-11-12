<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import welcome from "../brand/bend/svg/wave-welcome.svg?raw";
import listen from "../brand/bend/svg/rest-welcome.svg?raw";
import gather from "../brand/bend/svg/carry-welcome.svg?raw";
import shape from "../brand/bend/svg/point-curious.svg?raw";
import arrive from "../brand/bend/svg/celebrate-pleased.svg?raw";
import blocked from "../brand/bend/svg/rest-unsure.svg?raw";
import { bendScore, type BendMoment } from "./bend-motion";
const props = defineProps<{
  moment: BendMoment;
  paused: boolean;
  seen: boolean;
}>();
const emit = defineEmits<{ played: [] }>();
const root = ref<HTMLElement>();
const prefix = `guide-${useId().replace(/[^a-z0-9-]/gi, "")}`;
const drawings = {
  welcome,
  listen,
  gather,
  shape,
  ready: gather,
  arrive,
  blocked,
};
const artwork = computed(() =>
  drawings[props.moment].replaceAll(/bend-[a-z]+-[a-z]+/g, prefix),
);
let animations: Animation[] = [];
let observer: IntersectionObserver | undefined;
let preference: MediaQueryList | undefined;
let visible = false;
let alive = false;
let started = false;
function cancel() {
  animations.forEach((animation) => animation.cancel());
  animations = [];
}
function reconcile() {
  if (!alive) return;
  if (preference?.matches) {
    cancel();
    if (visible && !props.seen && !started) {
      started = true;
      emit("played");
    }
    return;
  }
  const eligible =
    visible && !props.paused && document.visibilityState === "visible";
  if (animations.length) {
    animations.forEach((animation) => {
      if (animation.playState !== "finished") {
        if (eligible) animation.play();
        else animation.pause();
      }
    });
    return;
  }
  if (!eligible || props.seen || started) return;
  started = true;
  emit("played");
  const score = bendScore(props.moment);
  for (const track of score.tracks) {
    const element = root.value?.querySelector<SVGElement>(
      `[data-bend-part="${track.part}"]`,
    );
    if (typeof element?.animate !== "function") continue;
    animations.push(
      element.animate(track.frames, {
        duration: score.duration,
        easing: "cubic-bezier(.22,.7,.25,1)",
        iterations: 1,
        fill: "none",
      }),
    );
  }
}
watch(
  () => props.moment,
  async () => {
    cancel();
    started = false;
    await nextTick();
    reconcile();
  },
);
watch(() => props.paused, reconcile);
onMounted(() => {
  alive = true;
  preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  preference?.addEventListener("change", reconcile);
  document.addEventListener("visibilitychange", reconcile);
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === root.value);
      if (!entry) return;
      visible = entry.isIntersecting;
      reconcile();
    });
    observer.observe(root.value!);
  }
});
onBeforeUnmount(() => {
  alive = false;
  cancel();
  observer?.disconnect();
  preference?.removeEventListener("change", reconcile);
  document.removeEventListener("visibilitychange", reconcile);
});
</script>
<template>
  <div ref="root" class="bend-companion" aria-hidden="true" v-html="artwork" />
</template>
<style scoped>
.bend-companion {
  width: 100%;
  aspect-ratio: 1;
  pointer-events: none;
}
.bend-companion :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
</style>
