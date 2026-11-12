import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { shallowReactive } from "vue";
import PluginManagement from "./PluginManagement.vue";
import type { RuntimePlugin } from "./runtime";
import type { PluginDisableState } from "./types";
import { openPluginSettings, pluginSettingsId } from "./management";
import { filesRequest } from "../files/api";
import { releaseWorkspace, retainedWorkspaces } from "../files/sessions";
vi.mock("../files/api", async (original) => ({
  ...(await original<typeof import("../files/api")>()),
  filesRequest: vi.fn(),
}));
const mocks = vi.hoisted(() => ({
  ui: vi.fn(),
  recovery: false as boolean | undefined,
}));
vi.mock("../layout/runtime", () => ({ workspaceUi: mocks.ui }));
vi.mock("../recovery", () => ({
  recoveryMode: () => mocks.recovery,
  pluginMayExecute: () => mocks.recovery === false,
}));
enableAutoUnmount(afterEach);
afterEach(() => retainedWorkspaces().forEach(releaseWorkspace));
const plugin = (id: string, enabled = true): RuntimePlugin => ({
  id,
  enabled,
  error: null,
  status: enabled ? "loaded" : "disabled",
  manifest: {
    id,
    schemaVersion: 2,
    name: `Plugin ${id}`,
    description: `Description ${id}`,
    skills: [],
  },
});
function setup(plugins: RuntimePlugin[] = [plugin("weekly")]) {
  const state = shallowReactive({
    status: "ready",
    error: null as string | null,
    actionError: null as string | null,
    plugins,
    disabling: null as PluginDisableState | null,
  });
  const runtime = {
    state,
    ready: Promise.resolve(),
    setEnabled: vi.fn(async (id: string, enabled: boolean) => {
      if (!enabled)
        state.disabling = {
          id: "request",
          pluginId: id,
          phase: "disabled",
          runningActions: [],
          pendingRequests: 0,
          error: null,
          stopRequested: false,
          checking: false,
        };
    }),
    cancelDisable: vi.fn(async () => {}),
    stopDisabling: vi.fn(async () => {}),
    checkDisableStatus: vi.fn(async () => {}),
    affectedPluginIds: vi.fn((id: string) => [id]),
    refresh: vi.fn(async () => {
      state.status = "ready";
      state.error = null;
    }),
    dismissActionError: vi.fn(() => {
      state.actionError = null;
    }),
    uninstall: vi.fn(async (_id: string) => {}),
    runningActions: vi.fn((_id: string) => 0),
    synchronizeInventory: vi.fn(async () => {}),
    uninstallOutcomeUnknown: vi.fn((_id: string) => false),
  };
  const ui = {
    plugins: Promise.resolve(runtime),
    coordinator: { open: vi.fn(async () => true) },
    registry: { definitions: new Map([["weekly:settings", {}]]) },
  };
  mocks.ui.mockReturnValue(ui);
  vi.mocked(filesRequest).mockImplementation(async (request) => {
    if (request.operation === "snapshot")
      return {
        status: "ok",
        snapshot: {
          writable: false,
          reason: null,
          entries: [{ path: "SKILL.md", isDirectory: false }],
          drafts: [],
        },
      };
    if (request.operation === "read")
      return {
        status: "ok",
        document: {
          path: request.path,
          version: { text: "# Instructions", revision: "source" },
          html: "<h1>Instructions</h1>",
          issues: [],
        },
      };
    throw new Error(`Unexpected operation ${request.operation}`);
  });
  const onDevelop = vi.fn(async () => {});
  const render = (selectedPlugin?: string) =>
    mount(PluginManagement, {
      attachTo: document.body,
      props: {
        scope: "garden",
        selectedPlugin,
        onDevelop,
      },
    });
  return { runtime, ui, onDevelop, render };
}
function action(wrapper: ReturnType<typeof mount>, key: string) {
  return wrapper
    .findAll("button")
    .find((b) => b.text().includes(`⟦pluginManagement.${key}⟧`))!;
}
beforeEach(() => {
  mocks.recovery = false;
  mocks.ui.mockReset();
  vi.mocked(filesRequest).mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
test("waits for lazy runtime initialization then renders icon-free cards including disabled and malformed plugins", async () => {
  const fixture = setup([
    plugin("weekly"),
    plugin("quiet", false),
    { ...plugin("broken"), manifest: null, status: "failed" },
  ]);
  let finish!: () => void;
  fixture.runtime.ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const wrapper = fixture.render();
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toContain(
    "⟦pluginManagement.loading⟧",
  );
  finish();
  await flushPromises();
  expect(wrapper.findAll(".plugin-card-grid .plugin-card-plain")).toHaveLength(
    3,
  );
  expect(wrapper.get('[data-plugin-id="weekly"]').text()).toContain(
    "Description weekly",
  );
  expect(wrapper.get('[data-plugin-id="quiet"]').text()).toContain(
    "⟦pluginManagement.disabled⟧",
  );
  expect(wrapper.get('[data-plugin-id="broken"] h3').text()).toBe("broken");
  expect(wrapper.find(".plugin-card-artwork").exists()).toBe(false);
  expect(mocks.ui).toHaveBeenCalledWith("garden");
});
test("opens a selected plugin directly and returns to its collection without Settings", async () => {
  const fixture = setup();
  const wrapper = fixture.render("weekly");
  await flushPromises();
  expect(wrapper.get(".plugin-files-view h1").text()).toBe("Plugin weekly");
  expect(document.activeElement).toBe(wrapper.get("h1").element);
  expect(filesRequest).toHaveBeenCalledWith({
    workspaceId: "garden",
    pluginId: "weekly",
    operation: "snapshot",
  });
  expect(wrapper.vm.back()).toBe(true);
  await flushPromises();
  expect(wrapper.find(".plugin-collection-view").exists()).toBe(true);
  expect(wrapper.vm.back()).toBe(false);
  expect(wrapper.text()).not.toContain("⟦pluginManagement.settings⟧");
});
test("offers new and further development without a Settings parent", async () => {
  const fixture = setup();
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "newPlugin").trigger("click");
  await flushPromises();
  expect(fixture.onDevelop).toHaveBeenLastCalledWith(undefined);
  await action(wrapper, "develop").trigger("click");
  await flushPromises();
  expect(fixture.onDevelop).toHaveBeenLastCalledWith("weekly");
  expect(wrapper.text()).not.toContain("⟦pluginManagement.settings⟧");
});
test("shows declared connection consumers and confirms only the enabled transitive disable impact", async () => {
  const connection = plugin("connection");
  connection.manifest!.kind = "connection";
  const alpha = plugin("alpha");
  alpha.manifest!.dependencies = ["connection"];
  const beta = plugin("beta");
  beta.manifest!.dependencies = ["alpha"];
  const quiet = plugin("quiet", false);
  quiet.manifest!.dependencies = ["connection"];
  const fixture = setup([connection, alpha, beta, quiet, plugin("other")]);
  fixture.runtime.affectedPluginIds.mockReturnValue([
    "connection",
    "alpha",
    "beta",
    "quiet",
  ]);
  const wrapper = fixture.render();
  await flushPromises();
  const card = wrapper.get('[data-plugin-id="connection"]');
  expect(card.text()).toContain("⟦pluginManagement.connectionKind⟧");
  expect(card.text()).toContain("⟦pluginManagement.accessUnverified⟧");
  expect(
    card.findAll(".plugin-consumers li").map((item) => item.text()),
  ).toEqual(["Plugin alpha", "Plugin quiet"]);
  await action(wrapper, "disable").trigger("click");
  expect(
    wrapper
      .get("dialog")
      .findAll("li")
      .map((item) => item.text()),
  ).toEqual(["Plugin alpha", "Plugin beta"]);
  expect(wrapper.get("dialog").text()).toContain(
    "⟦pluginManagement.explicitDependentEnable⟧",
  );
  expect(wrapper.get("dialog").text()).toContain(
    "⟦pluginManagement.disableWaitsForActions⟧",
  );
  expect(fixture.runtime.setEnabled).not.toHaveBeenCalled();
  await action(wrapper, "cancel").trigger("click");
  expect(wrapper.find("dialog").exists()).toBe(false);
  expect(fixture.runtime.setEnabled).not.toHaveBeenCalled();
  expect(wrapper.findAll(".plugin-card-grid .plugin-card-plain")).toHaveLength(
    5,
  );
});

test("keeps independent development available for a connection without consumers and a tool-only plugin", async () => {
  const connection = plugin("connection");
  connection.manifest!.kind = "connection";
  const tool = plugin("tool");
  tool.manifest!.kind = "tool";
  const fixture = setup([connection, tool]);
  const wrapper = fixture.render();
  await flushPromises();
  expect(wrapper.get('[data-plugin-id="connection"]').text()).toContain(
    "⟦pluginManagement.noDeclaredConsumers⟧",
  );
  expect(wrapper.get('[data-plugin-id="tool"]').text()).toContain(
    "⟦pluginManagement.toolKind⟧",
  );
  for (const id of ["connection", "tool"]) {
    const button = wrapper
      .get(`[data-plugin-id="${id}"]`)
      .findAll("button")
      .find((button) => button.text().includes("⟦pluginManagement.develop⟧"))!;
    await button.trigger("click");
    await flushPromises();
    expect(fixture.onDevelop).toHaveBeenLastCalledWith(id);
  }
  expect(fixture.ui.coordinator.open).not.toHaveBeenCalled();
});

test.each([
  ["missing", "missingDependency"],
  ["disabled", "disabledDependency"],
  ["cyclic", "cyclicDependency"],
  ["platform", "unavailablePlatform"],
  ["dependency", "failedDependency"],
] as const)(
  "explains %s blockers with the actual dependency name",
  async (reason, key) => {
    const blocked = {
      ...plugin("consumer"),
      status: "failed" as const,
      blockedBy: { reason, pluginId: "connection" },
    };
    const fixture = setup(
      reason === "missing"
        ? [blocked]
        : [blocked, plugin("connection", reason !== "disabled")],
    );
    const wrapper = fixture.render();
    await flushPromises();
    expect(
      wrapper.get('[data-plugin-id="consumer"] .plugin-blocked').text(),
    ).toBe(
      `⟦pluginManagement.${key}:{"name":"${reason === "missing" ? "connection" : "Plugin connection"}"}⟧`,
    );
  },
);

test("renders the designed empty state without an empty card grid", async () => {
  const fixture = setup([]);
  const wrapper = fixture.render();
  await flushPromises();
  expect(wrapper.find(".plugin-first-tool").exists()).toBe(true);
  expect(wrapper.find(".plugin-card-grid").exists()).toBe(false);
  await action(wrapper, "newPlugin").trigger("click");
  await flushPromises();
  expect(fixture.onDevelop).toHaveBeenCalledOnce();
});
test("opens only an available enabled settings contribution using semantic navigation", async () => {
  const fixture = setup([
    { ...plugin("weekly"), settingsId: "weekly:settings" },
    plugin("quiet", false),
  ]);
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "configure").trigger("click");
  await flushPromises();
  expect(fixture.ui.coordinator.open).toHaveBeenCalledExactlyOnceWith({
    kind: "view",
    viewId: "weekly:settings",
  });
  expect(wrapper.emitted("opened")).toEqual([[]]);
  expect(wrapper.get('[data-plugin-id="quiet"]').text()).not.toContain(
    "⟦pluginManagement.configure⟧",
  );
  expect(pluginSettingsId(undefined)).toBeUndefined();
  expect(
    pluginSettingsId({
      ...plugin("quiet", false),
      settingsId: "quiet:settings",
    }),
  ).toBeUndefined();
});
test("does not announce opening when semantic navigation is discarded", async () => {
  const fixture = setup([
    { ...plugin("weekly"), settingsId: "weekly:settings" },
  ]);
  fixture.ui.coordinator.open.mockResolvedValueOnce(false);
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "configure").trigger("click");
  await flushPromises();
  expect(wrapper.emitted("opened")).toBeUndefined();
});

