import { describe, expect, it } from "vitest";
import {
  createUpdates,
  reduceUpdates,
  updateReady,
  updateScenarios,
} from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
import { scenarioForState } from "../workshop/scenario-catalog";

describe("update workflow", () => {
  it("resets the previous installation without opening history", () => {
    let state = createSimulation("release-notes-skipped");
    state = reduceSimulation(state, {
      type: "updates",
      action: { type: "previous-version", value: "0.8.0" },
    });
    expect(state.updates.previousVersion).toBe("0.8.0");
    state = reduceSimulation(state, { type: "reset" });
    expect(state.updates.previousVersion).toBe("0.7.0");
    expect(state.updates.dialog).toBeNull();
    expect(state.updates.installed).toBe("0.8.1");
  });
  it("registers each starting state once and opens an actual workspace", () => {
    for (const preset of updateScenarios) {
      expect(
        scenarioForState(preset.id).states.filter((s) => s.id === preset.id),
      ).toHaveLength(1);
      const state = createSimulation(preset.id);
      expect(state.snapshot.current).not.toBeNull();
      expect(state.updates.enabled).toBe(true);
    }
  });
  it("requires fresh consent after failure and never installs when timed-out writes settle", () => {
    const state = createUpdates("updates-restart");
    reduceUpdates(state, { type: "confirm-force" });
    expect(state.preparation).toBe("idle");
    reduceUpdates(state, { type: "confirm-install" });
    expect(state.preparation).toBe("pending");
    reduceUpdates(state, { type: "fail-preparation" });
    expect(state.preparation).toBe("failed");
    reduceUpdates(state, { type: "request-force" });
    state.available = "0.8.2";
    reduceUpdates(state, { type: "confirm-force" });
    expect(state.preparation).toBe("failed");
    reduceUpdates(state, { type: "close-dialog" });
    reduceUpdates(state, { type: "request-force" });
    reduceUpdates(state, { type: "confirm-force" });
    expect(state.preparation).toBe("pending");
    expect(state.forced).toBe(true);
    reduceUpdates(state, { type: "preparation-reason", value: "native" });
    reduceUpdates(state, { type: "fail-preparation" });
    reduceUpdates(state, { type: "request-force" });
    expect(state.dialog).toBeNull();
    reduceUpdates(state, { type: "settle-writes" });
    reduceUpdates(state, { type: "finish-preparation" });
    expect(state.phase).toBe("ready");
    expect(state.preparation).toBe("idle");
  });
  it.each(["native", "stop-failed"] as const)(
    "retains running activity after %s until safe stopping completes",
    (reason) => {
      const state = createUpdates("updates-restart");
      reduceUpdates(state, { type: "confirm-install" });
      reduceUpdates(state, { type: "preparation-reason", value: reason });
      reduceUpdates(state, { type: "fail-preparation" });
      expect(state.preparation).toBe("blocked");
      expect(state.running).toBe(true);
      reduceUpdates(state, { type: "settle-writes" });
      expect(state.running).toBe(false);
      expect(state.phase).toBe("ready");
    },
  );
  it("labels force confirmation and preparation by their current screen", () => {
    const state = createSimulation("updates-restart");
    reduceUpdates(state.updates, { type: "confirm-install" });
    expect(screenControls(state).label).toBe("Preparing update restart");
    reduceUpdates(state.updates, { type: "fail-preparation" });
    expect(screenControls(state).label).toBe("Update preparation failed");
    reduceUpdates(state.updates, { type: "request-force" });
    expect(screenControls(state).label).toBe("Confirm restart without saving");
  });
  it("downloads after a successful check without installing", () => {
    const state = createUpdates("updates-current");
    reduceUpdates(state, { type: "check" });
    expect(state.phase).toBe("checking");
    reduceUpdates(state, { type: "finish-check" });
    expect(state.phase).toBe("downloading");
    reduceUpdates(state, { type: "finish-download" });
    expect(updateReady(state)).toBe(true);
    expect(state.installed).toBe("0.8.0");
    reduceUpdates(state, { type: "confirm-install" });
    expect(state.phase).toBe("ready");
  });
  it("postpones without stopping actions and cancels a pending sync", () => {
    const state = createUpdates("updates-restart");
    reduceUpdates(state, { type: "close-dialog" });
    expect(state.running).toBe(true);
    expect(state.phase).toBe("ready");
    reduceUpdates(state, { type: "unsynced", value: true });
    reduceUpdates(state, { type: "request-install" });
    reduceUpdates(state, { type: "confirm-install", synchronize: true });
    expect(state.dialog).toBe("sync");
    reduceUpdates(state, { type: "close-dialog" });
    reduceUpdates(state, { type: "finish-sync" });
    expect(state.phase).toBe("ready");
    expect(state.running).toBe(true);
  });
  it("synchronizes before installation only when explicitly selected", () => {
    const state = createUpdates("updates-sync");
    reduceUpdates(state, { type: "confirm-install", synchronize: true });
    expect(state.phase).toBe("ready");
    reduceUpdates(state, { type: "finish-sync" });
    expect(state.phase).toBe("installing");
    expect(state.unsynced).toBe(false);
    reduceUpdates(state, { type: "finish-install" });
    expect(state.dialog).toBeNull();
    expect(state.installed).toBe("0.8.1");
  });
  it("retains unsynchronized changes when the user chooses immediate restart", () => {
    const state = createUpdates("updates-sync");
    reduceUpdates(state, { type: "confirm-install" });
    expect(state.preparation).toBe("pending");
    reduceUpdates(state, { type: "finish-preparation" });
    expect(state.phase).toBe("installing");
    expect(state.unsynced).toBe(true);
  });
  it.each(["homebrew", "store"] as const)(
    "never updates a %s installation through direct controls",
    (channel) => {
      const state = createUpdates("updates-current");
      reduceUpdates(state, { type: "channel", channel });
      for (const type of [
        "check",
        "finish-check",
        "finish-download",
        "request-install",
        "confirm-install",
        "finish-install",
      ] as const)
        reduceUpdates(state, { type });
      expect(state.phase).toBe("current");
      expect(state.installed).toBe("0.8.0");
      expect(updateReady(state)).toBe(false);
      reduceUpdates(state, { type: "external-update" });
      expect(state.dialog).toBeNull();
      reduceUpdates(state, { type: "close-dialog" });
      reduceUpdates(state, { type: "external-update" });
      expect(state.dialog).toBeNull();
    },
  );
  it("retains the working draft across settings navigation and postponement", () => {
    let state = createSimulation("updates-notice");
    state.chat.draft = "Keep this reading note";
    state = reduceSimulation(state, { type: "update-settings" });
    expect(screenControls(state).controls).toContain("updates");
    state = reduceSimulation(state, {
      type: "updates",
      action: { type: "request-install" },
    });
    expect(screenControls(state).label).toBe("Confirm update restart");
    state = reduceSimulation(state, {
      type: "updates",
      action: { type: "close-dialog" },
    });
    expect(state.chat.draft).toBe("Keep this reading note");
  });
  it("reset removes dialogs and pending progress while preserving environment", () => {
    let state = createSimulation("updates-current");
    state.environment.keyboardOpen = true;
    state = reduceSimulation(state, {
      type: "updates",
      action: { type: "check" },
    });
    state = reduceSimulation(state, { type: "reset" });
    expect(state.updates.phase).toBe("current");
    expect(state.updates.dialog).toBeNull();
    expect(state.environment.keyboardOpen).toBe(true);
  });
});
