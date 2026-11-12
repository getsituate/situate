<script setup lang="ts">
import { ref } from "vue";
import SituateTooltip from "./SituateTooltip.vue";
defineOptions({ inheritAttrs: false });
withDefaults(
  defineProps<{
    title?: string;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    variant?: "primary" | "secondary" | "ghost" | "danger" | "plain";
    size?: "normal" | "small";
    busy?: boolean;
  }>(),
  {
    type: "button",
    disabled: false,
    variant: "primary",
    size: "normal",
    busy: false,
  },
);
const element = ref<HTMLButtonElement>();
const tooltipDescription = ref<string>();
defineExpose({
  element,
  focus: (options?: FocusOptions) => element.value?.focus(options),
});
</script>

<template>
  <button
    ref="element"
    v-bind="{
      ...$attrs,
      'aria-description': $attrs['aria-description'] ?? title,
      'aria-describedby':
        [$attrs['aria-describedby'], tooltipDescription]
          .filter(Boolean)
          .join(' ') || undefined,
    }"
    :class="
      variant === 'plain'
        ? undefined
        : [
            'situate-button',
            `situate-button--${variant}`,
            `situate-button--${size}`,
          ]
    "
    :type="type"
    :disabled="disabled || busy"
    :aria-busy="busy || undefined"
  >
    <slot />
    <SituateTooltip
      v-if="title"
      :text="title"
      :anchor="element"
      @describe="tooltipDescription = $event"
    />
  </button>
</template>

<style scoped>
.situate-button {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  min-height: 50px;
  padding: var(--situate-space-3) var(--situate-space-6);
  border: var(--situate-stroke-divider) solid
    var(--situate-accent-edge, transparent);
  border-radius: var(--situate-radius-pill);
  background: var(--situate-accent, var(--situate-ink));
  color: var(--situate-accent-on, var(--situate-surface));
  font: inherit;
  font-size: var(--situate-text-small);
  font-weight: var(--situate-weight-emphasis);
  cursor: pointer;
}
.situate-button--secondary {
  background: var(--situate-surface);
  color: var(--situate-ink);
  border-color: var(--situate-control-line);
}
.situate-button--danger {
  background: var(--situate-ink);
  color: var(--situate-surface);
  border-color: var(--situate-ink);
}
.situate-button--small {
  min-height: var(--situate-target-min);
  padding: 10px 20px;
  font-size: var(--situate-text-caption);
  font-weight: 600;
}
.situate-button--ghost {
  min-width: var(--situate-target-min);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--situate-space-2);
  padding: var(--situate-space-2) var(--situate-space-3);
  border: 0;
  border-radius: var(--situate-radius-small);
  background: transparent;
  color: var(--situate-muted);
  font-weight: 500;
}
.situate-button--normal:where(
  :hover:not(:disabled):not(.situate-button--ghost)
) {
  background: var(--situate-accent-strong, var(--situate-violet-deep));
  color: var(--situate-surface);
}
.situate-button--ghost:where(:hover:not(:disabled)) {
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-ink);
}
.situate-button:where(
  :focus:where(html:not([data-input-modality="pointer"]) *):where(
      :focus-visible,
      [data-input-modality="keyboard"] *
    )
) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
.situate-button:where(:disabled) {
  cursor: default;
}
.situate-button--normal:where(:disabled) {
  background: var(--situate-muted);
  color: var(--situate-surface);
  border-color: transparent;
}
</style>
