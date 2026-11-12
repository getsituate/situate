import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const directory = new URL("../app/src-tauri/tests/support/", import.meta.url);
const read = (name) => readFile(new URL(name, directory), "utf8");
const providerSource = await read("process-connection.js");
const consumerSource = await read("process-connection-consumer.js");
const smokeSource = await read("process-connection-smoke.js");
const request = {
  executable: "/bin/sh",
  args: ["-c", "synthetic immutable command"],
  timeoutMs: 5000,
};
const holdRequest = {
  executable: "/bin/sh",
  args: ["-c", "synthetic long command"],
  timeoutMs: 90000,
};
const stdout = '{"count":3,"source":"offline"}\n';
const stream = (text) => ({
  text,
  capturedBytes: text.length,
  totalBytes: text.length,
  truncated: false,
  incomplete: false,
});
function reply() {
  return {
    isError: false,
    commandResult: {
      Ok: {
        outcome: "exited",
        exitCode: 0,
        signal: null,
        stdout: stream(stdout),
        stderr: stream(""),
      },
    },
    beforeHistoryRevision: "before",
    afterHistoryRevision: "after",
    reconciliationError: null,
    attribution: "uncertainExternalChangesMayCoexist",
  };
}
const factory = (source) =>
  vm.runInNewContext(source.replace("export default", ""), { JSON, Error });

