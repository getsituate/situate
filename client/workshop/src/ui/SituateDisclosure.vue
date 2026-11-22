<script setup lang="ts">
import { ref } from "vue";
import SituateIcon from "./SituateIcon.vue";
withDefaults(
  defineProps<{ label?: string; open?: boolean; customIndicator?: boolean }>(),
  { open: undefined },
);
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
    <summary ref="summary" :class="{ 'with-chevron': !customIndicator }">
      <SituateIcon
        v-if="!customIndicator"
        name="chevron"
        class="disclosure-chevron"
      />
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
.with-chevron {
  list-style: none;
  border-radius: var(--situate-radius-small);
}
.with-chevron::-webkit-details-marker {
  display: none;
}
.disclosure-chevron {
  display: inline-block;
  width: 1em;
  height: 1em;
  margin-inline: 0.3em 0.35em;
  vertical-align: -0.15em;
  rotate: -90deg;
}
.disclosure-chevron:dir(rtl) {
  rotate: 90deg;
}
.situate-disclosure[open] > summary > .disclosure-chevron {
  rotate: 0deg;
}
@media (prefers-reduced-motion: no-preference) {
  .disclosure-chevron {
    transition: rotate var(--situate-duration-feedback)
      var(--situate-ease-settle);
  }
}
.situate-disclosure > summary:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
</style>
