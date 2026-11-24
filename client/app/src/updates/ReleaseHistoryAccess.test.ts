import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { preferences, setPreferences } from "@situate/localization";
import ReleaseHistoryAccess from "./ReleaseHistoryAccess.vue";
import {
  installedReleases,
  loadInstalledVersion,
  type ReleaseCatalog,
  type ReleaseText,
} from "./release-history";

vi.mock("./release-history", () => ({
  installedReleases: vi.fn(),
  loadInstalledVersion: vi.fn(async () => {}),
}));

const originalPreferences = preferences.value;
const releaseText = (entries: ReleaseText["entries"]): ReleaseText => ({
  title: "Changes",
  entries,
});
const englishFix = releaseText([
  {
    id: "drafts",
    type: "fixed",
    platforms: ["macos"],
    title: "Keep drafts",
    paragraphs: ["Drafts stay in their conversation."],
  },
]);
function setCatalog(releases: ReleaseCatalog["releases"]) {
  vi.mocked(installedReleases).mockReturnValue({
    schemaVersion: 1,
    installedVersion: "0.9.1",
    releases,
  });
}

beforeEach(() => {
  Reflect.set(globalThis, "__SITUATE_LOCALIZATION_KEYS__", false);
  vi.clearAllMocks();
});
afterEach(() => setPreferences(originalPreferences));

it("shows localized changes inline and falls back to English for earlier notes", async () => {
  setPreferences({ ...originalPreferences, language: "de" });
  setCatalog([
    { version: "0.9.1", locales: { en: releaseText([]) } },
    {
      version: "0.9.0",
      date: "2026-10-20",
      locales: {
        en: englishFix,
        de: releaseText([
          {
            id: "export",
            type: "important",
            platforms: ["macos"],
            title: "Notizen sichern",
            paragraphs: ["Exportiere deine Notizen.", "Bewahre die Kopie auf."],
          },
          {
            id: "mobile",
            type: "fixed",
            platforms: ["ios"],
            title: "Notizen auf dem iPhone",
            paragraphs: [],
          },
        ]),
      },
    },
    { version: "0.8.0", locales: { en: englishFix } },
  ]);
  const wrapper = mount(ReleaseHistoryAccess);
  try {
    expect(installedReleases).not.toHaveBeenCalled();
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(loadInstalledVersion).toHaveBeenCalledOnce();
    const dialog = wrapper.get("dialog[open]");
    expect(
      dialog
        .findAll("[data-version]")
        .map((group) => group.attributes("data-version")),
    ).toEqual(["0.9.0", "0.8.0"]);
    expect(dialog.get("time").text()).toBe("20. Oktober 2026");
    expect(dialog.text()).toContain("Wichtig");
    expect(dialog.text()).toContain("iOS");
    expect(dialog.text()).toContain("Bewahre die Kopie auf.");
    expect(dialog.text()).toContain("Drafts stay in their conversation.");
    await dialog.trigger("cancel");
    expect(wrapper.find("dialog[open]").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

it("shows an empty state when the installed catalog has no public entries", async () => {
  setCatalog([{ version: "0.9.1", locales: { en: releaseText([]) } }]);
  const wrapper = mount(ReleaseHistoryAccess);
  try {
    await wrapper.get("button").trigger("click");
    await flushPromises();
    const dialog = wrapper.get("dialog[open]");
    expect(dialog.get('[role="status"]').text()).toBe(
      "There are no release notes for this installation yet.",
    );
    await dialog.get("button").trigger("click");
    expect(wrapper.find("dialog[open]").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});
