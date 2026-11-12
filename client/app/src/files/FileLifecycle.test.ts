import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import FileLifecycle from "./FileLifecycle.vue";
import { LifecycleCoordinator } from "../lifecycle";
import { invoke as hostInvoke } from "@tauri-apps/api/core";
import { filesRequest, type FilesReply } from "./api";
import {
  releaseWorkspace,
  retainedWorkspaces,
  workspaceSession,
} from "./sessions";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  filesRequest: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invoke = vi.mocked(filesRequest);
const calls = () => invoke.mock.calls.map(([request]) => request);
const deferred = () => {
  let resolve!: (value: FilesReply) => void;
  const promise = new Promise<FilesReply>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll("button").find((button) => button.text() === text)!;
}
let count = 0;
async function setup(
  options: {
    failure?: boolean;
    canExport?: boolean;
    two?: boolean;
    prepareConversations?: () => Promise<void>;
    prepareDictation?: (scope?: string) => Promise<boolean>;
  } = {},
) {
  const id = `lifecycle-${++count}`;
  vi.mocked(hostInvoke)
    .mockReset()
    .mockResolvedValue({ sequence: 1, state: "pending", workspaceIds: [id] });
  invoke.mockImplementation(async (request) => {
    switch (request.operation) {
      case "snapshot":
        return {
          status: "ok",
          snapshot: {
            writable: true,
            canExport: options.canExport ?? true,
            reason: null,
            entries: [
              { path: "One.md", isDirectory: false },
              { path: "Two.md", isDirectory: false },
            ],
            drafts: (options.two ? ["One.md", "Two.md"] : ["One.md"]).map(
              (path) => ({
                path,
                text: `# Retained ${path}`,
                base: { text: "# Original", revision: "base" },
              }),
            ),
          },
        };
      case "save":
        if (options.failure) throw new Error("Disk full");
        return {
          status: "saved",
          document: {
            path: request.path!,
            version: { text: request.text!, revision: "saved" },
            html: "",
            issues: [],
          },
        };
      case "read":
        return {
          status: "ok",
          document: {
            path: request.path!,
            version: { text: "# Current file", revision: "current" },
            html: "",
            issues: [],
          },
        };
      case "detach":
      case "discard":
      case "cancelQuit":
      case "quitReady":
        return { status: "ok" };
      case "export":
        return { status: "cancelled" };
      default:
        throw new Error(`Unexpected operation: ${request.operation}`);
    }
  });
  const wrapper = mount(FileLifecycle, { attachTo: document.body });
  const report = vi.fn();
  const cancellationChanged = vi.fn();
  const lifecycle = new LifecycleCoordinator(
    () => wrapper.vm,
    report,
    cancellationChanged,
    options.prepareConversations,
    options.prepareDictation,
  );
  await flushPromises();
  return { id, wrapper, lifecycle, report, cancellationChanged };
}
enableAutoUnmount(afterEach);
beforeEach(() => {
  invoke.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  retainedWorkspaces().forEach(releaseWorkspace);
  document.body.replaceChildren();
});

