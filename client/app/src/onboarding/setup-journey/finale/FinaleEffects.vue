<script setup lang="ts">
import type { FinaleFrame } from "./score";
defineProps<{ frame: FinaleFrame }>();
</script>
<template>
  <g class="finale-fireworks" aria-hidden="true">
    <g
      v-for="rocket in frame.rockets"
      :key="rocket.id"
      :opacity="rocket.opacity"
    >
      <path
        :d="rocket.trail"
        fill="none"
        :stroke="
          rocket.id ? 'var(--situate-violet)' : 'var(--situate-tangerine)'
        "
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray="1 11"
        opacity=".7"
      />
      <g
        class="paper-rocket"
        :transform="`translate(${rocket.x} ${rocket.y}) rotate(${rocket.rotation})`"
      >
        <path d="M0-30 14 13 0 5-14 13Z" fill="var(--situate-surface)" />
        <path
          d="M0-30 0 5 14 13Z"
          :fill="
            rocket.id ? 'var(--situate-violet)' : 'var(--situate-tangerine)'
          "
        />
        <path d="M-4 9 0 24 4 9" fill="var(--situate-lemon)" />
        <path
          d="M0-23V2"
          fill="none"
          stroke="var(--situate-ink)"
          stroke-opacity=".24"
          stroke-width="1.5"
        />
      </g>
    </g>
    <g class="finale-confetti">
      <path
        v-for="bit in frame.confetti"
        :key="bit.id"
        :d="bit.ribbon ? 'M-3-9Q5-3 0 3T2 12' : 'M-3-5H4L2 5H-5Z'"
        :fill="bit.ribbon ? 'none' : bit.color"
        :stroke="bit.ribbon ? bit.color : 'none'"
        stroke-width="3"
        :opacity="bit.opacity"
        :transform="`translate(${bit.x} ${bit.y}) rotate(${bit.rotation})`"
      />
    </g>
  </g>
</template>
