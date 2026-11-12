<script setup lang="ts">
import { SituateIcon, SituateButton } from "../ui";
import copy from "../localization/en.import-result.json";
withDefaults(
  defineProps<{
    label: string;
    scope: string;
    page: number;
    last: number;
    depth?: number;
  }>(),
  { depth: 0 },
);
const emit = defineEmits<{ change: [page: number] }>();
</script>
<template>
  <div
    class="page-controls"
    role="group"
    :aria-label="scope"
    :style="{ marginInlineStart: `${8 + Math.min(depth, 4) * 12}px` }"
  >
    <span class="page-range" role="status">{{ label }}</span>
    <div class="page-actions">
      <SituateButton
        variant="plain"
        type="button"
        :aria-label="copy.previousPage"
        :title="copy.previousPage"
        :disabled="page === 0"
        @click="emit('change', page - 1)"
      >
        <SituateIcon name="chevron" class="previous-arrow" />
      </SituateButton>
      <SituateButton
        variant="plain"
        type="button"
        :aria-label="copy.nextPage"
        :title="copy.nextPage"
        :disabled="page === last"
        @click="emit('change', page + 1)"
      >
        <SituateIcon name="chevron" class="next-arrow" />
      </SituateButton>
    </div>
  </div>
</template>
<style scoped>
.page-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
  margin-block: 4px 12px;
  padding-block: 4px;
  border-top: 1px solid var(--situate-line);
}
.page-range {
  min-width: 0;
  color: var(--situate-muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.page-actions {
  display: flex;
}
button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--situate-radius-small);
  background: transparent;
  color: var(--situate-ink);
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
button:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.previous-arrow,
.next-arrow {
  width: 18px;
  height: 18px;
}
.previous-arrow {
  transform: rotate(90deg);
}
.next-arrow {
  transform: rotate(-90deg);
}
:dir(rtl) .previous-arrow {
  transform: rotate(-90deg);
}
:dir(rtl) .next-arrow {
  transform: rotate(90deg);
}
</style>
