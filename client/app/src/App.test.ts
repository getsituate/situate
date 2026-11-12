import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, onMounted, onUpdated } from "vue";
import { newOnboardingRecord } from "./onboarding/types";
import { onBackButtonPress } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LifecycleCoordinator } from "./lifecycle";
import App from "./App.vue";
import { SituatePopover } from "@situate/ui";
import { retainWorkspaceUi } from "./layout/runtime";
import { closeChats } from "./ai/chat";
import { action, snapshot } from "./workspaces/api";
import { filesRequest } from "./files/api";
import {
  releaseWorkspace,
  retainedWorkspaces,
  workspaceSession,
} from "./files/sessions";

vi.mock("./files/api", async (original) => ({
  ...(await original<typeof import("./files/api")>()),
  filesRequest: vi.fn(async ({ operation }: { operation: string }) =>
    operation === "snapshot"
      ? {
          status: "ok",
          snapshot: { writable: true, reason: null, entries: [], drafts: [] },
        }
      : { status: "ok" },
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command, args) =>
    command === "plugin_executor"
      ? (args?.request as { operation: string })?.operation === "activity"
        ? { runningActions: 0 }
        : (args?.request as { operation: string })?.operation === "snapshot"
          ? { plugins: [], unavailable: [] }
          : (args?.request as { operation: string })?.operation === "stop"
            ? undefined
            : []
      : command === "plugin_runtime"
        ? { plugins: [], revision: null }
        : command === "layout_load"
          ? { revision: null, data: null }
          : command === "layout_save"
            ? { revision: "layout-1", data: args.data }
            : command === "localization_snapshot"
              ? {
                  language: "en",
                  formats: { time: "12", date: "mdy", number: "dot-comma" },
                  writable: true,
                }
              : undefined,
  ),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));
vi.mock("@tauri-apps/api/app", () => ({
  onBackButtonPress: vi.fn(async () => ({ unregister: vi.fn() })),
}));
vi.mock("./workspaces/api", async (original) => ({
  ...(await original<typeof import("./workspaces/api")>()),
  action: vi.fn(),
  snapshot: vi.fn(),
  chooseParent: vi.fn(async () => null),
}));

enableAutoUnmount(afterEach);
function openMenu(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('[role="menu"]')
    .find((menu) => menu.element.matches(":popover-open"))!;
}
async function settleViews(): Promise<void> {
  await flushPromises();
  await vi.dynamicImportSettled();
  await flushPromises();
}
afterEach(() => {
  retainWorkspaceUi([]);
  closeChats([]);
  retainedWorkspaces().forEach(releaseWorkspace);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
beforeEach(() => {
  const rectangle = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this instanceof HTMLButtonElement
        ? new DOMRect(32, 32, 44, 44)
        : rectangle.call(this);
    },
  );
  retainWorkspaceUi([]);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const garden = { id: "garden", name: "Garden", display: "/Documents/Garden" };
  vi.mocked(snapshot).mockResolvedValue({
    ready: true,
    mobile: true,
    known: [garden],
    open: [garden],
    current: garden,
    failures: [],
    error: null,
  });
});

async function pressBack(): Promise<void> {
  expect(onBackButtonPress).toHaveBeenCalledOnce();
  vi.mocked(onBackButtonPress).mock.calls[0]![0]({ canGoBack: false });
  await settleViews();
}
async function openEntry(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper
    .get('button[aria-label="⟦navigation.openNavigation⟧"]')
    .trigger("click");
  await wrapper.get(".workspace-menu").trigger("click");
  await flushPromises();
  await openMenu(wrapper).get('[role="menuitem"]').trigger("click");
  await settleViews();
  expect(wrapper.find(".workspace-entry").exists()).toBe(true);
}