test("shell back consumes source and confirmation states before leaving management", async () => {
  const fixture = setup();
  const wrapper = fixture.render();
  await flushPromises();
  expect(wrapper.vm.back()).toBe(false);
  await action(wrapper, "inspect").trigger("click");
  await flushPromises();
  expect(wrapper.vm.back()).toBe(true);
  await flushPromises();
  expect(wrapper.find(".plugin-code-browser").exists()).toBe(false);
  expect(wrapper.vm.back()).toBe(false);
  await action(wrapper, "disable").trigger("click");
  expect(wrapper.vm.back()).toBe(true);
  await flushPromises();
  expect(wrapper.find("dialog").exists()).toBe(false);
  expect(fixture.runtime.setEnabled).not.toHaveBeenCalled();
  expect(wrapper.vm.back()).toBe(false);
  expect(wrapper.emitted("close")).toBeUndefined();
});

test("missing settings registrations return without executing or navigating", async () => {
  const fixture = setup();
  await openPluginSettings(fixture.ui as never, {
    ...plugin("missing"),
    settingsId: "missing:settings",
  });
  await openPluginSettings(fixture.ui as never, undefined);
  expect(fixture.ui.coordinator.open).not.toHaveBeenCalled();
});
test("confirms disable, supports cancel, and never deletes plugin data", async () => {
  const fixture = setup();
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "disable").trigger("click");
  expect(fixture.runtime.setEnabled).not.toHaveBeenCalled();
  expect(wrapper.get("dialog").text()).toContain(
    "⟦pluginManagement.disableBody⟧",
  );
  await action(wrapper, "cancel").trigger("click");
  expect(wrapper.find("dialog").exists()).toBe(false);
  await action(wrapper, "disable").trigger("click");
  await wrapper
    .get(".situate-dialog-actions button:last-child")
    .trigger("click");
  await flushPromises();
  expect(fixture.runtime.setEnabled).toHaveBeenCalledExactlyOnceWith(
    "weekly",
    false,
  );
  expect(wrapper.find("dialog").exists()).toBe(false);
});

