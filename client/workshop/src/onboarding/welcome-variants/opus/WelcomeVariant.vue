<script setup lang="ts">
import { SituateButton } from "../../../ui";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
  watch,
} from "vue";
import rest from "../../../brand/bend/svg/rest-welcome.svg?raw";
import wordmarkSource from "../../../brand/assets/wordmark.svg?raw";
import book from "../../../brand/assets/book.svg";
import page from "../../../brand/assets/page.svg";
import leaf from "../../../brand/assets/folded-leaf.svg";
import card from "../../../brand/assets/card.svg";
import performance, { type BendRig } from "../../../brand/bend/performance";
import { welcomeCopy as copy } from "./content";
import {
  durationMs,
  objectArt,
  stillMs,
  welcomeFrame,
  wordProgress,
  type Viewport,
} from "./timeline";

const props = defineProps<{ paused: boolean; timeMs?: number }>();
const emit = defineEmits<{ toggle: []; finished: [] }>();

const prefix = `opus-welcome-${useId().replace(/[^a-z0-9-]/gi, "")}`;
// The surrounding stage is decorative; drop the export's title so it does not appear as a tooltip.
const artwork = rest
  .replaceAll("bend-rest-welcome", prefix)
  .replace(/<title[^>]*>[^<]*<\/title>/, "")
  .replace(' role="img"', "")
  .replace(/ aria-labelledby="[^"]*"/, ' aria-hidden="true"');
const wordmarkStrokes = (
  /<g[^>]*>\s*<path d="([^"]+)"/.exec(wordmarkSource)?.[1] ?? ""
)
  .split(/(?=M)/)
  .filter(Boolean);
const wordmarkAccent =
  /<path d="([^"]+)" fill="#ff874d"/.exec(wordmarkSource)?.[1] ?? "";
const images = { book, page, leaf, card };
const words = {
  hello: copy.hello.split(" "),
  gather: copy.gather.split(" "),
  tagline: copy.tagline.split(" "),
};

const root = ref<HTMLElement>();
const actor = ref<SVGGElement>();
const size = shallowRef<Viewport>({ width: 1280, height: 800 });
const elapsed = ref(0);
const reduced = ref(false);
const scrubbing = computed(() => props.timeMs !== undefined);
const time = computed(() => props.timeMs ?? elapsed.value);
const frame = computed(() => welcomeFrame(time.value, size.value));
const l = computed(() => frame.value.layout);

let rig: BendRig | undefined;
let lastPose = "";
let preference: MediaQueryList | undefined;
let intersection: IntersectionObserver | undefined;
let resize: ResizeObserver | undefined;
let modal: MutationObserver | undefined;
let visible = false;
let alive = false;
let done = false;
let raf: number | undefined;
let last: number | undefined;

function pose() {
  const next = frame.value.bend.pose;
  const key = JSON.stringify(next);
  if (rig && key !== lastPose) {
    rig.set(next);
    lastPose = key;
  }
}
watch(frame, pose);

function stop() {
  if (raf !== undefined) cancelAnimationFrame(raf);
  raf = undefined;
  last = undefined;
}
function finish() {
  if (done) return;
  done = true;
  stop();
  emit("finished");
}
function tick(now: number) {
  raf = undefined;
  if (!alive) return;
  if (last !== undefined)
    elapsed.value = Math.min(
      durationMs,
      elapsed.value + Math.min(100, Math.max(0, now - last)),
    );
  last = now;
  if (elapsed.value >= durationMs) {
    finish();
    return;
  }
  raf = requestAnimationFrame(tick);
}
function reconcile() {
  if (!alive) return;
  reduced.value = preference?.matches ?? false;
  if (scrubbing.value || done) {
    stop();
    return;
  }
  if (reduced.value) {
    stop();
    elapsed.value = stillMs;
    finish();
    return;
  }
  const covered = document.querySelector('dialog[open], [aria-modal="true"]');
  if (
    !visible ||
    props.paused ||
    document.visibilityState !== "visible" ||
    covered
  )
    stop();
  else if (raf === undefined) raf = requestAnimationFrame(tick);
}
watch(() => [props.paused, props.timeMs], reconcile);