describe("workspace closure and quit", () => {
  it("checkpoints recovery without a dialog and releases only affected file owners after confirmation", async () => {
    const { id, wrapper } = await setup({ two: true });
    const other = workspaceSession("other-recovery-workspace");
    expect(await wrapper.vm.prepareRecovery([id], "recovery-one")).toBe(true);
    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(workspaceSession(id).closing).toBe(true);
    expect(other.closing).toBe(false);
    expect(calls().map((call) => call.operation)).toEqual([
      "snapshot",
      "save",
      "save",
    ]);
    wrapper.vm.cancelQuit("recovery-one");
    wrapper.vm.completeClose(id, true);
    expect(retainedWorkspaces()).toContain(other);
    expect(retainedWorkspaces().some((session) => session.id === id)).toBe(
      false,
    );
  });

  it("vetoes failed recovery saves without discarding text or releasing the barrier", async () => {
    const { id, wrapper } = await setup({ failure: true });
    expect(await wrapper.vm.prepareRecovery([id], "recovery-one")).toBe(false);
    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(workspaceSession(id).closing).toBe(true);
    expect(workspaceSession(id).files["One.md"]?.text).toBe(
      "# Retained One.md",
    );
    expect(
      calls().some(
        (call) => call.operation === "discard" || call.operation === "detach",
      ),
    ).toBe(false);
    wrapper.vm.cancelQuit("recovery-one");
    expect(workspaceSession(id).closing).toBe(false);
  });
  it("flushes every retained file before detaching the workspace", async () => {
    const { id, wrapper } = await setup({ two: true });
    expect(await wrapper.vm.prepareClose(id)).toBe(true);
    expect(calls().map((call) => call.operation)).toEqual([
      "snapshot",
      "save",
      "save",
      "detach",
    ]);
    expect(workspaceSession(id).closing).toBe(true);
    wrapper.vm.completeClose(id, true);
    expect(retainedWorkspaces().some((session) => session.id === id)).toBe(
      false,
    );
  });

  it("cancels a failed close without detaching or losing text", async () => {
    const { id, wrapper } = await setup({ failure: true });
    const closing = wrapper.vm.prepareClose(id);
    await flushPromises();
    expect(wrapper.get("dialog").text()).toContain(
      "⟦localization.unknownError⟧",
    );
    await button(wrapper, "⟦navigation.cancel⟧").trigger("click");
    expect(await closing).toBe(false);
    expect(workspaceSession(id).files["One.md"]?.text).toBe(
      "# Retained One.md",
    );
    expect(workspaceSession(id).closing).toBe(false);
    expect(calls().some((call) => call.operation === "detach")).toBe(false);
  });

  it("requires confirmation to close after a snapshot failure without deleting workspace data", async () => {
    const { id, wrapper, lifecycle } = await setup();
    const previous = invoke.getMockImplementation()!;
    invoke.mockImplementation((request) =>
      request.operation === "snapshot"
        ? Promise.reject(new Error("native.content.reference.invalid"))
        : previous(request),
    );
    const commit = vi.fn().mockResolvedValue(true);
    const closing = lifecycle.close(id, commit);
    await flushPromises();
    expect(wrapper.get("dialog").text()).not.toContain("⟦files.unsavedClose⟧");
    await button(wrapper, "⟦files.closeAnyway⟧").trigger("click");
    expect(wrapper.text()).toContain("⟦files.forceCloseDetail⟧");
    expect(commit).not.toHaveBeenCalled();
    expect(calls().some((call) => call.operation === "detach")).toBe(false);
    await button(wrapper, "⟦workspace.closeWorkspace⟧").trigger("click");
    expect(await closing).toBe("closed");
    expect(commit).toHaveBeenCalledOnce();
    expect(calls().map((call) => call.operation)).toEqual([
      "snapshot",
      "detach",
    ]);
    expect(calls()[1]).toEqual({
      workspaceId: id,
      operation: "detach",
      force: true,
    });
    expect(retainedWorkspaces().some((session) => session.id === id)).toBe(
      false,
    );
  });

  it("retains recovery drafts when closing without saving is confirmed", async () => {
    const { id, wrapper } = await setup({ failure: true });
    const closing = wrapper.vm.prepareClose(id);
    await flushPromises();
    await button(wrapper, "⟦files.closeAnyway⟧").trigger("click");
    await button(wrapper, "⟦workspace.closeWorkspace⟧").trigger("click");
    expect(await closing).toBe(true);
    expect(workspaceSession(id).files["One.md"]?.dirty).toBe(true);
    expect(workspaceSession(id).files["One.md"]?.text).toBe(
      "# Retained One.md",
    );
    expect(calls().some((call) => call.operation === "discard")).toBe(false);
    expect(calls().at(-1)).toEqual({
      workspaceId: id,
      operation: "detach",
      force: true,
    });
    wrapper.vm.completeClose(id, true);
  });

  it("cancels forced closure without dropping edits or retaining its confirmation", async () => {
    const { id, wrapper } = await setup({ failure: true });
    const closing = wrapper.vm.prepareClose(id);
    await flushPromises();
    await button(wrapper, "⟦files.closeAnyway⟧").trigger("click");
    await button(wrapper, "⟦navigation.cancel⟧").trigger("click");
    expect(await closing).toBe(false);
    expect(workspaceSession(id).files["One.md"]?.dirty).toBe(true);
    expect(calls().some((call) => call.operation === "detach")).toBe(false);
    const retry = wrapper.vm.prepareClose(id);
    await flushPromises();
    expect(button(wrapper, "⟦workspace.closeWorkspace⟧")).toBeUndefined();
    expect(button(wrapper, "⟦files.closeAnyway⟧")).toBeDefined();
    await button(wrapper, "⟦navigation.cancel⟧").trigger("click");
    expect(await retry).toBe(false);
  });

  it("does not offer forced file closure during application quit or update preparation", async () => {
    const { id, wrapper } = await setup({ failure: true });
    const preparing = wrapper.vm.prepareQuit([id], "preparation");
    await flushPromises();
    expect(button(wrapper, "⟦files.closeAnyway⟧")).toBeUndefined();
    wrapper.vm.cancelQuit("preparation");
    expect(await preparing).toBe(false);
    expect(calls().some((call) => call.operation === "detach")).toBe(false);
  });

  it("does not prepare file detachment when dictation closure is cancelled and permits retry", async () => {
    const dictation = vi.fn().mockResolvedValue(false);
    const { id, lifecycle } = await setup({ prepareDictation: dictation });
    const commit = vi.fn().mockResolvedValue(true);
    expect(await lifecycle.close(id, commit)).toBe("cancelled");
    expect(dictation).toHaveBeenCalledWith(id);
    expect(calls()).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
    expect(workspaceSession(id).closing).toBe(false);
    dictation.mockResolvedValue(true);
    expect(await lifecycle.close(id, commit)).toBe("closed");
    expect(commit).toHaveBeenCalledOnce();
    expect(calls().map((call) => call.operation)).toEqual([
      "snapshot",
      "save",
      "detach",
    ]);
  });

  it("requires explicit discard confirmation and removes drafts before closing", async () => {
    const { id, wrapper } = await setup({ failure: true });
    const closing = wrapper.vm.prepareClose(id);
    await flushPromises();
    await button(wrapper, "⟦files.discardChanges⟧").trigger("click");
    expect(calls().some((call) => call.operation === "discard")).toBe(false);
    await button(wrapper, "⟦files.discardClose⟧").trigger("click");
    expect(await closing).toBe(true);
    expect(
      calls()
        .slice(-3)
        .map((call) => call.operation),
    ).toEqual(["discard", "read", "detach"]);
  });

  it("does not discard text or approve closure after an export picker cancellation", async () => {
    const { id, wrapper } = await setup({ failure: true });
    const closing = wrapper.vm.prepareClose(id);
    await flushPromises();
    await button(wrapper, "⟦files.exportCopies⟧").trigger("click");
    expect(await closing).toBe(false);
    expect(workspaceSession(id).files["One.md"]?.dirty).toBe(true);
    expect(
      calls().some((call) => ["discard", "detach"].includes(call.operation)),
    ).toBe(false);
  });

  it("only discards the original draft after a successful durable export", async () => {
    const { id, wrapper } = await setup({ failure: true });
    const closing = wrapper.vm.prepareClose(id);
    await flushPromises();
    const pending = deferred();
    const previous = invoke.getMockImplementation()!;
    invoke.mockImplementation((request) =>
      request.operation === "export" ? pending.promise : previous(request),
    );
    await button(wrapper, "⟦files.exportCopies⟧").trigger("click");
    expect(calls().some((call) => call.operation === "discard")).toBe(false);
    pending.resolve({ status: "ok" });
    expect(await closing).toBe(true);
    expect(
      calls()
        .slice(-4)
        .map((call) => call.operation),
    ).toEqual(["export", "discard", "read", "detach"]);
  });

  it("disables unavailable mobile exports without claiming a copy exists", async () => {
    const { id, wrapper } = await setup({ failure: true, canExport: false });
    const closing = wrapper.vm.prepareClose(id);
    await flushPromises();
    expect(button(wrapper, "⟦files.exportCopies⟧").element.disabled).toBe(true);
    expect(wrapper.text()).toContain(
      "⟦files.exportingASecuredCopyToAnotherLocationIsUnavailable⟧",
    );
    await button(wrapper, "⟦navigation.cancel⟧").trigger("click");
    await closing;
    expect(calls().some((call) => call.operation === "export")).toBe(false);
  });

  it("waits for conversation persistence before file preparation and quit acknowledgement", async () => {
    let release!: () => void;
    const persistence = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { lifecycle } = await setup({
      prepareConversations: () => persistence,
    });
    const quitting = lifecycle.quit("chat-pending");
    await flushPromises();
    expect(lifecycle.quitting).toBe(true);
    expect(calls()).toEqual([]);
    release();
    await quitting;
    expect(calls().at(-1)).toMatchObject({
      operation: "quitReady",
      token: "chat-pending",
    });
    expect(lifecycle.quitting).toBe(true);
    lifecycle.cancelQuit("chat-pending");
    expect(lifecycle.quitting).toBe(false);
  });

  it("cancels the host quit barrier when conversation persistence fails", async () => {
    const { lifecycle, report } = await setup({
      prepareConversations: async () => {
        throw new Error("ai.saveTheConversationBeforeClosing");
      },
    });
    await lifecycle.quit("chat-failure");
    expect(calls()).toEqual([
      expect.objectContaining({
        operation: "cancelQuit",
        token: "chat-failure",
      }),
    ]);
    expect(report).toHaveBeenCalledWith("ai.saveTheConversationBeforeClosing");
    expect(lifecycle.quitting).toBe(false);
  });

  it("acknowledges only the current quit nonce after every retained file is saved", async () => {
    const { id, lifecycle } = await setup({ two: true });
    void lifecycle.quit("quit-one");
    await flushPromises();
    expect(calls().map((call) => call.operation)).toEqual([
      "snapshot",
      "save",
      "save",
      "quitReady",
    ]);
    expect(calls().at(-1)).toMatchObject({
      operation: "quitReady",
      token: "quit-one",
    });
    expect(workspaceSession(id).closing).toBe(true);
    lifecycle.cancelQuit("older-quit");
    expect(workspaceSession(id).closing).toBe(true);
    lifecycle.cancelQuit("quit-one");
    expect(workspaceSession(id).closing).toBe(false);
  });

  it("ignores late save completion after cancellation instead of approving quit", async () => {
    const { id, lifecycle } = await setup();
    const response = deferred();
    const previous = invoke.getMockImplementation()!;
    invoke.mockImplementation((request) =>
      request.operation === "save" ? response.promise : previous(request),
    );
    void lifecycle.quit("cancelled-quit");
    await flushPromises();
    lifecycle.cancelQuit("cancelled-quit");
    response.resolve({
      status: "saved",
      document: {
        path: "One.md",
        version: { text: "# Retained One.md", revision: "saved" },
        html: "",
        issues: [],
      },
    });
    await flushPromises();
    expect(workspaceSession(id).closing).toBe(false);
    expect(calls().some((call) => call.operation === "quitReady")).toBe(false);
  });

  it("cancels the matching global quit barrier when quitReady is rejected", async () => {
    const { id, lifecycle, report } = await setup();
    const previous = invoke.getMockImplementation()!;
    invoke.mockImplementation((request) =>
      request.operation === "quitReady"
        ? Promise.reject(new Error("The quit acknowledgement was rejected."))
        : previous(request),
    );
    void lifecycle.quit("rejected-quit");
    await flushPromises();
    expect(
      calls()
        .slice(-2)
        .map((call) => ({ operation: call.operation, token: call.token })),
    ).toEqual([
      { operation: "quitReady", token: "rejected-quit" },
      { operation: "cancelQuit", token: "rejected-quit" },
    ]);
    expect(workspaceSession(id).closing).toBe(false);
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("acknowledgement was rejected"),
    );
  });

  it("retains a rejected cancellation until an explicit retry confirms host rollback", async () => {
    const { id, wrapper, lifecycle, cancellationChanged } = await setup({
      failure: true,
    });
    const previous = invoke.getMockImplementation()!;
    let cancellations = 0;
    invoke.mockImplementation((request) => {
      if (request.operation === "cancelQuit" && ++cancellations === 1)
        return Promise.reject(new Error("IPC unavailable"));
      return previous(request);
    });
    void lifecycle.quit("retryable-quit");
    await flushPromises();
    await button(wrapper, "⟦navigation.cancel⟧").trigger("click");
    await flushPromises();
    expect(cancellations).toBe(1);
    expect(cancellationChanged).toHaveBeenLastCalledWith(true);
    expect(workspaceSession(id).closing).toBe(true);
    expect(workspaceSession(id).files["One.md"]?.dirty).toBe(true);
    expect(await lifecycle.reconcile()).toBe(false);
    expect(cancellations).toBe(1);
    await lifecycle.retryCancellation();
    expect(cancellations).toBe(2);
    expect(cancellationChanged).toHaveBeenLastCalledWith(false);
    expect(workspaceSession(id).closing).toBe(false);
    expect(workspaceSession(id).files["One.md"]?.text).toBe(
      "# Retained One.md",
    );
  });

  it("confirms rollback through host status when the cancellation broadcast or reply fails", async () => {
    const { id, wrapper, lifecycle, cancellationChanged } = await setup({
      failure: true,
    });
    const previous = invoke.getMockImplementation()!;
    invoke.mockImplementation((request) => {
      if (request.operation === "cancelQuit") {
        vi.mocked(hostInvoke).mockResolvedValue({
          sequence: 1,
          state: "cancelled",
          workspaceIds: [id],
        });
        return Promise.reject(new Error("Broadcast failed after rollback"));
      }
      return previous(request);
    });
    void lifecycle.quit("lost-broadcast");
    await flushPromises();
    await button(wrapper, "⟦navigation.cancel⟧").trigger("click");
    await flushPromises();
    expect(workspaceSession(id).closing).toBe(false);
    expect(cancellationChanged).toHaveBeenLastCalledWith(false);
    expect(
      calls().filter((call) => call.operation === "cancelQuit"),
    ).toHaveLength(1);
    expect(await lifecycle.reconcile()).toBe(true);
  });

  it("reconciles a missed cancellation before closing a workspace that was awaiting quit", async () => {
    const { id, lifecycle } = await setup();
    await lifecycle.quit("missed-cancellation");
    expect(workspaceSession(id).closing).toBe(true);
    vi.mocked(hostInvoke).mockResolvedValue({
      sequence: 1,
      state: "cancelled",
      workspaceIds: [id],
    });
    const commit = vi.fn(async () => true);
    expect(await lifecycle.close(id, commit)).toBe("closed");
    expect(commit).toHaveBeenCalledOnce();
    expect(calls().at(-1)?.operation).toBe("detach");
    expect(calls().some((call) => call.operation === "cancelQuit")).toBe(false);
  });

  it("does not prepare a cancelled token delivered after its cancellation event", async () => {
    const { lifecycle } = await setup();
    lifecycle.cancelQuit("already-cancelled");
    await lifecycle.quit("already-cancelled");
    expect(invoke).not.toHaveBeenCalled();
    expect(hostInvoke).not.toHaveBeenCalled();
  });

  it("checks host status before preparing an obsolete token even when its cancellation event was missed", async () => {
    const { id, lifecycle } = await setup();
    vi.mocked(hostInvoke).mockResolvedValue({
      sequence: 1,
      state: "cancelled",
      workspaceIds: [id],
    });
    await lifecycle.quit("obsolete");
    expect(hostInvoke).toHaveBeenCalledExactlyOnceWith("lifecycle_status", {
      token: "obsolete",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not let a delayed old status response replace a newer pending quit", async () => {
    const { id, lifecycle } = await setup();
    let finishOld!: (status: unknown) => void;
    vi.mocked(hostInvoke).mockImplementation(async (_command, args) =>
      args && "token" in args && args.token === "old"
        ? new Promise((resolve) => {
            finishOld = resolve;
          })
        : { sequence: 2, state: "pending", workspaceIds: [id] },
    );
    const old = lifecycle.quit("old");
    await flushPromises();
    await lifecycle.quit("new");
    expect(
      calls()
        .filter((call) => call.operation === "quitReady")
        .map((call) => call.token),
    ).toEqual(["new"]);
    finishOld({ sequence: 1, state: "pending", workspaceIds: [id] });
    await old;
    lifecycle.cancelQuit("old");
    expect(workspaceSession(id).closing).toBe(true);
    expect(
      calls()
        .filter((call) => call.operation === "quitReady")
        .map((call) => call.token),
    ).toEqual(["new"]);
    lifecycle.cancelQuit("new");
    expect(workspaceSession(id).closing).toBe(false);
  });

  it("sends cancelQuit with its nonce and keeps failed drafts in the workspace", async () => {
    const { id, wrapper, lifecycle } = await setup({ failure: true });
    void lifecycle.quit("quit-failure");
    await flushPromises();
    await button(wrapper, "⟦navigation.cancel⟧").trigger("click");
    await flushPromises();
    expect(calls().at(-1)).toMatchObject({
      operation: "cancelQuit",
      token: "quit-failure",
    });
    expect(workspaceSession(id).files["One.md"]?.text).toBe(
      "# Retained One.md",
    );
    expect(calls().some((call) => call.operation === "quitReady")).toBe(false);
  });
});