function holdDisable(
  fixture: ReturnType<typeof setup>,
  phase: PluginDisableState["phase"] = "waiting",
) {
  fixture.runtime.setEnabled.mockImplementationOnce(async (id) => {
    fixture.runtime.state.disabling = {
      id: "request",
      pluginId: id,
      phase,
      runningActions: [{ pluginId: "weekly", count: 2 }],
      pendingRequests: 0,
      error: phase === "failed" ? "native.plugins.stateSaveFailed" : null,
      stopRequested: false,
      checking: false,
    };
  });
}
test("shows running work in the dialog and Escape cancels disabling without stopping it", async () => {
  const fixture = setup();
  holdDisable(fixture);
  const wrapper = fixture.render();
  await flushPromises();
  const trigger = action(wrapper, "disable");
  trigger.element.focus();
  await trigger.trigger("click");
  await wrapper
    .get(".situate-dialog-actions button:last-child")
    .trigger("click");
  await flushPromises();
  expect(wrapper.get('dialog [role="status"]').text()).toBe(
    '⟦pluginManagement.disableWaiting:{"count":2}⟧',
  );
  expect(wrapper.get("dialog li").text()).toBe("Plugin weekly (2)");
  expect(document.activeElement).toBe(
    wrapper.get('dialog [role="status"]').element,
  );
  await wrapper.get("dialog").trigger("cancel");
  await flushPromises();
  expect(fixture.runtime.cancelDisable).toHaveBeenCalledOnce();
  expect(fixture.runtime.stopDisabling).not.toHaveBeenCalled();
  expect(wrapper.find("dialog").exists()).toBe(false);
  expect(document.activeElement).toBe(trigger.element);
});

