import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { Worker } from "node:worker_threads";
import { once } from "node:events";

const directory = new URL("../app/src-tauri/tests/support/", import.meta.url);
const smoke = await readFile(
  new URL("plugin-runtime-smoke.js", directory),
  "utf8",
);
const rust = await readFile(
  new URL("plugin_runtime_smoke.rs", directory),
  "utf8",
);
const serviceSource = rust.match(
  /pub\(crate\) fn service_source\(\) -> &'static str \{\s*r#"([\s\S]*?)"#/,
)[1];
const lifecycle = smoke.slice(
  smoke.indexOf("  async function disableHeldRoot(stop)"),
  smoke.indexOf("  await disableHeldRoot(false);"),
);

async function journey(useActivity = false) {
  let admitted = false,
    marker = "previous-invocation",
    polls = 0,
    enabled = true,
    revision = "original",
    finishWork,
    finishDisable;
  const phases = [];
  const runtime = {
    state: {},
    setEnabled(_id, value) {
      assert.equal(value, false);
      assert.equal(admitted, true, "disable raced export admission");
      phases.push("waiting");
      this.state.disabling = { id: "disable", phase: "waiting" };
      return new Promise((resolve) => {
        finishDisable = resolve;
      });
    },
    async cancelDisable() {
      phases.push("cancelled");
      this.state.disabling.phase = "cancelled";
      finishDisable();
    },
    async stopDisabling() {
      phases.push("disabled");
      enabled = false;
      revision = "disabled";
      admitted = false;
      this.state.disabling.phase = "disabled";
      finishWork({ completed: false, error: "plugins.executionCancelled" });
      finishDisable();
    },
  };
  let invocation;
  const service = {
    descriptor: { tools: [{}] },
    invoke(name, args) {
      if (name === "release") {
        assert.equal(admitted, true);
        admitted = false;
        finishWork({ completed: true });
        return Promise.resolve(true);
      }
      invocation = args.invocation;
      assert.ok(invocation);
      return new Promise((resolve, reject) => {
        finishWork = (result) =>
          result.completed ? resolve() : reject(result.error);
      });
    },
  };
  const invoke = async (command, args) => {
    if (command === "smoke_plugin_runtime_source") {
      assert.equal(args.operation, "invocationEntered");
      // A retained marker and unrelated registered work must not admit this root.
      if (++polls % 2 === 0) {
        admitted = true;
        marker = invocation;
      }
      return marker;
    }
    if (command === "plugin_disable")
      return {
        phase: "waiting",
        runningActions: [{ pluginId: "native-counter", count: 1 }],
      };
    assert.equal(command, "plugin_executor");
    if (args.request.operation === "activity")
      return { runningActions: enabled ? 1 : 0 };
    assert.equal(args.request.operation, "stop");
    admitted = false;
    finishWork?.({ completed: false, error: "plugins.executionCancelled" });
  };
  const wait = async (condition, message) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await condition()) return;
    }
    throw new Error(message);
  };
  const program = useActivity
    ? lifecycle.replace(
        /await invoke\("smoke_plugin_runtime_source", \{\s*scope: current.id,\s*operation: "invocationEntered",\s*\}\)\s*\) === invocation/,
        'await invoke("plugin_executor", { scope: current.id, request: { operation: "activity" } }) ).runningActions > 0',
      )
    : lifecycle;
  await vm.runInNewContext(
    `(async () => { ${program}\nawait disableHeldRoot(false); await disableHeldRoot(true); })()`,
    {
      window: { nativePluginService: async () => service },
      current: { id: "owned" },
      listing: { revision: "original" },
      request: async () => ({
        revision,
        plugins: [{ id: "native-counter", enabled }],
      }),
      runtime,
      invoke,
      wait,
      crypto: { randomUUID: () => `invocation-${polls}` },
    },
  );
  return { phases, polls, enabled };
}

test("native lifecycle waits for each entered export despite stale markers and unrelated activity", async () => {
  assert.deepEqual(await journey(), {
    phases: ["waiting", "cancelled", "waiting", "disabled"],
    polls: 4,
    enabled: false,
  });
});

test("workspace activity reproduces the pre-admission disable race", async () => {
  await assert.rejects(journey(true), /disable raced export admission/);
});

test("held fixture writes its invocation marker and remains running until release", async () => {
  const factory = vm.runInNewContext(
    `(${serviceSource.replace("export default", "").trim().replace(/;$/, "")})`,
  );
  const service = factory();
  let entered;
  const marker = new Promise((resolve) => {
    entered = resolve;
  });
  let settled = false;
  const work = service.exports
    .hold(
      { invocation: "held-root" },
      {
        config: {
          read: async (path) => {
            assert.equal(path, "invocation.json");
            return { revision: "before" };
          },
          write: async (path, text, expected) => {
            assert.equal(path, "invocation.json");
            assert.equal(expected, "before");
            entered(text);
            return { Saved: {} };
          },
        },
      },
    )
    .then(() => {
      settled = true;
    });
  assert.equal(await marker, "held-root");
  assert.equal(settled, false);
  await service.exports.release();
  await work;
  assert.equal(settled, true);
});

test(
  "hung fixture acknowledges its own invocation before blocking the worker",
  { timeout: 5000 },
  async (t) => {
    const worker = new Worker(
      `
    const { parentPort } = require('node:worker_threads');
    const service = (${serviceSource.replace("export default", "").trim().replace(/;$/, "")})();
    service.exports.hang({ invocation: 'hung-root' }, {
      config: {
        read: async () => ({ revision: 'before' }),
        write: async (_path, text) => { parentPort.postMessage(text); return { Saved: {} }; }
      }
    }).then(() => parentPort.postMessage('unexpected-completion'));
  `,
      { eval: true },
    );
    try {
      assert.deepEqual(await once(worker, "message", { signal: t.signal }), [
        "hung-root",
      ]);
    } finally {
      assert.equal(await worker.terminate(), 1);
    }
  },
);