it.each([false, true])(
  "shows failed workspace opening in a dismissible, retryable dialog (mobile: %s)",
  async (mobile) => {
    const empty = {
      ready: true,
      mobile,
      known: [],
      open: [],
      current: null,
      failures: [],
      error: null,
    };
    vi.mocked(snapshot).mockResolvedValue(empty);
    vi.mocked(action)
      .mockReset()
      .mockRejectedValue(new Error("native.workspace.migration.cleanupFailed"));
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    const trigger = wrapper.findAll(".entry-action")[1]!;
    (trigger.element as HTMLButtonElement).focus();
    await trigger.trigger("click");
    await settleViews();
    const openingDialog = () =>
      wrapper
        .findAll<HTMLDialogElement>("dialog")
        .find((item) =>
          item.text().includes("⟦workspace.couldntOpenTheWorkspace⟧"),
        )!;
    let dialog = openingDialog();
    expect(dialog.element.open).toBe(true);
    expect(
      dialog.get(`[id="${dialog.attributes("aria-describedby")}"]`).text(),
    ).toBe("⟦native.workspace.migration.cleanupFailed⟧");
    expect(wrapper.find(".entry-error").exists()).toBe(false);
    expect(wrapper.find(".app-shell").exists()).toBe(false);
    await dialog.trigger("cancel");
    await settleViews();
    expect(dialog.element.open).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    const review = wrapper
      .findAll("button")
      .find((button) => button.text() === "⟦workspace.reviewError⟧")!;
    await review.trigger("click");
    expect(dialog.element.open).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    let retry = dialog
      .findAll("button")
      .find((button) => button.text() === "⟦navigation.retry⟧")!;
    await retry.trigger("click");
    await settleViews();
    expect(action).toHaveBeenCalledTimes(2);
    dialog = openingDialog();
    retry = dialog
      .findAll("button")
      .find((button) => button.text() === "⟦navigation.retry⟧")!;
    expect(dialog.element.open).toBe(true);
    const garden = {
      id: "garden",
      name: "Garden",
      display: "/Documents/Garden",
    };
    vi.mocked(action).mockResolvedValueOnce(true);
    vi.mocked(snapshot).mockResolvedValueOnce({
      ...empty,
      known: [garden],
      open: [garden],
      current: garden,
    });
    await retry.trigger("click");
    await settleViews();
    expect(action).toHaveBeenLastCalledWith(
      "pick",
      undefined,
      undefined,
      undefined,
    );
    expect(wrapper.find(".workspace-entry").exists()).toBe(false);
    expect(wrapper.find("dialog[open]").exists()).toBe(false);
  },
);

it("routes update preparation and cancellation through the shared lifecycle and removes its listeners", async () => {
  const prepare = vi
    .spyOn(LifecycleCoordinator.prototype, "prepareUpdate")
    .mockResolvedValue();
  const cancel = vi
    .spyOn(LifecycleCoordinator.prototype, "cancelUpdate")
    .mockImplementation(() => {});
  const wrapper = mount(App, { attachTo: document.body });
  await settleViews();
  for (const [name, spy] of [
    ["updates-prepare-requested", prepare],
    ["updates-preparation-cancelled", cancel],
  ] as const) {
    const index = vi
      .mocked(listen)
      .mock.calls.findIndex(([event]) => event === name);
    expect(index).toBeGreaterThanOrEqual(0);
    const callback = vi.mocked(listen).mock.calls[index]![1];
    callback({ event: name, id: index, payload: "update-token" });
    await flushPromises();
    expect(spy).toHaveBeenCalledWith("update-token");
  }
  const listenerStops = await Promise.all(
    vi
      .mocked(listen)
      .mock.results.filter((_, index) =>
        ["updates-prepare-requested", "updates-preparation-cancelled"].includes(
          vi.mocked(listen).mock.calls[index]![0],
        ),
      )
      .map((result) => result.value),
  );
  wrapper.unmount();
  for (const stop of listenerStops) expect(stop).toHaveBeenCalled();
});

