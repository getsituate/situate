<script setup lang="ts">
import { ref } from "vue";
import SituateTooltip from "./SituateTooltip.vue";
import { t } from "@situate/localization";
import SituateIcon from "./SituateIcon.vue";
import type { IconName } from "./icons";

defineOptions({ inheritAttrs: false });
const element = ref<HTMLButtonElement>();
const tooltipDescription = ref<string>();
defineExpose({
  element,
  focus: (options?: FocusOptions) => element.value?.focus(options),
});
withDefaults(
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
    unavailableReason: undefined,
    variant: "quiet",
  },
);
</script>

<template>
  <button
    ref="element"
    type="button"
    v-bind="{
      ...$attrs,
      'aria-describedby':
        [$attrs['aria-describedby'], tooltipDescription]
          .filter(Boolean)
          .join(' ') || undefined,
    }"
    :class="
      variant === 'plain'
        ? undefined
        : ['situate-icon-button', { primary: variant === 'primary' }]
    "
    :disabled="disabled"
    :aria-label="label"
    :aria-description="
      $attrs['aria-description'] ??
      (disabled
        ? (unavailableReason ?? t('control.thisActionIsUnavailable'))
        : undefined)
    "
  >
    <slot><SituateIcon v-if="icon" :name="icon" /></slot>
    <SituateTooltip
      :text="
        disabled
          ? (unavailableReason ?? t('control.thisActionIsUnavailable'))
          : (title ?? label)
      "
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
  box-shadow: inset 0 0 0 var(--situate-stroke-divider)
    var(--situate-accent-edge, transparent);
  background: var(--situate-accent, var(--situate-ink));
  color: var(--situate-accent-on, var(--situate-surface));
}
.situate-icon-button:disabled {
  cursor: default;
}
.situate-icon-button:focus:where(
    html:not([data-input-modality="pointer"]) *
  ):where(:focus-visible, [data-input-modality="keyboard"] *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
@media (hover: hover) {
  .situate-icon-button:hover:not(:disabled) {
    background: var(--situate-accent-soft, var(--situate-lilac));
    color: var(--situate-ink);
  }
}
</style>
