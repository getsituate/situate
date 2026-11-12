import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { localizeError } from "@situate/localization";
import { invoke } from "@tauri-apps/api/core";
import { action, snapshot } from "./workspaces/api";
import App from "./App.vue";
import { retainWorkspaceUi, workspaceUi } from "./layout/runtime";
import { closeChats, workspaceChat } from "./ai/chat";
import { filesRequest } from "./files/api";
import { releaseWorkspace, retainedWorkspaces } from "./files/sessions";

vi.mock("./files/api", async (original) => ({
  ...(await original<typeof import("./files/api")>()),
  filesRequest: vi.fn(),
}));

const { events, cancelLogin } = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  cancelLogin: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async () => {}),
  Channel: class {
    onmessage = (_event: unknown) => {};
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      events.set(name, handler);
      return () => events.delete(name);
    },
  ),
}));
vi.mock("./workspaces/api", async (original) => ({
  ...(await original<typeof import("./workspaces/api")>()),
  action: vi.fn(),
  snapshot: vi.fn(),
}));
const Setup = defineComponent({
  props: { notice: String },
  setup(props, { expose }) {
    expose({ cancelAndWait: cancelLogin });
    return () =>
      h(
        "section",
        props.notice
          ? [h("p", { role: "alert" }, localizeError(props.notice))]
          : [],
      );
  },
});
function mountSetup() {
  return mount(App, { global: { stubs: { AiSetup: Setup } } });
}
enableAutoUnmount(afterEach);
afterEach(() => {
  retainWorkspaceUi([]);
  retainedWorkspaces().forEach(releaseWorkspace);
  vi.useRealTimers();
});
beforeEach(() => {
  retainWorkspaceUi([]);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.mocked(filesRequest)
    .mockReset()
    .mockImplementation(async (request) =>
      request.operation === "snapshot"
        ? {
            status: "ok",
            snapshot: { writable: true, entries: [], drafts: [], reason: null },
          }
        : { status: "ok" },
    );
  closeChats([]);
  events.clear();
  cancelLogin.mockReset().mockResolvedValue(undefined);
  vi.mocked(action).mockReset().mockResolvedValue(true);
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      const request = (args as { request?: { operation: string } } | undefined)
        ?.request;
      if (command === "plugin_executor") {
        switch (request?.operation) {
          case "activity":
          case "stop":
            return { runningActions: 0 };
          case "snapshot":
            return { plugins: [], unavailable: [] };
          case "pendingPersistences":
            return [];
          default:
            throw new Error("Unexpected executor request");
        }
      }
      if (command === "plugin_runtime") return { plugins: [], revision: null };
      if (command === "layout_load") return { revision: null, data: null };
      if (command === "layout_save")
        return { revision: "layout-1", data: (args as { data: unknown }).data };
      if (command === "lifecycle_status")
        return { sequence: 1, state: "pending", workspaceIds: ["garden"] };
      if (command === "localization_snapshot")
        return {
          language: "en",
          formats: { time: "12", date: "mdy", number: "dot-comma" },
          writable: true,
        };
      return undefined;
    });
  const garden = { id: "garden", name: "Garden", display: "/Documents/Garden" };
  vi.mocked(snapshot).mockResolvedValue({
    ready: true,
    mobile: false,
    known: [garden],
    open: [garden],
    current: garden,
    failures: [],
    error: null,
    aiSetup: true,
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function runningProcesses() {
  const activity = vi.fn().mockReturnValue({ runningActions: 1 });
  const stop = vi.fn().mockImplementation(async () => {
    activity.mockReturnValue({ runningActions: 0 });
  });
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, args) => {
    const params = args as
      { scope?: string; request?: { operation: string } } | undefined;
    if (command === "plugin_executor" && params?.scope === "garden") {
      const operation = params.request?.operation;
      if (operation === "activity") return Promise.resolve(activity());
      if (operation === "stop") return stop();
    }
    return implementation(command, args);
  });
  return { activity, stop };
}

