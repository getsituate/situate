export function installInputModality(document: Document): () => void {
  const root = document.documentElement;
  root.dataset.inputModality = "pointer";
  function pointer() {
    root.dataset.inputModality = "pointer";
  }
  function keyboard(event: KeyboardEvent) {
    if (
      !event.isComposing &&
      !["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)
    )
      root.dataset.inputModality = "keyboard";
  }
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    delete root.dataset.inputModality;
  };
}
