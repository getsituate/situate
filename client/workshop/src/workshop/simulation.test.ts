import { describe, expect, it } from "vitest";
import {
  createSimulation,
  reduceSimulation,
  scenarios,
  type Command,
  type Simulation,
} from "./simulation";

function step(state: Simulation, ...commands: Command[]): Simulation {
  return commands.reduce(reduceSimulation, state);
}
const open: Command = {
  type: "action",
  operation: { request: "open-1", action: "open", id: "sample-1" },
};

describe("design scenarios", () => {
  it.each(scenarios)(
    "creates an independent, coherent $id scenario",
    ({ id }) => {
      const state = createSimulation(id);
      const before = JSON.stringify(state);
      const second = createSimulation(id);
      second.snapshot.known.length = 0;
      expect(JSON.stringify(state)).toBe(before);
      expect(
        state.snapshot.current === null ||
          state.snapshot.open.some(
            (item) => item.id === state.snapshot.current?.id,
          ),
      ).toBe(true);
      expect(
        state.removingId === null ||
          state.snapshot.known.some((item) => item.id === state.removingId),
      ).toBe(true);
    },
  );

  it("holds an action until completion, then opens the actual workspace", () => {
    const initial = createSimulation();
    const waiting = step(initial, { type: "outcome", outcome: "wait" }, open);
    expect(initial.pending).toBeNull();
    expect(waiting.pending?.request).toBe("open-1");
    expect(waiting.snapshot.current).toBeNull();
    const done = step(waiting, { type: "finish", ok: true });
    expect(done.snapshot.current?.id).toBe("sample-1");
    expect(done.entryVisible).toBe(false);
    expect(done.completion).toEqual({ request: "open-1", ok: true });
    expect(done.pending).toBeNull();
  });

  it("fails without changing workspace data and permits a successful retry", () => {
    const state = createSimulation();
    const failed = step(state, { type: "outcome", outcome: "error" }, open);
    expect(failed.error).toContain("could not be opened");
    expect(failed.snapshot).toEqual(state.snapshot);
    expect(failed.completion?.ok).toBe(false);
    const retried = step(failed, { type: "outcome", outcome: "success" }, open);
    expect(retried.error).toBe("");
    expect(retried.snapshot.current?.id).toBe("sample-1");
  });

  it("invalidates in-flight actions on reset and ignores late completion", () => {
    const waiting = step(
      createSimulation(),
      { type: "outcome", outcome: "wait" },
      open,
    );
    const reset = step(
      waiting,
      { type: "reset" },
      { type: "finish", ok: true },
    );
    expect(reset.snapshot.current).toBeNull();
    expect(reset.pending).toBeNull();
    expect(reset.epoch).toBe(waiting.epoch + 1);
  });

  it("preserves platform on scenario changes and resets all transient settings", () => {
    const changed = step(
      createSimulation(),
      { type: "platform", mobile: true },
      { type: "outcome", outcome: "error" },
      { type: "scenario", scenario: "remove" },
    );
    expect(changed.snapshot.mobile).toBe(true);
    expect(changed.nextOutcome).toBe("success");
    expect(changed.removingId).toBe("sample-1");
  });

  it("preserves feature drafts across environment changes and resets them with the scenario", () => {
    const initial = createSimulation("navigation-draft");
    const changed = step(initial, {
      type: "navigation",
      state: {
        ...initial.navigation,
        tabs: initial.navigation.tabs.map((tab) => ({
          ...tab,
          draft: "Changed draft",
        })),
      },
    });
    const resized = step(
      changed,
      { type: "environment", state: { profile: "ios", keyboardOpen: true } },
      { type: "platform", mobile: true },
    );
    expect(resized.epoch).toBe(changed.epoch);
    expect(resized.navigation.tabs[0]?.draft).toBe("Changed draft");
    const reset = step(resized, { type: "reset" });
    expect(reset.environment).toEqual(resized.environment);
    expect(reset.navigation.tabs[0]?.draft).toBe(
      initial.navigation.tabs[0]?.draft,
    );
    expect(reset.epoch).toBe(resized.epoch + 1);
  });

  it("preserves AI drafts across platforms and keeps the current platform on AI updates and resets", () => {
    const initial = createSimulation("ai-chat-existing");
    const ai = structuredClone(initial.ai);
    ai.workspaces.Personal.draft = "Keep this message";
    const edited = step(initial, { type: "ai", state: ai });
    const mobile = step(
      edited,
      { type: "platform", mobile: true },
      { type: "environment", state: { profile: "ios", keyboardOpen: true } },
    );
    expect(mobile.ai.mobile).toBe(true);
    expect(mobile.ai.workspaces).toEqual(edited.ai.workspaces);
    expect(mobile.epoch).toBe(initial.epoch);
    expect(step(mobile, { type: "ai", state: ai }).ai.mobile).toBe(true);
    const reset = step(mobile, { type: "reset" });
    expect(reset.ai.mobile).toBe(true);
    expect(reset.ai.workspaces.Personal.draft).toBe(
      initial.ai.workspaces.Personal.draft,
    );
    expect(reset.environment).toEqual(mobile.environment);
    expect(reset.epoch).toBe(initial.epoch + 1);
  });

  it("keeps current/open workspace and failure references coherent after changing examples", () => {
    const state = step(createSimulation("workspace"), {
      type: "content",
      content: "long",
    });
    expect(state.snapshot.current?.name).toContain("community garden");
    expect(state.snapshot.open[0]).toEqual(state.snapshot.current);
    const empty = step(state, { type: "content", content: "empty" });
    expect(empty.snapshot.current).toBeNull();
    expect(empty.snapshot.open).toEqual([]);
    expect(empty.entryVisible).toBe(true);
    expect(
      step(createSimulation("remove"), { type: "content", content: "empty" })
        .removingId,
    ).toBeNull();
    expect(
      step(createSimulation("restore-error"), {
        type: "content",
        content: "empty",
      }).snapshot.failures,
    ).toEqual([]);
  });

  it("removes a listing without deleting its open session", () => {
    const state = step(createSimulation("workspace"), {
      type: "action",
      operation: { request: "remove-1", action: "remove", id: "sample-1" },
    });
    expect(state.snapshot.known.some((item) => item.id === "sample-1")).toBe(
      false,
    );
    expect(state.snapshot.current?.id).toBe("sample-1");
    expect(state.snapshot.open.some((item) => item.id === "sample-1")).toBe(
      true,
    );
  });

  it("creates example workspaces and closes the current session consistently", () => {
    const created = step(createSimulation("create"), {
      type: "action",
      operation: { request: "new-1", action: "create", name: "Book list" },
    });
    expect(created.snapshot.current?.name).toBe("Book list");
    expect(created.creating).toBe(false);
    const closed = step(created, {
      type: "action",
      operation: {
        request: "close-1",
        action: "close",
        id: created.snapshot.current!.id,
      },
    });
    expect(closed.snapshot.current).toBeNull();
    expect(closed.entryVisible).toBe(true);
  });

  it("can finish or fail startup without leaving an incoherent loading state", () => {
    const loading = createSimulation("startup");
    expect(step(loading, { type: "finish", ok: true }).snapshot.ready).toBe(
      true,
    );
    const failed = step(loading, { type: "finish", ok: false });
    expect(failed.snapshot.error).toContain("could not be opened");
    expect(failed.pending).toBeNull();
    const retried = step(failed, {
      type: "action",
      operation: { request: "retry", action: "reload" },
    });
    expect(retried.snapshot.error).toBeNull();
    expect(retried.snapshot.ready).toBe(true);
  });
});
