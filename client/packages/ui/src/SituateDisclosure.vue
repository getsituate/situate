<script setup lang="ts">
import { ref } from "vue";
withDefaults(defineProps<{ label?: string; open?: boolean }>(), {
  open: undefined,
});
const emit = defineEmits<{
  "update:open": [value: boolean];
  toggle: [event: Event];
}>();
const element = ref<HTMLDetailsElement>();
const summary = ref<HTMLElement>();
function toggle(event: Event) {
  emit("update:open", (event.target as HTMLDetailsElement).open);
  emit("toggle", event);
}
defineExpose({
  element,
  focus: (options?: FocusOptions) => summary.value?.focus(options),
});
</script>

<template>
  <details
    ref="element"
    class="situate-disclosure"
    :open="open"
    @toggle="toggle"
  >
    <summary ref="summary">
      <slot name="label">{{ label }}</slot>
    </summary>
    <slot />
  </details>
</template>

<style scoped>
.situate-disclosure > summary {
  min-height: 44px;
  align-content: center;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.situate-disclosure
  > summary:focus:where(html:not([data-input-modality="pointer"]) *):where(
    :focus-visible,
    [data-input-modality="keyboard"] *
  ) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
</style>
