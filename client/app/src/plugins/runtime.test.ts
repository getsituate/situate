import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewRegistry, type UiCoordinator } from "../layout/registry";
import { createPluginRuntime } from "./runtime";
import type { PluginUiHost } from "./types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  importModule: vi.fn(),
  link: vi.fn(),
  disposeModule: vi.fn(),
  recovery: false,
  resume: vi.fn(),
  persistenceDispose: vi.fn(),
  persistenceUnwrap: vi.fn(),
  persistenceError: undefined as ((error: unknown) => void) | undefined,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./module", () => ({
  importPluginModule: mocks.importModule,
  loadHostModules: async () => ({ vue: { h: "synthetic-vue" }, ui: {} }),
}));
vi.mock("./module-source", () => ({ createPluginModule: mocks.link }));
vi.mock("./manual-persistence", () => ({
  observeManualPersistence: (
    _scope: string,
    _current: () => boolean,
    onError: (error: unknown) => void,
  ) => {
    mocks.persistenceError = onError;
    return {
      ready: Promise.resolve(),
      dispose: mocks.persistenceDispose,
      unwrap: mocks.persistenceUnwrap,
    };
  },
}));
vi.mock("../recovery", async () => {
  const { shallowRef } = await import("vue");
  const revision = shallowRef(0);
  return {
    recoveryMode: () => mocks.recovery,
    recoveryRevision: () => revision.value,
    pluginMayExecute: () => !mocks.recovery,
    resumePlugins: mocks.resume,
  };
});
const view = (id: string) => ({
  id,
  title: () => "Synthetic",
  icon: "folder",
  component: { render: () => null },
});
const descriptor = {
  name: "plugin_2a97516c354b6884_run",
  description: "Run",
  parameters: { type: "object", properties: {} },
};
function definition(id = "demo", dependencies: string[] = []) {
  return {
    pluginId: id,
    revision: "r1",
    incarnation: `inc-${id}`,
    generation: 7,
    tools: id === "demo" ? [descriptor] : [],
    exports: ["run"],
    source: {
      manifest: {
        schemaVersion: 2,
        id,
        name: id,
        description: "Synthetic",
        skills: [],
        serviceEntry: "service.js",
        uiEntry: "ui.js",
        dependencies,
        exports: ["run"],
      },
      serviceEntry: "throw new Error('must not execute in UI')",
      uiEntry: "export default () => ({})",
      modules: {},
      skills: [],
    },
  };
}
let definitions: ReturnType<typeof definition>[];
let hosts: Map<string, PluginUiHost>;
const instances: ReturnType<typeof createPluginRuntime>[] = [];
function setup() {
  const registry = createViewRegistry("scope");
  const coordinator = {
    open: vi.fn(async () => true),
    reveal: vi.fn(async () => true),
  } as unknown as UiCoordinator;
  const runtime = createPluginRuntime({
    scope: "scope",
    registry,
    coordinator,
    isCurrent: () => true,
  });
  instances.push(runtime);
  return { runtime, registry, coordinator };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.recovery = false;
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.persistenceUnwrap.mockImplementation(async (reply) => reply.value);
  definitions = [definition()];
  hosts = new Map();
  mocks.link.mockImplementation((source, entry) => ({
    url: `${source.manifest.id}:${entry}`,
    dispose: mocks.disposeModule,
  }));
  mocks.importModule.mockImplementation(async (url: string) => ({
    default: (host: PluginUiHost) => {
      const id = url.split(":")[0];
      hosts.set(id, host);
      return {
        views: [view(`${id}:main`)],
        settings: view(`${id}:settings`),
        components: { Card: { name: `${id}Card`, render: () => null } },
      };
    },
  }));
  mocks.invoke.mockImplementation(async (command, { request }) => {
    if (command === "plugin_runtime" && request.operation === "list")
      return {
        revision: "inventory",
        plugins: definitions.map((entry) => ({
          id: entry.pluginId,
          revision: entry.revision,
          incarnation: entry.incarnation,
          enabled: true,
          manifest: entry.source.manifest,
          error: null,
        })),
      };
    if (command === "plugin_executor" && request.operation === "snapshot")
      return { plugins: definitions };
    if (command === "plugin_executor" && request.operation === "invoke")
      return { outcome: "completed", value: { done: request.args } };
    throw new Error("Unexpected native command");
  });
});
afterEach(() => {
  for (const runtime of instances.splice(0)) runtime.dispose();
});

