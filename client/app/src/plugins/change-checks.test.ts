import { beforeEach, expect, it, vi } from "vitest";
import { createPluginChanges } from "./change-checks";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  recovery: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../recovery", () => ({
  recoveryMode: mocks.recovery,
}));
const options = () => ({
  scope: "scope",
  conversation: "conversation",
  runId: "run",
  isCurrent: () => true,
  onAvailable: vi.fn().mockResolvedValue(undefined),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.recovery.mockReturnValue(false);
});

it("submits grouped sources and scripts to the native check owner", async () => {
  const args = {
    changes: [{ pluginId: "consumer", revision: "revision" }],
    checks: [
      {
        pluginId: "consumer",
        script: 'throw new Error("not UI code")',
        fixtures: { config: { "settings.json": "{}" } },
      },
    ],
  };
  const result = {
    checkId: "check",
    passed: true,
    results: [{ pluginId: "consumer", passed: true, assertions: 2 }],
    images: [],
  };
  mocks.invoke.mockResolvedValue(result);
  await expect(
    createPluginChanges(options()).check("call", args),
  ).resolves.toEqual(result);
  expect(mocks.invoke.mock.calls).toEqual([
    [
      "plugin_changes_check",
      {
        scope: "scope",
        conversation: "conversation",
        runId: "run",
        toolCallId: "call",
        request: { operation: "check", ...args },
      },
    ],
  ]);
});

it("retains native missing-check and failed-check outcomes", async () => {
  const result = {
    passed: false,
    needsChecks: ["provider"],
    requiredChecks: ["consumer", "provider"],
    images: [],
  };
  mocks.invoke.mockResolvedValue(result);
  await expect(
    createPluginChanges(options()).check("call", {
      changes: [],
      checks: [],
    }),
  ).resolves.toEqual(result);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it("rejects cancelled or unavailable admission without calling native", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    createPluginChanges(options()).check(
      "call",
      { changes: [], checks: [] },
      controller.signal,
    ),
  ).rejects.toThrow();
  mocks.recovery.mockReturnValue(undefined);
  await expect(
    createPluginChanges(options()).check("call", {
      changes: [],
      checks: [],
    }),
  ).rejects.toThrow("native.plugins.recoveryBlocked");
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("projects native-completed activation without describe, refresh admission or release", async () => {
  const plugins = [
    { pluginId: "provider", revision: "one" },
    { pluginId: "consumer", revision: "two" },
  ];
  const result = {
    activated: true,
    plugins,
    publication: { attempt: "attempt", status: "published" },
    followUpError: "plugins.activationFollowUpFailed",
  };
  mocks.invoke.mockResolvedValue(result);
  const configured = options();
  await expect(
    createPluginChanges(configured).activate("call", "check"),
  ).resolves.toEqual(result);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("plugin_changes_check", {
    scope: "scope",
    conversation: "conversation",
    runId: "run",
    toolCallId: "call",
    request: { operation: "activate", checkId: "check" },
  });
  expect(configured.onAvailable).toHaveBeenCalledExactlyOnceWith(plugins);
});

it("retains an uncertain native publication without follow-up or redispatch", async () => {
  const result = {
    activated: false,
    plugins: [],
    publication: { attempt: "attempt", status: "outcomeUnknown" },
  };
  mocks.invoke.mockResolvedValue(result);
  const configured = options();
  await expect(
    createPluginChanges(configured).activate("call", "check"),
  ).resolves.toEqual(result);
  expect(configured.onAvailable).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledOnce();
});

it.each(["result", "error"] as const)(
  "cancels before a check ID exists and waits for native cleanup (%s)",
  async (outcome) => {
    let finish!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    let cancellationDone!: (value: unknown) => void;
    const native = new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const cancelled = new Promise((resolve) => {
      cancellationDone = resolve;
    });
    mocks.invoke.mockImplementation((_command, { request }) =>
      request.operation === "cancelPending" ? cancelled : native,
    );
    const controller = new AbortController();
    const pending = createPluginChanges(options()).check(
      "call",
      { changes: [], checks: [] },
      controller.signal,
    );
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const rejected = expect(pending).rejects.toThrow(
      "plugins.executionCancelled",
    );
    controller.abort();
    expect(mocks.invoke).toHaveBeenLastCalledWith("plugin_changes_check", {
      scope: "scope",
      conversation: "conversation",
      runId: "run",
      toolCallId: "call",
      request: { operation: "cancelPending", toolCallId: "call" },
    });
    cancellationDone(undefined);
    await Promise.resolve();
    expect(settled).toBe(false);
    if (outcome === "result")
      finish({ checkId: "check", assertions: 1, images: [] });
    else fail(new Error("native cleanup completed"));
    await rejected;
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  },
);

it("does not report cancellation complete while its acknowledgement is pending", async () => {
  let finish!: (value: unknown) => void;
  let cancellationDone!: (value: unknown) => void;
  const native = new Promise((resolve) => {
    finish = resolve;
  });
  const cancelled = new Promise((resolve) => {
    cancellationDone = resolve;
  });
  mocks.invoke.mockImplementation((_command, { request }) =>
    request.operation === "cancelPending" ? cancelled : native,
  );
  const controller = new AbortController();
  const pending = createPluginChanges(options()).check(
    "call",
    { changes: [], checks: [] },
    controller.signal,
  );
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const rejected = expect(pending).rejects.toThrow(
    "plugins.executionCancelled",
  );
  controller.abort();
  finish({ checkId: "check", assertions: 1, images: [] });
  await Promise.resolve();
  expect(settled).toBe(false);
  cancellationDone(undefined);
  await rejected;
});

it("removes cancellation admission after a check has finished", async () => {
  mocks.invoke.mockResolvedValue({
    checkId: "check",
    assertions: 1,
    images: [],
  });
  const controller = new AbortController();
  await createPluginChanges(options()).check(
    "call",
    { changes: [], checks: [] },
    controller.signal,
  );
  controller.abort();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
