<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import performance, { type BendRig } from "../bend-performance";
import bendSource from "../../../../../design/brand/bend/svg/rest-welcome.svg?raw";
import folder from "../../../../../design/brand/assets/collection-folder.svg";
import links from "../../../../../design/brand/assets/linked-notes.svg";
import tray from "../../../../../design/brand/assets/paper-tray.svg";
import map from "../../../../../design/brand/assets/folded-map.svg";
import leaf from "../../../../../design/brand/assets/folded-leaf.svg";
import page from "../../../../../design/brand/assets/page.svg";
import type { JourneyFrame } from "./journey";
import type { FinaleFrame } from "./finale/score";
import FinaleEffects from "./finale/FinaleEffects.vue";

const props = defineProps<{ frame: JourneyFrame; finale?: FinaleFrame }>();
const assets = { folder, links, tray, map };
const prefix = `journey-bend-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
const bend = bendSource.replaceAll("bend-rest-welcome", prefix);
const actor = ref<SVGGElement>();
let rig: BendRig | undefined;
onMounted(() => {
  const svg = actor.value?.querySelector("svg");
  if (svg) {
    rig = performance.create(svg);
    rig.set(props.frame.actor.pose);
  }
});
watch(
  () => props.frame.actor.pose,
  (pose) => rig?.set(pose),
  { flush: "post" },
);
onBeforeUnmount(() => rig?.destroy());
</script>

<template>
  <svg
    class="setup-illustration"
    :viewBox="finale ? `0 0 ${finale.width} ${finale.height}` : '0 0 500 470'"
    :style="finale ? { height: '100%' } : undefined"
    aria-hidden="true"
    focusable="false"
    :data-position="frame.position"
    :data-arrival="frame.arrival"
  >
    <defs v-if="finale">
      <clipPath :id="`${prefix}-window`">
        <rect
          :x="finale.clip.x"
          :y="finale.clip.y"
          :width="finale.clip.width"
          :height="finale.clip.height"
        />
      </clipPath>
    </defs>
    <g
      :clip-path="finale ? `url(#${prefix}-window)` : undefined"
      :opacity="finale?.artOpacity"
    >
      <g
        class="journey-world"
        :transform="
          finale
            ? `translate(${finale.camera.x} ${finale.camera.y}) scale(${finale.camera.scale})`
            : undefined
        "
      >
        <g
          :transform="`translate(${frame.backdropX} 0)`"
          class="paper-distance"
        >
          <rect
            v-if="finale"
            x="-3000"
            y="465"
            width="6000"
            height="2500"
            fill="var(--situate-peach)"
          />
          <path
            d="M-140 336C-36 274-12 118 90 128S229 255 327 210 416 76 551 98 669 217 782 225 885 107 1035 138 1173 293 1320 218 1422 145 1600 210V465H-140Z"
            fill="var(--situate-lilac)"
          />
          <path
            d="M-90 379C91 325 105 264 219 302S361 366 485 323 608 248 754 318 916 370 1076 310 1304 270 1550 330V470H-90Z"
            fill="var(--situate-peach)"
          />
          <path
            d="M50 159C44 79 147 60 161 142M820 140C821 81 913 52 932 132"
            fill="none"
            stroke="var(--situate-lemon)"
            stroke-width="25"
          />
          <path
            d="M1067 163V90Q1067 67 1090 67H1225Q1248 67 1248 90V191"
            fill="none"
            stroke="var(--situate-surface)"
            stroke-width="16"
          />
        </g>
        <g class="ribbon-canopy" fill="none" stroke-linecap="round">
          <path
            :d="frame.rail"
            transform="translate(0 8)"
            stroke="var(--situate-cobalt)"
            stroke-width="43"
          />
          <path :d="frame.rail" stroke="var(--situate-sky)" stroke-width="43" />
          <path
            :d="frame.rail"
            transform="translate(0 -13)"
            stroke="var(--situate-surface)"
            stroke-opacity="0.5"
            stroke-width="2"
          />
        </g>
        <g class="garden-posts" fill="var(--situate-violet-deep)">
          <g
            v-for="(post, i) in frame.posts"
            :key="i"
            :transform="`translate(${post.x} ${post.y})`"
          >
            <path d="M-5-131H5V0H-5Z" />
            <path d="M-22-4Q0-14 22-4L24 1H-24Z" />
            <path d="M-67-135H67V-123H-67Z" fill="var(--situate-peach)" />
          </g>
        </g>
        <g class="paper-landmarks">
          <g
            v-for="object in frame.objects"
            :key="object.id"
            :data-paper="object.id"
            :transform="`translate(${object.x} ${object.y}) rotate(${object.rotation})`"
          >
            <image
              :href="assets[object.id]"
              :x="-object.size / 2"
              :width="object.size"
              :height="object.height"
            />
          </g>
        </g>
        <g
          class="passing-page"
          :transform="`translate(${frame.leaf.x} ${frame.leaf.y}) rotate(${frame.leaf.rotation})`"
        >
          <image :href="page" x="-23" y="-26" width="46" height="54" />
        </g>
        <g
          class="workplace"
          :transform="`translate(${frame.desk.x} ${frame.desk.y})`"
        >
          <path
            d="M-48-95L-55-6H-42L-28-95M64-95L80-4H93L82-95"
            fill="var(--situate-violet-deep)"
          />
          <path
            d="M-54-102L-62-10H-49L-35-102M58-102L74-8H87L76-102"
            fill="var(--situate-tangerine)"
          />
          <path
            d="M-97-115H86L103-97Q106-90 95-88H-84L-102-105Q-107-114-97-115Z"
            fill="var(--situate-violet-deep)"
          />
          <path d="M-102-122H81L99-105H-84Z" fill="var(--situate-peach)" />
          <path d="M-102-122H81L90-114H-93Z" fill="var(--situate-surface)" />
          <g
            :transform="`translate(${frame.desk.noteX} ${frame.desk.noteY}) rotate(${frame.desk.noteRotation})`"
            class="desk-note"
            :opacity="finale ? 1 - finale.sheet.paperMix : undefined"
          >
            <path
              :d="finale?.sheet.path ?? 'M0 0H48L56 17H7Z'"
              :transform="finale ? 'translate(2 3)' : undefined"
              fill="#ad9284"
            />
            <path
              :d="finale?.sheet.path ?? 'M-2-3H46L54 14H5Z'"
              fill="#fff7e3"
            />
            <path
              v-if="finale"
              :d="finale.sheet.path"
              fill="var(--situate-paper)"
              :opacity="finale.sheet.paperMix"
            />
            <path
              :opacity="finale?.sheet.linesOpacity"
              d="M10 2H33M14 7H29"
              stroke="#ad9284"
              stroke-width="2"
              stroke-linecap="round"
            />
          </g>
          <image
            :href="folder"
            x="34"
            y="-204"
            width="80"
            height="66"
            transform="rotate(4 74 -172)"
          />
          <path
            d="M109-194H117V-106H109ZM41-140H119V-133H41Z"
            fill="var(--situate-violet-deep)"
          />
          <path
            d="M116-73Q129-68 141-73L137-38H120Z"
            fill="var(--situate-cobalt)"
          />
          <image
            :href="leaf"
            x="106"
            y="-127"
            width="39"
            height="64"
            transform="rotate(-13 126 -70)"
          />
          <image
            :href="leaf"
            x="126"
            y="-110"
            width="30"
            height="47"
            transform="rotate(27 133 -69)"
          />
        </g>
        <g class="walking-ribbon" fill="none" stroke-linecap="round">
          <path
            :d="frame.road"
            stroke="#da592f"
            stroke-width="70"
            transform="translate(0 9)"
          />
          <path
            :d="frame.road"
            stroke="var(--situate-tangerine)"
            stroke-width="70"
          />
          <path
            :d="frame.road"
            stroke="var(--situate-peach)"
            stroke-width="2.5"
            transform="translate(0 -24)"
          />
        </g>
        <g fill="var(--situate-peach)">
          <path
            v-for="(fold, i) in frame.folds"
            :key="i"
            :d="`M${fold.x} ${fold.y}l25 -9 -12 22Z`"
          />
        </g>
        <g class="garden-plants">
          <g
            v-for="(plant, i) in frame.plants"
            :key="i"
            :transform="`translate(${plant.x} ${plant.y}) scale(${plant.size})`"
          >
            <path d="M-17-10H20L17 10H-12Z" fill="var(--situate-violet-deep)" />
            <image
              :href="leaf"
              x="-25"
              y="-106"
              width="59"
              height="100"
              :transform="`rotate(${plant.tilt} 0 0)`"
            />
            <image
              :href="leaf"
              x="-9"
              y="-70"
              width="43"
              height="68"
              transform="rotate(33 0 0)"
            />
          </g>
        </g>
        <g class="opening-paper" aria-hidden="true">
          <path
            v-for="bit in frame.paperBits"
            :key="bit.id"
            d="M-3-5H4L2 5H-5Z"
            :fill="bit.color"
            :opacity="bit.opacity"
            :transform="`translate(${bit.x} ${bit.y}) rotate(${bit.rotation})`"
          />
        </g>
        <ellipse
          class="contact-shadow"
          :cx="frame.shadow.x"
          :cy="frame.shadow.y"
          :rx="frame.shadow.rx"
          :ry="frame.shadow.ry"
          fill="#da592f"
          opacity="0.22"
        />
        <g
          :transform="`translate(${frame.actor.x} ${frame.actor.y}) scale(${frame.actor.scale})`"
        >
          <g ref="actor" class="actor bend-companion" v-html="bend" />
        </g>
        <FinaleEffects v-if="finale" :frame="finale" />
        <g
          v-if="finale && finale.sheet.paperMix > 0"
          class="paper-portal"
          :opacity="finale.sheet.paperMix"
          :transform="`translate(${frame.desk.x + frame.desk.noteX} ${frame.desk.y + frame.desk.noteY}) rotate(${frame.desk.noteRotation})`"
        >
          <path
            :d="finale.sheet.path"
            transform="translate(2 3)"
            fill="#ad9284"
          />
          <path :d="finale.sheet.path" fill="#fff7e3" />
          <path
            :d="finale.sheet.path"
            fill="var(--situate-paper)"
            :opacity="finale.sheet.paperMix"
          />
          <path
            d="M10 2H33M14 7H29"
            fill="none"
            stroke="#ad9284"
            stroke-width="2"
            stroke-linecap="round"
            :opacity="finale.sheet.linesOpacity"
          />
        </g>
      </g>
    </g>
  </svg>
</template>
<style scoped>
.setup-illustration {
  display: block;
  width: 100%;
  height: auto;
  overflow: hidden;
  pointer-events: none;
  isolation: isolate;
}
.actor :deep(svg) {
  overflow: visible;
}
</style>
