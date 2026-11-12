<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { celebrationFrame } from "./score";

const props = defineProps<{ timeMs: number }>();
const root = ref<SVGSVGElement>();
const size = ref({ width: 0, height: 0 });
const pieces = computed(() =>
  celebrationFrame(props.timeMs, size.value.width, size.value.height),
);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry)
      size.value = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
  });
  observer.observe(root.value!);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <svg
    ref="root"
    class="callback-celebration"
    :viewBox="`0 0 ${size.width || 1} ${size.height || 1}`"
    :data-time="Math.round(timeMs)"
    aria-hidden="true"
    focusable="false"
  >
    <g
      v-for="piece in pieces"
      :key="piece.id"
      class="celebration-piece"
      :data-shape="piece.shape"
      :transform="`translate(${piece.x} ${piece.y}) rotate(${piece.rotation}) scale(${piece.scaleX} ${piece.scaleY})`"
      :opacity="piece.opacity"
      :fill="`var(--situate-${piece.color})`"
    >
      <path
        v-if="piece.shape === 'sparkle'"
        d="M0-12C2-3 3-2 12 0C3 2 2 3 0 12C-2 3-3 2-12 0C-3-2-2-3 0-12Z"
        :transform="`scale(${piece.width / 24})`"
      />
      <path
        v-else-if="piece.shape === 'ribbon'"
        :d="`M${-piece.width / 2} ${-piece.height / 2}Q${piece.width * 1.4} 0 ${-piece.width / 2} ${piece.height / 2}H${piece.width / 2}Q${piece.width * 2.4} 0 ${piece.width / 2} ${-piece.height / 2}Z`"
      />
      <rect
        v-else
        :x="-piece.width / 2"
        :y="-piece.height / 2"
        :width="piece.width"
        :height="piece.height"
        rx="1"
      />
    </g>
  </svg>
</template>

<style scoped>
.callback-celebration {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .callback-celebration {
    visibility: hidden;
  }
}
</style>
