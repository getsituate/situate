<script setup lang="ts">
import { ref } from "vue";
defineProps<{ removeLabel: string; disabled?: boolean }>();
const emit = defineEmits<{ remove: [event: MouseEvent] }>();
const element = ref<HTMLButtonElement>();
defineExpose({
  element,
  focus: (options?: FocusOptions) => element.value?.focus(options),
});
</script>

<template>
  <button
    ref="element"
    type="button"
    class="situate-filter-chip"
    :disabled="disabled"
    :aria-label="removeLabel"
    @click="emit('remove', $event)"
  >
    <slot /><span aria-hidden="true">×</span>
  </button>
</template>

<style scoped>
.situate-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 44px;
  min-height: 44px;
  max-width: 100%;
  padding: 6px 12px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-pill);
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-ink);
  font: inherit;
  text-align: start;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.situate-filter-chip > span {
  flex-shrink: 0;
}
.situate-filter-chip:hover:not(:disabled) {
  border-color: var(--situate-ink);
}
.situate-filter-chip:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.situate-filter-chip:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