test.each(["open", "close-during", "close-before"])(
  "keeps the invoking card mounted through status refresh when progress is %s",
  async (dismissal) => {
    const fixture = setup();
    holdDisable(fixture);
    const wrapper = fixture.render();
    await flushPromises();
    const trigger = action(wrapper, "disable");
    trigger.element.focus();
    await trigger.trigger("click");
    await wrapper
      .get(".situate-dialog-actions button:last-child")
      .trigger("click");
    await flushPromises();
    if (dismissal === "close-before") {
      fixture.runtime.state.disabling = {
        ...fixture.runtime.state.disabling!,
        stopRequested: true,
      };
      await flushPromises();
      await wrapper.get("dialog").trigger("cancel");
    }
    fixture.runtime.state.disabling = {
      ...fixture.runtime.state.disabling!,
      phase: "disabled",
    };
    fixture.runtime.state.status = "loading";
    await flushPromises();
    if (dismissal === "close-during") {
      await wrapper.get("dialog").trigger("cancel");
      await flushPromises();
    }
    expect(wrapper.find("dialog").exists()).toBe(dismissal === "open");
    expect(trigger.element.isConnected).toBe(true);
    fixture.runtime.state.plugins = [plugin("weekly", false)];
    fixture.runtime.state.status = "ready";
    await flushPromises();
    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(document.activeElement).toBe(action(wrapper, "enable").element);
    expect(fixture.runtime.cancelDisable).not.toHaveBeenCalled();
  },
);
test("dismisses stopping without claiming completion and reopens the same operation from Disable", async () => {
  const fixture = setup();
  holdDisable(fixture);
  fixture.runtime.stopDisabling.mockImplementation(async () => {
    fixture.runtime.state.disabling = {
      ...fixture.runtime.state.disabling!,
      stopRequested: true,
    };
  });
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "disable").trigger("click");
  await wrapper
    .get(".situate-dialog-actions button:last-child")
    .trigger("click");
  await flushPromises();
  await action(wrapper, "disableAbortNow").trigger("click");
  await flushPromises();
  expect(fixture.runtime.stopDisabling).toHaveBeenCalledOnce();
  expect(wrapper.get('dialog [role="status"]').text()).toContain(
    "⟦pluginManagement.disableStopping⟧",
  );
  expect(document.activeElement).toBe(
    wrapper.get('dialog [role="status"]').element,
  );
  await wrapper.get("dialog").trigger("cancel");
  await flushPromises();
  expect(fixture.runtime.cancelDisable).not.toHaveBeenCalled();
  expect(wrapper.find("dialog").exists()).toBe(false);
  await action(wrapper, "disable").trigger("click");
  expect(wrapper.get('dialog [role="status"]').text()).toContain(
    "⟦pluginManagement.disableStopping⟧",
  );
  expect(fixture.runtime.setEnabled).toHaveBeenCalledTimes(1);
  fixture.runtime.state.disabling = {
    ...fixture.runtime.state.disabling!,
    phase: "disabled",
  };
  await flushPromises();
  expect(wrapper.find("dialog").exists()).toBe(false);
});

