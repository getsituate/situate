<script setup lang="ts">
import { SituateButton } from "../ui";
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import rest from "../brand/bend/svg/rest-welcome.svg?raw";
import book from "../brand/assets/book.svg";
import page from "../brand/assets/page.svg";
import leaf from "../brand/assets/folded-leaf.svg";
import card from "../brand/assets/card.svg";
import performance, { type BendRig } from "../brand/bend/performance";
import { c } from "./content";
import {
  welcomeFrame,
  welcomeStillTime,
  type WelcomeLayer,
} from "./welcome-motion";

const props = defineProps<{
  paused: boolean;
  finite?: boolean;
  still?: boolean;
}>();
const emit = defineEmits<{ toggle: []; finished: [] }>();
let finished = false;
const rootControl = ref<InstanceType<typeof SituateButton>>();
const root = computed(() => rootControl.value?.element);
const actor = ref<SVGGElement>();
const layers = new Map<WelcomeLayer, SVGGElement>();
const transforms = new Map<WelcomeLayer, string>();
const opacities = new Map<WelcomeLayer, number>();
const prefix = `welcome-${useId().replace(/[^a-z0-9-]/gi, "")}`;
const artwork = rest.replaceAll("bend-rest-welcome", prefix);
const reduced = ref(false);
const label = computed(() =>
  reduced.value
    ? c.journey.reduced
    : props.paused
      ? c.journey.resume
      : c.journey.pause,
);
let rig: BendRig | undefined;
let preference: MediaQueryList | undefined;
let observer: IntersectionObserver | undefined;
let modalObserver: MutationObserver | undefined;
let visible = false;
let alive = false;
let elapsed = props.paused ? welcomeStillTime : 0;
let lastTime: number | undefined;
let frame: number | undefined;
let lastPose = "";

function draw(time: number) {
  const state = welcomeFrame(time);
  const pose = JSON.stringify(state.actor);
  if (pose !== lastPose) {
    rig?.set(state.actor);
    lastPose = pose;
  }
  for (const [name, element] of layers) {
    const layer = state.layers[name];
    if (transforms.get(name) !== layer.transform) {
      element.setAttribute("transform", layer.transform);
      transforms.set(name, layer.transform);
    }
    if (opacities.get(name) !== layer.opacity) {
      element.setAttribute("opacity", String(layer.opacity));
      opacities.set(name, layer.opacity);
    }
  }
}
function stop() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
  lastTime = undefined;
}
function tick(now: number) {
  if (!alive) return;
  frame = undefined;
  if (lastTime !== undefined) elapsed += now - lastTime;
  lastTime = now;
  draw(elapsed);
  if (props.finite && elapsed >= welcomeStillTime) {
    finished = true;
    stop();
    emit("finished");
    return;
  }
  frame = requestAnimationFrame(tick);
}
function reconcile() {
  if (!alive) return;
  reduced.value = preference?.matches ?? false;
  if (props.still) {
    stop();
    elapsed = welcomeStillTime;
    draw(elapsed);
    return;
  }
  if (reduced.value) {
    stop();
    elapsed = welcomeStillTime;
    draw(elapsed);
    if (props.finite && !finished) {
      finished = true;
      emit("finished");
    }
    return;
  }
  if (props.finite && finished) return;
  const covered = document.querySelector('dialog[open], [aria-modal="true"]');
  if (
    !visible ||
    props.paused ||
    document.visibilityState !== "visible" ||
    covered
  ) {
    stop();
  } else if (frame === undefined) {
    frame = requestAnimationFrame(tick);
  }
}
watch(() => [props.paused, props.still], reconcile);
onMounted(() => {
  rig = performance.create(actor.value!.querySelector("svg")!);
  alive = true;
  for (const name of Object.keys(welcomeFrame(0).layers) as WelcomeLayer[]) {
    layers.set(
      name,
      root.value!.querySelector(`[data-welcome-layer="${name}"]`)!,
    );
  }
  draw(elapsed);
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
  } else visible = true;
  modalObserver = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === "attributes" ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof HTMLElement &&
              (node.matches('dialog, [aria-modal="true"]') ||
                node.querySelector('dialog, [aria-modal="true"]')),
          ),
      )
    )
      reconcile();
  });
  modalObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open", "aria-modal"],
  });
  reconcile();
});
onBeforeUnmount(() => {
  alive = false;
  stop();
  observer?.disconnect();
  modalObserver?.disconnect();
  preference?.removeEventListener("change", reconcile);
  document.removeEventListener("visibilitychange", reconcile);
  rig?.destroy();
});
</script>