test("native process services keep immutable argv and invoke only the declared dependency", async () => {
  const calls = [],
    controller = new AbortController();
  const service = factory(
    providerSource.replace(
      'JSON.parse("PROCESS_REQUEST")',
      JSON.stringify(request),
    ),
  )();
  const providerHost = {
    signal: controller.signal,
    process: {
      capability: async () => ({ available: true }),
      run: async (...args) => {
        assert.equal(args.length, 1);
        assert.deepEqual(JSON.parse(JSON.stringify(args[0])), request);
        calls.push(args[0]);
        return reply();
      },
    },
  };
  const consumer = factory(consumerSource)();
  const context = {
    signal: controller.signal,
    dependencies: {
      invoke: async (...args) => {
        assert.equal(args.length, 3);
        const [id, name, input] = args;
        assert.equal(id, "process-connection");
        assert.equal(name, "read");
        return service.exports.read(input, providerHost);
      },
    },
  };
  const result = await consumer.exports.read(
    { executable: "/untrusted", args: ["ignored"] },
    context,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(result.details.value)), {
    count: 3,
    source: "offline",
  });
  assert.equal(result.details.reply.commandResult.Ok.stdout.text, stdout);
  assert.equal(calls.length, 1);
});
test("native hold export keeps immutable argv and the actual cancelled process outcome", async () => {
  const stopped = {
    ...reply(),
    isError: true,
    commandResult: {
      Ok: { ...reply().commandResult.Ok, outcome: "cancelled", exitCode: null },
    },
  };
  const service = factory(
    providerSource
      .replace('JSON.parse("PROCESS_REQUEST")', JSON.stringify(request))
      .replace(
        'JSON.parse("PROCESS_HOLD_REQUEST")',
        JSON.stringify(holdRequest),
      ),
  )();
  const host = {
    process: {
      run: async (...args) => {
        assert.equal(args.length, 1);
        assert.deepEqual(JSON.parse(JSON.stringify(args[0])), holdRequest);
        return stopped;
      },
    },
  };
  const consumer = factory(consumerSource)();
  const result = await consumer.exports.hold(
    { executable: "/ignored" },
    {
      dependencies: {
        invoke: async (id, name, args) => {
          assert.equal(id, "process-connection");
          assert.equal(name, "hold");
          return service.exports.hold(args, host);
        },
      },
    },
  );
  assert.equal(result.details.reply, stopped);
});
test("native provider rejects failed, interrupted and malformed process replies", async () => {
  const service = factory(
    providerSource.replace(
      'JSON.parse("PROCESS_REQUEST")',
      JSON.stringify(request),
    ),
  )();
  for (const response of [
    { isError: true, commandResult: { Err: "spawnFailed" } },
    {
      ...reply(),
      commandResult: {
        Ok: { ...reply().commandResult.Ok, outcome: "cancelled" },
      },
    },
    {
      ...reply(),
      commandResult: { Ok: { ...reply().commandResult.Ok, exitCode: 3 } },
    },
    {
      ...reply(),
      commandResult: {
        Ok: { ...reply().commandResult.Ok, stdout: stream("not json") },
      },
    },
  ]) {
    await assert.rejects(
      service.exports.read(
        {},
        {
          process: {
            capability: async () => ({ available: true }),
            run: async () => response,
          },
        },
      ),
    );
  }
  await assert.rejects(
    service.exports.read(
      {},
      {
        process: {
          capability: async () => ({ available: false }),
          run: () => assert.fail("Unavailable process ran"),
        },
      },
    ),
    /process-unavailable/,
  );
});
async function journey(fault) {
  let sentinel = false;
  let holding = false;
  let armed = false;
  let closed = false;
  let menuOpen = false;
  let closeDialog;
  let releaseHold;
  const lifecycleCalls = [];
  let dialog;
  let opened = 0;
  const stages = [];
  const checks = [];
  const writes = [];
  const require = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const document = {
    querySelector: (selector) => {
      if (selector.includes("close-ai-title")) return closeDialog;
      if (selector === "button.workspace-menu")
        return {
          click: () => {
            menuOpen = true;
          },
        };
      if (selector.includes("aria-expanded")) return menuOpen ? {} : null;
      if (selector === ".workspace-close button")
        return {
          click: () => {
            assert.equal(holding, true);
            menuOpen = false;
            closeDialog = {
              querySelectorAll: () => [
                {
                  click: () => {
                    lifecycleCalls.push("cancel-ui");
                    closeDialog = undefined;
                  },
                },
                {
                  click: () => {
                    assert.equal(armed, true);
                    lifecycleCalls.push("abort-ui");
                    holding = false;
                    closed = true;
                    closeDialog = undefined;
                    releaseHold();
                  },
                },
              ],
            };
          },
        };
      return dialog;
    },
    querySelectorAll: () => (dialog ? [dialog] : []),
  };
  const window = {
    nativePluginService: async (scope, pluginId) => {
      assert.equal(scope, "owned");
      assert.equal(pluginId, "process-consumer");
      opened++;
      return {
        invoke: async (name, _args, signal) => {
          signal?.throwIfAborted();
          if (fault === "confirmation") dialog = {};
          if (name === "hold") {
            assert.equal(checks.length, 4);
            holding = true;
            return new Promise((resolve) => {
              releaseHold = () => resolve({ details: {} });
            });
          }
          sentinel = true;
          const actual = reply();
          if (fault === "stdout") actual.commandResult.Ok.stdout.text = "wrong";
          if (fault === "history") actual.afterHistoryRevision = "before";
          return {
            content: [],
            details: {
              capability: {
                available: true,
                platform: "macos",
                requiresPathBackedWorkspace: true,
              },
              reply: actual,
              value: { count: 3, source: "offline" },
            },
          };
        },
      };
    },
  };
  await vm.runInNewContext(`(async () => {${smokeSource}\n})()`, {
    fixture: {
      processRequest: request,
      processHoldRequest: holdRequest,
      processConnection: providerSource,
      processConsumer: consumerSource,
    },
    scope: "owned",
    assignment: "v2",
    window,
    document,
    AbortController,
    crypto: { randomUUID: () => "id" },
    require,
    wait: async (predicate, message) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        if (await predicate()) return;
        await Promise.resolve();
      }
      assert.fail(message);
    },
    onClosing: () => {
      assert.equal(armed, true);
    },
    sourceWrite: async (...args) => writes.push(args),
    sourceRequest: async (request) => {
      assert.equal(request.operation, "create");
      return {};
    },
    checkChanges: async (_assignment, args) => {
      checks.push(args);
      const matching = checks.length === 4;
      if (fault === "fake-spawn" && matching) sentinel = true;
      return {
        passed: matching,
        results: [{ passed: matching }, { passed: matching }],
      };
    },
    activateGroup: async (_assignment, checked) => {
      if (!checked.passed && fault === "failed-receipt")
        throw new Error("native.plugins.checkInvalid");
      if (!checked.passed && fault === "activation-error")
        throw new Error("native.plugins.stateBusy");
      return { activated: checked.passed };
    },
    assertPublished: async (result) => assert.equal(result.activated, true),
    invoke: async (command, args) => {
      if (command === "smoke_plugin_check_verify") {
        assert.equal(
          sentinel,
          args.version === "process-executed",
          "synthetic checks executed a process",
        );
      } else if (command === "smoke_plugin_process_lifecycle") {
        lifecycleCalls.push(args.action);
        if (args.action === "absent") {
          assert.equal(holding, false);
          return { started: false };
        }
        if (args.action === "running") return { started: holding };
        assert.equal(holding, true);
        if (args.action === "quit-blocked" && fault === "quit")
          throw new Error("Quit passed process preflight");
        if (args.action === "arm-close") {
          armed = true;
          return { armed: true };
        }
        return { started: true };
      } else if (command === "ai_prepare_close") {
        lifecycleCalls.push("prepare-close");
        return { processes: holding };
      } else if (command === "ai_cancel_close") {
        lifecycleCalls.push("cancel-close");
        if (fault === "cancel") holding = false;
      } else if (command === "plugin_runtime") {
        return { plugins: [] };
      } else if (command === "change_revision") {
        assert.equal(args.scope, "owned");
        assert.equal(args.path, "process-result.md");
        assert.equal(args.revision, "after");
        return {
          status: "available",
          text: "# Process result\nOwned offline fixture.\n",
        };
      } else if (command === "files_request") {
        assert.deepEqual(Object.keys(args), ["request"]);
        assert.equal(args.request.workspaceId, "owned");
        assert.equal(args.request.operation, "history");
        return { history: [{ revision: sentinel ? "after" : "before" }] };
      } else if (command === "smoke_progress") stages.push(args.stage);
      else assert.fail(`Unexpected command ${command}`);
    },
  });
  return {
    sentinel,
    opened,
    stages,
    checks,
    writes,
    closed,
    armed,
    lifecycleCalls,
  };
}