test("returns to confirmation with the current dependent list after a conflict", async () => {
  const fixture = setup();
  holdDisable(fixture, "waiting");
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "disable").trigger("click");
  await wrapper
    .get(".situate-dialog-actions button:last-child")
    .trigger("click");
  await flushPromises();
  const consumer = plugin("consumer");
  consumer.manifest!.dependencies = ["weekly"];
  fixture.runtime.affectedPluginIds.mockReturnValue(["weekly", "consumer"]);
  fixture.runtime.state.plugins = [plugin("weekly"), consumer];
  fixture.runtime.state.disabling = {
    ...fixture.runtime.state.disabling!,
    phase: "failed",
    error: "native.plugins.stateConflict",
  };
  await flushPromises();
  expect(wrapper.get("dialog").text()).toContain(
    "⟦pluginManagement.disableBody⟧",
  );
  expect(wrapper.get("dialog").text()).toContain("Plugin consumer");
  expect(action(wrapper, "disableRetry")).toBeUndefined();
  expect(fixture.runtime.setEnabled).toHaveBeenCalledOnce();
});
test("keeps uncertain outcomes in the dialog and checks status before offering retry", async () => {
  const fixture = setup();
  holdDisable(fixture, "uncertain");
  fixture.runtime.checkDisableStatus.mockImplementation(async () => {
    fixture.runtime.state.disabling = {
      ...fixture.runtime.state.disabling!,
      checking: true,
    };
  });
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "disable").trigger("click");
  await wrapper
    .get(".situate-dialog-actions button:last-child")
    .trigger("click");
  await flushPromises();
  expect(wrapper.get('dialog [role="status"]').text()).toContain(
    "⟦pluginManagement.disableUncertain⟧",
  );
  expect(action(wrapper, "disableRetry")).toBeUndefined();
  await action(wrapper, "disableCheck").trigger("click");
  await flushPromises();
  expect(fixture.runtime.checkDisableStatus).toHaveBeenCalledOnce();
  expect(wrapper.get('dialog [role="status"]').text()).toContain(
    "⟦pluginManagement.disableChecking⟧",
  );
  expect(action(wrapper, "disableCheck")).toBeUndefined();
  await action(wrapper, "disableClose").trigger("click");
  await flushPromises();
  expect(fixture.runtime.cancelDisable).not.toHaveBeenCalled();
  await action(wrapper, "disable").trigger("click");
  expect(wrapper.get('dialog [role="status"]').text()).toContain(
    "⟦pluginManagement.disableChecking⟧",
  );
  fixture.runtime.state.disabling = {
    ...fixture.runtime.state.disabling!,
    phase: "failed",
    checking: false,
  };
  await flushPromises();
  expect(action(wrapper, "disableRetry")).toBeDefined();
  await action(wrapper, "disableRetry").trigger("click");
  await flushPromises();
  expect(fixture.runtime.setEnabled).toHaveBeenCalledTimes(2);
  expect(wrapper.find("dialog").exists()).toBe(false);
});
test.each([true, undefined])(
  "startup state %s keeps source/development/disabling usable and gates activation",
  async (mode) => {
    mocks.recovery = mode;
    const fixture = setup([
      {
        ...plugin("weekly"),
        status: "suppressed",
        settingsId: "weekly:settings",
      },
      plugin("quiet", false),
    ]);
    const wrapper = fixture.render();
    await flushPromises();
    expect(action(wrapper, "configure").attributes("disabled")).toBeDefined();
    expect(action(wrapper, "enable").attributes("disabled") !== undefined).toBe(
      mode === undefined,
    );
    await action(wrapper, "develop").trigger("click");
    await flushPromises();
    expect(fixture.onDevelop).toHaveBeenCalledWith("weekly");
    await action(wrapper, "inspect").trigger("click");
    await flushPromises();
    expect(filesRequest).toHaveBeenCalledWith({
      workspaceId: "garden",
      pluginId: "weekly",
      operation: "snapshot",
    });
    await wrapper.get(".file-entry").trigger("click");
    await flushPromises();
    expect(filesRequest).toHaveBeenCalledWith({
      workspaceId: "garden",
      pluginId: "weekly",
      operation: "read",
      path: "SKILL.md",
    });
    expect(wrapper.get(".markdown").text()).toBe("Instructions");
    await action(wrapper, "back").trigger("click");
    await action(wrapper, "disable").trigger("click");
    await wrapper
      .get(".situate-dialog-actions button:last-child")
      .trigger("click");
    await flushPromises();
    expect(fixture.runtime.setEnabled).toHaveBeenCalledExactlyOnceWith(
      "weekly",
      false,
    );
    expect(fixture.ui.coordinator.open).not.toHaveBeenCalled();
  },
);
test("re-enables through the existing runtime", async () => {
  const fixture = setup([plugin("quiet", false)]);
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "enable").trigger("click");
  await flushPromises();
  expect(fixture.runtime.setEnabled).toHaveBeenCalledExactlyOnceWith(
    "quiet",
    true,
  );
});
test("retains management after a failed action and dismisses without replaying it", async () => {
  const fixture = setup();
  fixture.onDevelop.mockRejectedValueOnce("native.plugins.readFailed");
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "develop").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "⟦native.plugins.readFailed⟧",
  );
  expect(wrapper.get('[data-plugin-id="weekly"]').text()).toContain(
    "Plugin weekly",
  );
  expect(wrapper.find(".situate-error-screen").exists()).toBe(false);
  await action(wrapper, "uninstall.close").trigger("click");
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(fixture.onDevelop).toHaveBeenCalledOnce();
  await action(wrapper, "inspect").trigger("click");
  await flushPromises();
  expect(wrapper.findComponent({ name: "FileEditor" }).exists()).toBe(true);
  expect(wrapper.vm.back()).toBe(true);
  await flushPromises();
  expect(wrapper.find('[data-plugin-id="weekly"]').exists()).toBe(true);
});
test("clears a failed enable notice after successful inventory reconciliation", async () => {
  const fixture = setup([plugin("quiet", false)]);
  fixture.runtime.setEnabled.mockRejectedValueOnce(
    "native.plugins.stateOutcomeUnknown",
  );
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "enable").trigger("click");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  fixture.runtime.state.status = "loading";
  await flushPromises();
  fixture.runtime.state.status = "ready";
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.find('[data-plugin-id="quiet"]').exists()).toBe(true);
});
test("does not show unreadable inventory as an empty installation and retries only its read", async () => {
  const fixture = setup([]);
  fixture.runtime.state.status = "failed";
  fixture.runtime.state.error = "native.plugins.readFailed";
  fixture.runtime.ready = Promise.reject("native.plugins.readFailed");
  const wrapper = fixture.render();
  await flushPromises();
  expect(wrapper.get("h1").text()).toBe("⟦pluginManagement.title⟧");
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "⟦native.plugins.readFailed⟧",
  );
  expect(wrapper.find(".plugin-first-tool").exists()).toBe(false);
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "⟦navigation.retry⟧")!
    .trigger("click");
  await flushPromises();
  expect(fixture.runtime.refresh).toHaveBeenCalledExactlyOnceWith(
    undefined,
    true,
  );
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.find(".plugin-first-tool").exists()).toBe(true);
  expect(fixture.onDevelop).not.toHaveBeenCalled();
});
test("ignores a caught old initialization rejection after reconciliation succeeds", async () => {
  const fixture = setup();
  let reject!: (cause: unknown) => void;
  fixture.runtime.ready = new Promise((_resolve, fail) => {
    reject = fail;
  });
  const wrapper = fixture.render();
  await flushPromises();
  fixture.runtime.state.status = "failed";
  fixture.runtime.state.error = "native.plugins.readFailed";
  await fixture.runtime.refresh();
  reject("native.plugins.readFailed");
  await flushPromises();
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  expect(wrapper.find('[data-plugin-id="weekly"]').exists()).toBe(true);
});
test("retains selected source and Back navigation when inventory becomes unavailable", async () => {
  const fixture = setup();
  const wrapper = fixture.render("weekly");
  await flushPromises();
  const editor = wrapper.findComponent({ name: "FileEditor" }).element;
  fixture.runtime.state.error = "native.plugins.readFailed";
  fixture.runtime.state.status = "failed";
  await flushPromises();
  expect(wrapper.findComponent({ name: "FileEditor" }).element).toBe(editor);
  expect(wrapper.get("h1").text()).toBe("Plugin weekly");
  expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  expect(wrapper.vm.back()).toBe(true);
  await flushPromises();
  expect(wrapper.find('[data-plugin-id="weekly"]').exists()).toBe(true);
});
test("keeps an open disable dialog and confirmed cards when inventory fails", async () => {
  const fixture = setup();
  const wrapper = fixture.render();
  await flushPromises();
  await action(wrapper, "disable").trigger("click");
  fixture.runtime.state.error = "native.plugins.readFailed";
  fixture.runtime.state.status = "failed";
  await flushPromises();
  expect(wrapper.get("dialog").element.open).toBe(true);
  expect(wrapper.find('[data-plugin-id="weekly"]').exists()).toBe(true);
  expect(wrapper.vm.back()).toBe(true);
  await flushPromises();
  expect(wrapper.find("dialog").exists()).toBe(false);
});
test("keeps runtime action notices local and dismissible without changing inventory", async () => {
  const fixture = setup();
  fixture.runtime.state.actionError = "plugins.cleanupFailed";
  const wrapper = fixture.render();
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toContain(
    "⟦plugins.cleanupFailed⟧",
  );
  expect(wrapper.find('[data-plugin-id="weekly"]').exists()).toBe(true);
  await action(wrapper, "uninstall.close").trigger("click");
  expect(fixture.runtime.dismissActionError).toHaveBeenCalledOnce();
  expect(fixture.runtime.state.plugins).toHaveLength(1);
  expect(fixture.runtime.setEnabled).not.toHaveBeenCalled();
});
test("discards a late runtime initialization when the workspace changes", async () => {
  const first = setup();
  let resolve!: (value: typeof first.runtime) => void;
  first.ui.plugins = new Promise((r) => {
    resolve = r;
  }) as typeof first.ui.plugins;
  const wrapper = first.render();
  await flushPromises();
  const second = setup([plugin("other")]);
  await wrapper.setProps({ scope: "other-workspace" });
  await flushPromises();
  resolve(first.runtime);
  await flushPromises();
  expect(wrapper.text()).toContain("Plugin other");
  expect(wrapper.text()).not.toContain("Plugin weekly");
  expect(second.runtime.setEnabled).not.toHaveBeenCalled();
});

