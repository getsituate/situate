import { ref, vModelText, type ObjectDirective } from "vue";

export interface TextControlProps {
  modelValue?: string | number;
  modelModifiers?: { trim?: boolean; lazy?: boolean; number?: boolean };
  appearance?: "default" | "plain";
}

export function useTextControl<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(
  props: TextControlProps,
  emit: (event: "update:modelValue", value: string | number) => void,
) {
  const element = ref<T>();
  const nativeTextModel = vModelText as ObjectDirective<
    T,
    string | number | undefined
  >;
  // Keep Vue's composition, focused-draft and normalization rules. An absent
  // model leaves native value attributes and form reset behavior in control.
  const textModel: ObjectDirective<T, string | number | undefined> = {
    created(el, binding, vnode, previous) {
      nativeTextModel.created?.(
        el,
        { ...binding, modifiers: props.modelModifiers ?? {} },
        vnode,
        previous,
      );
    },
    mounted(el, binding, vnode, previous) {
      if (binding.value !== undefined)
        nativeTextModel.mounted?.(
          el,
          { ...binding, modifiers: props.modelModifiers ?? {} },
          vnode,
          previous,
        );
    },
    beforeUpdate(el, binding, vnode, previous) {
      if (binding.value !== undefined)
        nativeTextModel.beforeUpdate?.(
          el,
          { ...binding, modifiers: props.modelModifiers ?? {} },
          vnode,
          previous,
        );
    },
  };
  return {
    element,
    textModel,
    update: (value: string | number) => emit("update:modelValue", value),
    focus: (options?: FocusOptions) => element.value?.focus(options),
    select: () => element.value?.select(),
    setSelectionRange: (
      start: number | null,
      end: number | null,
      direction?: "forward" | "backward" | "none",
    ) => element.value?.setSelectionRange(start, end, direction),
  };
}