it.each(["navigation", "control", "dialog"] as const)(
  "finale focus handoff respects %s focus ownership",
  async (owner) => {
    const initial = await snapshot();
    vi.mocked(snapshot).mockResolvedValue({ ...initial, onboarding: true });
    vi.mocked(action).mockImplementation(async () => {
      vi.mocked(snapshot).mockResolvedValue({ ...initial, onboarding: false });
      return true;
    });
    vi.spyOn(
      await import("./ai/chat"),
      "refreshWorkspaceChats",
    ).mockResolvedValue();
    const dialog = document.createElement("dialog");
    const control = document.createElement("button");
    dialog.append(control);
    if (owner === "dialog") document.body.append(dialog);
    else document.body.append(control);
    const focusNavigation = vi.fn(() => {
      const shell = document.querySelector<HTMLElement>(".handoff-shell")!;
      expect(shell.style.display).not.toBe("none");
      expect(shell.hasAttribute("inert")).toBe(false);
      shell.querySelector<HTMLButtonElement>("button")!.focus();
    });
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        stubs: {
          OnboardingHost: defineComponent({
            emits: ["enter"],
            setup(_, { emit }) {
              return () =>
                h(
                  "button",
                  {
                    onClick: () =>
                      emit(
                        "enter",
                        {
                          ...newOnboardingRecord(),
                          step: "complete",
                          instructionRevision: "instructions-1",
                        },
                        true,
                      ),
                  },
                  "Enter",
                );
            },
          }),
          AppShell: defineComponent({
            props: { inert: Boolean },
            setup(props, { expose }) {
              expose({ focusNavigation });
              onUpdated(() => {
                if (props.inert) return;
                if (owner === "dialog") dialog.open = true;
                else if (owner === "control") control.focus();
              });
              return () =>
                h(
                  "div",
                  {
                    class: "handoff-shell",
                    inert: props.inert ? "" : undefined,
                  },
                  [h("button", "Navigation")],
                );
            },
          }),
          SetupFinale: defineComponent({
            emits: ["finished"],
            setup(_, { emit }) {
              onMounted(() => emit("finished"));
              return () => h("div", { class: "handoff-finale" });
            },
          }),
        },
      },
    });
    await settleViews();
    await wrapper.get("button").trigger("click");
    await settleViews();
    expect(wrapper.find(".handoff-finale").exists()).toBe(false);
    if (owner === "navigation") {
      expect(focusNavigation).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(
        wrapper.get(".handoff-shell button").element,
      );
    } else {
      expect(focusNavigation).not.toHaveBeenCalled();
      if (owner === "control") expect(document.activeElement).toBe(control);
      else expect(dialog.open).toBe(true);
    }
  },
);