async function openUninstall(wrapper: ReturnType<typeof mount>, id = "weekly") {
  const more = wrapper.get(`[data-plugin-id="${id}"] [data-action="more"]`);
  vi.spyOn(more.element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 100, 44, 44),
  );
  await more.trigger("click");
  await flushPromises();
  await wrapper.get('[role="menuitem"]').trigger("click");
  await flushPromises();
}

test.each([false, true, undefined])(
  "More actions works for disabled plugins during recovery %s",
  async (mode) => {
    mocks.recovery = mode;
    const fixture = setup([plugin("quiet", false)]);
    const wrapper = fixture.render();
    await flushPromises();
    await openUninstall(wrapper, "quiet");
    expect(wrapper.get("dialog h2").text()).toContain("Plugin quiet");
    expect(action(wrapper, "uninstall.disable")).toBeUndefined();
    expect(
      action(wrapper, "uninstall.confirm").attributes("disabled"),
    ).toBeUndefined();
    await wrapper.get("dialog").trigger("cancel");
    await flushPromises();
    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(document.activeElement).toBe(
      wrapper.get('[data-action="more"]').element,
    );
  },
);

test("uninstall blocks all direct and indirect dependents including disabled ones", async () => {
  const fixture = setup([
    plugin("weekly"),
    plugin("direct", false),
    plugin("indirect", false),
    plugin("other"),
  ]);
  fixture.runtime.affectedPluginIds.mockReturnValue([
    "weekly",
    "direct",
    "indirect",
  ]);
  const wrapper = fixture.render();
  await flushPromises();
  await openUninstall(wrapper);
  expect(
    wrapper
      .get("dialog")
      .findAll("li")
      .map((li) => li.text()),
  ).toEqual(["Plugin direct", "Plugin indirect"]);
  expect(action(wrapper, "uninstall.confirm")).toBeUndefined();
  expect(fixture.runtime.uninstall).not.toHaveBeenCalled();
  await action(wrapper, "uninstall.disable").trigger("click");
  await flushPromises();
  expect(wrapper.get("dialog").text()).toContain(
    "⟦pluginManagement.disableBody⟧",
  );
  expect(wrapper.get("dialog").findAll("li")).toHaveLength(0);
  await action(wrapper, "cancel").trigger("click");
  await flushPromises();
  expect(document.activeElement).toBe(
    wrapper.get('[data-plugin-id="weekly"] [data-action="more"]').element,
  );
});

