<script setup lang="ts">
import { useId } from "vue";
import bendSource from "../../../../design/brand/bend/svg/rest-welcome.svg?raw";
import folder from "../../../../design/brand/assets/collection-folder.svg";
import links from "../../../../design/brand/assets/linked-notes.svg";
import leaf from "../../../../design/brand/assets/folded-leaf.svg";
import page from "../../../../design/brand/assets/page.svg";
const prefix = `setup-bend-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
const bend = bendSource.replaceAll("bend-rest-welcome", prefix);
</script>
<template>
  <svg
    class="setup-illustration"
    viewBox="0 0 500 470"
    aria-hidden="true"
    focusable="false"
  >
    <g class="paper-distance">
      <path
        d="M-140 336C-36 274-12 118 90 128S229 255 327 210 416 76 551 98 669 217 782 225 885 107 1035 138 1173 293 1320 218 1422 145 1600 210V465H-140Z"
        fill="var(--situate-lilac)"
      />
      <path
        d="M-90 379C91 325 105 264 219 302S361 366 485 323 608 248 754 318 916 370 1076 310 1304 270 1550 330V470H-90Z"
        fill="var(--situate-peach)"
      />
      <path
        d="M50 159C44 79 147 60 161 142"
        fill="none"
        stroke="var(--situate-lemon)"
        stroke-width="25"
      />
    </g>
    <g class="ribbon-canopy" fill="none" stroke-linecap="round">
      <path
        d="M-100 137C30 190 100 270 230 231S415 105 600 119"
        transform="translate(0 8)"
        stroke="var(--situate-cobalt)"
        stroke-width="43"
      />
      <path
        d="M-100 137C30 190 100 270 230 231S415 105 600 119"
        stroke="var(--situate-sky)"
        stroke-width="43"
      />
      <path
        d="M-100 137C30 190 100 270 230 231S415 105 600 119"
        transform="translate(0 -13)"
        stroke="var(--situate-surface)"
        stroke-opacity=".5"
        stroke-width="2"
      />
    </g>
    <g transform="translate(445 365)" fill="var(--situate-violet-deep)">
      <path d="M-5-131H5V0H-5Z" />
      <path d="M-22-4Q0-14 22-4L24 1H-24Z" />
      <path d="M-67-135H67V-123H-67Z" fill="var(--situate-peach)" />
    </g>
    <image
      :href="folder"
      x="275"
      y="237"
      width="156"
      height="128"
      transform="rotate(-5 353 300)"
    />
    <image
      :href="links"
      x="381"
      y="155"
      width="128"
      height="102"
      transform="rotate(3 445 206)"
    />
    <image
      :href="page"
      x="37"
      y="46"
      width="46"
      height="54"
      transform="rotate(-15 60 72)"
    />
    <g class="walking-ribbon" fill="none" stroke-linecap="round">
      <path
        d="M-100 395C80 403 260 413 600 392"
        stroke="var(--situate-ribbon-depth)"
        stroke-width="70"
        transform="translate(0 9)"
      />
      <path
        d="M-100 395C80 403 260 413 600 392"
        stroke="var(--situate-tangerine)"
        stroke-width="70"
      />
      <path
        d="M-100 395C80 403 260 413 600 392"
        stroke="var(--situate-peach)"
        stroke-width="2.5"
        transform="translate(0 -24)"
      />
    </g>
    <g transform="translate(30 367) scale(.85)">
      <path d="M-17-10H20L17 10H-12Z" fill="var(--situate-violet-deep)" />
      <image
        :href="leaf"
        x="-25"
        y="-106"
        width="59"
        height="100"
        transform="rotate(-12)"
      />
      <image
        :href="leaf"
        x="-9"
        y="-70"
        width="43"
        height="68"
        transform="rotate(33)"
      />
    </g>
    <ellipse
      cx="189"
      cy="374"
      rx="65"
      ry="7"
      fill="var(--situate-ribbon-depth)"
      opacity=".22"
    />
    <g transform="translate(41 123) scale(.9)">
      <g class="actor" v-html="bend" />
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
