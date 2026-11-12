import { describe, expect, it } from "vitest";
import {
  createRecovery,
  recoveryScenarios,
  reduceRecovery,
  reportText,
} from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { scenarioForState } from "../workshop/scenario-catalog";
import { screenControls } from "../workshop/screen-controls";

describe("error recovery", () => {
  it("registers one workflow with reachable screen controls", () => {
    for (const { id } of recoveryScenarios) {
      const state = createSimulation(id);
      expect(state.feature).toBe("recovery");
      if (id === "recovery-startup") {
        expect(state.snapshot.current).toBeNull();
        expect(state.snapshot.open).toEqual([]);
      }
      expect(scenarioForState(id).label).toBe("Error recovery");
      expect(screenControls(state).controls).toEqual(["recovery"]);
    }
  });
  it("dismisses repeated errors without losing drafts or uncertainty", () => {
    const state = createRecovery("recovery-unexpected");
    reduceRecovery(state, { type: "draft", value: "A new thought" });
    reduceRecovery(state, { type: "dialog", dialog: null });
    for (let i = 0; i < 10; i++) reduceRecovery(state, { type: "repeat" });
    expect(state.dialog).toBeNull();
    expect(state.failed).toBe(true);
    expect(state.draft).toBe("A new thought");
    reduceRecovery(state, { type: "reload" });
    expect(state.failed).toBe(false);
    expect(state.escalated).toBe(true);
    expect(state.running).toBe(true);
    expect(state.draft).toBe("A new thought");
  });
  it("always includes bounded technical data and excludes note content", () => {
    const state = createRecovery();
    state.draft = "PRIVATE_NOTE_MARKER";
    reduceRecovery(state, { type: "description", value: "x".repeat(3000) });
    expect(state.description).toHaveLength(2000);
    expect(reportText(state)).toContain("bugs@getsituate.com");
    expect(reportText(state)).not.toContain(state.draft);
    expect(reportText(state)).toContain("Trace: example-event-0042");
    const startup = createRecovery("recovery-startup");
    expect(reportText(startup)).toContain("Workspace: not opened");
    expect(reportText(startup)).not.toContain("reading-list 0.4.2");
  });
  it("restarts directly after selection, retaining unsaved work if saving fails", () => {
    const state = createRecovery("recovery-unexpected");
    reduceRecovery(state, { type: "saveSucceeds", value: false });
    reduceRecovery(state, { type: "restart" });
    expect(state.dialog).toBe("unexpected");
    expect(state.savedDraft).toBeNull();
    expect(state.running).toBe(true);
    reduceRecovery(state, { type: "dialog", dialog: null });
    expect(state.failed).toBe(true);
    reduceRecovery(state, { type: "draft", value: "Later edit" });
    reduceRecovery(state, { type: "saveSucceeds", value: true });
    reduceRecovery(state, { type: "restart" });
    expect(state.dialog).toBeNull();
    expect(state.savedDraft).toBe("Later edit");
    expect(state.running).toBe(false);
    expect(state.escalated).toBe(true);
  });
  it("shares the general dialog with startup and keeps workspace reload separate from app restart", () => {
    const startup = createRecovery("recovery-startup");
    expect(startup.dialog).toBe("unexpected");
    reduceRecovery(startup, { type: "recover" });
    expect(startup.dialog).toBe("unexpected");
    const state = createRecovery("recovery-unexpected");
    state.reloadSucceeds = false;
    reduceRecovery(state, { type: "recover" });
    expect(state.intent).toBe("workspace");
    expect(state.dialog).toBe("unexpected");
    expect(state.failed).toBe(true);
    expect(state.draft).toBe(state.savedDraft);
  });
  it("keeps repair explicit, unavailable and separate from the original view", () => {
    const state = createRecovery();
    expect(state.screen).toBe("notes");
    reduceRecovery(state, { type: "repair" });
    const before = state.draft;
    reduceRecovery(state, { type: "repair" });
    reduceRecovery(state, { type: "retry-repair" });
    expect(state.screen).toBe("repair");
    expect(state.failed).toBe(true);
    reduceRecovery(state, { type: "return" });
    expect(state.draft).toBe(before);
  });
  it("resets all local work and keeps mobile restart unavailable", () => {
    let state = createSimulation("recovery-restart", true);
    state.recovery.savedDraft = state.recovery.draft;
    state.recovery.running = false;
    state = reduceSimulation(state, {
      type: "recovery",
      action: { type: "restart" },
    });
    expect(state.recovery.dialog).toBeNull();
    expect(state.recovery.notice).toBe("Ready");
    state = reduceSimulation(state, {
      type: "recovery",
      action: { type: "draft", value: "Changed" },
    });
    state = reduceSimulation(state, { type: "reset" });
    expect(state.recovery).toEqual(createRecovery("recovery-restart"));
    expect(state.snapshot.mobile).toBe(true);
  });
});