describe("plugin UI runtime", () => {
  it("keeps healthy capabilities available and exposes native initialization failures", async () => {
    definitions = [definition("broken"), definition()];
    const native = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (
        command === "plugin_executor" &&
        args.request.operation === "snapshot"
      )
        return {
          plugins: definitions.filter((entry) => entry.pluginId !== "broken"),
          unavailable: [
            {
              pluginId: "broken",
              pluginName: "Broken",
              reason: "initializationUnavailable",
              error: "native.plugins.readFailed",
            },
          ],
        };
      return native(command, args);
    });
    const { runtime } = setup();
    await runtime.ready;
    expect(
      runtime.state.plugins.find((plugin) => plugin.id === "broken"),
    ).toMatchObject({ status: "failed", error: "native.plugins.readFailed" });
    expect(
      runtime.state.plugins.find((plugin) => plugin.id === "demo")?.status,
    ).toBe("loaded");
    expect(runtime.getToolDescriptors()).toEqual([descriptor]);
    expect(mocks.importModule).toHaveBeenCalledTimes(1);
  });
  it("imports only the UI entry and retains serializable native descriptors", async () => {
    const { runtime } = setup();
    await runtime.ready;
    expect(runtime.state.plugins[0].status).toBe("loaded");
    expect(mocks.link).toHaveBeenCalledWith(definitions[0].source, "ui");
    expect(mocks.importModule).toHaveBeenCalledExactlyOnceWith("demo:ui");
    expect(runtime.getToolDescriptors()).toEqual([descriptor]);
    expect(() => structuredClone(runtime.getToolDescriptors())).not.toThrow();
    expect(mocks.disposeModule).not.toHaveBeenCalled();
    expect(hosts.get("demo")).not.toHaveProperty("files");
    expect(hosts.get("demo")).not.toHaveProperty("signal");
    runtime.dispose();
    expect(mocks.disposeModule).toHaveBeenCalledOnce();
  });

  it("takes one native snapshot per refresh without reimporting unchanged UI", async () => {
    const { runtime } = setup();
    await runtime.ready;
    await runtime.refresh(undefined, true);
    expect(
      mocks.invoke.mock.calls.filter(
        ([command, { request }]) =>
          command === "plugin_executor" && request.operation === "snapshot",
      ),
    ).toHaveLength(2);
    expect(mocks.importModule).toHaveBeenCalledOnce();
  });

  it("sends manual service calls through native generation admission", async () => {
    const { runtime } = setup();
    await runtime.ready;
    expect(
      await hosts.get("demo")!.service.invoke("run", { value: 2 }),
    ).toEqual({ done: { value: 2 } });
    expect(mocks.invoke).toHaveBeenLastCalledWith("plugin_executor", {
      scope: "scope",
      request: {
        operation: "invoke",
        pluginId: "demo",
        exportName: "run",
        args: { value: 2 },
        generation: 7,
      },
    });
    await expect(
      hosts.get("demo")!.service.invoke("missing", {}),
    ).rejects.toThrow("native.plugins.unavailable");
  });

  it("keeps native invocation failures observable", async () => {
    const { runtime } = setup();
    await runtime.ready;
    mocks.invoke.mockRejectedValueOnce(new Error("native.plugins.unavailable"));
    await expect(hosts.get("demo")!.service.invoke("run", {})).rejects.toThrow(
      "native.plugins.unavailable",
    );
    expect(runtime.runningActions("demo")).toBe(0);
    expect(runtime.state.status).toBe("ready");
    expect(runtime.state.error).toBeNull();
    const inventory = runtime.state.plugins;
    await runtime.synchronizeInventory();
    expect(runtime.state.plugins).toBe(inventory);
    expect(runtime.state.error).toBeNull();
    expect(runtime.getToolDescriptors()).toEqual([descriptor]);
  });

  it("retains confirmed inventory on read failure and reconciles on retry", async () => {
    const { runtime } = setup();
    await runtime.ready;
    const inventory = runtime.state.plugins;
    const host = hosts.get("demo")!;
    mocks.invoke.mockRejectedValueOnce("native.plugins.readFailed");
    await expect(runtime.synchronizeInventory()).rejects.toThrow(
      "native.plugins.readFailed",
    );
    expect(runtime.state.status).toBe("failed");
    expect(runtime.state.error).toBe("native.plugins.readFailed");
    expect(runtime.state.plugins).toBe(inventory);
    expect(runtime.getToolDescriptors()).toEqual([]);
    await expect(host.service.invoke("run", {})).rejects.toThrow(
      "native.plugins.unavailable",
    );
    await runtime.synchronizeInventory();
    expect(runtime.state.status).toBe("ready");
    expect(runtime.state.error).toBeNull();
    expect(runtime.state.plugins.map((plugin) => plugin.id)).toEqual(["demo"]);
    expect(runtime.getToolDescriptors()).toEqual([descriptor]);
  });

  it("clears an initial inventory failure only after a successful retry", async () => {
    mocks.invoke.mockRejectedValueOnce("native.plugins.readFailed");
    const { runtime } = setup();
    const initial = runtime.ready;
    await expect(initial).rejects.toThrow("native.plugins.readFailed");
    expect(runtime.state.status).toBe("failed");
    expect(runtime.state.error).toBe("native.plugins.readFailed");
    await runtime.refresh(undefined, true);
    expect(runtime.state.status).toBe("ready");
    expect(runtime.state.error).toBeNull();
    expect(runtime.state.plugins).toHaveLength(1);
    await expect(initial).rejects.toThrow("native.plugins.readFailed");
    expect(runtime.state.error).toBeNull();
  });

  it("keeps uncertain enable failures local and admission closed until reconciliation", async () => {
    const { runtime } = setup();
    await runtime.ready;
    const host = hosts.get("demo")!;
    mocks.invoke.mockRejectedValueOnce("native.plugins.stateOutcomeUnknown");
    await expect(runtime.setEnabled("demo", true)).rejects.toThrow(
      "native.plugins.stateOutcomeUnknown",
    );
    expect(runtime.state.status).toBe("ready");
    expect(runtime.state.error).toBeNull();
    expect(runtime.state.actionError).toBe(
      "native.plugins.stateOutcomeUnknown",
    );
    expect(runtime.state.plugins).toHaveLength(1);
    await expect(host.service.invoke("run", {})).rejects.toThrow(
      "native.plugins.unavailable",
    );
    runtime.dismissActionError();
    await expect(runtime.setEnabled("demo", true)).rejects.toThrow(
      "native.plugins.stateInvalid",
    );
    await runtime.synchronizeInventory();
    expect(runtime.state.actionError).toBeNull();
    expect(runtime.getToolDescriptors()).toEqual([descriptor]);
    expect(await hosts.get("demo")!.service.invoke("run", {})).toEqual({
      done: {},
    });
  });

  it("keeps persistence failures local and reconciles unchanged inventory", async () => {
    const { runtime } = setup();
    await runtime.ready;
    mocks.persistenceError!("native.plugins.stateOutcomeUnknown");
    expect(runtime.state.error).toBeNull();
    expect(runtime.state.status).toBe("ready");
    expect(runtime.state.plugins).toHaveLength(1);
    expect(runtime.state.actionError).toBe(
      "native.plugins.stateOutcomeUnknown",
    );
    await runtime.synchronizeInventory();
    expect(runtime.state.actionError).toBeNull();
    expect(runtime.state.error).toBeNull();
  });

  it("retains cleanup failures as dismissible notices without losing inventory", async () => {
    const imported = mocks.importModule.getMockImplementation()!;
    mocks.importModule.mockImplementation(async (...args) => {
      const module = await imported(...args);
      return {
        default: (host: PluginUiHost) => ({
          ...module.default(host),
          dispose: () => {
            throw new Error("Synthetic cleanup failure");
          },
        }),
      };
    });
    const { runtime } = setup();
    await runtime.ready;
    await runtime.refresh();
    expect(runtime.state.status).toBe("ready");
    expect(runtime.state.plugins).toHaveLength(1);
    expect(runtime.state.error).toBeNull();
    expect(runtime.state.actionError).toBe("plugins.cleanupFailed");
    runtime.dismissActionError();
    expect(runtime.state.actionError).toBeNull();
    expect(runtime.state.plugins).toHaveLength(1);
  });

  it("provides only declared dependency service and component exports", async () => {
    definitions = [definition("demo", ["provider"]), definition("provider")];
    const { runtime } = setup();
    await runtime.ready;
    const host = hosts.get("demo")!;
    expect(host.dependencies.component("provider", "Card")).toHaveProperty(
      "name",
      "providerCard",
    );
    expect(await host.dependencies.invoke("provider", "run", 1)).toEqual({
      done: 1,
    });
    await expect(host.dependencies.invoke("other", "run", {})).rejects.toThrow(
      "native.plugins.unavailable",
    );
    expect(() => host.dependencies.component("other", "Card")).toThrow(
      "native.plugins.unavailable",
    );
  });

  it("preserves guarded host navigation and invalidates retained UI on disposal", async () => {
    const { runtime, coordinator } = setup();
    await runtime.ready;
    const host = hosts.get("demo")!;
    await host.navigation.reveal("demo:main", "item");
    expect(coordinator.reveal).toHaveBeenCalled();
    runtime.dispose();
    await expect(host.service.invoke("run", {})).rejects.toThrow(
      "plugins.workspaceUnavailable",
    );
    expect(() => host.navigation.reveal("demo:main", "item")).toThrow(
      "plugins.workspaceUnavailable",
    );
    expect(runtime.getToolDescriptors()).toEqual([]);
  });

  it("does not snapshot or import plugins during plugin-free recovery", async () => {
    mocks.recovery = true;
    const { runtime } = setup();
    await runtime.ready;
    expect(runtime.state.plugins[0].status).toBe("suppressed");
    expect(mocks.link).not.toHaveBeenCalled();
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) => command === "plugin_executor",
      ),
    ).toBe(false);
  });

  it("supports service-only plugins without loading Vue modules", async () => {
    definitions[0].source.uiEntry = null as unknown as string;
    const { runtime } = setup();
    await runtime.ready;
    expect(runtime.getToolDescriptors()).toEqual([descriptor]);
    expect(mocks.importModule).not.toHaveBeenCalled();
  });

  it("fails a mismatched captured revision before importing UI", async () => {
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[0] === "plugin_executor")
        return { plugins: [{ ...definitions[0], revision: "other" }] };
      return result;
    });
    const { runtime } = setup();
    await runtime.ready;
    expect(runtime.state.plugins[0].status).toBe("failed");
    expect(mocks.importModule).not.toHaveBeenCalled();
    expect(runtime.getToolDescriptors()).toEqual([]);
  });

  it("rejects combined-factory contributions and cleans up linked UI modules", async () => {
    mocks.importModule.mockResolvedValue({
      default: () => ({ tools: [{ execute: () => null }] }),
    });
    const { runtime } = setup();
    await runtime.ready;
    expect(runtime.state.plugins[0].error).toBe("plugins.invalidContributions");
    expect(mocks.disposeModule).toHaveBeenCalledOnce();
  });

  it("waits for manual service work before a quiescent publication", async () => {
    const { runtime } = setup();
    await runtime.ready;
    let finish!: (value: unknown) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const work = hosts.get("demo")!.service.invoke("run", {});
    const publish = vi.fn(async () => undefined);
    const quiet = runtime.withQuiescent(["demo"], publish);
    expect(publish).not.toHaveBeenCalled();
    await expect(hosts.get("demo")!.service.invoke("run", {})).rejects.toThrow(
      "native.plugins.unavailable",
    );
    finish({ done: true });
    await work;
    await quiet;
    expect(publish).toHaveBeenCalledOnce();
  });

  it("releases graph URLs when a UI import fails without exposing plugin errors", async () => {
    mocks.importModule.mockRejectedValue(new Error("Synthetic private source"));
    const { runtime } = setup();
    await runtime.ready;
    expect(runtime.state.plugins[0].error).toBe("plugins.loadFailed");
    expect(mocks.disposeModule).toHaveBeenCalledOnce();
  });

  it("refreshes published projections only for the current workspace without navigation", async () => {
    const { runtime, coordinator } = setup();
    await runtime.ready;
    const callback = mocks.listen.mock.calls.find(
      ([name]) => name === "plugin-executor-updated",
    )![1] as (event: {
      payload: { scope: string; pluginIds: string[] };
    }) => void;
    const calls = mocks.invoke.mock.calls.length;
    callback({ payload: { scope: "other", pluginIds: ["demo"] } });
    expect(mocks.invoke).toHaveBeenCalledTimes(calls);
    definitions[0].revision = "r2";
    definitions[0].generation = 8;
    definitions[0].tools = [{ ...descriptor, description: "Updated" }];
    callback({ payload: { scope: "scope", pluginIds: ["demo"] } });
    await vi.waitFor(() =>
      expect(runtime.getToolDescriptors()[0].description).toBe("Updated"),
    );
    expect(coordinator.open).not.toHaveBeenCalled();
    expect(coordinator.reveal).not.toHaveBeenCalled();
    runtime.dispose();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    const stopped = mocks.invoke.mock.calls.length;
    callback({ payload: { scope: "scope", pluginIds: ["demo"] } });
    expect(mocks.invoke).toHaveBeenCalledTimes(stopped);
  });

  it("keeps failed publication local and retries the unconfirmed inventory on reconciliation", async () => {
    const { runtime } = setup();
    await runtime.ready;
    const confirmed = runtime.state.plugins;
    definitions[0].revision = "r2";
    definitions[0].generation = 8;
    definitions[0].tools = [{ ...descriptor, description: "Updated" }];
    mocks.importModule.mockRejectedValueOnce(
      new Error("Synthetic import failure"),
    );
    await expect(runtime.refreshGroup(["demo"])).rejects.toThrow(
      "plugins.loadFailed",
    );
    expect(runtime.state.status).toBe("ready");
    expect(runtime.state.error).toBeNull();
    expect(runtime.state.actionError).toBe("plugins.loadFailed");
    expect(runtime.state.plugins).toBe(confirmed);
    await runtime.synchronizeInventory();
    expect(runtime.state.error).toBeNull();
    expect(runtime.state.actionError).toBeNull();
    expect(runtime.state.plugins[0].revision).toBe("r2");
    expect(runtime.getToolDescriptors()[0].description).toBe("Updated");
  });

  it("unsubscribes if disposal precedes publication listener registration", async () => {
    let finish!: (stop: () => void) => void;
    mocks.listen.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { runtime } = setup();
    runtime.dispose();
    finish(mocks.unlisten);
    await runtime.ready;
    expect(mocks.unlisten).toHaveBeenCalledOnce();
    expect(mocks.importModule).not.toHaveBeenCalled();
  });

  it("returns independent descriptor snapshots", async () => {
    const { runtime } = setup();
    await runtime.ready;
    runtime.getToolDescriptors()[0].parameters.type = "string";
    expect(runtime.getToolDescriptors()[0].parameters.type).toBe("object");
  });
});
