import { mount } from "@vue/test-utils";
import { afterEach, expect, test } from "vitest";
import { enableAutoUnmount } from "@vue/test-utils";
import { initialFormats, setPreferences } from "@situate/localization";
import ChatDuration from "./ChatDuration.vue";

enableAutoUnmount(afterEach);
test.each([
  ["en", 0, "complete", "Worked for less than 1 sec"],
  ["en", 999, "complete", "Worked for less than 1 sec"],
  ["en", 59999, "complete", "Worked for 59 sec"],
  ["en", 60000, "complete", "Worked for 1 min 0 sec"],
  ["de", 84000, "complete", "1 Min. 24 Sek. gearbeitet"],
  ["de", 42000, "cancelled", "Gestoppt · 42 Sek. gearbeitet"],
  ["de", 42000, "error", "Durch Fehler beendet · 42 Sek. gearbeitet"],
] as const)("formats %s %s %s", (language, durationMs, outcome, expected) => {
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
  setPreferences({ language, formats: initialFormats(language) });
  expect(mount(ChatDuration, { props: { durationMs, outcome } }).text()).toBe(
    expected,
  );
});
test.each([-1, NaN, Infinity])("omits invalid duration %s", (durationMs) => {
  expect(
    mount(ChatDuration, { props: { durationMs, outcome: "complete" } })
      .find(".duration")
      .exists(),
  ).toBe(false);
});
