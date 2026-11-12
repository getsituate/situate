import { onBeforeUnmount, shallowRef, watch } from "vue";
import { cloneEditorState, type EditorState } from "./model";

export function useEditorState(
  props: { state: EditorState },
  emit: (event: "update:state", state: EditorState) => void,
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
  function update(change: (next: EditorState) => void): void {
    if (!active) return;
    const next = cloneEditorState(state.value);
    change(next);
    if (JSON.stringify(next) === JSON.stringify(state.value)) return;
    state.value = next;
    emit("update:state", next);
  }
  return { state, update };
}