<template>
  <SituateButton
    variant="plain"
    ref="rootControl"
    type="button"
    class="welcome-scene"
    :class="{ paused }"
    :disabled="reduced"
    :aria-label="label"
    :title="label"
    @click="emit('toggle')"
  >
    <svg viewBox="0 0 600 520" aria-hidden="true" focusable="false">
      <g data-welcome-layer="back" class="ribbon ribbon-back">
        <path
          class="ribbon-body"
          d="M-100 245C50 280 65 35 255 72S435 225 700 34"
        />
        <path
          class="ribbon-highlight"
          d="M-100 217C50 252 65 7 255 44S435 197 700 6"
        />
      </g>
      <g data-welcome-layer="middle" class="ribbon ribbon-middle">
        <path
          class="ribbon-depth"
          d="M-70 444C80 164 168 516 303 474S540 124 680 254"
        />
        <path
          class="ribbon-body"
          d="M-70 430C80 150 168 502 303 460S540 110 680 240"
        />
        <path
          class="ribbon-highlight"
          d="M-70 405C80 125 168 477 303 435S540 85 680 215"
        />
      </g>
      <g data-welcome-layer="book">
        <image
          :href="book"
          x="20"
          y="190"
          width="125"
          height="150"
          transform="rotate(-18 82 265)"
        />
      </g>
      <g data-welcome-layer="page">
        <image
          :href="page"
          x="460"
          y="26"
          width="116"
          height="138"
          transform="rotate(18 518 95)"
        />
      </g>
      <g data-welcome-layer="burst">
        <g transform="translate(126 52) scale(.28)">
          <path
            class="burst"
            d="m100 0 17 51 39-36-11 54 53-3-42 34 42 34-53-3 11 54-39-36-17 51-17-51-39 36 11-54-53 3 42-34L2 66l53 3-11-54 39 36Z"
          />
          <circle class="burst-center" cx="100" cy="100" r="32" />
        </g>
      </g>
      <g data-welcome-layer="bend">
        <g
          ref="actor"
          transform="translate(100 62) scale(1.25)"
          v-html="artwork"
        />
      </g>
      <g data-welcome-layer="front" class="ribbon ribbon-front">
        <path class="ribbon-depth" d="M-90 536C160 331 330 644 680 411" />
        <path class="ribbon-body" d="M-90 520C160 315 330 628 680 395" />
        <path class="ribbon-highlight" d="M-90 496C160 291 330 604 680 371" />
      </g>
      <g data-welcome-layer="leaf">
        <image
          :href="leaf"
          x="470"
          y="327"
          width="90"
          height="114"
          transform="rotate(29 515 384)"
        />
      </g>
      <g data-welcome-layer="card">
        <image
          :href="card"
          x="62"
          y="396"
          width="127"
          height="91"
          transform="rotate(-12 125 441)"
        />
      </g>
    </svg>
    <span v-if="!reduced" class="welcome-playback" aria-hidden="true">{{
      paused ? "▷" : "Ⅱ"
    }}</span>
  </SituateButton>
</template>

<style scoped>
.welcome-scene {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 32px;
  background: var(--situate-ink);
  overflow: hidden;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.welcome-scene:disabled {
  cursor: default;
}
.welcome-scene:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.welcome-scene > svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: hidden;
}
.ribbon {
  fill: none;
}
.ribbon-body {
  stroke-width: 68;
}
.ribbon-depth {
  stroke-width: 72;
}
.ribbon-highlight {
  stroke-width: 4;
}
.ribbon-back .ribbon-body {
  stroke: var(--situate-cobalt);
  stroke-width: 80;
}
.ribbon-back .ribbon-highlight {
  stroke: var(--situate-sky);
  stroke-width: 7;
}
.ribbon-middle .ribbon-body {
  stroke: var(--situate-violet);
}
.ribbon-middle .ribbon-depth {
  stroke: var(--situate-violet-deep);
}
.ribbon-middle .ribbon-highlight {
  stroke: var(--situate-bend-highlight);
}
.ribbon-front .ribbon-body {
  stroke: var(--situate-tangerine);
  stroke-width: 64;
}
.ribbon-front .ribbon-depth {
  stroke: var(--situate-ribbon-depth);
}
.ribbon-front .ribbon-highlight {
  stroke: var(--situate-peach);
}
.burst {
  fill: var(--situate-tangerine);
}
.burst-center {
  fill: var(--situate-lemon);
}
.welcome-playback {
  position: absolute;
  bottom: 18%;
  left: calc(50% - 15px);
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--situate-surface);
  color: var(--situate-ink);
  box-shadow: 0 1px 6px color-mix(in srgb, var(--situate-ink) 12%, transparent);
  opacity: 0;
}
.welcome-scene:hover .welcome-playback,
.welcome-scene:focus-visible .welcome-playback,
.welcome-scene.paused .welcome-playback {
  opacity: 1;
}
@media (max-width: 760px) {
  .welcome-scene {
    max-width: 300px;
    margin-inline: auto;
    border-radius: 23px;
  }
}
</style>
