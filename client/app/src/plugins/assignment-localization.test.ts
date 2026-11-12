import { afterEach, expect, it, vi } from "vitest";
import {
  en,
  de,
  isMessageKey,
  setPreferences,
  t,
  initialFormats,
} from "@situate/localization";

afterEach(() => vi.unstubAllGlobals());

it("loads inspection translations with the feature and retains central language selection", async () => {
  vi.stubGlobal("__SITUATE_LOCALIZATION_KEYS__", false);
  expect(Object.hasOwn(en, "assignmentChanges.title")).toBe(false);
  expect(Object.hasOwn(de, "assignmentChanges.title")).toBe(false);
  await import("@situate/localization/assignment-changes");
  expect(isMessageKey("assignmentChanges.title")).toBe(true);
  setPreferences({ language: "en", formats: initialFormats("en") });
  expect(t("assignmentChanges.title")).toBe("Changes");
  setPreferences({ language: "de", formats: initialFormats("de") });
  expect(t("assignmentChanges.title")).toBe("Änderungen");
  expect(t("assignmentChanges.count", { count: 12 })).toBe("12 Änderungen");
});