describe("onboarding handoff", () => {
  it.each(["early", "skip", "replaced-rejected", "replaced-resolved"] as const)(
    "handles development dispatch completion after %s finale dismissal",
    async (outcome) => {
      const record = {
        ...newOnboardingRecord(),
        step: "complete" as const,
        entered: true,
        instructionRevision: "instructions-1",
      };
      const initial = await snapshot();
      vi.mocked(snapshot).mockResolvedValue({ ...initial, onboarding: true });
      vi.mocked(action).mockImplementation(async () => {
        vi.mocked(snapshot).mockResolvedValue({
          ...initial,
          onboarding: false,
        });
        return true;
      });
      vi.spyOn(
        await import("./ai/chat"),
        "refreshWorkspaceChats",
      ).mockResolvedValue();
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const dispatch = vi
        .spyOn(await import("./onboarding/agent"), "startSetupDevelopments")
        .mockImplementation(async () => {
          await pending;
          if (outcome === "replaced-resolved")
            return [new Error("layoutHost.viewUnavailable")];
          throw new Error("layoutHost.viewUnavailable");
        });
      const wrapper = mount(App, {
        attachTo: document.body,
        global: {
          stubs: {
            OnboardingHost: defineComponent({
              emits: ["enter"],
              setup(_, { emit }) {
                return () =>
                  h(
                    "button",
                    {
                      class: "enter",
                      onClick: () => emit("enter", record, true, true),
                    },
                    "Enter",
                  );
              },
            }),
            AppShell: defineComponent({
              props: { inert: Boolean },
              setup(props, { expose }) {
                expose({ focusNavigation: vi.fn() });
                return () =>
                  h(
                    "div",
                    {
                      class: "handoff-shell",
                      inert: props.inert ? "" : undefined,
                    },
                    "Workspace",
                  );
              },
            }),
            SetupFinale: defineComponent({
              emits: ["finished"],
              setup(_, { emit }) {
                onMounted(() => {
                  if (outcome === "early") emit("finished");
                });
                return () =>
                  h(
                    "button",
                    {
                      class: "handoff-skip",
                      onClick: () => {
                        emit("finished");
                        emit("finished");
                      },
                    },
                    "Skip",
                  );
              },
            }),
          },
        },
      });
      try {
        await settleViews();
        await wrapper.get(".enter").trigger("click");
        await settleViews();
        if (outcome !== "early")
          await wrapper.get(".handoff-skip").trigger("click");
        await settleViews();
        expect(wrapper.find(".handoff-skip").exists()).toBe(false);
        expect(
          wrapper.get(".handoff-shell").attributes("inert"),
        ).toBeUndefined();
        expect(dispatch).toHaveBeenCalledOnce();
        if (outcome.startsWith("replaced")) {
          const other = {
            id: "other",
            name: "Other",
            display: "/Documents/Other",
          };
          vi.mocked(snapshot).mockResolvedValue({
            ...initial,
            current: other,
            open: [other],
          });
          const callback = vi
            .mocked(listen)
            .mock.calls.find(([event]) => event === "workspaces-changed")![1];
          callback({ event: "workspaces-changed", id: 1, payload: undefined });
          await settleViews();
        }
      } finally {
        release();
        await settleViews();
      }
      expect(dispatch).toHaveBeenCalledOnce();
      if (outcome.startsWith("replaced")) {
        expect(wrapper.find(".workspace-notice").exists()).toBe(false);
      } else {
        const notice = wrapper.get(".workspace-notice");
        expect(notice.text()).toContain("⟦chat.developmentUnavailable⟧");
        const { onboardingSession } = await import("./onboarding/session");
        const session = onboardingSession("garden");
        session.state.record = record;
        vi.spyOn(session, "retry").mockResolvedValue();
        dispatch.mockResolvedValue([]);
        await notice.get("button").trigger("click");
        await settleViews();
        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(wrapper.find(".workspace-notice").exists()).toBe(false);
      }
    },
  );

  it.each([
    ["refresh", false],
    ["open", false],
    ["flush", false],
    ["open", true],
    ["flush", true],
    ["navigation", false],
  ] as const)(
    "lets Skip reveal the shell while %s is pending (failure: %s)",
    async (stage, fails) => {
      const startDevelopments = vi
        .spyOn(await import("./onboarding/agent"), "startSetupDevelopments")
        .mockResolvedValue([]);
      const initial = await snapshot();
      vi.mocked(snapshot).mockResolvedValue({ ...initial, onboarding: true });
      vi.mocked(action).mockImplementation(async () => {
        vi.mocked(snapshot).mockResolvedValue({
          ...initial,
          onboarding: false,
        });
        return true;
      });
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const refresh = vi
        .spyOn(await import("./ai/chat"), "refreshWorkspaceChats")
        .mockImplementation(async () => {
          if (stage === "refresh" || stage === "navigation") await pending;
        });
      const { workspaceUi } = await import("./layout/runtime");
      const ui = workspaceUi("garden");
      const openConversation = ui.coordinator.open;
      const open = vi
        .spyOn(ui.coordinator, "open")
        .mockImplementation(async (...args) => {
          if (stage === "open") {
            await pending;
            if (fails) throw new Error("layoutHost.viewUnavailable");
          }
          return openConversation(...args);
        });
      const flush = vi
        .spyOn(ui.session, "flush")
        .mockImplementation(async () => {
          if (stage === "flush") {
            await pending;
            if (fails) throw new Error("native.layout.storage.failed");
          }
        });
      const wrapper = mount(App, {
        attachTo: document.body,
        global: {
          stubs: {
            OnboardingHost: defineComponent({
              emits: ["enter"],
              setup(_, { emit }) {
                return () =>
                  h(
                    "button",
                    {
                      onClick: () =>
                        emit(
                          "enter",
                          {
                            ...newOnboardingRecord(),
                            step: "complete",
                            entered: true,
                            instructionRevision: "instructions-1",
                            conversationId: "setup-chat",
                          },
                          true,
                          true,
                        ),
                    },
                    "Enter",
                  );
              },
            }),
            AppShell: defineComponent({
              props: { inert: Boolean },
              setup(props, { expose }) {
                expose({ focusNavigation: vi.fn() });
                return () =>
                  h(
                    "div",
                    {
                      class: "handoff-shell",
                      inert: props.inert ? "" : undefined,
                    },
                    [h("button", "Navigation")],
                  );
              },
            }),
            SetupFinale: defineComponent({
              props: { ready: Boolean },
              emits: ["finished"],
              setup(props, { emit }) {
                return () =>
                  h(
                    "button",
                    {
                      class: "handoff-skip",
                      "data-ready": props.ready,
                      onClick: () => emit("finished"),
                    },
                    "Skip",
                  );
              },
            }),
          },
        },
      });
      try {
        await settleViews();
        await wrapper.get("button").trigger("click");
        await settleViews();
        expect(wrapper.get(".handoff-skip").attributes("data-ready")).toBe(
          "true",
        );
        await wrapper.get(".handoff-skip").trigger("click");
        await settleViews();
        expect(wrapper.find(".handoff-skip").exists()).toBe(false);
        expect(
          wrapper.get(".handoff-shell").attributes("inert"),
        ).toBeUndefined();
        expect(wrapper.get(".handoff-shell").isVisible()).toBe(true);
        expect(action).toHaveBeenCalledExactlyOnceWith(
          "ai-setup-done",
          undefined,
          undefined,
          undefined,
        );
        if (stage === "navigation")
          ui.coordinator.dispatch({
            type: "open",
            target: { kind: "view", viewId: "files" },
          });
      } finally {
        release();
        await settleViews();
      }
      expect(refresh).toHaveBeenCalledOnce();
      if (stage === "navigation") {
        expect(open).not.toHaveBeenCalled();
        expect(flush).not.toHaveBeenCalled();
        expect(wrapper.find(".workspace-notice").exists()).toBe(false);
      } else {
        expect(open).toHaveBeenCalledOnce();
        if (stage !== "open" || !fails) expect(flush).toHaveBeenCalledOnce();
      }
      if (fails) {
        expect(wrapper.get(".workspace-notice").text()).toContain(
          stage === "open"
            ? "⟦layoutHost.viewUnavailable⟧"
            : "⟦native.layout.storage.failed⟧",
        );
        expect(wrapper.find(".handoff-shell").exists()).toBe(true);
        open.mockImplementation(openConversation);
        ui.coordinator.dispatch({
          type: "open",
          target: { kind: "view", viewId: "files" },
        });
        await ui.coordinator.open({
          kind: "conversation",
          conversationId: "setup-chat",
        });
        expect(await open.mock.results[1]!.value).toBe(true);
      }
      expect(wrapper.find(".handoff-skip").exists()).toBe(false);
      expect(action).toHaveBeenCalledTimes(1);
      expect(startDevelopments).toHaveBeenCalledOnce();
    },
  );
});

