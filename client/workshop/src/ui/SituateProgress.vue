<script setup lang="ts">
import { computed } from "vue";
const props = withDefaults(
  defineProps<{
    label: string;
    value?: number | null;
    max?: number;
    estimate?: number;
  }>(),
  { max: 100 },
);
const maximum = computed(() =>
  Number.isFinite(props.max) && props.max > 0 ? props.max : 100,
);
const measured = computed(
  () => typeof props.value === "number" && Number.isFinite(props.value),
);
const value = computed(() =>
  Math.max(0, Math.min(maximum.value, props.value ?? 0)),
);
const fraction = computed(() =>
  measured.value
    ? value.value / maximum.value
    : Number.isFinite(props.estimate)
      ? Math.max(0, Math.min(0.95, props.estimate!))
      : 0.25,
);
</script>

<template>
  <div
    class="situate-progress"
    role="progressbar"
    :aria-label="label"
    :aria-valuemin="measured ? 0 : undefined"
    :aria-valuemax="measured ? maximum : undefined"
    :aria-valuenow="measured ? value : undefined"
    :data-indeterminate="!measured || undefined"
  >
    <span
      class="situate-progress-fill"
      :style="{ transform: `scaleX(${fraction})` }"
    />
  </div>
</template>

<style scoped>
.situate-progress {
  display: block;
  width: 100%;
  height: 6px;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: var(--situate-radius-pill);
  background: var(--situate-line);
}
.situate-progress-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--situate-accent-strong, var(--situate-violet-deep));
  transform-origin: left center;
}
@media (forced-colors: active) {
  .situate-progress {
    background: Canvas;
    border: 1px solid CanvasText;
  }
  .situate-progress-fill {
    background: Highlight;
    forced-color-adjust: none;
  }
}
</style>
