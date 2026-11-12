import { describe, expect, it } from "vitest";
import {
  createSimulation,
  reduceSimulation,
  type Scenario,
} from "./simulation";
import { screenControls } from "./screen-controls";
import {
  hasPluginWork,
  pluginScenarios,
  startPluginDevelopment,
} from "../plugins/model";

const clone = <T>(state: T): T => JSON.parse(JSON.stringify(state));

describe("plugin workshop routing and lifecycle", () => {
  it.each(pluginScenarios)(
    "opens $id with only its visible controls",
    ({ id }) => {
      const state = createSimulation(id as Scenario);
      expect(state.feature).toBe("plugins");
      expect(state.entryVisible).toBe(false);
      expect(screenControls(state).controls).toEqual(["plugins"]);
      expect(screenControls(state).canSetOutcome).toBe(false);
    },
  );
  it("keeps drafts and development state when the environment or visible feature changes", () => {
    const state = createSimulation("plugins-list");
    startPluginDevelopment(
      state.plugins,
      "Build a weekly overview using my calendar.",
    );
    const plugins = clone(state.plugins);
    let next = reduceSimulation(state, {
      type: "feature",
      feature: "settings",
    });
    expect(next.plugins).toEqual(plugins);
    expect(screenControls(next).controls).toEqual(["settings"]);
    next = reduceSimulation(next, { type: "platform", mobile: true });
    next = reduceSimulation(next, {
      type: "environment",
      state: { ...next.environment, keyboardOpen: true },
    });
    expect(next.plugins).toEqual(plugins);
    next = reduceSimulation(next, { type: "feature", feature: "plugins" });
    expect(next.plugins).toEqual(plugins);
  });
  it("preserves each workspace's development state without sharing configuration", () => {
    const state = createSimulation("plugins-list");
    startPluginDevelopment(state.plugins, "Adapt my weekly review.");
    const own = clone(state.plugins);
    let next = reduceSimulation(state, {
      type: "action",
      operation: { request: "other", action: "open", id: "sample-2" },
    });
    expect(next.plugins).not.toEqual(own);
    next = reduceSimulation(next, {
      type: "action",
      operation: { request: "back", action: "open", id: "sample-1" },
    });
    expect(next.plugins).toEqual(own);
  });
  it("stops temporary development on application quit but not view navigation", () => {
    const state = createSimulation("plugins-development");
    expect(hasPluginWork(state.plugins)).toBe(true);
    const hidden = reduceSimulation(state, {
      type: "feature",
      feature: "settings",
    });
    expect(hasPluginWork(hidden.plugins)).toBe(true);
    const quit = reduceSimulation(hidden, {
      type: "action",
      operation: { request: "quit", action: "quit" },
    });
    expect(hasPluginWork(quit.plugins)).toBe(false);
    const reopened = reduceSimulation(quit, { type: "entry", visible: false });
    expect(hasPluginWork(reopened.plugins)).toBe(false);
  });
  it("reset removes pending development and retains only environmental assumptions", () => {
    const initial = createSimulation("plugins-development");
    const next = reduceSimulation(initial, {
      type: "scenario",
      scenario: "plugins-empty",
    });
    expect(hasPluginWork(next.plugins)).toBe(false);
    next.environment.keyboardOpen = true;
    const reset = reduceSimulation(next, { type: "reset" });
    expect(reset.plugins).toEqual(createSimulation("plugins-empty").plugins);
    expect(reset.environment.keyboardOpen).toBe(true);
    expect(reset.epoch).toBe(next.epoch + 1);
  });
});
