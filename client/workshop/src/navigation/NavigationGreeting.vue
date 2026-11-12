<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import artwork from "../brand/bend/svg/wave-welcome.svg?raw";
const props = withDefaults(
  defineProps<{ active: boolean; covered: boolean; text?: string }>(),
  { text: "Good to see you." },
);
const prefix = `greeting-${useId()}`;
const svg = artwork.replaceAll("bend-wave-welcome", prefix);
const root = ref<HTMLElement>();
const phase = ref<"ready" | "playing" | "done">("ready");
const revealed = ref(0);
const text = computed(() => props.text);
let animations: Animation[] = [];
let frame = 0;
let observer: IntersectionObserver | undefined;
let surfaces: MutationObserver | undefined;
let preference: MediaQueryList | undefined;
function finish() {
  phase.value = "done";
  revealed.value = text.value.length;
  cancelAnimationFrame(frame);
  animations.forEach((animation) => animation.cancel());
  animations = [];
  observer?.disconnect();
}
function start() {
  if (phase.value !== "ready" || !props.active) return;
  if (
    props.covered ||
    preference?.matches ||
    document.hidden ||
    !Element.prototype.animate
  ) {
    finish();
    return;
  }
  phase.value = "playing";
  const figure = root.value!.querySelector('[data-bend-part="figure"]')!;
  const arm = root.value!.querySelector('[data-bend-part="right-arm"]')!;
  animations = [
    figure.animate(
      [
        { transform: "translate(0px, 0px) rotate(0deg)" },
        { transform: "translate(0px, -3px) rotate(-2deg)" },
        { transform: "translate(0px, -2px) rotate(1deg)" },
        { transform: "translate(0px, 0px) rotate(0deg)" },
      ],
      { duration: 1400, easing: "ease-in-out" },
    ),
    arm.animate(
      [0, -18, 12, -12, 0].map((value) => ({
        transform: `rotate(${value}deg)`,
      })),
      { duration: 1400, easing: "ease-in-out" },
    ),
  ];
  const started = performance.now();
  function type(now: number) {
    if (phase.value !== "playing") return;
    revealed.value = Math.min(
      text.value.length,
      Math.max(0, Math.floor((now - started - 120) / 65) + 1),
    );
    if (now - started >= Math.max(1400, 120 + text.value.length * 65)) finish();
    else frame = requestAnimationFrame(type);
  }
  frame = requestAnimationFrame(type);
  void Promise.all(animations.map((animation) => animation.finished)).catch(
    () => {},
  );
}
function interaction() {
  if (phase.value === "playing") finish();
}
function visibility() {
  if (document.hidden) interaction();
}
function key(event: KeyboardEvent) {
  if (event.key === "Escape") interaction();
}
function reduced() {
  if (preference?.matches) finish();
}
watch(
  () => [props.active, props.covered],
  () => {
    if (!props.active || props.covered) interaction();
  },
);
onMounted(() => {
  preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (
    preference?.matches ||
    !window.IntersectionObserver ||
    !Element.prototype.animate
  )
    finish();
  else {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.25) start();
          else if (!entry.isIntersecting) interaction();
        }
      },
      { threshold: [0, 0.25] },
    );
    observer.observe(root.value!);
  }
  surfaces = new MutationObserver(() => {
    if (document.querySelector('dialog[open], [role="menu"]:popover-open'))
      interaction();
  });
  surfaces.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  document.addEventListener("pointerdown", interaction, true);
  document.addEventListener("focusin", interaction);
  document.addEventListener("keydown", key);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", finish);
  preference?.addEventListener("change", reduced);
});
onBeforeUnmount(() => {
  finish();
  surfaces?.disconnect();
  document.removeEventListener("pointerdown", interaction, true);
  document.removeEventListener("focusin", interaction);
  document.removeEventListener("keydown", key);
  document.removeEventListener("visibilitychange", visibility);
  window.removeEventListener("pagehide", finish);
  preference?.removeEventListener("change", reduced);
});
</script>
<template>
  <div ref="root" class="greeting" :data-state="phase">
    <div class="welcome-bend" aria-hidden="true" v-html="svg" />
    <h2>
      <span class="sr-only">{{ text }}</span
      ><span aria-hidden="true"
        ><span
          v-for="(letter, index) in text"
          :key="index"
          class="greeting-letter"
          :class="{ unrevealed: phase === 'playing' && index >= revealed }"
          >{{ letter }}</span
        ></span
      >
    </h2>
  </div>
</template>
<style scoped>
.greeting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
}
.welcome-bend {
  width: 128px;
  height: 128px;
}
.welcome-bend :deep(svg) {
  width: 100%;
  height: 100%;
}
.greeting h2 {
  margin: 0;
  font-family: var(--situate-font-display);
  font-size: clamp(26px, 4cqi, 37px);
  line-height: var(--situate-leading-heading);
  font-weight: 600;
  letter-spacing: -0.05em;
}
.unrevealed {
  visibility: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .unrevealed {
    visibility: visible;
  }
}
@media (max-height: 480px) {
  .welcome-bend {
    display: none;
  }
}
</style>
