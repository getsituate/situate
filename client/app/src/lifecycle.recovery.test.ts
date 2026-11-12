import { beforeEach, expect, it, vi } from "vitest";
import { LifecycleCoordinator, type FileParticipant } from "./lifecycle";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./files/api", () => ({ filesRequest: vi.fn() }));
vi.mock("./diagnostics", () => ({ flushDiagnostics: vi.fn() }));

function setup() {
  let state = "pending";
  invoke.mockImplementation(
    async (command: string, args: { approved: boolean }) => {
      if (command === "recovery_status")
        return { state, workspaceIds: ["one"] };
      if (command === "recovery_ack") {
        if (!args.approved) state = "rejected";
        return;
      }
      throw new Error("unexpected command");
    },
  );
  const files: FileParticipant = {
    prepareClose: vi.fn(),
    completeClose: vi.fn(),
    prepareQuit: vi.fn(),
    prepareRecovery: vi.fn().mockResolvedValue(true),
    cancelQuit: vi.fn(),
  };
  const save = vi.fn().mockResolvedValue(undefined);
  const dictation = vi.fn().mockResolvedValue(true);
  const report = vi.fn();
  const lifecycle = new LifecycleCoordinator(
    () => files,
    report,
    vi.fn(),
    save,
    dictation,
  );
  return {
    lifecycle,
    files,
    save,
    dictation,
    report,
    setState: (next: string) => {
      state = next;
    },
  };
}
beforeEach(() => vi.resetAllMocks());
it("checkpoints only captured files after dictation and UI flush, without ordinary quit or update", async () => {
  const { lifecycle, files, save, dictation } = setup();
  await Promise.all([
    lifecycle.prepareRecovery("t", "page"),
    lifecycle.prepareRecovery("t", "page"),
  ]);
  expect(dictation).toHaveBeenCalledWith("one");
  expect(save).toHaveBeenCalledExactlyOnceWith(["one"]);
  expect(files.prepareRecovery).toHaveBeenCalledWith(["one"], "t");
  expect(files.prepareQuit).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenLastCalledWith("recovery_ack", {
    token: "t",
    registration: "page",
    approved: true,
  });
  expect(lifecycle.quitting).toBe(true);
  lifecycle.finishRecovery("t", true);
  expect(files.completeClose).toHaveBeenCalledWith("one", true);
  expect(lifecycle.quitting).toBe(false);
});
it("does not inspect foreign windows when flushing the host-authorized recovery scopes", async () => {
  const { lifecycle, save } = setup();
  const running = new Set(["foreign-window"]);
  save.mockImplementation(async (scopes?: readonly string[]) => {
    if (!scopes || scopes.some((scope) => running.has(scope)))
      throw new Error("foreign execution");
  });
  await lifecycle.prepareRecovery("t", "page");
  expect(save).toHaveBeenCalledExactlyOnceWith(["one"]);
  expect(invoke).toHaveBeenLastCalledWith("recovery_ack", {
    token: "t",
    registration: "page",
    approved: true,
  });
});
it("keeps ordinary update checkpoint calls unscoped", async () => {
  const { lifecycle, save } = setup();
  invoke.mockImplementation(async (command: string) => {
    if (command === "updates_preparation_status")
      return { state: "pending", workspaceIds: [] };
  });
  await lifecycle.prepareUpdate("update");
  expect(save).toHaveBeenCalledExactlyOnceWith();
});
it("keeps the barrier after failed save until cancellation is confirmed", async () => {
  const { lifecycle, files, save, report, setState } = setup();
  save.mockRejectedValue({
    get message() {
      throw new Error("private");
    },
  });
  await lifecycle.prepareRecovery("t", "page");
  expect(report).toHaveBeenCalledWith("native.recovery.failed");
  expect(files.prepareRecovery).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledWith("recovery_ack", {
    token: "t",
    registration: "page",
    approved: false,
  });
  expect(lifecycle.quitting).toBe(true);
  setState("cancelled");
  expect(await lifecycle.reconcile()).toBe(true);
  expect(files.cancelQuit).toHaveBeenCalledWith("t");
});
it("reconciles an archived cancellation after a newer native attempt without releasing that newer attempt", async () => {
  const { lifecycle, files } = setup();
  await lifecycle.prepareRecovery("old", "page");
  const cancelled = vi.fn();
  lifecycle.onRecoveryCancelled(cancelled);
  invoke.mockImplementation(
    async (command: string, args: { token: string }) => {
      if (command === "recovery_status")
        return {
          state: args.token === "old" ? "cancelled" : "pending",
          workspaceIds: ["one"],
        };
      throw new Error("unexpected write");
    },
  );
  expect(await lifecycle.reconcile()).toBe(true);
  expect(files.cancelQuit).toHaveBeenCalledExactlyOnceWith("old");
  expect(cancelled).toHaveBeenCalledExactlyOnceWith("old");
  expect(invoke).toHaveBeenLastCalledWith("recovery_status", { token: "old" });
});
it("never acknowledges a late save after cancellation", async () => {
  const { lifecycle, save, files } = setup();
  let resolve!: () => void;
  save.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const preparing = lifecycle.prepareRecovery("t", "page");
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
  lifecycle.finishRecovery("t");
  resolve();
  await preparing;
  expect(files.prepareRecovery).not.toHaveBeenCalled();
  expect(
    invoke.mock.calls.some(([command]) => command === "recovery_ack"),
  ).toBe(false);
});
it("does not revive a delayed preparation status after cancellation", async () => {
  const { lifecycle, save } = setup();
  let resolve!: (status: unknown) => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const preparing = lifecycle.prepareRecovery("t", "page");
  lifecycle.finishRecovery("t");
  resolve({ state: "pending", workspaceIds: ["one"] });
  await preparing;
  expect(save).not.toHaveBeenCalled();
  expect(lifecycle.quitting).toBe(false);
});
