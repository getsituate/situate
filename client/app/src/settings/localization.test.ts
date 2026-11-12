import { beforeEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import {
  de,
  deviceLanguage,
  en,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  initialFormats,
  isLocalizationSnapshot,
  keyLabel,
  localizeError,
  localizeHistorySummary,
  localizeProvidedText,
  preferences,
  resolveMessage,
  setPreferences,
  t,
} from "@situate/localization";
import { displayWorkspaceName } from "../workspaces/api";

beforeEach(() => {
  Reflect.deleteProperty(globalThis, "__SITUATE_LOCALIZATION_KEYS__");
  setPreferences({ language: "en", formats: initialFormats("en") });
});

describe("interface translations", () => {
  it("selects German only for a German device language", () => {
    expect(
      ["de", "de-CH", "de_AT", "en-US", "fr-FR", ""].map(deviceLanguage),
    ).toEqual(["de", "de", "de", "en", "en", "en"]);
  });
  it("updates computed labels and document language without coupling formats", () => {
    const label = computed(() => t("settings.language.label"));
    expect(label.value).toBe("Interface language");
    setPreferences({ language: "de", formats: preferences.value.formats });
    expect(label.value).toBe("Sprache der Oberfläche");
    expect(document.documentElement.lang).toBe("de");
    expect(preferences.value.formats).toEqual({
      time: "12",
      date: "mdy",
      number: "dot-comma",
    });
  });
  it("uses English when a German translation is missing at runtime", () => {
    expect(resolveMessage("settings.language.label", {}, en)).toBe(
      "Interface language",
    );
    expect(resolveMessage("unavailable.key", {}, {})).toBe(
      "This message is unavailable.",
    );
  });
  it("interpolates parameters once without interpreting their contents as messages or markup", () => {
    expect(
      resolveMessage(
        "example",
        { example: "Open {name}" },
        {},
        { name: "<b>{other}</b>" },
      ),
    ).toBe("Open <b>{other}</b>");
  });
  it("renders known errors in the active language and hides unknown external diagnostics", () => {
    setPreferences({ language: "de", formats: initialFormats("de") });
    expect(localizeError("localization.saveFailed")).toBe(
      de["localization.saveFailed"],
    );
    expect(
      localizeError(
        JSON.stringify({ key: "localization.saveFailed", params: {} }),
      ),
    ).toBe(de["localization.saveFailed"]);
    expect(localizeError({ key: "localization.saveFailed" })).toBe(
      de["localization.saveFailed"],
    );
    expect(localizeError(new Error("Unexpected external diagnostic"))).toBe(
      de["localization.unknownError"],
    );
  });
  it.each(["en", "de"] as const)(
    "renders migration file system codes with the original explanation in %s",
    (language) => {
      setPreferences({ language, formats: initialFormats(language) });
      const message = JSON.stringify({
        key: "native.workspace.migration.fileSystemError",
        params: {
          error: JSON.stringify({
            key: "native.workspace.migration.cleanupFailed",
            params: {},
          }),
          code: 5,
        },
      });
      expect(localizeError(message)).toBe(
        language === "en"
          ? "Workspace update cleanup could not be completed. The workspace remains closed. Try opening it again. File system error code: 5."
          : "Die Bereinigung nach der Aktualisierung konnte nicht abgeschlossen werden. Der Arbeitsbereich bleibt geschlossen. Versuche, ihn erneut zu öffnen. Dateisystem-Fehlercode: 5.",
      );
    },
  );
  it("resolves nested supplied labels and errors without translating user names or paths", () => {
    const child = JSON.stringify({
      key: "native.workspace.location.child",
      params: {
        parent: "native.provider.documents.name",
        name: "native.provider.documents.name",
      },
    });
    expect(localizeProvidedText(child)).toBe(
      "Documents — Situate/native.provider.documents.name",
    );
    expect(
      localizeProvidedText("/Documents/native.provider.documents.name"),
    ).toBe("/Documents/native.provider.documents.name");
    expect(
      displayWorkspaceName({
        id: "path:/Documents/native.provider.documents.name",
        name: "native.provider.documents.name",
        display: "/Documents/native.provider.documents.name",
      }),
    ).toBe("native.provider.documents.name");
    expect(
      displayWorkspaceName({
        id: "ios-documents:",
        name: "native.provider.documents.name",
        display: "native.provider.documents.name",
      }),
    ).toBe("Documents — Situate");
    expect(
      localizeError({
        key: "native.workspace.create.partial",
        params: {
          path: "native.provider.documents.name",
          error: "native.workspace.create.markerFailed",
        },
      }),
    ).toBe(
      "A folder may remain at or near native.provider.documents.name. Its .situate directory could not be created. No files were removed. Open it separately if it contains a .situate directory.",
    );
  });
  it("keeps user-authored history text while localizing generated summaries and hiding Git envelopes", () => {
    const envelope =
      "\n\nSituate-History: " +
      JSON.stringify({
        version: 1,
        parent_tree: "a".repeat(40),
        result_tree: "b".repeat(40),
        fact: { kind: "change" },
      });
    expect(localizeHistorySummary("A personal checkpoint" + envelope)).toBe(
      "A personal checkpoint",
    );
    expect(
      localizeHistorySummary("native.history.restoreContent" + envelope),
    ).toBe("Restore deleted content");
    expect(
      localizeHistorySummary(
        JSON.stringify({
          key: "native.history.reverseChange",
          params: { revision: "a".repeat(40) },
        }) + envelope,
      ),
    ).toBe("Reverse change from an earlier version");
    expect(
      localizeHistorySummary(`Reverse change ${"a".repeat(40)}` + envelope),
    ).toBe("Reverse change from an earlier version");
  });
  it("rejects malformed IPC preferences rather than coercing their types", () => {
    expect(
      isLocalizationSnapshot({
        language: "en",
        formats: initialFormats("en"),
        writable: true,
      }),
    ).toBe(true);
    expect(
      isLocalizationSnapshot({
        language: "en",
        formats: { ...initialFormats("en"), time: 12 },
        writable: true,
      }),
    ).toBe(false);
    expect(
      isLocalizationSnapshot({
        language: "en",
        formats: { ...initialFormats("en"), number: "unknown" },
        writable: true,
      }),
    ).toBe(false);
    expect(isLocalizationSnapshot(undefined)).toBe(false);
  });
  it("uses deterministic complete markers in the test-only key mode", () => {
    Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", true);
    expect(t("settings.language.label")).toBe("⟦settings.language.label⟧");
    expect(keyLabel("settings.title", { z: 2, a: "example" })).toBe(
      '⟦settings.title:{"a":"example","z":2}⟧',
    );
    expect(keyLabel("settings.title", { name: "⟦example⟧" })).toBe(
      '⟦settings.title:{"name":"\\u27e6example\\u27e7"}⟧',
    );
  });
});

describe("independent formats", () => {
  it("falls back only for missing device fields at creation", () => {
    expect(
      initialFormats("de", { time: "12", number: "dot-apostrophe" }),
    ).toEqual({ time: "12", date: "dmy-dot", number: "dot-apostrophe" });
    expect(initialFormats("en", { date: "ymd" })).toEqual({
      time: "12",
      date: "ymd",
      number: "dot-comma",
    });
  });
  it("renders all date and time choices without altering the instant", () => {
    const date = new Date(2026, 11, 31, 14, 30, 8);
    const instant = date.getTime();
    expect(
      (["dmy-dot", "dmy-slash", "mdy", "ymd"] as const).map((format) =>
        formatDate(date, format),
      ),
    ).toEqual(["31.12.2026", "31/12/2026", "12/31/2026", "2026-12-31"]);
    expect(formatTime(date, "24")).toBe("14:30");
    expect(formatTime(date, "12")).toBe("2:30 PM");
    expect(formatTime(new Date(2026, 0, 1, 0, 5), "12")).toBe("12:05 AM");
    expect(formatTime(new Date(2026, 0, 1, 12, 5), "12")).toBe("12:05 PM");
    expect(date.getTime()).toBe(instant);
  });
  it("uses independently selected presentation for history and numbers", () => {
    setPreferences({
      language: "en",
      formats: { time: "24", date: "dmy-dot", number: "comma-space" },
    });
    expect(formatDateTime(new Date(2026, 11, 31, 14, 30, 8))).toBe(
      "31.12.2026 14:30:08",
    );
    expect(formatNumber(1234.56)).toBe("1 234,56");
    expect(t("files.countMany", { count: 1234 })).toBe("1 234 files");
    expect(
      (
        [
          "dot-comma",
          "comma-dot",
          "dot-space",
          "comma-space",
          "dot-apostrophe",
        ] as const
      ).map((format) => formatNumber(-1234.56, format)),
    ).toEqual([
      "-1,234.56",
      "-1.234,56",
      "-1 234.56",
      "-1 234,56",
      "-1’234.56",
    ]);
    expect(formatNumber(12, "dot-comma", { minimumFractionDigits: 2 })).toBe(
      "12.00",
    );
  });
});
