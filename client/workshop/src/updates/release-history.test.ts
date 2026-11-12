import { describe, expect, it } from "vitest";
import { createUpdates, reduceUpdates } from "./model";
import { releaseCatalog, installedReleaseCatalog } from "./release-history";
import copy from "../localization/en.updates.json" with { type: "json" };

describe("optional release history", () => {
  it("caps every history entry at the installed version using numeric ordering", () => {
    expect(installedReleaseCatalog("0.7.1").map((r) => r.version)).toEqual([
      "0.7.1",
      "0.7.0",
    ]);
    expect(installedReleaseCatalog("0.8.0").map((r) => r.version)).toEqual([
      "0.8.0",
      "0.7.2",
      "0.7.1",
      "0.7.0",
    ]);
    expect(installedReleaseCatalog("0.10.0")).toHaveLength(5);
    expect(installedReleaseCatalog("0.6.0")).toEqual([]);
    expect(installedReleaseCatalog("unknown")).toEqual([]);
  });
  it("has individually identifiable notes for every synthetic published release", () => {
    expect(releaseCatalog.map((r) => r.version)).toEqual([
      "0.8.1",
      "0.8.0",
      "0.7.2",
      "0.7.1",
      "0.7.0",
    ]);
    for (const release of releaseCatalog) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Date.parse(release.date)).not.toBeNaN();
      const article =
        release.content === "latest"
          ? copy.featureNotes
          : copy.releaseArchive[release.content];
      expect(article.sections.length).toBeGreaterThan(0);
    }
  });
  it.each(["direct", "homebrew", "store"] as const)(
    "does not open history after a %s update, including skipped releases",
    (channel) => {
      const state = createUpdates("updates-current");
      state.channel = channel;
      state.installed = "0.7.0";
      state.phase = "installing";
      reduceUpdates(state, {
        type: channel === "direct" ? "finish-install" : "external-update",
      });
      expect(state.installed).toBe("0.8.1");
      expect(state.previousVersion).toBe("0.7.0");
      expect(state.dialog).toBeNull();
      reduceUpdates(state, { type: "show-notes" });
      expect(state.dialog).toBe("release-notes");
      reduceUpdates(state, { type: "close-dialog" });
      expect(state.dialog).toBeNull();
    },
  );
  it.each([
    "release-notes-direct",
    "release-notes-homebrew",
    "release-notes-store",
    "release-notes-skipped",
  ])("%s starts without an automatic dialog", (scenario) =>
    expect(createUpdates(scenario).dialog).toBeNull(),
  );
});
