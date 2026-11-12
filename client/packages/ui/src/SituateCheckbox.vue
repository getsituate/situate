<script setup lang="ts">
import { ref } from "vue";
defineOptions({ inheritAttrs: false });
withDefaults(
  defineProps<{
    modelValue?: boolean;
    appearance?: "default" | "plain";
  }>(),
  { modelValue: undefined, appearance: "default" },
);
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const element = ref<HTMLInputElement>();
function change(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).checked);
}
defineExpose({
  element,
  focus: (options?: FocusOptions) => element.value?.focus(options),
});
</script>

<template>
  <input
    ref="element"
    type="checkbox"
    v-bind="{
      ...$attrs,
      ...(modelValue === undefined ? {} : { checked: modelValue }),
    }"
    :class="appearance === 'plain' ? undefined : 'situate-choice'"
    @change="change"
  />
</template>

<style scoped>
.situate-choice {
  accent-color: var(--situate-violet-deep);
}
.situate-choice:where(
  :focus:where(html:not([data-input-modality="pointer"]) *):where(
      :focus-visible,
      [data-input-modality="keyboard"] *
    )
) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
</style>
