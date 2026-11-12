import "./ui/popover-test-environment";
import { createRequire } from "node:module";
import { beforeEach, vi } from "vitest";
import { initialFormats, setPreferences } from "@situate/localization";

beforeEach(() => {
  Reflect.set(
    globalThis,
    "SituateBendMini",
    createRequire(import.meta.url)("../../../design/brand/bend/mini/mini.js"),
  );
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  Element.prototype.scrollIntoView = vi.fn();
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", true);
  setPreferences({ language: "en", formats: initialFormats("en") });
});