describe("workspace navigation", () => {
  it("retains navigation focus when the workspace layout finishes loading", async () => {
    let loaded!: () => void;
    const pending = new Promise<void>((resolve) => {
      loaded = resolve;
    });
    const implementation = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "layout_load") await pending;
      return implementation(command, args);
    });
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    const opening = wrapper.get<HTMLButtonElement>(
      ".layout-recovery-header .open-navigation",
    );
    opening.element.focus();
    loaded();
    await settleViews();
    expect(wrapper.find(".layout-recovery-header").exists()).toBe(false);
    expect(document.activeElement).toBe(
      wrapper.get(".open-navigation").element,
    );
  });
  it("routes desktop entry closure to the owning window without accessing its files", async () => {
    const garden = {
      id: "remote-garden",
      name: "Garden",
      display: "/Documents/Garden",
    };
    vi.mocked(snapshot).mockResolvedValue({
      ready: true,
      mobile: false,
      known: [garden],
      open: [garden],
      current: null,
      failures: [],
      error: null,
    });
    vi.mocked(action).mockResolvedValue(true);
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    await wrapper.get(".row-actions").trigger("click");
    await flushPromises();
    await openMenu(wrapper)
      .findAll('[role="menuitem"]')
      .find((button) => button.text() === "⟦workspace.closeWorkspace⟧")!
      .trigger("click");
    await settleViews();
    expect(action).toHaveBeenCalledExactlyOnceWith(
      "close",
      garden.id,
      undefined,
      undefined,
    );
    expect(filesRequest).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([command]) => command === "layout_load" || command === "layout_save",
        ),
    ).toBe(false);
    expect(wrapper.get(".workspace-row").text()).toContain("Garden");
    expect(wrapper.get(".workspace-state").text()).toBe(
      "⟦workspace.openBringToFront⟧",
    );
  });

  it("flushes and detaches files before closing its own workspace", async () => {
    vi.mocked(action).mockResolvedValue(true);
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    await wrapper
      .get('button[aria-label="⟦navigation.openNavigation⟧"]')
      .trigger("click");
    await wrapper.get(".workspace-menu").trigger("click");
    await flushPromises();
    await openMenu(wrapper)
      .findAll('[role="menuitem"]')
      .find((button) => button.text() === "⟦workspace.closeWorkspace⟧")!
      .trigger("click");
    await settleViews();
    expect(
      vi.mocked(filesRequest).mock.calls.map(([request]) => request.operation),
    ).toEqual(["snapshot", "detach"]);
    expect(action).toHaveBeenCalledExactlyOnceWith(
      "close",
      "garden",
      undefined,
    );
  });

  it("retains its file session when the host defers closure for AI confirmation", async () => {
    vi.mocked(action).mockResolvedValueOnce(false);
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    const retained = workspaceSession("garden");
    await wrapper
      .get('button[aria-label="⟦navigation.openNavigation⟧"]')
      .trigger("click");
    await wrapper.get(".workspace-menu").trigger("click");
    await flushPromises();
    await openMenu(wrapper)
      .findAll('[role="menuitem"]')
      .find((button) => button.text() === "⟦workspace.closeWorkspace⟧")!
      .trigger("click");
    await settleViews();
    expect(action).toHaveBeenCalledExactlyOnceWith(
      "close",
      "garden",
      undefined,
    );
    expect(workspaceSession("garden")).toBe(retained);
    expect(retained.closing).toBe(false);
    expect(retained.snapshot?.writable).toBe(true);
  });

  it("resumes its file session when closing fails to persist the workspace registry", async () => {
    vi.mocked(action).mockRejectedValueOnce(
      new Error("native.workspace.registry.saveFailed"),
    );
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    await wrapper
      .get('button[aria-label="⟦navigation.openNavigation⟧"]')
      .trigger("click");
    await wrapper.get(".workspace-menu").trigger("click");
    await flushPromises();
    await openMenu(wrapper)
      .findAll('[role="menuitem"]')
      .find((button) => button.text() === "⟦workspace.closeWorkspace⟧")!
      .trigger("click");
    await settleViews();
    expect(workspaceSession("garden").closing).toBe(false);
    expect(workspaceSession("garden").snapshot?.writable).toBe(true);
    expect(wrapper.get(".workspace-notice").text()).toContain(
      "⟦native.workspace.registry.saveFailed⟧",
    );
    expect(wrapper.find(".app-shell").exists()).toBe(true);
  });

  it.each([false, true])(
    "uses open sessions rather than known listings (mobile: %s)",
    async (mobile) => {
      const current = {
        id: "current",
        name: "Current notes",
        display: "/Documents/Current notes",
      };
      const other = {
        id: "other",
        name: "Other notes",
        display: "/Documents/Other notes",
      };
      const closed = {
        id: "closed",
        name: "Closed notes",
        display: "/Documents/Closed notes",
      };
      const state = {
        ready: true,
        mobile,
        known: [current, closed],
        open: [current, other],
        current,
        failures: [],
        error: null,
      };
      vi.mocked(snapshot).mockResolvedValue(state);
      const wrapper = mount(App, { attachTo: document.body });
      await settleViews();
      await wrapper
        .get('button[aria-label="⟦navigation.openNavigation⟧"]')
        .trigger("click");
      await wrapper.get(".workspace-menu").trigger("click");
      await flushPromises();
      const menu = openMenu(wrapper);
      expect(menu.text()).not.toContain("Closed notes");
      expect(menu.get('[aria-current="true"]').text()).toBe(
        `Current notes${mobile ? "⟦navigation.currentWorkspace⟧" : "⟦navigation.thisWindow⟧"}`,
      );
      vi.mocked(snapshot).mockResolvedValue({
        ...state,
        current: mobile ? other : current,
      });
      await menu
        .findAll('[role="menuitem"]')
        .find((item) => item.text().startsWith("Other notes"))!
        .trigger("click");
      await settleViews();
      expect(action).toHaveBeenCalledExactlyOnceWith(
        "open",
        "other",
        undefined,
        undefined,
      );
      expect(wrapper.get(".workspace-name").text()).toBe(
        mobile ? "Other notes" : "Current notes",
      );
      expect(!!openMenu(wrapper)).toBe(false);
      expect(
        wrapper.get<HTMLDialogElement>(".navigation-drawer").element.open,
      ).toBe(false);
      expect(wrapper.find(".workspace-entry").exists()).toBe(false);
    },
  );

  it("keeps the current workspace and surfaces a failed switch", async () => {
    vi.mocked(action).mockRejectedValueOnce(
      new Error("Cannot focus this workspace."),
    );
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    await wrapper
      .get('button[aria-label="⟦navigation.openNavigation⟧"]')
      .trigger("click");
    await wrapper.get(".workspace-menu").trigger("click");
    await flushPromises();
    await wrapper.get('[aria-current="true"]').trigger("click");
    await settleViews();
    expect(wrapper.get(".workspace-name").text()).toBe("Garden");
    expect(wrapper.get('[role="status"]').text()).toContain(
      "⟦localization.unknownError⟧",
    );
    expect(action).toHaveBeenCalledExactlyOnceWith(
      "open",
      "garden",
      undefined,
      undefined,
    );
  });
});

