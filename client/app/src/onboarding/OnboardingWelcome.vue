<script setup lang="ts">
import "@situate/localization/onboarding";
import { SituateButton } from "@situate/ui";
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import rest from "../../../../design/brand/bend/svg/rest-welcome.svg?raw";
import wordmark from "../../../../design/brand/assets/wordmark.svg";
import performance, { type BendRig } from "./bend-performance";
import { t } from "@situate/localization";
import { durationMs, frameAt } from "./welcome-timeline";

const props = defineProps<{ paused: boolean; timeMs?: number }>();
const emit = defineEmits<{ toggle: []; finished: [] }>();
const c = computed(() => ({
  label: t("onboarding.welcome.label"),
  title: t("onboarding.welcome.title"),
  closing: t("onboarding.welcome.closing"),
  detail: t("onboarding.welcome.detail"),
  pause: t("onboarding.welcome.pause"),
  resume: t("onboarding.welcome.resume"),
  skip: t("onboarding.welcome.skip"),
}));
const root = ref<HTMLElement>();
const actor = ref<SVGGElement>();
const elapsed = ref(0);
const reduced = ref(false);
const width = ref(1280);
const height = ref(900);
const frame = computed(() =>
  frameAt(props.timeMs ?? (reduced.value ? durationMs : elapsed.value)),
);
const compact = computed(() => width.value < 700);
const scale = computed(() =>
  compact.value
    ? Math.min(width.value / 580, Math.max(0.3, (height.value - 230) / 510))
    : Math.min(width.value / 1280, height.value / 880, 1.2),
);
const stageY = computed(() => height.value * (compact.value ? 0.59 : 0.57));
const sceneTransform = computed(
  () =>
    `translate(${width.value / 2} ${stageY.value}) scale(${scale.value * frame.value.camera}) translate(0 ${frame.value.collectionY})`,
);
const id = `astra-${useId().replace(/[^a-z0-9-]/gi, "")}`;
const artwork = rest.replaceAll("bend-rest-welcome", id);
const logoStyle = computed(() => {
  const p = frame.value.logo;
  const startWidth = compact.value ? 105 : 126;
  const endWidth = compact.value ? 184 : 244;
  const w = startWidth + (endWidth - startWidth) * p;
  const startX = compact.value ? (width.value - startWidth) / 2 : 24;
  const x = startX + (width.value / 2 - w / 2 - startX) * p;
  const y = 27 + (height.value * (compact.value ? 0.155 : 0.15) - 27) * p;
  return { width: `${w}px`, transform: `translate(${x}px, ${y}px)` };
});
const bookPosition = computed(() => (compact.value ? [-151, 163] : [-340, 68]));
const cardPosition = computed(() => (compact.value ? [167, 185] : [340, 128]));
const documentPosition = computed(() =>
  compact.value ? [192, -83] : [310, -145],
);
function objectTransform(
  x: number,
  y: number,
  progress: number,
  angle: number,
) {
  return `translate(${x} ${y + (1 - progress) * 210}) rotate(${angle + (1 - progress) * 36}) scale(${0.6 + progress * 0.4})`;
}

let rig: BendRig | undefined;
let preference: MediaQueryList | undefined;
let intersection: IntersectionObserver | undefined;
let resize: ResizeObserver | undefined;
let raf: number | undefined;
let last: number | undefined;
let visible = false;
let alive = false;
let finished = false;
function stop() {
  if (raf !== undefined) cancelAnimationFrame(raf);
  raf = undefined;
  last = undefined;
}
function finish() {
  if (finished) return;
  finished = true;
  stop();
  emit("finished");
}
function tick(now: number) {
  raf = undefined;
  if (!alive || finished) return;
  if (last !== undefined)
    elapsed.value = Math.min(
      durationMs,
      elapsed.value + Math.max(0, now - last),
    );
  last = now;
  if (elapsed.value >= durationMs) finish();
  else raf = requestAnimationFrame(tick);
}
function reconcile() {
  if (!alive) return;
  reduced.value = preference?.matches ?? false;
  if (props.timeMs !== undefined) {
    stop();
    return;
  }
  if (reduced.value) {
    stop();
    elapsed.value = durationMs;
    finish();
    return;
  }
  if (
    finished ||
    props.paused ||
    !visible ||
    document.visibilityState !== "visible"
  )
    stop();
  else if (raf === undefined) raf = requestAnimationFrame(tick);
}
watch(frame, (value) => rig?.set(value.actor), { flush: "post" });
watch(() => [props.paused, props.timeMs], reconcile);
onMounted(() => {
  alive = true;
  rig = performance.create(actor.value!.querySelector("svg")!);
  rig.set(frame.value.actor);
  const measure = () => {
    const rect = root.value!.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      width.value = rect.width;
      height.value = rect.height;
    }
  };
  measure();
  if (typeof ResizeObserver !== "undefined") {
    resize = new ResizeObserver(measure);
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
  reconcile();
});
onBeforeUnmount(() => {
  alive = false;
  stop();
  resize?.disconnect();
  intersection?.disconnect();
  preference?.removeEventListener("change", reconcile);
  document.removeEventListener("visibilitychange", reconcile);
  rig?.destroy();
});
</script>

