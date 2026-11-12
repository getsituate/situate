import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, isTauri } = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  isTauri.mockReturnValue(true);
});

const plugin = {
  pluginId: "demo",
  enabled: true,
  views: [
    {
      id: "demo:notes",
      title: () => "Notes",
      icon: "folder" as const,
      component: {},
    },
  ],
};

async function registry() {
  const { createViewRegistry } = await import("./layout/registry");
  return createViewRegistry();
}

function expectSuppressed(value: Awaited<ReturnType<typeof registry>>) {
  value.setRecovery(false);
  expect(() => value.registerPlugin(plugin)).toThrow(
    "layoutHost.pluginUnavailable",
  );
  expect(value.definitions.has("demo:notes")).toBe(false);
}

describe("application recovery", () => {
  it("blocks registration before and during initialization, then allows normal startup", async () => {
    let resolve!: (mode: boolean) => void;
    invoke.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    const recovery = await import("./recovery");
    const existing = await registry();
    expectSuppressed(existing);
    const pending = recovery.initializeRecovery();
    expect(recovery.initializeRecovery()).toBe(pending);
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("plugin_recovery_mode");
    expect(recovery.recoveryMode()).toBeUndefined();
    expectSuppressed(existing);
    expectSuppressed(await registry());
    resolve(false);
    await pending;
    existing.registerPlugin(plugin);
    expect(existing.definitions.has("demo:notes")).toBe(true);
    (await registry()).registerPlugin(plugin);
  });

  it("keeps installed plugins paused across existing and future registries until explicit resumption", async () => {
    invoke.mockImplementation(async (command) =>
      command === "plugin_recovery_mode"
        ? true
        : { revision: 0, recovery: true, resumed: [] },
    );
    const recovery = await import("./recovery");
    const existing = await registry();
    await recovery.initializeRecovery();
    expectSuppressed(existing);
    expectSuppressed(await registry());
    invoke.mockResolvedValue(false);
    await recovery.initializeRecovery();
    expect(recovery.recoveryMode()).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    expectSuppressed(existing);
  });

  it.each([undefined, null, "false", 0])(
    "rejects malformed native state %s without enabling plugins",
    async (value) => {
      invoke.mockResolvedValue(value);
      const recovery = await import("./recovery");
      await expect(recovery.initializeRecovery()).rejects.toThrow(
        "layoutHost.pluginUnavailable",
      );
      expect(recovery.recoveryMode()).toBeUndefined();
      expectSuppressed(await registry());
    },
  );

  it("retains failure and never retries into normal mode", async () => {
    invoke.mockRejectedValue(new Error("unavailable"));
    const recovery = await import("./recovery");
    const existing = await registry();
    await expect(recovery.initializeRecovery()).rejects.toThrow("unavailable");
    invoke.mockResolvedValue(false);
    await expect(recovery.initializeRecovery()).rejects.toThrow("unavailable");
    expect(invoke).toHaveBeenCalledTimes(1);
    expectSuppressed(existing);
    expectSuppressed(await registry());
  });

  it("retries failed startup only through the explicit recovery action", async () => {
    invoke.mockRejectedValueOnce(new Error("unavailable"));
    const recovery = await import("./recovery");
    await expect(recovery.initializeRecovery()).rejects.toThrow("unavailable");
    expect(recovery.recoveryMode()).toBeUndefined();
    invoke.mockResolvedValue(false);
    await recovery.retryRecoveryInitialization();
    expect(recovery.recoveryMode()).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("resumes only the chosen workspace plugin and ignores older events", async () => {
    const recovery = await import("./recovery");
    recovery.acceptRecoveryState({ revision: 1, recovery: true, resumed: [] });
    const { createViewRegistry } = await import("./layout/registry");
    const one = createViewRegistry("one");
    const two = createViewRegistry("two");
    invoke.mockResolvedValue({
      revision: 3,
      recovery: true,
      resumed: [["one", "demo"]],
    });
    await recovery.resumePlugins("one", "demo");
    one.registerPlugin(plugin);
    expectSuppressed(two);
    expect(recovery.pluginMayExecute("one", "other")).toBe(false);
    recovery.acceptRecoveryState({ revision: 2, recovery: true, resumed: [] });
    expect(recovery.pluginMayExecute("one", "demo")).toBe(true);
    expect(recovery.recoveryMode()).toBe(true);
  });

  it("supports the browser-only shell without native IPC", async () => {
    isTauri.mockReturnValue(false);
    const recovery = await import("./recovery");
    await recovery.initializeRecovery();
    expect(recovery.recoveryMode()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
