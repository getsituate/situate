import { afterEach, beforeEach, expect, it } from "vitest";
import { installInputModality } from "./input-modality";

let dispose: () => void;
beforeEach(() => {
  dispose = installInputModality(document);
});
afterEach(() => {
  dispose();
  document.body.replaceChildren();
});

it("keeps programmatic focus without enabling keyboard decoration", () => {
  const button = document.createElement("button");
  document.body.append(button);
  button.focus();
  expect(document.activeElement).toBe(button);
  expect(document.documentElement.dataset.inputModality).toBe("pointer");
});

it.each(["Tab", "ArrowDown", "Home", "Enter", "Escape", "a"])(
  "enables keyboard decoration on %s before controls handle the event",
  (key) => {
    const button = document.createElement("button");
    document.body.append(button);
    let modality: string | undefined;
    button.addEventListener("keydown", (event) => {
      event.stopPropagation();
      modality = document.documentElement.dataset.inputModality;
    });
    button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(modality).toBe("keyboard");
  },
);

it("supports Shift+Tab and shortcuts without treating modifier keys as navigation", () => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
  expect(document.documentElement.dataset.inputModality).toBe("pointer");
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }),
  );
  expect(document.documentElement.dataset.inputModality).toBe("keyboard");
});

it.each(["mouse", "touch", "pen"])(
  "disables keyboard decoration on %s without removing focus",
  (pointerType) => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    button.dispatchEvent(
      new PointerEvent("pointerdown", { pointerType, bubbles: true }),
    );
    expect(document.documentElement.dataset.inputModality).toBe("pointer");
    expect(document.activeElement).toBe(button);
  },
);

it("does not change modality during text composition", () => {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Process", isComposing: true }),
  );
  expect(document.documentElement.dataset.inputModality).toBe("pointer");
});

it("removes its listeners and document state when disposed", () => {
  dispose();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  document.dispatchEvent(new Event("pointerdown"));
  expect(document.documentElement.hasAttribute("data-input-modality")).toBe(
    false,
  );
});