test("failed-check activation rejection cannot hide an unrelated failure", async () => {
  assert.equal((await journey("failed-receipt")).closed, true);
  await assert.rejects(
    journey("activation-error"),
    /Unexpected process activation rejection/,
  );
});

test("qualification requires negative fixtures, direct execution, cancellation, and history", async () => {
  const result = await journey();
  assert.equal(result.sentinel, true);
  assert.equal(result.opened, 3);
  assert.equal(result.closed, true);
  assert.equal(result.armed, true);
  assert.deepEqual(
    result.lifecycleCalls.filter(
      (action) => action !== "absent" && action !== "running",
    ),
    [
      "prepare-close",
      "cancel-close",
      "quit-blocked",
      "cancel-ui",
      "arm-close",
      "abort-ui",
    ],
  );
  assert.deepEqual(result.stages, ["process-connection-offline-qualified"]);
  assert.equal(result.checks.length, 4);
  const manifest = JSON.parse(
    result.writes.find(
      ([, id, path]) => id === "process-connection" && path === "plugin.json",
    )[3],
  );
  assert.deepEqual(manifest.exports.sort(), ["hold", "read"]);
  const provider = factory(
    providerSource.replace(
      'JSON.parse("PROCESS_REQUEST")',
      JSON.stringify(request),
    ),
  )({});
  assert.deepEqual(Object.keys(provider.exports).sort(), ["hold", "read"]);
  const fixtures = JSON.parse(
    JSON.stringify(
      result.checks.map(({ checks }) => checks.map((entry) => entry.processes)),
    ),
  );
  assert.deepEqual(fixtures[0], [null, []]);
  assert.equal(fixtures[1][0][0].args.at(-1), "not-the-same-argv");
  assert.equal(fixtures[2][0].length, 0);
  assert.equal(fixtures[2][1].length, 1);
  assert.equal(fixtures[3][0].length, 2);
  assert.deepEqual(fixtures[3][0][1].args, holdRequest.args);
  assert.equal(fixtures[3][1].length, 0);
  assert.equal(result.writes.length, 4);
  assert.ok(
    result.writes
      .find(
        (args) => args[1] === "process-connection" && args[2] === "service.js",
      )[3]
      .includes(JSON.stringify(request)),
  );
});

test("process-only phase uses native assignment without starting unrelated plugin work", async () => {
  const commands = [];
  const fixture = {
    processConnectionOnly: true,
    connectionId: "native-connection",
    processSmoke:
      'await invoke("smoke_progress", {stage:"offline-qualified"});',
  };
  const invoke = async (command, args) => {
    commands.push(command);
    switch (command) {
      case "smoke_phase":
        return { pluginDrafts: true, pluginChecksMode: "block" };
      case "plugin_recovery_mode":
        return false;
      case "workspace_snapshot":
        return { current: { id: "owned" } };
      case "smoke_plugin_check_prepare":
        return fixture;
      case "smoke_plugin_assignment":
        return {
          ready: true,
          conversation: {
            id: "native-assignment",
            version: 2,
            development: { version: 2 },
          },
        };
      case "ai_create_conversation":
        return;
      case "smoke_progress":
        assert.equal(args.stage, "offline-qualified");
        return;
      case "finish_smoke_test":
        assert.equal(args.error, null);
        return;
      default:
        assert.fail(`Process phase reached an unrelated command: ${command}`);
    }
  };
  const window = {
    nativeSmokeWait: {
      invoke,
      wait: async (predicate) => assert.ok(predicate()),
    },
    nativePluginChecks() {},
  };
  vm.runInNewContext(await read("plugin-checks-smoke.js"), {
    window,
    crypto: { randomUUID: () => "id" },
  });
  await window.runPluginChecksSmoke();
  assert.equal(commands.at(-1), "finish_smoke_test");
  assert.equal(
    commands.filter((command) => command === "smoke_plugin_assignment").length,
    1,
  );
  commands.length = 0;
  fixture.processSmoke = "onClosing();";
  await window.runPluginChecksSmoke();
  assert.equal(commands.includes("finish_smoke_test"), false);
});

test("qualification fails if synthetic checks execute or actual output/history is wrong", async () => {
  await assert.rejects(
    journey("fake-spawn"),
    /synthetic checks executed a process/,
  );
  await assert.rejects(journey("stdout"), /Actual process output differs/);
  await assert.rejects(journey("history"), /history reconciliation differs/);
  await assert.rejects(journey("cancel"), /Cancel close stopped the process/);
  await assert.rejects(journey("quit"), /Quit passed process preflight/);
  await assert.rejects(
    journey("confirmation"),
    /Command execution requested confirmation/,
  );
});
