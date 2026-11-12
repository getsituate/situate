<script setup lang="ts">
import { useTextControl, type TextControlProps } from "./text-control";
defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<TextControlProps>(), {
  appearance: "default",
});
const emit = defineEmits<{ "update:modelValue": [value: string | number] }>();
const {
  element,
  focus,
  select,
  setSelectionRange,
  textModel: vTextModel,
  update,
} = useTextControl<HTMLTextAreaElement>(props, emit);
defineExpose({ element, focus, select, setSelectionRange });
</script>

<template>
  <textarea
    ref="element"
    v-bind="$attrs"
    v-text-model="modelValue"
    :onUpdate:modelValue="update"
    :class="appearance === 'plain' ? undefined : 'situate-text-control'"
  />
</template>

<style src="./text-control.css"></style>