function measure(width: number, height: number) {
  if (width <= 0 || height <= 0) return;
  if (width === size.value.width && height === size.value.height) return;
  size.value = { width, height };
}
onMounted(() => {
  alive = true;
  const svg = actor.value?.querySelector("svg");
  if (svg) rig = performance.create(svg);
  pose();
  const box = root.value!.getBoundingClientRect();
  measure(box.width, box.height);
  if (typeof ResizeObserver !== "undefined") {
    resize = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) measure(rect.width, rect.height);
    });
    resize.observe(root.value!);
  }
  preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  preference?.addEventListener("change", reconcile);
  document.addEventListener("visibilitychange", reconcile);
  if (typeof IntersectionObserver !== "undefined") {
    intersection = new IntersectionObserver((entries) => {
      const entry = entries.find((item) => item.target === root.value);
      if (!entry) return;
      visible = entry.isIntersecting;
      reconcile();
    });
    intersection.observe(root.value!);
  } else visible = true;
  modal = new MutationObserver(reconcile);
  modal.observe(document.body, {
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
  intersection?.disconnect();
  resize?.disconnect();
  modal?.disconnect();
  preference?.removeEventListener("change", reconcile);
  document.removeEventListener("visibilitychange", reconcile);
  rig?.destroy();
  rig = undefined;
});

const textStyle = computed(() => {
  const text = l.value.text;
  return {
    left: `${text.left}px`,
    top: `${text.top}px`,
    width: `${text.width}px`,
    textAlign: text.align,
  };
});
const taglineStyle = computed(() => ({
  ...textStyle.value,
  top: `${l.value.taglineTop}px`,
}));
function captionStyle(exit: number) {
  return {
    opacity: String(1 - exit),
    transform: `translateY(${-exit * 14}px)`,
  };
}
function wordStyle(reveal: number, index: number, count: number) {
  const p = wordProgress(reveal, index, count);
  return { transform: `translateY(${(1 - p) * 112}%)` };
}
</script>

