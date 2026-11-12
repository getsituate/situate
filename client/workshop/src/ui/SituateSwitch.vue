<script setup lang="ts">
import { ref } from "vue";
defineOptions({ inheritAttrs: false });
withDefaults(defineProps<{ modelValue?: boolean }>(), {
  modelValue: undefined,
});
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const element = ref<HTMLInputElement>();
defineExpose({
  element,
  focus: (options?: FocusOptions) => element.value?.focus(options),
});
</script>

<template>
  <input
    ref="element"
    v-bind="{
      ...$attrs,
      ...(modelValue === undefined ? {} : { checked: modelValue }),
    }"
    type="checkbox"
    role="switch"
    class="situate-switch"
    @change="
      emit('update:modelValue', ($event.target as HTMLInputElement).checked)
    "
  />
</template>

<style scoped>
.situate-switch {
  appearance: none;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  margin: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  position: relative;
}
.situate-switch::after {
  content: "";
  position: absolute;
  inset: 8px 0;
  border: 1px solid var(--situate-control-line);
  border-radius: 20px;
  background: var(--situate-paper);
}
.situate-switch::before {
  content: "";
  position: absolute;
  z-index: 1;
  top: 12px;
  left: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--situate-muted);
}
.situate-switch:checked::after {
  background: var(--situate-accent-strong, var(--situate-violet-deep));
  border-color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.situate-switch:checked::before {
  left: 20px;
  background: var(--situate-surface);
}
.situate-switch:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.situate-switch:disabled {
  opacity: 0.55;
  cursor: default;
}
@media (forced-colors: active) {
  .situate-switch {
    appearance: auto;
  }
  .situate-switch::before,
  .situate-switch::after {
    content: none;
  }
}
</style>
