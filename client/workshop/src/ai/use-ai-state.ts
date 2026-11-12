import { onBeforeUnmount, shallowRef, watch } from "vue";
import { cloneAiState, type AiState } from "./model";
export function useAiState(
  props: { state: AiState },
  emit: (event: "update:state", state: AiState) => void,
) {
  const state = shallowRef(props.state);
  let active = true;
  onBeforeUnmount(() => {
    active = false;
  });
  watch(
    () => props.state,
    (value) => {
      state.value = value;
    },
    { flush: "sync" },
  );
  function update(change: (next: AiState) => void) {
    if (!active) return;
    const next = cloneAiState(state.value);
    change(next);
    if (JSON.stringify(next) === JSON.stringify(state.value)) return;
    state.value = next;
    emit("update:state", next);
  }
  return { state, update };
}