<template>
  <section
    ref="root"
    class="unfolding-place"
    :class="{ compact }"
    :aria-label="c.label"
    :data-time="Math.round(frame.time)"
  >
    <h1 class="sr-only">{{ c.label }}</h1>
    <p class="sr-only">{{ c.detail }}</p>
    <svg
      class="world"
      :viewBox="`0 0 ${width} ${height}`"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <path
          :id="`${id}-route`"
          pathLength="1"
          d="M-1100 315C-650 340-560 75-360 107S-48 340 241 210 540-22 1100 80"
        />
      </defs>
      <g :transform="sceneTransform">
        <g
          :transform="`translate(0 ${frame.ribbonExit * 300})`"
          :opacity="1 - frame.ribbonExit"
        >
          <use
            :href="`#${id}-route`"
            class="route route-depth"
            stroke-dasharray="1 1"
            :stroke-dashoffset="1 - frame.ribbon"
            transform="translate(0 12)"
          />
          <use
            :href="`#${id}-route`"
            class="route"
            stroke-dasharray="1 1"
            :stroke-dashoffset="1 - frame.ribbon"
          />
          <use
            :href="`#${id}-route`"
            class="route route-edge"
            stroke-dasharray="1 1"
            :stroke-dashoffset="1 - frame.ribbon"
            transform="translate(0 -24)"
          />
        </g>

        <g
          :transform="`translate(${-frame.wingTravel} 0) rotate(${-frame.wingRotate} -180 300)`"
          class="fold-left"
        >
          <path
            class="cobalt"
            d="M-1500-850H-235Q-168-850-160-680L-143 320Q-510 242-1500 830Z"
          />
          <path
            class="sky"
            d="M-1500-850H-257Q-190-850-185-680L-168 295Q-520 210-1500 780Z"
          />
          <path
            class="lilac"
            d="M-1500-700Q-810-590-185-680L-168 295Q-630 275-1500 780Z"
          />
          <path
            class="surface"
            d="M-1500-700Q-820-520-198-650L-183 266Q-650 260-1500 750Z"
          />
          <path class="fold-line" d="M-216-580-205 240" />
        </g>
        <g
          :transform="`translate(${frame.wingTravel} 0) rotate(${frame.wingRotate} 180 300)`"
          class="fold-right"
        >
          <path
            class="ribbon-depth"
            d="M1500-850H238Q168-850 160-680L143 320Q510 242 1500 830Z"
          />
          <path
            class="tangerine"
            d="M1500-850H260Q190-850 185-680L168 295Q520 210 1500 780Z"
          />
          <path
            class="peach"
            d="M1500-700Q810-590 185-680L168 295Q630 275 1500 780Z"
          />
          <path
            class="note"
            d="M1500-700Q820-520 198-650L183 266Q650 260 1500 750Z"
          />
          <path class="fold-line" d="M216-580 205 240" />
        </g>

        <g
          :transform="
            objectTransform(
              documentPosition[0]!,
              documentPosition[1]!,
              frame.document,
              12,
            )
          "
          :opacity="frame.document"
          data-object="document"
        >
          <path
            class="peach"
            d="M-64-86H26L72-42V99H-64Q-76 99-76 87V-74Q-76-86-64-86Z"
          />
          <path
            class="surface"
            d="M-73-95H20L63-52V88H-73Q-85 88-85 76V-83Q-85-95-73-95Z"
          />
          <path class="note" d="M20-95V-51H63Z" />
          <path
            class="paper-marks"
            d="M-57-37H-10M-57-15H31M-57 7H22M-57 29H3"
          />
          <path class="violet" d="M-57 53H-16V63H-57Z" />
        </g>

        <g
          :transform="`${objectTransform(bookPosition[0]!, bookPosition[1]!, frame.book, -12)} scale(${compact ? 0.82 : 1})`"
          :opacity="frame.book"
          data-object="book"
        >
          <path
            class="ink"
            d="M-120-63Q-68-78 0-45 72-74 120-57V88Q57 71 0 102-65 73-120 88Z"
          />
          <path class="tangerine" d="M-123-72Q-56-87 0-56V91Q-55 61-123 77Z" />
          <path class="note" d="M-113-67Q-58-79-4-52V78Q-55 52-113 66Z" />
          <g :transform="`scale(${0.035 + frame.bookOpen * 0.965} 1)`">
            <path class="peach" d="M0-56Q55-89 123-72V77Q55 60 0 91Z" />
            <path class="surface" d="M4-52Q58-79 113-67V66Q57 52 4 78Z" />
            <path
              class="paper-marks"
              d="M26-26Q58-37 91-35M26-3Q57-14 91-13M26 20Q58 9 76 12"
            />
          </g>
          <path
            class="paper-marks"
            d="M-91-35Q-63-37-27-26M-91-12Q-63-14-27-3M-91 11Q-68 10-42 17"
          />
          <path class="cobalt" d="M-9-51H3V109L-5 101-13 111Z" />
        </g>

        <ellipse class="lilac" cx="7" cy="162" rx="126" ry="16" />
        <g
          ref="actor"
          :transform="`translate(-248 -270) scale(1.55)`"
          data-actor
          v-html="artwork"
        />

        <g
          :transform="`${objectTransform(cardPosition[0]!, cardPosition[1]!, frame.card, 9)} scale(${compact ? 0.82 : 1})`"
          :opacity="frame.card"
          data-object="card"
        >
          <rect
            class="cobalt"
            x="-96"
            y="-58"
            width="200"
            height="140"
            rx="17"
          />
          <rect class="sky" x="-104" y="-68" width="200" height="140" rx="17" />
          <rect class="surface" x="-82" y="-42" width="44" height="44" rx="9" />
          <path class="check" d="m-71-21 10 10 15-20" />
          <path class="card-marks" d="M-19-24H67M-19-3H44M-80 33H67" />
        </g>

        <g
          :transform="`translate(${compact ? -180 : -505} ${compact ? -98 : -106}) rotate(${-28 + 16 * frame.leaf}) scale(${frame.leaf * 0.85})`"
          data-object="leaf"
        >
          <path class="lemon" d="M0 64Q-81-12 14-91 67-3 0 64Z" />
          <path class="peach" d="M0 64 14-91Q67-3 0 64Z" />
          <path class="leaf-crease" d="M0 64 14-91" />
        </g>
        <g
          :transform="`translate(${-700 * (1 - frame.foreground)} ${130 * (1 - frame.foreground)})`"
          :opacity="frame.foreground"
        >
          <path
            class="foreground-depth"
            d="M-1300 502C-805 310-422 391-110 352S572 350 1300 583"
          />
          <path
            class="foreground"
            d="M-1300 487C-805 295-422 376-110 337S572 335 1300 568"
          />
          <path
            class="foreground-edge"
            d="M-1300 463C-805 271-422 352-110 313S572 311 1300 544"
          />
        </g>
      </g>
    </svg>
    <div
      class="intro-title"
      aria-hidden="true"
      :style="{
        opacity: frame.title,
        transform: `translateY(${frame.titleY}px)`,
      }"
    >
      <p>{{ c.title }}</p>
    </div>
    <img
      class="wordmark"
      :src="wordmark"
      alt=""
      aria-hidden="true"
      :style="logoStyle"
    />
    <div
      class="closing-title"
      aria-hidden="true"
      :style="{
        opacity: frame.finalTitle,
        transform: `translateY(${12 * (1 - frame.finalTitle)}px)`,
      }"
    >
      <p>{{ c.closing }}</p>
      <span>{{ c.detail }}</span>
    </div>
    <div class="playback">
      <SituateButton
        variant="plain"
        type="button"
        :aria-pressed="paused"
        @click="emit('toggle')"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path v-if="paused" d="m7 4 9 6-9 6Z" />
          <path v-else d="M6 4h3v12H6Zm6 0h3v12h-3Z" />
        </svg>
        <span>{{ paused ? c.resume : c.pause }}</span>
      </SituateButton>
      <SituateButton variant="plain" type="button" class="skip" @click="finish">
        {{ c.skip }}<span aria-hidden="true">↗</span>
      </SituateButton>
    </div>
  </section>
