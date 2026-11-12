<script setup lang="ts">
import { computed, ref, useAttrs } from "vue";
import SituateIcon from "./SituateIcon.vue";
import SituateTooltip from "./SituateTooltip.vue";
import type { IconName } from "./icons";

defineOptions({ inheritAttrs: false });
const attrs = useAttrs();
const element = ref<HTMLButtonElement>();
const tooltipDescription = ref<string>();
const props = withDefaults(
  defineProps<{
    icon?: IconName;
    label: string;
    title?: string;
    disabled?: boolean;
    unavailableReason?: string;
    variant?: "quiet" | "primary" | "plain";
  }>(),
  {
    disabled: false,
    variant: "quiet",
  },
);
const tooltip = computed(() =>
  props.disabled
    ? props.unavailableReason || props.label
    : props.title || props.label,
);
function buttonAttrs(description?: string) {
  return {
    ...attrs,
    "aria-describedby":
      [attrs["aria-describedby"], description].filter(Boolean).join(" ") ||
      undefined,
  };
}
defineExpose({
  element,
  focus: (options?: FocusOptions) => element.value?.focus(options),
});
</script>

<template>
  <button
    ref="element"
    v-bind="buttonAttrs(tooltipDescription)"
    type="button"
    :class="
      variant === 'plain'
        ? undefined
        : ['situate-icon-button', { primary: variant === 'primary' }]
    "
    :disabled="disabled"
    :aria-label="label"
    :aria-description="
      disabled
        ? unavailableReason
        : typeof attrs['aria-description'] === 'string'
          ? attrs['aria-description']
          : undefined
    "
  >
    <slot><SituateIcon v-if="icon" :name="icon" /></slot>
    <SituateTooltip
      :text="tooltip"
      :anchor="element"
      @describe="tooltipDescription = $event"
    />
  </button>
</template>

<style scoped>
.situate-icon-button {
  display: inline-grid;
  place-items: center;
  width: var(--situate-target-min);
  height: var(--situate-target-min);
  flex: 0 0 var(--situate-target-min);
  padding: var(--situate-space-3);
  border: 0;
  border-radius: var(--situate-radius-control);
  background: transparent;
  color: var(--situate-muted);
  cursor: pointer;
}
.situate-icon-button.primary {
  border-radius: var(--situate-radius-pill);
  background: var(--situate-ink);
  color: var(--situate-surface);
}
.situate-icon-button:disabled {
  cursor: default;
}
.situate-icon-button:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@media (hover: hover) {
  .situate-icon-button:hover:not(:disabled) {
    background: var(--situate-accent-soft, var(--situate-lilac));
    color: var(--situate-ink);
  }
}
</style>
