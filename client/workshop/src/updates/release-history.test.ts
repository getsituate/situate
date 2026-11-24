import { describe, expect, it } from "vitest";
import { createUpdates, reduceUpdates } from "./model";
import { installedReleaseCatalog } from "./release-history";

describe("optional release notes", () => {
  it("shows only nonempty releases at or below the installed version in descending numeric order", () => {
    expect(installedReleaseCatalog("0.7.1").map((r) => r.version)).toEqual([
      "0.7.1",
      "0.7.0",
    ]);
    expect(installedReleaseCatalog("0.8.2").map((r) => r.version)).toEqual([
      "0.8.1",
      "0.8.0",
      "0.7.2",
      "0.7.1",
      "0.7.0",
    ]);
    expect(installedReleaseCatalog("0.10.0")).toHaveLength(5);
    expect(installedReleaseCatalog("0.6.0")).toEqual([]);
    expect(installedReleaseCatalog("unknown")).toEqual([]);
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
    "release-notes-empty",
  ])("%s starts without an automatic dialog", (scenario) =>
    expect(createUpdates(scenario).dialog).toBeNull(),
  );
});