test("uninstall blocks running work until it finishes reactively", async () => {
  const fixture = setup();
  const work = shallowReactive({ count: 1 });
  fixture.runtime.runningActions.mockImplementation(() => work.count);
  const wrapper = fixture.render();
  await flushPromises();
  await openUninstall(wrapper);
  expect(wrapper.get("dialog").text()).toContain(
    "⟦pluginManagement.uninstall.runningHelp⟧",
  );
  expect(action(wrapper, "uninstall.confirm")).toBeUndefined();
  work.count = 0;
  await flushPromises();
  expect(action(wrapper, "uninstall.confirm").exists()).toBe(true);
});

test("pending uninstall prevents duplicates and dismissal; success announces its name and focuses the collection", async () => {
  const fixture = setup();
  let finish!: () => void;
  fixture.runtime.uninstall.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const wrapper = fixture.render();
  await flushPromises();
  await openUninstall(wrapper);
  await action(wrapper, "uninstall.confirm").trigger("click");
  await action(wrapper, "uninstall.confirm").trigger("click");
  await wrapper.get("dialog").trigger("cancel");
  expect(wrapper.vm.back()).toBe(true);
  expect(wrapper.find("dialog").exists()).toBe(true);
  expect(wrapper.get("dialog").attributes("aria-busy")).toBe("true");
  expect(fixture.runtime.uninstall).toHaveBeenCalledExactlyOnceWith("weekly");
  fixture.runtime.state.plugins = [];
  finish();
  await flushPromises();
  expect(wrapper.find("dialog").exists()).toBe(false);
  expect(wrapper.find('[data-plugin-id="weekly"]').exists()).toBe(false);
  expect(wrapper.get(".plugin-announcement").text()).toContain(
    '⟦pluginManagement.uninstall.success:{"name":"Plugin weekly"}⟧',
  );
  expect(document.activeElement).toBe(wrapper.get("h1").element);
});

test.each(["stateBusy", "stateConflict"])(
  "known %s refusal retains the target and allows explicit retry",
  async (code) => {
    const fixture = setup();
    fixture.runtime.uninstall.mockRejectedValueOnce(
      new Error(`native.plugins.${code}`),
    );
    const wrapper = fixture.render();
    await flushPromises();
    await openUninstall(wrapper);
    await action(wrapper, "uninstall.confirm").trigger("click");
    await flushPromises();
    expect(wrapper.get("dialog [role=alert]").text()).toContain(
      "⟦pluginManagement.uninstall.error⟧",
    );
    expect(wrapper.find('[data-plugin-id="weekly"]').exists()).toBe(true);
    await action(wrapper, "uninstall.retry").trigger("click");
    await flushPromises();
    expect(fixture.runtime.uninstall).toHaveBeenCalledTimes(2);
  },
);