test.each(["files-close-requested", "ai-close-requested"])(
  "%s checks native processes before files; Cancel retains the process",
  async (event) => {
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) =>
      command === "ai_prepare_close"
        ? { processes: true }
        : implementation(command, args),
    );
    const wrapper = mountSetup();
    await flushPromises();
    events.get(event)!({ payload: "garden" });
    await vi.waitFor(
      () => {
        expect(
          wrapper.get<HTMLDialogElement>(
            "dialog[aria-labelledby=close-ai-title]",
          ).element.open,
        ).toBe(true);
      },
      { timeout: 5000 },
    );
    const dialog = wrapper.get("dialog[aria-labelledby=close-ai-title]");
    expect(filesRequest).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
    await dialog
      .findAll("button")
      .find((button) => button.text() === "⟦navigation.cancel⟧")!
      .trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("ai_cancel_close", { scope: "garden" });
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([name]) => name === "plugin_process_abort"),
    ).toBe(false);
    expect(filesRequest).not.toHaveBeenCalled();
  },
);

test("a native running-work close request never closes from an idle frontend snapshot", async () => {
  const wrapper = mountSetup();
  await flushPromises();
  events.get("ai-close-requested")!({
    payload: { scope: "garden", processes: false },
  });
  await vi.waitFor(
    () => {
      expect(
        wrapper.get<HTMLDialogElement>("dialog[aria-labelledby=close-ai-title]")
          .element.open,
      ).toBe(true);
    },
    { timeout: 5000 },
  );
  expect(action).not.toHaveBeenCalled();
  expect(filesRequest).not.toHaveBeenCalled();
});

test("Abort waits for pending consent and native cleanup before file preparation", async () => {
  const process = await runningProcesses();
  const consent = deferred<void>();
  const native = deferred<void>();
  process.stop.mockImplementation(async () => {
    await consent.promise;
    process.activity.mockReturnValue({ runningActions: 0 });
  });
  let nativeActive = true;
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "ai_prepare_close") return { processes: nativeActive };
    if (command === "plugin_process_abort") {
      await native.promise;
      nativeActive = false;
      return;
    }
    return implementation(command, args);
  });
  const wrapper = mountSetup();
  await flushPromises();
  events.get("files-close-requested")!({ payload: "garden" });
  await flushPromises();
  await wrapper
    .get("dialog[aria-labelledby=close-ai-title]")
    .findAll("button")
    .find((button) => button.text() === "⟦navigation.abortNowAndClose⟧")!
    .trigger("click");
  await flushPromises();
  expect(process.stop).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith("plugin_process_abort", {
    scope: "garden",
  });
  expect(filesRequest).not.toHaveBeenCalled();
  consent.resolve();
  await flushPromises();
  expect(filesRequest).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
  native.resolve();
  await flushPromises();
  expect(action).toHaveBeenCalledExactlyOnceWith("close", "garden", undefined);
  expect(vi.mocked(filesRequest).mock.calls.at(-1)?.[0].operation).toBe(
    "detach",
  );
});

test("a close dialog keeps its original scope when the displayed workspace changes", async () => {
  const process = await runningProcesses();
  const wrapper = mountSetup();
  await flushPromises();
  events.get("files-close-requested")!({ payload: "garden" });
  await flushPromises();
  const previous = await snapshot();
  const notes = { id: "notes", name: "Notes", display: "/Documents/Notes" };
  vi.mocked(snapshot).mockResolvedValue({
    ...previous,
    open: [...previous.open, notes],
    current: notes,
  });
  events.get("workspaces-changed")!({ payload: null });
  await flushPromises();
  await wrapper
    .get("dialog[aria-labelledby=close-ai-title]")
    .findAll("button")
    .find((button) => button.text() === "⟦navigation.cancel⟧")!
    .trigger("click");
  await flushPromises();
  expect(invoke).toHaveBeenCalledWith("ai_cancel_close", { scope: "garden" });
  expect(invoke).not.toHaveBeenCalledWith("ai_cancel_close", {
    scope: "notes",
  });
  expect(process.stop).not.toHaveBeenCalled();
});

test("quit rejects running processes before files without aborting them", async () => {
  const process = await runningProcesses();
  const wrapper = mountSetup();
  await flushPromises();
  events.get("files-quit-requested")!({ payload: "process-quit" });
  await flushPromises();
  expect(
    vi.mocked(filesRequest).mock.calls.map(([request]) => request.operation),
  ).toEqual(["cancelQuit"]);
  expect(process.stop).not.toHaveBeenCalled();
  expect(process.activity()).toEqual({ runningActions: 1 });
  expect(wrapper.text()).toContain("⟦native.ai.quit.responsesPending⟧");
  expect(action).not.toHaveBeenCalled();
});

