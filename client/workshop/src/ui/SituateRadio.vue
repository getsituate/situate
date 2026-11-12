<script setup lang="ts">
import { ref } from "vue";
defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    value?: string | number;
    appearance?: "default" | "plain";
  }>(),
  { value: "on", appearance: "default" },
);
const emit = defineEmits<{ "update:modelValue": [value: string | number] }>();
const element = ref<HTMLInputElement>();
function change(event: Event) {
  if ((event.target as HTMLInputElement).checked)
    emit("update:modelValue", props.value);
}
defineExpose({
  element,
  focus: (options?: FocusOptions) => element.value?.focus(options),
});
</script>

<template>
  <input
    ref="element"
    type="radio"
    :value="value"
    v-bind="{
      ...$attrs,
      ...(modelValue === undefined ? {} : { checked: modelValue === value }),
    }"
    :class="appearance === 'plain' ? undefined : 'situate-choice'"
    @change="change"
  />
</template>

<style scoped>
.situate-choice {
  accent-color: var(--situate-violet-deep);
}
.situate-choice:where(:focus-visible) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
</style>
