import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LifecycleCoordinator, type FileParticipant } from "../lifecycle";
import {
  installRecoveryLifecycle,
  openRecoveryEmail,
  requestRecovery,
  recoveryPreparing,
} from "./native";

const { invoke, listen, handlers } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  handlers: new Map<string, (event: { payload: string }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("../files/api", () => ({ filesRequest: vi.fn() }));
vi.mock("../diagnostics", () => ({ flushDiagnostics: vi.fn() }));
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  handlers.clear();
  recoveryPreparing.value = false;
  listen.mockImplementation(
    async (event: string, handler: (event: { payload: string }) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  );
  invoke.mockImplementation(async (command: string) => {
    if (command === "recovery_register") return "page";
    if (command === "recovery_request") return "t";
    if (command === "recovery_status")
      return { state: "completed", workspaceIds: ["one"] };
    if (command === "recovery_open_email") return true;
    throw new Error("unexpected command");
  });
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
});
function coordinator() {
  return {
    prepareRecovery: vi.fn().mockResolvedValue(undefined),
    finishRecovery: vi.fn(),
    releaseRecoveryFiles: vi.fn(),
    onRecoveryCompleted: vi.fn().mockReturnValue(() => {}),
    onRecoveryCancelled: vi.fn().mockReturnValue(() => {}),
  } as unknown as LifecycleCoordinator;
}
it("registers after listeners, routes preparation and resets only confirmed scopes once", async () => {
  const lifecycle = coordinator();
  const refresh = vi.fn().mockResolvedValue(undefined);
  dispose = await installRecoveryLifecycle(lifecycle, refresh);
  handlers.get("recovery-prepare")!({ payload: "t" });
  expect(recoveryPreparing.value).toBe(true);
  expect(lifecycle.prepareRecovery).toHaveBeenCalledWith("t", "page");
  handlers.get("recovery-completed")!({ payload: "t" });
  await requestRecovery("workspace", "one");
  expect(lifecycle.finishRecovery).toHaveBeenCalledWith("t", true);
  expect(refresh).toHaveBeenCalledExactlyOnceWith(["one"]);
  expect(recoveryPreparing.value).toBe(false);
  expect(invoke).toHaveBeenCalledWith("recovery_request", {
    kind: "workspace",
    scope: "one",
  });
  dispose();
  expect(handlers.size).toBe(0);
});
it("does not reset owners after failure or unconfirmed completion", async () => {
  const lifecycle = coordinator();
  const refresh = vi.fn();
  dispose = await installRecoveryLifecycle(lifecycle, refresh);
  invoke.mockImplementation(async (command: string) => {
    if (command === "recovery_request") return "t";
    return { state: "cancelled", workspaceIds: ["one"] };
  });
  await expect(requestRecovery("workspace", "one")).rejects.toThrow(
    "native.recovery.failed",
  );
  expect(refresh).not.toHaveBeenCalled();
  expect(lifecycle.finishRecovery).not.toHaveBeenCalled();
});
async function preparedRecovery(
  refresh: (scopes: readonly string[]) => Promise<void>,
) {
  let state = "pending";
  invoke.mockImplementation(async (command: string) => {
    if (command === "recovery_register") return "page";
    if (command === "recovery_status") return { state, workspaceIds: ["one"] };
    if (command === "recovery_request") throw new Error("reply lost");
    if (command === "recovery_ack") {
      if (state !== "pending") throw new Error("terminal attempt");
      return;
    }
    throw new Error("unexpected command");
  });
  const files: FileParticipant = {
    prepareClose: vi.fn(),
    completeClose: vi.fn(),
    prepareQuit: vi.fn(),
    prepareRecovery: vi.fn().mockResolvedValue(true),
    cancelQuit: vi.fn(),
  };
  const lifecycle = new LifecycleCoordinator(() => files, vi.fn());
  dispose = await installRecoveryLifecycle(lifecycle, refresh);
  handlers.get("recovery-prepare")!({ payload: "t" });
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("recovery_ack", {
      token: "t",
      registration: "page",
      approved: true,
    }),
  );
  return {
    lifecycle,
    files,
    setState: (value: string) => {
      state = value;
    },
  };
}
it("reconciles completed readback after both completion deliveries are lost, keeping UI inert until scoped refresh succeeds", async () => {
  let resolve!: () => void;
  const refresh = vi.fn().mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const { lifecycle, files, setState } = await preparedRecovery(refresh);
  setState("completed");
  await expect(requestRecovery("workspace", "one")).rejects.toThrow(
    "reply lost",
  );
  const retry = lifecycle.retryCancellation();
  await vi.waitFor(() =>
    expect(refresh).toHaveBeenCalledExactlyOnceWith(["one"]),
  );
  expect(recoveryPreparing.value).toBe(true);
  expect(lifecycle.quitting).toBe(true);
  expect(files.completeClose).toHaveBeenCalledExactlyOnceWith("one", true);
  resolve();
  await retry;
  expect(recoveryPreparing.value).toBe(false);
  expect(lifecycle.quitting).toBe(false);
});
it("retries failed scoped refresh without replaying native recovery or releasing fresh file owners", async () => {
  const refresh = vi
    .fn()
    .mockRejectedValueOnce(new Error("refresh failed"))
    .mockResolvedValueOnce(undefined);
  const { lifecycle, files, setState } = await preparedRecovery(refresh);
  setState("completed");
  await lifecycle.retryCancellation();
  expect(refresh).toHaveBeenCalledExactlyOnceWith(["one"]);
  expect(recoveryPreparing.value).toBe(true);
  expect(lifecycle.quitting).toBe(true);
  expect(await lifecycle.reconcile()).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenLastCalledWith(["one"]);
  expect(files.completeClose).toHaveBeenCalledExactlyOnceWith("one", true);
  expect(recoveryPreparing.value).toBe(false);
  expect(
    invoke.mock.calls.some(([command]) => command === "recovery_request"),
  ).toBe(false);
});
it("never reports cancellation readback as completed recovery or refreshes its workspace", async () => {
  const refresh = vi.fn();
  const { lifecycle, files, setState } = await preparedRecovery(refresh);
  setState("cancelled");
  await lifecycle.retryCancellation();
  expect(refresh).not.toHaveBeenCalled();
  expect(files.completeClose).not.toHaveBeenCalled();
  expect(files.cancelQuit).toHaveBeenCalledExactlyOnceWith("t");
  expect(recoveryPreparing.value).toBe(false);
  expect(lifecycle.quitting).toBe(false);
});
it("passes the exact report as data and returns false when unavailable or oversized", async () => {
  const body = "Description: Grüße & ?#%\nTechnical details: 日本語";
  expect(await openRecoveryEmail(body)).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("recovery_open_email", { body });
  invoke.mockRejectedValue(new Error("unavailable"));
  expect(await openRecoveryEmail(body)).toBe(false);
  invoke.mockClear();
  expect(await openRecoveryEmail("界".repeat(2731))).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});
it("cleans up listeners when registration fails", async () => {
  invoke.mockRejectedValue(new Error("unavailable"));
  await expect(
    installRecoveryLifecycle(coordinator(), vi.fn()),
  ).rejects.toThrow();
  expect(handlers.size).toBe(0);
});
