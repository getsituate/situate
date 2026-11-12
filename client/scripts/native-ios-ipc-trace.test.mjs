import assert from "node:assert/strict";
import test from "node:test";
import {
  createIpcTrace,
  sanitizeIpcTrace,
} from "../app/src-tauri/tests/support/native-ios-ipc-trace.mjs";

function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("the close trace preserves original promises, arguments, options, and failures", async () => {
  const commands = [
    "plugin_executor",
    "plugin_process_abort",
    "ai_conversations_abort",
  ];
  const gates = commands.map(gate);
  const calls = [];
  const trace = createIpcTrace((...args) => {
    calls.push(args);
    return gates[commands.indexOf(args[0])].promise;
  });
  trace.start();
  const parameters = {
    scope: "PRIVATE",
    request: { operation: "stop", privateValue: "SECRET" },
  };
  const options = { headers: { privateValue: "SECRET" } };
  const promises = commands.map((command, index) => {
    const promise = trace.invoke(command, parameters, options);
    assert.equal(promise, gates[index].promise);
    assert.equal(calls[index][1], parameters);
    assert.equal(calls[index][2], options);
    return promise;
  });
  gates[0].resolve({ runningActions: 0 });
  gates[1].resolve();
  await Promise.all(promises.slice(0, 2));
  assert.deepEqual(
    trace.snapshot().map((row) => row.status),
    ["completed", "completed", "pending"],
  );
  gates[2].reject("native.ai.turn.inactive");
  await assert.rejects(
    promises[2],
    (error) => error === "native.ai.turn.inactive",
  );
  assert.deepEqual(trace.snapshot(), [
    {
      command: "plugin_executor",
      operation: "stop",
      status: "completed",
      code: null,
    },
    {
      command: "plugin_process_abort",
      operation: "abort",
      status: "completed",
      code: null,
    },
    {
      command: "ai_conversations_abort",
      operation: "abort",
      status: "rejected",
      code: "native.ai.turn.inactive",
    },
  ]);
  assert.ok(!JSON.stringify(trace.snapshot()).match(/PRIVATE|SECRET/));
});

test("the close trace records only selected operations during its observation interval", async () => {
  const trace = createIpcTrace(() => Promise.resolve("unchanged"));
  await trace.invoke("ai_conversations_abort", {});
  trace.start();
  await trace.invoke("plugin_executor", {
    request: { operation: "invoke_export" },
  });
  await trace.invoke("ai_conversation_action", {
    action: { type: "submit", input: "PRIVATE" },
  });
  await trace.invoke("workspace_action", { action: "open" });
  await trace.invoke("ai_conversation_action", {
    action: { type: "draft", input: "PRIVATE" },
  });
  trace.stop();
  await trace.invoke("workspace_action", { action: "close" });
  assert.deepEqual(trace.snapshot(), [
    {
      command: "ai_conversation_action",
      operation: "draft",
      status: "completed",
      code: null,
    },
  ]);
  trace.start();
  assert.deepEqual(trace.snapshot(), []);
});

test("the close trace bounds output and strips unknown codes and fields", () => {
  const row = {
    command: "workspace_action",
    operation: "close",
    status: "rejected",
    code: "PRIVATE",
    args: { token: "SECRET" },
  };
  const result = sanitizeIpcTrace([
    null,
    "PRIVATE",
    { status: "completed" },
    { ...row, command: "PRIVATE" },
    { ...row, status: "PRIVATE" },
    ...Array(40).fill(row),
  ]);
  assert.equal(result.length, 27);
  assert.deepEqual(result[0], {
    command: "workspace_action",
    operation: "close",
    status: "rejected",
    code: "unclassified",
  });
  assert.ok(!JSON.stringify(result).match(/PRIVATE|SECRET|args/));
  result[0].code = "PRIVATE";
  assert.equal(sanitizeIpcTrace([row])[0].code, "unclassified");
});

test("unreadable diagnostic parameters cannot prevent the original invocation", async () => {
  let called = false;
  const result = Promise.resolve();
  const parameters = Object.defineProperty({}, "request", {
    get() {
      throw new Error("PRIVATE");
    },
  });
  const trace = createIpcTrace((command, args) => {
    called = true;
    assert.equal(command, "plugin_executor");
    assert.equal(args, parameters);
    return result;
  });
  trace.start();
  assert.equal(trace.invoke("plugin_executor", parameters), result);
  await result;
  assert.equal(called, true);
  assert.deepEqual(trace.snapshot(), []);
  trace.recordFailure(
    "plugin_executor",
    "stop",
    "native.plugins.stateSaveFailed",
  );
  trace.recordFailure("PRIVATE", "stop", "PRIVATE");
  assert.deepEqual(trace.snapshot(), [
    {
      command: "plugin_executor",
      operation: "stop",
      status: "rejected",
      code: "native.plugins.stateSaveFailed",
    },
  ]);
});

test("synchronous transport errors remain unchanged and cannot leak into the trace", () => {
  const error = new Error("PRIVATE");
  const trace = createIpcTrace(() => {
    throw error;
  });
  trace.start();
  assert.throws(
    () => trace.invoke("ai_conversations_abort", {}),
    (value) => value === error,
  );
  assert.deepEqual(trace.snapshot(), [
    {
      command: "ai_conversations_abort",
      operation: "abort",
      status: "rejected",
      code: "unclassified",
    },
  ]);
});
