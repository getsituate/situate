import { beforeEach, describe, expect, it, vi } from "vitest";
import { LifecycleCoordinator, type FileParticipant } from "./lifecycle";

const { invoke, filesRequest } = vi.hoisted(() => ({
  invoke: vi.fn(),
  filesRequest: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./files/api", () => ({ filesRequest }));
vi.mock("./diagnostics", () => ({ flushDiagnostics: vi.fn() }));

function setup(ids = ["one", "two"]) {
  let state: "pending" | "cancelled" | "installing" = "pending";
  invoke.mockImplementation(async (command, args) => {
    if (command === "updates_preparation_status")
      return { state, workspaceIds: ids };
    if (command === "updates_prepare_ack") {
      if (!args.approved) state = "cancelled";
      return;
    }
    throw new Error(`Unexpected command ${command}`);
  });
  const files: FileParticipant = {
    prepareClose: vi.fn(),
    completeClose: vi.fn(),
    prepareQuit: vi.fn().mockResolvedValue(true),
    cancelQuit: vi.fn(),
  };
  const report = vi.fn();
  const conversation = vi.fn().mockResolvedValue(undefined);
  const dictation = vi.fn().mockResolvedValue(true);
  const changed = vi.fn();
  const lifecycle = new LifecycleCoordinator(
    () => files,
    report,
    changed,
    conversation,
    dictation,
  );
  return {
    lifecycle,
    files,
    report,
    conversation,
    dictation,
    changed,
    setState: (value: typeof state) => {
      state = value;
    },
  };
}
beforeEach(() => vi.resetAllMocks());

describe("update preparation", () => {
  it("saves conversations and all workspace drafts before acknowledging without using ordinary quit IPC", async () => {
    const { lifecycle, files, conversation, dictation } = setup();
    await lifecycle.prepareUpdate("update-one");
    expect(conversation).toHaveBeenCalledOnce();
    expect(files.prepareQuit).toHaveBeenCalledWith(
      ["one", "two"],
      "update-one",
    );
    expect(dictation).toHaveBeenCalledWith();
    expect(invoke).toHaveBeenLastCalledWith("updates_prepare_ack", {
      token: "update-one",
      approved: true,
    });
    expect(filesRequest).not.toHaveBeenCalled();
    expect(lifecycle.quitting).toBe(true);
    lifecycle.cancelUpdate("update-one");
    expect(files.cancelQuit).toHaveBeenCalledWith("update-one");
    expect(lifecycle.quitting).toBe(false);
  });
  it.each(["files", "dictation"])(
    "honors a %s veto and resumes editing only after native cancellation",
    async (veto) => {
      const { lifecycle, files, dictation } = setup();
      if (veto === "files")
        vi.mocked(files.prepareQuit).mockResolvedValue(false);
      else dictation.mockResolvedValue(false);
      await lifecycle.prepareUpdate("update-one");
      expect(invoke).toHaveBeenLastCalledWith("updates_prepare_ack", {
        token: "update-one",
        approved: false,
        reason: veto === "files" ? "files_pending" : "dictation_active",
      });
      expect(files.cancelQuit).toHaveBeenCalledWith("update-one");
      expect(lifecycle.quitting).toBe(false);
    },
  );
  it("reports a bounded preparation stage instead of a private exception", async () => {
    const { lifecycle, conversation } = setup();
    conversation.mockRejectedValue(new Error("PRIVATE_SENTINEL"));
    await lifecycle.prepareUpdate("update-one");
    expect(invoke).toHaveBeenLastCalledWith("updates_prepare_ack", {
      token: "update-one",
      approved: false,
      reason: "conversation_save",
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("PRIVATE_SENTINEL");
  });
  it("prepares an empty window without requiring a workspace", async () => {
    const { lifecycle, files, conversation, dictation } = setup([]);
    await lifecycle.prepareUpdate("empty-window");
    expect(files.prepareQuit).not.toHaveBeenCalled();
    expect(conversation).toHaveBeenCalledOnce();
    expect(dictation).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenLastCalledWith("updates_prepare_ack", {
      token: "empty-window",
      approved: true,
    });
  });
  it("coalesces repeated prepare events and reconciles a lost cancellation broadcast", async () => {
    const { lifecycle, files, setState } = setup();
    await Promise.all([
      lifecycle.prepareUpdate("update-one"),
      lifecycle.prepareUpdate("update-one"),
    ]);
    expect(files.prepareQuit).toHaveBeenCalledOnce();
    setState("cancelled");
    expect(await lifecycle.reconcile()).toBe(true);
    expect(files.cancelQuit).toHaveBeenCalledOnce();
  });
  it("does not acknowledge an attempt cancelled while a save dialog is open", async () => {
    const { lifecycle, files } = setup();
    let resolve!: (value: boolean) => void;
    vi.mocked(files.prepareQuit).mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const preparing = lifecycle.prepareUpdate("update-one");
    await vi.waitFor(() => expect(files.prepareQuit).toHaveBeenCalledOnce());
    lifecycle.cancelUpdate("update-one");
    resolve(true);
    await preparing;
    expect(
      invoke.mock.calls.some(([command]) => command === "updates_prepare_ack"),
    ).toBe(false);
    expect(lifecycle.quitting).toBe(false);
  });
  it("does not revive cancelled preparation from a delayed pending status", async () => {
    const { lifecycle, conversation } = setup();
    let resolve!: (value: { state: string; workspaceIds: string[] }) => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const preparing = lifecycle.prepareUpdate("cancelled-status");
    lifecycle.cancelUpdate("cancelled-status");
    resolve({ state: "pending", workspaceIds: ["one"] });
    await preparing;
    expect(conversation).not.toHaveBeenCalled();
    expect(lifecycle.quitting).toBe(false);
  });
  it("releases a cancelled preparation even if its conversation save never completes", async () => {
    const { lifecycle, conversation, files } = setup();
    let resolve!: () => void;
    conversation.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const preparing = lifecycle.prepareUpdate("hung-window");
    await vi.waitFor(() => expect(conversation).toHaveBeenCalledOnce());
    lifecycle.cancelUpdate("hung-window");
    expect(lifecycle.quitting).toBe(false);
    expect(await lifecycle.reconcile()).toBe(true);
    resolve();
    await preparing;
    expect(files.prepareQuit).not.toHaveBeenCalled();
    expect(
      invoke.mock.calls.some(([command]) => command === "updates_prepare_ack"),
    ).toBe(false);
  });
  it("retains the barrier after uncertain cancellation and allows explicit reconciliation", async () => {
    const { lifecycle, conversation, changed } = setup();
    conversation.mockRejectedValue(
      new Error("native.updates.preparationFailed"),
    );
    invoke.mockImplementation(async (command) => {
      if (command === "updates_preparation_status")
        return { state: "pending", workspaceIds: ["one"] };
      throw new Error("Lost acknowledgement");
    });
    await lifecycle.prepareUpdate("update-one");
    expect(lifecycle.quitting).toBe(true);
    expect(changed).toHaveBeenCalledWith(true);
    invoke.mockResolvedValue({ state: "cancelled", workspaceIds: ["one"] });
    await lifecycle.retryCancellation();
    expect(lifecycle.quitting).toBe(false);
    expect(changed).toHaveBeenLastCalledWith(false);
  });
});
