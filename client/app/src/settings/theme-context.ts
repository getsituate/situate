import type { InjectionKey, Ref } from "vue";
import type { ThemeVariables } from "./theme-tokens";

export const protectedThemeStyle: InjectionKey<
  Readonly<Ref<ThemeVariables | undefined>>
> = Symbol("protectedThemeStyle");