test.each(["close", "quit"] as const)(
  "retains unsaved layout and blocks %s when layout persistence fails",
  async (operation) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ui = workspaceUi("garden");
    await ui.session.load();
    ui.session.dispatch({ type: "new-tab" });
    const retained = ui.session.state.document;
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    let fail = true;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "layout_save" && fail)
        throw new Error("layoutHost.saveFailed");
      return implementation(command, args);
    });
    const wrapper = mountSetup();
    await flushPromises();
    events.get(
      operation === "close" ? "files-close-requested" : "files-quit-requested",
    )!({ payload: operation === "close" ? "garden" : "layout-quit" });
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith(
      "layout_save",
      expect.objectContaining({ workspaceId: "garden", data: retained }),
    );
    expect(action).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(filesRequest)
        .mock.calls.some(([request]) =>
          ["detach", "quitReady"].includes(request.operation),
        ),
    ).toBe(false);
    expect(ui.session.state.document).toBe(retained);
    expect(ui.session.state.dirty).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "⟦layoutHost.saveFailed⟧",
    );
    if (operation === "quit")
      expect(filesRequest).toHaveBeenCalledWith({
        workspaceId: "garden",
        operation: "cancelQuit",
        token: "layout-quit",
      });
    else
      expect(invoke).toHaveBeenCalledWith("ai_cancel_close", {
        scope: "garden",
      });
    fail = false;
    await ui.session.retry();
    events.get(
      operation === "close" ? "files-close-requested" : "files-quit-requested",
    )!({ payload: operation === "close" ? "garden" : "layout-quit-retry" });
    await flushPromises();
    expect(ui.session.state.dirty).toBe(false);
    if (operation === "close")
      expect(action).toHaveBeenCalledExactlyOnceWith(
        "close",
        "garden",
        undefined,
      );
    else
      expect(filesRequest).toHaveBeenCalledWith({
        workspaceId: "garden",
        operation: "quitReady",
        token: "layout-quit-retry",
      });
  },
);

test.each(["close", "quit"] as const)(
  "limits layout persistence to the authorized %s scope",
  async (operation) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const base = await snapshot();
    const notes = { id: "notes", name: "Notes", display: "/Notes" };
    vi.mocked(snapshot).mockResolvedValue({
      ...base,
      mobile: true,
      open: [...base.open, notes],
      known: [...base.known, notes],
    });
    const garden = workspaceUi("garden");
    const other = workspaceUi("notes");
    await Promise.all([garden.session.load(), other.session.load()]);
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "lifecycle_status")
        return {
          sequence: 1,
          state: "pending",
          workspaceIds: ["garden", "notes"],
        };
      if (
        command === "layout_save" &&
        (args as { workspaceId: string }).workspaceId === "notes"
      )
        throw new Error("layoutHost.saveFailed");
      return implementation(command, args);
    });
    mountSetup();
    await flushPromises();
    events.get(
      operation === "close" ? "files-close-requested" : "files-quit-requested",
    )!({ payload: operation === "close" ? "garden" : "all-layouts" });
    await flushPromises();
    const savedIds = vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "layout_save")
      .map(([, args]) => (args as { workspaceId: string }).workspaceId);
    expect(garden.session.state.dirty).toBe(false);
    expect(other.session.state.dirty).toBe(true);
    if (operation === "close") {
      expect(savedIds).toEqual(["garden"]);
      expect(action).toHaveBeenCalledExactlyOnceWith(
        "close",
        "garden",
        undefined,
      );
    } else {
      expect(savedIds).toEqual(["garden", "notes"]);
      expect(action).not.toHaveBeenCalled();
      expect(filesRequest).toHaveBeenCalledWith({
        workspaceId: "garden",
        operation: "cancelQuit",
        token: "all-layouts",
      });
      expect(
        vi
          .mocked(filesRequest)
          .mock.calls.some(([request]) => request.operation === "quitReady"),
      ).toBe(false);
    }
  },
);

