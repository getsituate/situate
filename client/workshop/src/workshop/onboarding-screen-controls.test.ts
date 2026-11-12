import { describe, expect, it } from "vitest";
import { currentScreen, screenControls } from "./screen-controls";
import { scenarios, createSimulation, reduceSimulation } from "./simulation";

describe("screen controls", () => {
  it("offers only the ordered onboarding workflow and its current states", () => {
    const entries = scenarios.filter(
      (scenario) => scenario.group === "Onboarding",
    );
    expect(entries.map(({ id }) => id)).toEqual([
      "first-entry",
      "first-entry-create",
      "first-entry-ai",
      "first-entry-model",
      "first-entry-paused",
      "setup-conversation-brief",
      "setup-conversation-fresh",
      "setup-conversation-keep",
      "setup-conversation-proposal",
      "setup-conversation-import",
      "setup-conversation-app",
      "setup-conversation-blocked",
      "setup-conversation-partial",
      "setup-conversation-support",
      "setup-conversation-finale",
    ]);
    expect(entries.map(({ label }) => label.split(" · ")[0])).toEqual([
      "01",
      "02",
      "03",
      "04",
      "04.1",
      "05",
      "05.1",
      "05.2",
      "05.3",
      "05.4",
      "05.5",
      "05.6",
      "05.7",
      "05.8",
      "05.9",
    ]);
  });
  it("follows navigation rather than the original scenario", () => {
    const initial = createSimulation("workspaces");
    const creation = reduceSimulation(initial, {
      type: "creating",
      value: true,
    });
    expect(creation.scenario).toBe("workspaces");
    expect(creation.firstEntry.step).toBe("intro");
    expect(screenControls(creation).controls).toEqual(["first-entry"]);
    const opened = reduceSimulation(creation, {
      type: "action",
      operation: { request: "create", action: "create", name: "Reading room" },
    });
    expect(opened.scenario).toBe("workspaces");
    expect(currentScreen(opened)).toBe("ai");
    expect(screenControls(opened).controls).toEqual(["ai", "first-entry"]);
    expect(opened.firstEntry.step).toBe("ai");
  });

  it("gives the visible modal and startup screen precedence over background state", () => {
    const state = createSimulation("create");
    state.removingId = "sample-1";
    expect(currentScreen(state)).toBe("removal");
    state.snapshot.error = "Could not start.";
    expect(currentScreen(state)).toBe("startup");
    expect(screenControls(state).controls).toEqual([]);
  });

  it("keeps workspace settings out of proposals until workspace selection opens", () => {
    const state = createSimulation("files-source");
    expect(screenControls(state)).toMatchObject({
      label: "Edit Markdown",
      editing: true,
      canSetOutcome: false,
    });
    const selection = reduceSimulation(state, { type: "entry", visible: true });
    expect(screenControls(selection)).toMatchObject({
      label: "Workspace selection",
      editing: false,
      controls: ["content", "error"],
    });
    const back = reduceSimulation(selection, { type: "entry", visible: false });
    expect(screenControls(back).controls).toEqual(["editor"]);
  });

  it("shows completion controls only while an action is pending", () => {
    const initial = createSimulation("workspaces");
    expect(screenControls(initial)).toMatchObject({
      canSetOutcome: true,
      canComplete: false,
    });
    const waiting = reduceSimulation(
      reduceSimulation(initial, { type: "outcome", outcome: "wait" }),
      {
        type: "action",
        operation: { request: "open", action: "pick" },
      },
    );
    expect(screenControls(waiting)).toMatchObject({
      canSetOutcome: false,
      canComplete: true,
    });
    const failed = reduceSimulation(waiting, { type: "finish", ok: false });
    expect(screenControls(failed)).toMatchObject({
      canSetOutcome: true,
      canComplete: false,
    });
    const reset = reduceSimulation(waiting, { type: "reset" });
    expect(screenControls(reset).canComplete).toBe(false);
  });

  it("offers startup action results only when Retry is available", () => {
    const state = createSimulation("startup");
    expect(screenControls(state)).toMatchObject({
      canSetOutcome: false,
      canComplete: true,
    });
    state.pending = null;
    expect(screenControls(state)).toMatchObject({
      canSetOutcome: false,
      canComplete: false,
    });
    state.snapshot.error = "Try again.";
    expect(screenControls(state)).toMatchObject({
      canSetOutcome: true,
      canComplete: false,
    });
  });
});
