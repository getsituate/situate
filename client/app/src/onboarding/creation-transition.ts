import type { InjectionKey, Ref } from "vue";
import type { SetupTransitionFrame } from "./setup-transition";

export const creationTransition: InjectionKey<{
  frame: Readonly<Ref<SetupTransitionFrame | undefined>>;
  restoreFocus: Ref<boolean>;
  finish: () => void;
}> = Symbol("creation-transition");
