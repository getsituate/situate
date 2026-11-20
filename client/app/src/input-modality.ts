export function installInputModality(document: Document): () => void {
  const root = document.documentElement;
  root.dataset.inputModality = "pointer";
  function pointer() {
    root.dataset.inputModality = "pointer";
  }
  function keyboard(event: KeyboardEvent) {
    if (event.isComposing) return;
    switch (event.key) {
      case "Shift":
      case "Control":
      case "Alt":
      case "Meta":
      case "CapsLock":
        return;
      default:
        root.dataset.inputModality = "keyboard";
    }
  }
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    delete root.dataset.inputModality;
  };
}