describe("visual viewport", () => {
  it("overrides the bottom inset only for an unzoomed occluded viewport", async () => {
    vi.stubGlobal("innerHeight", 800);
    const viewport = Object.assign(new EventTarget(), {
      height: 800,
      offsetTop: 0,
      scale: 1,
    });
    vi.stubGlobal("visualViewport", viewport);
    mount(App, { attachTo: document.body });
    await settleViews();
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--app-safe-area-bottom")).toBe("");
    for (const [height, scale, inset] of [
      [430, 1, "0px"],
      [400, 2, ""],
      [430, 1, "0px"],
      [800, 1, ""],
    ] as const) {
      Object.assign(viewport, { height, scale });
      viewport.dispatchEvent(new Event("resize"));
      expect(style.getPropertyValue("--app-safe-area-bottom")).toBe(inset);
    }
  });
  it("releases viewport styles and listeners on unmount", async () => {
    const viewport = Object.assign(new EventTarget(), {
      height: 400,
      offsetTop: 20,
      scale: 1,
    });
    vi.stubGlobal("visualViewport", viewport);
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    expect(
      document.documentElement.style.getPropertyValue("--app-viewport-height"),
    ).toBe("400px");
    expect(
      document.documentElement.style.getPropertyValue("--app-viewport-top"),
    ).toBe("20px");
    expect(
      document.documentElement.style.getPropertyValue("--app-safe-area-bottom"),
    ).toBe("0px");
    wrapper.unmount();
    viewport.dispatchEvent(new Event("resize"));
    viewport.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    expect(
      document.documentElement.style.getPropertyValue("--app-viewport-height"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--app-viewport-top"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--app-safe-area-bottom"),
    ).toBe("");
  });
});

