import { describe, expect, it } from "vitest";
import { reconcile } from "./reconcile";
import { createSimulation, reduceSimulation } from "./simulation";
import {
  beginConflictOperation,
  chooseConflict,
  completeConflictOperation,
} from "../editor/conflicts";
import { applyOutcome } from "../ai/model";

describe("preview state reconciliation", () => {
  it("keeps newer control values and applies independent draft edits", () => {
    const base = {
      draft: "Original",
      model: "Previous",
      settings: { active: false },
    };
    const requested = { ...base, draft: "Changed" };
    const current = { ...base, model: "Confirmed", settings: { active: true } };
    expect(reconcile(base, requested, current)).toEqual({
      ...current,
      draft: "Changed",
    });
    expect(base.draft).toBe("Original");
    expect(
      reconcile(base, { ...base, model: "Stale choice" }, current).model,
    ).toBe("Confirmed");
  });

  it("reconciles stable IDs without replacing concurrent additions or reordering", () => {
    const base = [
      { id: "a", draft: "First" },
      { id: "b", draft: "Second" },
    ];
    const requested = [{ id: "a", draft: "Edited" }, base[1]];
    const current = [base[1], { id: "c", draft: "New" }, base[0]];
    expect(reconcile(base, requested, current)).toEqual([
      base[1],
      current[1],
      requested[0],
    ]);
    expect(reconcile(base, [base[1]], current)).toEqual(current);
  });

  it("merges independent checkbox edits and only deletes unchanged properties", () => {
    expect(reconcile([false, false], [true, false], [false, true])).toEqual([
      true,
      true,
    ]);
    expect(
      reconcile(
        { old: "value", keep: "old" },
        {},
        { old: "value", keep: "new" },
      ),
    ).toEqual({ keep: "new" });
  });

  it("cannot restore a pending conflict or roll back saved content from an older scroll snapshot", () => {
    const base = createSimulation("files-conflict");
    chooseConflict(base.editor, "file");
    beginConflictOperation(base.editor, "apply");
    const request = structuredClone(base.editor);
    request.conflict!.scroll.file = 80;
    const completed = structuredClone(base.editor);
    completeConflictOperation(
      completed,
      completed.conflict!.epoch,
      completed.conflict!.pending!,
    );
    const current = reduceSimulation(base, {
      type: "editor",
      state: completed,
    });
    const next = reduceSimulation(current, {
      type: "editor",
      base: base.editor,
      state: request,
    });
    expect(next.editor.conflict).toMatchObject({
      status: "resolved",
      pending: null,
      open: false,
    });
    expect(next.editor.files).toEqual(completed.files);
    expect(next.editor.conflict!.scroll.file).toBe(80);
  });

  it("cannot undo a confirmed model choice while preserving an in-flight message edit", () => {
    const base = createSimulation("ai-chat-saving");
    const request = structuredClone(base.ai);
    request.workspaces.Personal.draft = "Keep this message";
    const completed = structuredClone(base.ai);
    applyOutcome(completed, "model-saved");
    const current = reduceSimulation(base, { type: "ai", state: completed });
    const next = reduceSimulation(current, {
      type: "ai",
      base: base.ai,
      state: request,
    });
    expect(next.ai.workspaces.Personal.model).toEqual(
      completed.workspaces.Personal.model,
    );
    expect(next.ai.workspaces.Personal.draft).toBe("Keep this message");
  });
});