test.each([
  "plugins.saveFailed",
  "native.plugins.readFailed",
  "native.plugins.stateOutcomeUnknown",
])(
  "uncertain %s response re-reads inventory and never offers a blind retry",
  async (code) => {
    const fixture = setup();
    fixture.runtime.uninstall.mockRejectedValueOnce(new Error(code));
    const wrapper = fixture.render();
    await flushPromises();
    await openUninstall(wrapper);
    await action(wrapper, "uninstall.confirm").trigger("click");
    await flushPromises();
    expect(fixture.runtime.synchronizeInventory).toHaveBeenCalledOnce();
    expect(wrapper.get("dialog [role=alert]").text()).toContain(
      "⟦pluginManagement.uninstall.unknown⟧",
    );
    expect(action(wrapper, "uninstall.retry")).toBeUndefined();
    expect(action(wrapper, "uninstall.confirm")).toBeUndefined();
    await action(wrapper, "uninstall.close").trigger("click");
    await openUninstall(wrapper);
    expect(action(wrapper, "uninstall.confirm")).toBeUndefined();
    expect(fixture.runtime.uninstall).toHaveBeenCalledOnce();
  },
);

test("an uncertain uninstall cannot be resubmitted after management unmounts and reopens", async () => {
  const fixture = setup();
  fixture.runtime.uninstall.mockImplementation(async (id) => {
    fixture.runtime.uninstallOutcomeUnknown.mockImplementation(
      (candidate) => candidate === id,
    );
    throw new Error("native.plugins.stateOutcomeUnknown");
  });
  const first = fixture.render();
  await flushPromises();
  await openUninstall(first);
  await action(first, "uninstall.confirm").trigger("click");
  await flushPromises();
  expect(first.get("dialog [role=alert]").text()).toContain(
    "⟦pluginManagement.uninstall.unknown⟧",
  );
  first.unmount();

  const reopened = fixture.render();
  await flushPromises();
  await openUninstall(reopened);
  expect(reopened.get("dialog [role=alert]").text()).toContain(
    "⟦pluginManagement.uninstall.unknown⟧",
  );
  expect(fixture.runtime.uninstallOutcomeUnknown).toHaveBeenCalledWith(
    "weekly",
  );
  expect(action(reopened, "uninstall.confirm")).toBeUndefined();
  expect(action(reopened, "uninstall.retry")).toBeUndefined();
  expect(fixture.runtime.uninstall).toHaveBeenCalledExactlyOnceWith("weekly");
});

test("an uncertain response that removed the target does not claim success", async () => {
  const fixture = setup();
  fixture.runtime.uninstall.mockImplementation(async () => {
    fixture.runtime.state.plugins = [];
    throw new Error("native.plugins.stateOutcomeUnknown");
  });
  const wrapper = fixture.render();
  await flushPromises();
  await openUninstall(wrapper);
  await action(wrapper, "uninstall.confirm").trigger("click");
  await flushPromises();
  expect(wrapper.find("dialog").exists()).toBe(false);
  expect(wrapper.get(".plugin-announcement").text()).toContain(
    "pluginManagement.uninstall.unknownOutcome",
  );
  expect(wrapper.get(".plugin-announcement").text()).not.toContain(
    "pluginManagement.uninstall.success",
  );
  expect(document.activeElement).toBe(wrapper.get("h1").element);
});

test("a new installation with the same ID closes the old confirmation", async () => {
  const fixture = setup([{ ...plugin("weekly"), incarnation: "old" }]);
  const wrapper = fixture.render();
  await flushPromises();
  await openUninstall(wrapper);
  fixture.runtime.state.plugins = [{ ...plugin("weekly"), incarnation: "new" }];
  await flushPromises();
  expect(wrapper.find("dialog").exists()).toBe(false);
  expect(document.activeElement).toBe(wrapper.get("h1").element);
  expect(fixture.runtime.uninstall).not.toHaveBeenCalled();
});

test.each(["files", "uninstall", "disable"])(
  "external removal closes %s and focuses the collection without a stale card",
  async (view) => {
    const fixture = setup();
    const wrapper = fixture.render();
    await flushPromises();
    if (view === "files") await action(wrapper, "inspect").trigger("click");
    else if (view === "disable")
      await action(wrapper, "disable").trigger("click");
    else await openUninstall(wrapper);
    fixture.runtime.state.plugins = [];
    await flushPromises();
    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(wrapper.find(".plugin-files-view").exists()).toBe(false);
    expect(wrapper.find('[data-plugin-id="weekly"]').exists()).toBe(false);
    expect(wrapper.get("h1").text()).toBe("⟦pluginManagement.title⟧");
    expect(document.activeElement).toBe(wrapper.get("h1").element);
  },
);