test.each(["close", "quit"] as const)(
  "waits for outstanding layout persistence before %s admission",
  async (operation) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ui = workspaceUi("garden");
    await ui.session.load();
    ui.session.dispatch({ type: "new-tab" });
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    let finish!: () => void;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "layout_save")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return implementation(command, args);
    });
    mountSetup();
    await flushPromises();
    events.get(
      operation === "close" ? "files-close-requested" : "files-quit-requested",
    )!({ payload: operation === "close" ? "garden" : "waiting-layout" });
    await flushPromises();
    expect(ui.session.state.saving).toBe(true);
    expect(action).not.toHaveBeenCalled();
    expect(filesRequest).not.toHaveBeenCalled();
    finish();
    await flushPromises();
    expect(ui.session.state.dirty).toBe(false);
    if (operation === "close")
      expect(action).toHaveBeenCalledExactlyOnceWith(
        "close",
        "garden",
        undefined,
      );
    else
      expect(filesRequest).toHaveBeenCalledWith({
        workspaceId: "garden",
        operation: "quitReady",
        token: "waiting-layout",
      });
  },
);

test("native close waits for browser sign-in cancellation without a response dialog", async () => {
  let finish!: () => void;
  cancelLogin.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = mountSetup();
  await flushPromises();
  events.get("ai-login-close-requested")!({ payload: null });
  events.get("ai-login-close-requested")!({ payload: null });
  await flushPromises();
  expect(cancelLogin).toHaveBeenCalledOnce();
  expect(action).not.toHaveBeenCalled();
  expect(wrapper.find("dialog[open]").exists()).toBe(false);
  finish();
  await flushPromises();
  expect(action).toHaveBeenCalledExactlyOnceWith("close", "garden", undefined);
  expect(invoke).not.toHaveBeenCalledWith("ai_cancel_close", expect.anything());
});

test("login-close continuation waits for an in-flight workspace action and coalesces duplicate events", async () => {
  let finish!: (closed: boolean) => void;
  vi.mocked(action).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mountSetup();
  await flushPromises();
  events.get("files-close-requested")!({ payload: "garden" });
  await flushPromises();
  expect(action).toHaveBeenCalledOnce();
  events.get("ai-login-close-requested")!({ payload: null });
  events.get("ai-login-close-requested")!({ payload: null });
  await flushPromises();
  expect(cancelLogin).toHaveBeenCalledOnce();
  expect(action).toHaveBeenCalledOnce();
  finish(false);
  await flushPromises();
  expect(vi.mocked(action).mock.calls).toEqual([
    ["close", "garden", undefined],
    ["close", "garden", undefined],
  ]);
  expect(invoke).not.toHaveBeenCalledWith("ai_cancel_close", expect.anything());
});

test("failed cancellation leaves the workspace open and releases the close lease for retry", async () => {
  cancelLogin.mockRejectedValueOnce(
    new Error("synthetic private provider details"),
  );
  const wrapper = mountSetup();
  await flushPromises();
  events.get("ai-login-close-requested")!({ payload: null });
  await flushPromises();
  expect(action).not.toHaveBeenCalled();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "ai_cancel_close"),
  ).toEqual([["ai_cancel_close", { scope: "garden" }]]);
  expect(wrapper.get("[role=alert]").text()).toContain(
    "⟦navigation.signInCouldNotBeStoppedKeepThisWorkspace⟧",
  );
  expect(wrapper.text()).not.toContain("synthetic private provider details");
  events.get("ai-login-close-requested")!({ payload: null });
  await flushPromises();
  expect(action).toHaveBeenCalledExactlyOnceWith("close", "garden", undefined);
});

test("a deferred workspace close retains its confirmation gate after sign-in has stopped", async () => {
  vi.mocked(action).mockResolvedValueOnce(false);
  mountSetup();
  await flushPromises();
  events.get("ai-login-close-requested")!({ payload: null });
  await flushPromises();
  expect(cancelLogin).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalledWith("ai_cancel_close", expect.anything());
});

