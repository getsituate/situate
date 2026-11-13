import { describe, expect, it, vi } from "vitest";
import { readReleaseCatalog, type ReleaseText } from "./release-history";
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
const english: ReleaseText = {
  title: "Search improvements",
  entries: [
    {
      id: "search",
      type: "fixed",
      platforms: ["macos", "ios"],
      title: "Find notes",
      paragraphs: ["Search keeps your filters."],
    },
  ],
};
const release = (version: string) => ({
  version,
  date: "2026-10-01",
  locales: { en: english },
});
const catalog = (releases: unknown[]) => ({
  schemaVersion: 1,
  installedVersion: "0.9.0",
  releases,
});
describe("bundled release history", () => {
  it("sorts numerically and excludes every release above the installed version", () => {
    expect(
      readReleaseCatalog(
        catalog([
          release("0.7.0"),
          release("0.10.0"),
          release("0.9.0"),
          release("0.8.1"),
        ]),
      ).releases.map((r) => r.version),
    ).toEqual(["0.9.0", "0.8.1", "0.7.0"]);
    expect(
      readReleaseCatalog(
        catalog([release("0.9.0"), release("0.7.0")]),
        "0.7.0",
      ).releases.map((r) => r.version),
    ).toEqual(["0.7.0"]);
  });
  it("retains skipped calendar versions and an empty installed release in both languages", () => {
    const german: ReleaseText = {
      title: "Suche",
      entries: [
        {
          ...english.entries[0]!,
          title: "Notizen finden",
          paragraphs: ["Die Suchfilter bleiben erhalten."],
        },
      ],
    };
    const result = readReleaseCatalog({
      schemaVersion: 1,
      installedVersion: "2027.1.2",
      releases: [
        { version: "2027.2.1", locales: { en: english, de: german } },
        { version: "2026.12.9", locales: { en: english, de: german } },
        {
          version: "2027.1.2",
          locales: {
            en: { title: "Changes", entries: [] },
            de: { title: "Änderungen", entries: [] },
          },
        },
        release("0.1.6"),
        { version: "2026.11.10", locales: { en: english, de: german } },
      ],
    });
    expect(result.releases.map((entry) => entry.version)).toEqual([
      "2027.1.2",
      "2026.12.9",
      "2026.11.10",
      "0.1.6",
    ]);
    expect(result.releases[0]?.date).toBeUndefined();
    expect(result.releases[0]?.locales.en.entries).toEqual([]);
    expect(result.releases[0]?.locales.de?.entries).toEqual([]);
    expect(result.releases[1]?.locales.de).toEqual(german);
  });
  it("keeps English when the German translation is unavailable or malformed", () => {
    for (const de of [undefined, { title: "Incomplete" }]) {
      const value = readReleaseCatalog(
        catalog([{ ...release("0.9.0"), locales: { en: english, de } }]),
      );
      expect(value.releases[0]?.locales.en).toEqual(english);
      expect(value.releases[0]?.locales.de).toBeUndefined();
    }
  });
  it.each([
    undefined,
    null,
    [],
    {},
    { schemaVersion: 2 },
    { installedVersion: "invalid" },
    { schemaVersion: 1, installedVersion: "0.9.0", releases: {} },
  ])("handles invalid catalog %j without throwing", (value) => {
    expect(readReleaseCatalog(value).releases).toEqual([]);
  });
  it("omits malformed entries, dates, duplicate versions and missing English", () => {
    const result = readReleaseCatalog(
      catalog([
        release("0.9.0"),
        release("0.9.0"),
        release("next"),
        { ...release("0.8.0"), date: "2026-02-30" },
        { ...release("0.7.0"), locales: { de: english } },
        {
          ...release("0.6.0"),
          locales: {
            en: {
              ...english,
              entries: [{ ...english.entries[0], type: "unknown" }],
            },
          },
        },
      ]),
    );
    expect(result.releases.map((r) => r.version)).toEqual(["0.9.0"]);
  });
  it("permits absent publication dates without inventing one", () => {
    expect(
      readReleaseCatalog(
        catalog([{ version: "0.9.0", locales: { en: english } }]),
      ).releases[0]?.date,
    ).toBeUndefined();
  });
});