<template>
  <section
    ref="root"
    class="opus-welcome"
    :class="[`tone-${frame.tone}`, { portrait: l.portrait }]"
    :aria-label="copy.region"
  >
    <svg
      class="stage"
      :viewBox="`0 0 ${l.w} ${l.h}`"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect class="ink" :width="l.w" :height="l.h" />
      <g v-if="frame.worldVisible">
        <g
          v-for="name in ['back', 'middle', 'front'] as const"
          :key="name"
          :class="['ribbon', `ribbon-${name}`]"
          :transform="frame.ribbons[name].transform"
          :visibility="frame.ribbons[name].visible ? 'visible' : 'hidden'"
          :stroke-dashoffset="frame.ribbons[name].draw"
        >
          <path
            v-if="name !== 'back'"
            class="ribbon-depth"
            :d="frame.paths[name]"
            pathLength="1"
            :stroke-width="frame.ribbonWidth * 1.06"
            :transform="`translate(0 ${frame.ribbonWidth * 0.1})`"
          />
          <path
            class="ribbon-body"
            :d="frame.paths[name]"
            pathLength="1"
            :stroke-width="frame.ribbonWidth * (name === 'back' ? 1.2 : 1)"
          />
          <path
            class="ribbon-highlight"
            :d="frame.paths[name]"
            pathLength="1"
            :stroke-width="Math.max(2.5, frame.ribbonWidth * 0.06)"
            :transform="`translate(0 ${-frame.ribbonWidth * (name === 'back' ? 0.44 : 0.36)})`"
          />
        </g>
        <g
          :transform="frame.burst.transform"
          :visibility="frame.burst.visible ? 'visible' : 'hidden'"
        >
          <path
            class="burst"
            d="m100 0 17 51 39-36-11 54 53-3-42 34 42 34-53-3 11 54-39-36-17 51-17-51-39 36 11-54-53 3 42-34L2 66l53 3-11-54 39 36Z"
          />
          <circle class="burst-center" cx="100" cy="100" r="32" />
        </g>
        <g :transform="frame.objectsTransform">
          <g
            v-for="(item, name) in frame.objects"
            :key="name"
            :transform="item.transform"
            :visibility="item.visible ? 'visible' : 'hidden'"
            :data-keepsake="name"
          >
            <g v-if="name === 'open'" class="open-book">
              <path
                class="open-rear"
                d="M6 40Q100 8 194 40l4 96q-98-26-196 0Z"
              />
              <path class="open-page" d="M14 30q44-20 86 2v96q-42-20-88-4Z" />
              <path
                class="open-page"
                d="M100 32q42-22 86-2l2 94q-46-16-88 4Z"
              />
              <path
                class="open-line"
                d="M100 32v96M30 52q28-10 56 0M30 70q28-10 56 0M30 88q20-7 38-2M114 52q28-10 56 0M114 70q28-10 56 0"
              />
              <path class="open-mark" d="m140 108 12-3 1 34-7-7-6 8Z" />
            </g>
            <image
              v-else
              :href="images[name]"
              :width="objectArt[name].width"
              :height="objectArt[name].height"
            />
          </g>
        </g>
      </g>
      <g class="sheet">
        <path class="sheet-laid" :d="frame.page.laid" />
        <path class="sheet-shadow" :d="frame.page.shadow" />
        <path class="sheet-flap" :d="frame.page.flap" />
        <path class="sheet-edge" :d="frame.page.edge" />
      </g>
      <g :transform="frame.bend.transform">
        <g ref="actor" v-html="artwork" />
      </g>
      <g
        class="wordmark"
        :transform="frame.wordmark.transform"
        :visibility="frame.wordmark.visible ? 'visible' : 'hidden'"
      >
        <path
          v-for="(stroke, index) in wordmarkStrokes"
          :key="index"
          :d="stroke"
          pathLength="1"
          :stroke-dashoffset="1 - (frame.wordmark.strokes[index] ?? 0)"
          :visibility="
            (frame.wordmark.strokes[index] ?? 0) > 0 ? 'visible' : 'hidden'
          "
        />
        <path
          class="wordmark-accent"
          :d="wordmarkAccent"
          :transform="frame.wordmark.accent.transform"
          :opacity="frame.wordmark.accent.opacity"
          :visibility="frame.wordmark.accent.visible ? 'visible' : 'hidden'"
        />
      </g>
    </svg>

    <div class="captions" aria-hidden="true">
      <p
        v-for="name in ['hello', 'gather'] as const"
        v-show="frame.captions[name].visible"
        :key="name"
        :class="['caption', `caption-${name}`, `anchor-${l.text.anchor}`]"
        :style="[textStyle, captionStyle(frame.captions[name].exit)]"
      >
        <span
          v-for="(word, index) in words[name]"
          :key="index"
          class="word-mask"
          ><span
            class="word"
            :style="
              wordStyle(frame.captions[name].reveal, index, words[name].length)
            "
            >{{ word }}</span
          ></span
        >
      </p>
      <p
        v-show="frame.captions.tagline.visible"
        class="tagline"
        :style="[taglineStyle, captionStyle(frame.captions.tagline.exit)]"
      >
        <span
          v-for="(word, index) in words.tagline"
          :key="index"
          class="word-mask"
          ><span
            class="word"
            :style="
              wordStyle(
                frame.captions.tagline.reveal,
                index,
                words.tagline.length,
              )
            "
            >{{ word }}</span
          ></span
        >
      </p>
    </div>
    <p class="visually-hidden">{{ copy.description }}</p>

    <div class="controls" :style="{ opacity: frame.controls }">
      <SituateButton
        variant="plain"
        v-if="!reduced"
        type="button"
        @click="emit('toggle')"
      >
        {{ paused ? copy.resume : copy.pause }}
      </SituateButton>
      <SituateButton variant="plain" type="button" class="skip" @click="finish">
        {{ copy.skip }}
      </SituateButton>
    </div>
  </section>
</template>