</template>

<style scoped>
.unfolding-place {
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--situate-paper);
  color: var(--situate-ink);
  font-family: var(--situate-font-body);
}
.world {
  display: block;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.wordmark {
  position: absolute;
  left: 0;
  top: 0;
  height: auto;
  z-index: 2;
}
.intro-title {
  position: absolute;
  top: 14%;
  left: 12%;
  right: 12%;
  text-align: center;
  pointer-events: none;
}
.intro-title p {
  margin: 0;
  font-family: var(--situate-font-display);
  font-size: clamp(40px, 5.3vw, 76px);
  font-weight: 650;
  line-height: 1.04;
  letter-spacing: -0.055em;
  white-space: pre-line;
}
.closing-title {
  position: absolute;
  top: 25%;
  left: 12%;
  right: 12%;
  text-align: center;
  pointer-events: none;
}
.closing-title p {
  margin: 0 0 14px;
  font-size: clamp(26px, 3.2vw, 44px);
  line-height: 1.12;
  letter-spacing: -0.045em;
  font-weight: 600;
}
.closing-title span {
  display: block;
  font-size: 16px;
  line-height: 1.6;
  white-space: pre-line;
  color: var(--situate-muted);
}
.playback {
  position: absolute;
  z-index: 5;
  top: 20px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.playback button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--situate-control-line);
  border-radius: 99px;
  color: var(--situate-ink);
  background: var(--situate-paper);
  font: 500 13px var(--situate-font-body);
  cursor: pointer;
}
.playback button:hover {
  background: var(--situate-surface);
}
.playback button:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.playback svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}
.skip span {
  font-size: 18px;
  line-height: 1;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.ink {
  fill: var(--situate-ink);
}
.cobalt {
  fill: var(--situate-cobalt);
}
.sky {
  fill: var(--situate-sky);
}
.lilac {
  fill: var(--situate-lilac);
}
.surface {
  fill: var(--situate-surface);
}
.tangerine {
  fill: var(--situate-tangerine);
}
.peach {
  fill: var(--situate-peach);
}
.note {
  fill: var(--situate-note);
}
.violet {
  fill: var(--situate-violet);
}
.lemon {
  fill: var(--situate-lemon);
}
.ribbon-depth {
  fill: var(--situate-ribbon-depth);
}
.fold-line {
  fill: none;
  stroke: var(--situate-book-line);
  stroke-width: 2;
  opacity: 0.35;
}
.route {
  fill: none;
  stroke: var(--situate-violet);
  stroke-width: 66;
  stroke-linecap: butt;
}
.route-depth {
  stroke: var(--situate-violet-deep);
  stroke-width: 70;
}
.route-edge {
  stroke: var(--situate-bend-highlight);
  stroke-width: 3;
}
.paper-marks {
  fill: none;
  stroke: var(--situate-book-line);
  stroke-width: 4;
  stroke-linecap: round;
}
.check {
  fill: none;
  stroke: var(--situate-violet-deep);
  stroke-width: 5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.card-marks {
  fill: none;
  stroke: var(--situate-ink);
  stroke-width: 5;
  stroke-linecap: round;
  opacity: 0.6;
}
.leaf-crease {
  fill: none;
  stroke: var(--situate-ink);
  stroke-width: 2;
  opacity: 0.16;
}
.foreground,
.foreground-depth,
.foreground-edge {
  fill: none;
  stroke-width: 62;
  stroke: var(--situate-tangerine);
}
.foreground-depth {
  stroke: var(--situate-ribbon-depth);
}
.foreground-edge {
  stroke: var(--situate-peach);
  stroke-width: 4;
}
.compact .playback {
  top: auto;
  bottom: 20px;
  right: 16px;
  left: 16px;
  justify-content: space-between;
}
.compact .intro-title {
  top: 16%;
  left: 20px;
  right: 20px;
}
.compact .intro-title p {
  font-size: clamp(36px, 9.8vw, 54px);
}
.compact .closing-title {
  top: 26%;
  left: 16px;
  right: 16px;
}
.compact .closing-title p {
  font-size: 26px;
}
.compact .closing-title span {
  font-size: 14px;
}
@media (max-height: 620px) {
  .compact .intro-title {
    top: 15%;
  }
  .compact .closing-title {
    top: 27%;
  }
  .compact .closing-title p {
    font-size: 22px;
    margin-bottom: 8px;
  }
  .compact .closing-title span {
    font-size: 12px;
  }
  .compact .playback {
    bottom: 14px;
  }
}
</style>
