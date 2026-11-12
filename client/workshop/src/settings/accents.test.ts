import { describe, expect, it } from "vitest";
import { accentStyle, accents } from "./accents";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";

describe("workspace accents", () => {
  it("offers six brand colors without changing artwork tokens", () => {
    expect(accents).toEqual([
      "violet",
      "cobalt",
      "sky",
      "tangerine",
      "peach",
      "lemon",
    ]);
    for (const accent of accents) {
      const style = accentStyle(accent);
      expect(style["--situate-accent"]).toBe(`var(--situate-${accent})`);
      expect(
        Object.keys(style).every((key) => key.startsWith("--situate-accent")),
      ).toBe(true);
    }
    expect(accentStyle("lemon")["--situate-accent-on"]).toBe(
      "var(--situate-ink)",
    );
  });

  it("retains independent accents, navigation and drafts when switching workspaces", () => {
    let state = createSimulation("settings-appearance");
    state = reduceSimulation(state, {
      type: "settings",
      state: { ...state.settings, accent: "sky", search: "draft" },
    });
    state = reduceSimulation(state, {
      type: "action",
      operation: { request: "other", action: "open", id: "sample-2" },
    });
    expect(state.settings.accent).toBe("violet");
    state = reduceSimulation(state, {
      type: "settings",
      state: { ...state.settings, accent: "peach" },
    });
    state = reduceSimulation(state, {
      type: "action",
      operation: { request: "back", action: "open", id: "sample-1" },
    });
    expect(state.settings).toMatchObject({
      accent: "sky",
      search: "draft",
      page: "appearance",
    });
    expect(state.settingsByWorkspace["sample-2"]?.accent).toBe("peach");
    state = reduceSimulation(state, { type: "platform", mobile: true });
    expect(state.settings.accent).toBe("sky");
    expect(screenControls(state)).toMatchObject({
      label: "Settings · Appearance · Sky",
      controls: ["settings"],
      canSetOutcome: false,
    });
    state = reduceSimulation(state, { type: "reset" });
    expect(state.settings.accent).toBe("violet");
    expect(state.settingsByWorkspace).toEqual({});
    expect(state.snapshot.mobile).toBe(true);
  });

  it("resets the light accent starting state to its original color", () => {
    let state = createSimulation("settings-appearance-light");
    state.settings.accent = "cobalt";
    state = reduceSimulation(state, { type: "reset" });
    expect(state.settings).toMatchObject({
      accent: "lemon",
      page: "appearance",
      detail: true,
    });
  });
});
