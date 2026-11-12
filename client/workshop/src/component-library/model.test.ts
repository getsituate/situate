import { describe, expect, it } from "vitest";
import * as ui from "../ui";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { currentScreen, screenControls } from "../workshop/screen-controls";
import { scenarioForState } from "../workshop/scenario-catalog";
import { catalogComponents, componentScenarios } from "./model";

describe("component library", () => {
  it("catalogs every public workshop component exactly once", () => {
    expect([...catalogComponents].sort()).toEqual(Object.keys(ui).sort());
    expect(new Set(catalogComponents).size).toBe(catalogComponents.length);
  });

  it.each(componentScenarios)(
    "opens $id under one scenario with its own controls",
    ({ id }) => {
      const state = createSimulation(id);
      expect(currentScreen(state)).toBe("components");
      expect(scenarioForState(id).id).toBe("components-ready");
      expect(state.components.status).toBe(id.replace("components-", ""));
      expect(screenControls(state)).toMatchObject({
        controls: ["components"],
        editing: true,
        canSetOutcome: false,
        canComplete: false,
      });
      const navigated = reduceSimulation(state, {
        type: "feature",
        feature: "editor",
      });
      expect(screenControls(navigated).controls).toEqual(["editor"]);
    },
  );

  it("preserves drafts and pending state across environmental changes, but resets the example deterministically", () => {
    const initial = createSimulation("components-ready");
    const edited = reduceSimulation(initial, {
      type: "components",
      patch: {
        name: "A different draft",
        status: "loading",
        dialogOpen: true,
        height: 240,
      },
    });
    const mobile = reduceSimulation(edited, { type: "platform", mobile: true });
    const resized = reduceSimulation(mobile, {
      type: "environment",
      state: { profile: "ios", keyboardOpen: true },
    });
    expect(resized.components).toEqual(edited.components);
    expect(resized.epoch).toBe(initial.epoch);
    const reset = reduceSimulation(resized, { type: "reset" });
    expect(reset.components).toEqual(initial.components);
    expect(reset.epoch).toBe(initial.epoch + 1);
    expect(reset.environment).toEqual(resized.environment);
    expect(reset.snapshot.mobile).toBe(true);
    const loaded = reduceSimulation(edited, {
      type: "scenario",
      scenario: "components-empty",
    });
    expect(loaded.components).toEqual(
      createSimulation("components-empty").components,
    );
  });

  it("merges independent example controls without overwriting input", () => {
    let state = createSimulation("components-ready");
    state = reduceSimulation(state, {
      type: "components",
      patch: { notes: "Keep this text" },
    });
    state = reduceSimulation(state, {
      type: "components",
      patch: { compact: true, longLabels: true },
    });
    expect(state.components.notes).toBe("Keep this text");
    expect(state.components.compact).toBe(true);
    expect(state.components.longLabels).toBe(true);
  });
});