<style scoped>
.opus-welcome {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--situate-ink);
  color: var(--situate-surface);
  isolation: isolate;
}
.opus-welcome.tone-paper {
  background: var(--situate-paper);
}
.stage {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
.ink {
  fill: var(--situate-ink);
}
.ribbon {
  fill: none;
  stroke-linecap: round;
  stroke-dasharray: 1 1;
}
.ribbon-back .ribbon-body {
  stroke: var(--situate-cobalt);
}
.ribbon-back .ribbon-highlight {
  stroke: var(--situate-sky);
}
.ribbon-middle .ribbon-depth {
  stroke: var(--situate-violet-deep);
}
.ribbon-middle .ribbon-body {
  stroke: var(--situate-violet);
}
.ribbon-middle .ribbon-highlight {
  stroke: var(--situate-bend-highlight);
}
.ribbon-front .ribbon-depth {
  stroke: var(--situate-ribbon-depth);
}
.ribbon-front .ribbon-body {
  stroke: var(--situate-tangerine);
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
.open-rear {
  fill: var(--situate-plum);
}
.open-page {
  fill: var(--situate-note);
}
.open-line {
  fill: none;
  stroke: var(--situate-book-line);
  stroke-width: 3;
  stroke-linecap: round;
}
.open-mark {
  fill: var(--situate-tangerine);
}
.sheet-laid {
  fill: var(--situate-paper);
}
.sheet-shadow {
  fill: color-mix(in srgb, var(--situate-paper) 86%, var(--situate-ink));
}
.sheet-flap {
  fill: var(--situate-note);
}
.sheet-edge {
  fill: var(--situate-peach);
}
.wordmark {
  fill: none;
  stroke: var(--situate-ink);
  stroke-width: 5.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1 1;
}
.wordmark-accent {
  fill: var(--situate-tangerine);
  stroke: none;
}
.captions {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.caption,
.tagline {
  position: absolute;
  margin: 0;
  font-family: var(--situate-font-display);
  text-wrap: balance;
}
.caption {
  font-size: clamp(30px, 3.7vw, 58px);
  font-weight: var(--situate-weight-display);
  line-height: 1.08;
  letter-spacing: -0.045em;
  color: var(--situate-surface);
}
.caption-gather {
  font-size: clamp(26px, 2.9vw, 44px);
}
.caption.anchor-middle {
  translate: 0 -50%;
}
.tagline {
  font-size: clamp(18px, 1.9vw, 27px);
  font-weight: 500;
  line-height: 1.35;
  letter-spacing: -0.015em;
  color: var(--situate-ink);
}
.word-mask {
  display: inline-block;
  overflow: hidden;
  vertical-align: top;
  padding-block: 0.06em 0.12em;
  margin-block: -0.06em -0.12em;
  margin-inline-end: 0.26em;
}
.word-mask:last-child {
  margin-inline-end: 0;
}
.word {
  display: inline-block;
}
.portrait .caption {
  font-size: clamp(25px, 7.6vw, 36px);
}
.portrait .caption-gather {
  font-size: clamp(20px, 6.2vw, 30px);
}
.portrait .tagline {
  font-size: clamp(16px, 4.6vw, 19px);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.controls {
  position: absolute;
  z-index: 2;
  top: calc(var(--app-safe-area-top, env(safe-area-inset-top, 0px)) + 16px);
  right: calc(
    var(--app-safe-area-right, env(safe-area-inset-right, 0px)) + 16px
  );
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.controls button {
  min-width: 44px;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-pill);
  background: var(--situate-surface);
  color: var(--situate-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition: background-color var(--situate-duration-feedback) ease-out;
}
.controls button:hover {
  background: var(--situate-lilac);
}
.controls button:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
  box-shadow: inset 0 0 0 6px var(--situate-surface);
}
@media (max-width: 600px) {
  .controls {
    top: auto;
    bottom: calc(
      var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px)) + 12px
    );
    right: calc(
      var(--app-safe-area-right, env(safe-area-inset-right, 0px)) + 12px
    );
  }
  .controls button {
    padding: 10px 14px;
    font-size: 13px;
  }
}
</style>
