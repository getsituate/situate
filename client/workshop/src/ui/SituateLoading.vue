<script setup lang="ts">
import { ref, watchEffect } from "vue";

defineProps<{
  label: string;
  pending: boolean;
  placement?: "centered" | "inline";
}>();

const mark = ref<SVGSVGElement>();
const animated = ref(false);

watchEffect((onCleanup) => {
  const element = mark.value;
  if (!element || typeof IntersectionObserver === "undefined") return;

  let inView = false;
  const update = () => (animated.value = inView && !document.hidden);
  const observer = new IntersectionObserver(([entry]) => {
    inView = !!entry?.isIntersecting;
    update();
  });
  observer.observe(element);
  document.addEventListener("visibilitychange", update);
  onCleanup(() => {
    observer.disconnect();
    document.removeEventListener("visibilitychange", update);
    animated.value = false;
  });
});
</script>

<template>
  <div
    class="situate-loading"
    :class="{ 'situate-loading--inline': placement === 'inline' }"
    role="status"
    :data-pending="pending || null"
  >
    <template v-if="pending">
      <div class="loading-art" aria-hidden="true">
        <div v-if="placement !== 'inline' && $slots.backdrop">
          <slot name="backdrop" />
        </div>
        <svg
          ref="mark"
          class="loading-symbol"
          :class="{ animated }"
          viewBox="0 0 32 32"
          width="32"
          height="32"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="currentColor"
          stroke-linecap="round"
        >
          <path d="M7 25V13a9 9 0 0 1 18 0v12" stroke-width="7" />
          <g stroke-width="1.6">
            <path class="rest" d="M13 11v3m6-3v3" />
            <path class="look" d="M13 12.5v3m6-3v3" />
            <path class="blink" d="M12 13h2m4 0h2" />
          </g>
        </svg>
      </div>
      <span>{{ label }}</span>
    </template>
  </div>
</template>

<style scoped>
.situate-loading[data-pending] {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  gap: 10px;
  min-width: 0;
  color: var(--situate-muted);
  font-size: var(--situate-text-small);
  line-height: 1.5;
  text-align: center;
  overflow-wrap: anywhere;
}
.loading-art {
  display: grid;
  flex: none;
  place-items: center;
}
.loading-art > * {
  grid-area: 1 / 1;
}
.loading-symbol {
  z-index: 1;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.situate-loading--inline[data-pending] {
  flex-direction: row;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 8px;
  text-align: start;
}
.situate-loading--inline .loading-art {
  margin-block-start: 0.18em;
}
.situate-loading--inline .loading-symbol {
  inline-size: 16px;
  block-size: 16px;
}
.look,
.blink {
  visibility: hidden;
}
@media (prefers-reduced-motion: no-preference) {
  .animated .rest {
    animation: loading-rest 2400ms step-end infinite;
  }
  .animated .look {
    animation: loading-look 2400ms step-end infinite;
  }
  .animated .blink {
    animation: loading-blink 2400ms step-end infinite;
  }
  :global(body:has(:modal) .situate-loading .animated:not(:modal *) path) {
    animation: none;
  }
}
@keyframes loading-rest {
  0%,
  67.5% {
    visibility: visible;
  }
  37.5% {
    visibility: hidden;
  }
}
@keyframes loading-look {
  0%,
  62.5% {
    visibility: hidden;
  }
  37.5% {
    visibility: visible;
  }
}
@keyframes loading-blink {
  0%,
  67.5% {
    visibility: hidden;
  }
  62.5% {
    visibility: visible;
  }
}
</style>
