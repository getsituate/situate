import { shallowRef, watch } from "vue";
import type { NavigationState } from "./model";

export function useNavigationState(
  source: () => NavigationState,
  emit: (state: NavigationState) => void,
) {
  const state = shallowRef(source());
  watch(
    source,
    (value) => {
      state.value = value;
    },
    { flush: "sync" },
  );
  function update(value: NavigationState) {
    state.value = value;
    emit(value);
  }
  return { state, update };
}