describe("Android Back", () => {
  it("dismisses supplementary popovers and ignores their retained closed surfaces", async () => {
    mount(App, { attachTo: document.body });
    await settleViews();
    const popup = mount(SituatePopover, {
      attachTo: document.body,
      props: {
        open: true,
        label: "Supplementary help",
        onClose: () => {
          void popup.setProps({ open: false });
        },
      },
    });
    await flushPromises();
    expect(popup.get("[popover]").element.matches(":popover-open")).toBe(true);
    await pressBack();
    expect(popup.emitted("close")).toHaveLength(1);
    expect(popup.get("[popover]").element.matches(":popover-open")).toBe(false);
    expect(action).not.toHaveBeenCalled();
    await pressBack();
    expect(action).toHaveBeenCalledExactlyOnceWith(
      "background",
      undefined,
      undefined,
      undefined,
    );
  });
  it("leaves creation when Back reaches the app after the IME has closed", async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    await openEntry(wrapper);
    await wrapper.get(".primary-choice").trigger("click");
    const field = wrapper.get<HTMLInputElement>("#workspace-name");
    field.element.focus();
    await field.setValue("Unsubmitted draft");
    await pressBack();
    expect(wrapper.find(".creation").exists()).toBe(false);
    expect(wrapper.find(".workspace-entry").exists()).toBe(true);
    expect(document.activeElement).toBe(wrapper.get(".primary-choice").element);
    expect(action).not.toHaveBeenCalled();
  });
  it("dismisses the workspace menu before its navigation drawer without closing the workspace", async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    await wrapper
      .get('button[aria-label="⟦navigation.openNavigation⟧"]')
      .trigger("click");
    await wrapper.get(".workspace-menu").trigger("click");
    await flushPromises();
    const drawer = wrapper.get<HTMLDialogElement>(".navigation-drawer");
    expect(drawer.element.open).toBe(true);
    expect(!!openMenu(wrapper)).toBe(true);

    await pressBack();
    expect(!!openMenu(wrapper)).toBe(false);
    expect(drawer.element.open).toBe(true);
    expect(document.activeElement).toBe(wrapper.get(".workspace-menu").element);

    await pressBack();
    expect(drawer.element.open).toBe(false);
    expect(
      wrapper
        .get('button[aria-label="⟦navigation.openNavigation⟧"]')
        .attributes("aria-expanded"),
    ).toBe("false");
    expect(wrapper.find(".view-chooser").exists()).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps removal confirmation above a background workspace actions menu", async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    await openEntry(wrapper);
    await wrapper.get(".row-actions").trigger("click");
    await flushPromises();
    await openMenu(wrapper)
      .findAll('[role="menuitem"]')
      .find((item) => item.text() === "⟦workspace.removeFromList⟧")!
      .trigger("click");
    await settleViews();
    await wrapper.get(".row-actions").trigger("click");
    await flushPromises();
    const confirmation = wrapper.get<HTMLDialogElement>(".removal-dialog");
    expect(confirmation.element.open).toBe(true);
    expect(
      wrapper.get(".workspace-action-menu").element.matches(":popover-open"),
    ).toBe(true);

    await pressBack();
    expect(confirmation.element.open).toBe(false);
    expect(
      wrapper.get(".workspace-action-menu").element.matches(":popover-open"),
    ).toBe(true);
    expect(wrapper.find(".workspace-entry").exists()).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });

  it("ignores a menu retained inside a closed drawer", async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    await wrapper
      .get('button[aria-label="⟦navigation.openNavigation⟧"]')
      .trigger("click");
    await wrapper.get(".workspace-menu").trigger("click");
    await flushPromises();
    await wrapper
      .get('button[aria-label="⟦navigation.closeNavigation⟧"]')
      .trigger("click");
    expect(
      wrapper.get<HTMLDialogElement>(".navigation-drawer").element.open,
    ).toBe(false);
    expect(!!openMenu(wrapper)).toBe(true);

    await pressBack();
    expect(action).toHaveBeenCalledExactlyOnceWith(
      "background",
      undefined,
      undefined,
      undefined,
    );
    expect(wrapper.find(".view-chooser").exists()).toBe(true);
  });

  it("cancels removal before leaving the entry, then focuses Open navigation on return", async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await settleViews();
    await openEntry(wrapper);
    await wrapper.get(".row-actions").trigger("click");
    await flushPromises();
    const remove = openMenu(wrapper)
      .findAll('[role="menuitem"]')
      .find((item) => item.text() === "⟦workspace.removeFromList⟧")!;
    await remove.trigger("click");
    await settleViews();
    const confirmation = wrapper.get<HTMLDialogElement>(".removal-dialog");
    expect(confirmation.element.open).toBe(true);

    await pressBack();
    expect(confirmation.element.open).toBe(false);
    expect(wrapper.find(".workspace-entry").exists()).toBe(true);
    expect(document.activeElement).toBe(wrapper.get(".row-actions").element);

    await pressBack();
    expect(wrapper.find(".view-chooser").exists()).toBe(true);
    expect(document.activeElement).toBe(
      wrapper.get('button[aria-label="⟦navigation.openNavigation⟧"]').element,
    );
    expect(
      wrapper.get<HTMLDialogElement>(".navigation-drawer").element.open,
    ).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });
});
