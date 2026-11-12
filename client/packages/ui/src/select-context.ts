import type { InjectionKey, Ref } from "vue";

export const selectEnvironment: InjectionKey<{
  mobile: Readonly<Ref<boolean>>;
  popupTarget?: Readonly<Ref<HTMLElement | undefined>>;
}> = Symbol("select-environment");
