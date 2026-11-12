import { describe, expect, it } from "vitest";
import {
  applyOutcome,
  createAiState,
  currentWorkspace,
  modelAction,
  saveModel,
} from "../ai/model";
import { modelChoiceBusy, modelIssue } from "./model-issue";

describe("model issues", () => {
  it.each(["new", "one", "existing", "custom", "long", "streaming"])(
    "does not present %s as a failure",
    (fixture) => {
      expect(modelIssue(createAiState(`chat-${fixture}`))).toBeNull();
    },
  );
  it.each(["loading", "saving", "reconciling"])(
    "keeps %s as a busy state without an issue popup",
    (phase) => {
      const state = createAiState("chat-existing");
      currentWorkspace(state).model.phase = phase as
        "loading" | "saving" | "reconciling";
      expect(modelChoiceBusy(state)).toBe(true);
      expect(modelIssue(state)).toBeNull();
    },
  );
  it.each([
    ["load-error", "catalog", ["reload"]],
    ["save-error", "save", ["retry", "discard"]],
    ["uncertain", "uncertain", ["check", "retry"]],
    ["unsaved", "unsaved", []],
    ["disconnected", "access", []],
    ["unavailable", "unavailable", ["choose"]],
    ["zero", "empty", []],
  ])("preserves the actionable meaning of %s", (fixture, kind, actions) => {
    const issue = modelIssue(createAiState(`chat-${fixture}`));
    expect(issue?.kind).toBe(kind);
    expect(issue?.actions.map((action) => action.id)).toEqual(actions);
  });
  it("retains the inherited default after an override fails to save", () => {
    const state = createAiState("chat-new");
    saveModel(state, "example-fast");
    applyOutcome(state, "model-save-error");
    expect(modelIssue(state)?.actions.at(-1)?.label).toBe(
      "Keep previous choice",
    );
    modelAction(state, "discard");
    expect(modelIssue(state)).toBeNull();
    expect(currentWorkspace(state).model.selected).toBeNull();
  });
  it("drops stale failures during retry and confirmed success without a rollback claim for uncertainty", () => {
    const state = createAiState("chat-save-error");
    expect(modelIssue(state)?.kind).toBe("save");
    modelAction(state, "retry");
    expect(modelIssue(state)).toBeNull();
    applyOutcome(state, "model-save-uncertain");
    expect(modelIssue(state)?.detail).toBe("The save result is unknown.");
    modelAction(state, "check");
    expect(modelIssue(state)).toBeNull();
    applyOutcome(state, "model-confirmed-new");
    expect(modelIssue(state)).toBeNull();
    applyOutcome(state, "model-save-error");
    expect(modelIssue(state)).toBeNull();
  });
});