test("cancelling file preparation after sign-in stops releases the AI close gate", async () => {
  vi.mocked(filesRequest).mockRejectedValueOnce(
    new Error("Synthetic file read failure"),
  );
  const wrapper = mountSetup();
  await flushPromises();
  events.get("ai-login-close-requested")!({ payload: null });
  await flushPromises();
  expect(wrapper.get(".file-dialog").text()).toContain(
    "⟦localization.unknownError⟧",
  );
  await wrapper
    .get(".file-dialog")
    .findAll("button")
    .find((button) => button.text() === "⟦navigation.cancel⟧")!
    .trigger("click");
  await flushPromises();
  expect(action).not.toHaveBeenCalled();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "ai_cancel_close"),
  ).toEqual([["ai_cancel_close", { scope: "garden" }]]);
});

test("native close waits for a pending model choice without presenting it as an active response", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  let finish!: () => void;
  const record = {
    version: 2,
    id: "legacy",
    title: "",
    revision: 0,
    messages: [],
    draft: "",
  };
  const status = {
    config: { provider: "openai", endpoint: null },
    available: true,
    reason: null,
    selectedModel: "gpt-4.1",
    modelError: null,
  };
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "ai_status") return status;
    if (command === "ai_select_conversation_model") {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return status;
    }
    if (
      command === "ai_conversation_subscribe" ||
      command === "ai_conversation_snapshot"
    )
      return {
        version: 1,
        generation: "garden:legacy",
        position: 0,
        record,
        phase: "idle",
        error: null,
        taskActive: false,
      };
    return implementation(command, args);
  });
  const chat = workspaceChat("garden");
  const selection = chat.selectModel("gpt-4.1");
  const wrapper = mountSetup();
  await flushPromises();
  events.get("ai-close-requested")!({ payload: null });
  await vi.waitFor(() =>
    expect(wrapper.find("dialog[open]").exists()).toBe(true),
  );
  expect(wrapper.get("dialog[open]").text()).toContain(
    "⟦navigation.closingWaitsForTheModelChoiceToFinishSaving⟧",
  );
  expect(wrapper.get("dialog[open]").text()).not.toContain(
    "⟦navigation.aResponseIsRunning⟧",
  );
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦navigation.waitAndClose⟧")!
    .trigger("click");
  await flushPromises();
  expect(action).not.toHaveBeenCalled();
  finish();
  await selection;
  await vi.waitFor(() =>
    expect(action).toHaveBeenCalledExactlyOnceWith(
      "close",
      "garden",
      undefined,
    ),
  );
});

test("quit arriving before the initial snapshot uses host-authorized workspace participants", async () => {
  let finishSnapshot!: (value: Awaited<ReturnType<typeof snapshot>>) => void;
  vi.mocked(snapshot).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSnapshot = resolve;
      }),
  );
  const wrapper = mountSetup();
  await flushPromises();
  expect(wrapper.find(".startup").exists()).toBe(true);
  events.get("files-quit-requested")!({ payload: "startup-quit" });
  await flushPromises();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "lifecycle_status"),
  ).toEqual([
    [
      "lifecycle_status",
      {
        token: "startup-quit",
      },
    ],
  ]);
  expect(
    vi
      .mocked(filesRequest)
      .mock.calls.map(([request]) => [request.workspaceId, request.operation]),
  ).toEqual([
    ["garden", "snapshot"],
    ["garden", "quitReady"],
  ]);
  finishSnapshot({
    ready: true,
    mobile: false,
    known: [],
    open: [],
    current: null,
    failures: [],
    error: null,
  });
  await flushPromises();
});

test("the app exposes an explicit retry after cancellation IPC fails", async () => {
  vi.mocked(filesRequest).mockImplementation(async (request) => {
    if (request.operation === "snapshot") throw new Error("File read failed");
    if (request.operation === "cancelQuit")
      throw new Error("Cancellation IPC failed");
    return { status: "ok" };
  });
  const wrapper = mountSetup();
  await flushPromises();
  events.get("files-quit-requested")!({ payload: "retry-quit" });
  await flushPromises();
  await wrapper
    .get(".file-dialog")
    .findAll("button")
    .find((button) => button.text() === "⟦navigation.cancel⟧")!
    .trigger("click");
  await flushPromises();
  const retry = wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦files.retryQuitCancellation⟧")!;
  expect(retry.exists()).toBe(true);
  expect(
    vi
      .mocked(filesRequest)
      .mock.calls.filter(([request]) => request.operation === "cancelQuit"),
  ).toHaveLength(1);
  vi.mocked(filesRequest).mockResolvedValue({ status: "ok" });
  await retry.trigger("click");
  await flushPromises();
  expect(
    vi
      .mocked(filesRequest)
      .mock.calls.filter(([request]) => request.operation === "cancelQuit"),
  ).toHaveLength(2);
  expect(wrapper.text()).not.toContain("⟦files.retryQuitCancellation⟧");
  expect(retainedWorkspaces()[0]?.closing).toBe(false);
});

test("a later workspace action reconciles a cancellation missed by this window", async () => {
  mountSetup();
  await flushPromises();
  events.get("files-quit-requested")!({ payload: "unbroadcast-cancellation" });
  await flushPromises();
  expect(retainedWorkspaces()[0]?.closing).toBe(true);
  const implementation = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (command, args) =>
    command === "lifecycle_status"
      ? { sequence: 1, state: "cancelled", workspaceIds: ["garden"] }
      : implementation(command, args),
  );
  events.get("files-close-requested")!({ payload: "garden" });
  await flushPromises();
  expect(action).toHaveBeenCalledExactlyOnceWith("close", "garden", undefined);
  expect(vi.mocked(filesRequest).mock.calls.at(-1)?.[0].operation).toBe(
    "detach",
  );
});

test("app quit coordinates file participants and coalesces duplicate native requests", async () => {
  const wrapper = mountSetup();
  await flushPromises();
  events.get("files-quit-requested")!({ payload: "quit-current" });
  events.get("files-quit-requested")!({ payload: "quit-current" });
  await flushPromises();
  expect(
    vi.mocked(filesRequest).mock.calls.map(([request]) => request.operation),
  ).toEqual(["snapshot", "quitReady"]);
  expect(filesRequest).toHaveBeenLastCalledWith({
    workspaceId: "garden",
    operation: "quitReady",
    token: "quit-current",
  });
  expect(retainedWorkspaces()[0]?.closing).toBe(true);
  events.get("files-quit-cancelled")!({ payload: "quit-old" });
  expect(retainedWorkspaces()[0]?.closing).toBe(true);
  events.get("files-quit-cancelled")!({ payload: "quit-current" });
  expect(retainedWorkspaces()[0]?.closing).toBe(false);
  wrapper.unmount();
  expect(events.has("files-quit-requested")).toBe(false);
  expect(events.has("files-quit-cancelled")).toBe(false);
  expect(events.has("files-close-requested")).toBe(false);
});

test("mobile quit includes inactive open workspaces without starting AI", async () => {
  const garden = { id: "garden", name: "Garden", display: "/Documents/Garden" };
  const notes = { id: "notes", name: "Notes", display: "/Documents/Notes" };
  vi.mocked(snapshot).mockResolvedValue({
    ready: true,
    mobile: true,
    known: [garden, notes],
    open: [garden, notes],
    current: notes,
    failures: [],
    error: null,
    aiSetup: true,
  });
  vi.mocked(invoke).mockResolvedValue({
    sequence: 1,
    state: "pending",
    workspaceIds: ["garden", "notes"],
  });
  mountSetup();
  await flushPromises();
  events.get("files-quit-requested")!({ payload: "quit-mobile" });
  await flushPromises();
  expect(
    vi
      .mocked(filesRequest)
      .mock.calls.map(([request]) => [request.workspaceId, request.operation]),
  ).toEqual([
    ["garden", "snapshot"],
    ["notes", "snapshot"],
    ["garden", "quitReady"],
  ]);
  expect(retainedWorkspaces().every((session) => session.closing)).toBe(true);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([command]) => command === "lifecycle_status"),
  ).toEqual([
    [
      "lifecycle_status",
      {
        token: "quit-mobile",
      },
    ],
  ]);
});

test("quit notices are visible during AI setup and native listeners are released", async () => {
  const wrapper = mountSetup();
  await flushPromises();
  events.get("ai-quit-blocked")!({ payload: "native.ai.login.finishing" });
  await flushPromises();
  expect(wrapper.get("[role=alert]").text()).toContain(
    "⟦native.ai.login.finishing⟧",
  );
  wrapper.unmount();
  expect(events.has("ai-login-close-requested")).toBe(false);
  expect(events.has("ai-quit-blocked")).toBe(false);
});
