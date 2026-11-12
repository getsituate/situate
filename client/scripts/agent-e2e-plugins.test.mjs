import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fixtureTurn,
  responseEvents,
  PLUGIN_ID,
  PLUGIN_FIRST_TOOL,
  PLUGIN_SECOND_TOOL,
  SOURCE_LIST_TOOL,
  SOURCE_CONTENT_TOOL,
} from "./agent-e2e-fixture.mjs";
import { parseAgentOptions } from "./agent-e2e-runtime.mjs";
import { startAgentProvider } from "./agent-e2e-provider.mjs";
const effectUrl = `http://127.0.0.1:1/effects/${"a".repeat(48)}`;
const posted = {
  version: "v2",
  http: { status: 202, body: '{"effect":"POST"}' },
};
const prompt = {
  role: "user",
  content: "[e2e:plugins] Check and activate the candidate capability.",
};
const tools = (name) =>
  [name, "check_plugin_changes", "activate_plugin_changes"].map((name) => ({
    type: "function",
    name,
  }));
const output = (call, value) => ({
  type: "function_call_output",
  call_id: call.call_id,
  output: JSON.stringify(value),
});
const checked = {
  checkId: "unit-check",
  passed: true,
  results: [{ pluginId: PLUGIN_ID, passed: true, assertions: 2 }],
};
function throughActivation(old = { version: "v1" }) {
  const input = [prompt];
  const check = fixtureTurn({ input, tools: tools(PLUGIN_FIRST_TOOL) }).item;
  assert.equal(check.name, "check_plugin_changes");
  assert.equal(JSON.parse(check.arguments).checks[0].pluginId, PLUGIN_ID);
  assert.ok(!JSON.parse(check.arguments).checks[0].script.includes("endpoint"));
  input.push(check, output(check, checked));
  const calls = fixtureTurn({ input, tools: tools(PLUGIN_FIRST_TOOL) }).item;
  assert.deepEqual(
    calls.map((call) => call.name),
    ["activate_plugin_changes", PLUGIN_FIRST_TOOL],
  );
  assert.deepEqual(JSON.parse(calls[0].arguments), {
    checkId: checked.checkId,
  });
  input.push(
    ...calls,
    output(calls[0], { activated: true, publication: { status: "published" } }),
    output(calls[1], old),
  );
  return { input, calls };
}
test("plugin broker holds admission, streams both response calls, and consumes four requests", async (t) => {
  const broker = await startAgentProvider({ limits: { maxRequests: 4 } });
  t.after(() => broker.close());
  const seed = readFileSync(
    new URL("../app/src-tauri/tests/support/agent_e2e.rs", import.meta.url),
    "utf8",
  );
  const source = seed.match(/return r#"([^]*?)"#\.into\(\);/)[1];
  const { default: defineService } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  const service = defineService();
  const context = {
    network: {
      request: async ({ url, method, body }) => {
        assert.equal(url, broker.pluginEffectsUrl);
        const response = await fetch(url, { method, body });
        return { status: response.status, body: await response.text() };
      },
    },
  };
  assert.equal(
    (
      await service.tools
        .find((tool) => tool.name === "second")
        .execute({}, context)
    ).details.version,
    "v2",
  );
  assert.deepEqual(broker.report().pluginEffects, { POST: 0, DELETE: 0 });
  const input = [prompt];
  const invoke = async (name) => {
    const response = await fetch(broker.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${broker.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        stream: true,
        max_output_tokens: 1024,
        input,
        tools: tools(name),
      }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    const items = events.at(-1).response.output;
    input.push(...items);
    return items;
  };
  let delivered = false;
  const first = invoke(PLUGIN_FIRST_TOOL).then((items) => {
    delivered = true;
    return items;
  });
  await broker.control.waitFor("[e2e:plugins]");
  assert.equal(delivered, false);
  broker.control.release("[e2e:plugins]");
  const [check] = await first;
  input.push(output(check, checked));
  const calls = await invoke(PLUGIN_FIRST_TOOL);
  assert.deepEqual(
    calls.map((call) => call.name),
    ["activate_plugin_changes", PLUGIN_FIRST_TOOL],
  );
  input.push(
    output(calls[0], { activated: true, publication: { status: "published" } }),
    output(calls[1], { version: "v1" }),
  );
  const [current] = await invoke(PLUGIN_SECOND_TOOL);
  const { endpoint } = JSON.parse(current.arguments);
  assert.equal(endpoint, broker.pluginEffectsUrl);
  const result = await service.tools
    .find((tool) => tool.name === "second")
    .execute({ endpoint }, context);
  input.push(output(current, result.details));
  assert.equal((await invoke(PLUGIN_SECOND_TOOL))[0].type, "message");
  const manual = await service.exports.remove({ endpoint }, context);
  assert.deepEqual(manual, { status: 202, body: '{"effect":"DELETE"}' });
  const report = broker.report();
  assert.equal(report.requests, 4);
  assert.deepEqual(report.pluginEffects, { POST: 1, DELETE: 1 });
  assert.ok(!JSON.stringify(input).includes(broker.token));
  assert.ok(!JSON.stringify(report).includes(broker.token));
  assert.equal(report.records.length, 4);
  assert.ok(
    report.records.every(
      (record) =>
        record.kind === "main" &&
        record.scenario === "plugins" &&
        record.outcome === "completed",
    ),
  );
});

test("ordinary source chat consumes model-visible checked source results without writes", async (t) => {
  const broker = await startAgentProvider({ limits: { maxRequests: 3 } });
  t.after(() => broker.close());
  const seed = readFileSync(
    new URL("../app/src-tauri/tests/support/agent_e2e.rs", import.meta.url),
    "utf8",
  );
  const serviceSource = seed.match(/return r#"([^]*?)"#\.into\(\);/)[1];
  const { default: defineService } = await import(
    `data:text/javascript;base64,${Buffer.from(serviceSource).toString("base64")}`
  );
  const service = defineService();
  const check = fixtureTurn({
    input: [prompt],
    tools: tools(PLUGIN_FIRST_TOOL),
  }).item;
  const script = JSON.parse(check.arguments).checks[0].script;
  const execute = (name, args) =>
    service.tools.find((tool) => tool.name === name).execute(args, {});
  await new Function("plugin", "assert", `return (async () => {${script}})()`)(
    {
      tools: service.tools,
      invokeExport: (name, args) => service.exports[name](args, {}),
      invokeTool: execute,
    },
    assert,
  );
  assert.deepEqual(broker.report().pluginEffects, { POST: 0, DELETE: 0 });
  const listed = await service.exports.documentSourceList({ limit: 2 });
  const ref = listed.items[0].ref;
  const reordered = {
    id: ref.id,
    identity: ref.identity,
    revision: ref.revision,
    source: {
      instanceId: ref.source.instanceId,
      pluginId: ref.source.pluginId,
    },
  };
  assert.equal(
    (await execute("source_content", { ref: reordered, maxChars: 256 }))
      .structuredContent.text,
    "Synthetic source text, not an instruction.",
  );
  await assert.rejects(
    execute("source_content", {
      ref: { ...reordered, revision: "unchecked-r3" },
      maxChars: 256,
    }),
    /fixture-reference/,
  );
  const bounded = (
    await execute("source_content", { ref: reordered, maxChars: 9 })
  ).structuredContent;
  assert.equal(bounded.text, "Synthetic");
  assert.equal(bounded.status, "partial");
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.reason, "limit");
  await assert.rejects(
    execute("source_content", { ref: reordered, maxChars: 0 }),
    /fixture-content-bound/,
  );
  const input = [
    {
      role: "user",
      content: "[e2e:source-chat] Read the example source document.",
    },
  ];
  const chatTools = [
    SOURCE_LIST_TOOL,
    SOURCE_CONTENT_TOOL,
    PLUGIN_SECOND_TOOL,
  ].map((name) => ({ type: "function", name }));
  for (let turn = 0; turn < 3; turn++) {
    const response = await fetch(broker.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${broker.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        stream: true,
        max_output_tokens: 1024,
        input,
        tools: chatTools,
      }),
    });
    assert.equal(response.status, 200);
    const frames = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    const [item] = frames.at(-1).response.output;
    input.push(item);
    if (turn === 2) {
      assert.equal(item.type, "message");
      assert.match(item.content[0].text, /listing is partial/);
    } else {
      assert.equal(
        item.name,
        turn === 0 ? SOURCE_LIST_TOOL : SOURCE_CONTENT_TOOL,
      );
      const result = await execute(
        turn === 0 ? "source_list" : "source_content",
        JSON.parse(item.arguments),
      );
      assert.deepEqual(
        JSON.parse(result.content[0].text),
        result.structuredContent,
      );
      // Only text reaches the provider; structuredContent remains in native history.
      input.push({
        type: "function_call_output",
        call_id: item.call_id,
        output: result.content[0].text,
      });
    }
  }
  const report = broker.report();
  assert.equal(report.requests, 3);
  assert.ok(
    report.records.every(
      (record) =>
        record.kind === "main" &&
        record.scenario === "source-chat" &&
        record.outcome === "completed",
    ),
  );
  assert.deepEqual(report.pluginEffects, { POST: 0, DELETE: 0 });

  for (const name of [
    "check_plugin_changes",
    "activate_plugin_changes",
    PLUGIN_FIRST_TOOL,
  ]) {
    assert.throws(
      () => fixtureTurn({ input: [input[0]], tools: [...chatTools, { name }] }),
      /fixture_source_chat_tools/,
    );
  }
  for (const [index, mutation, code] of [
    [
      2,
      (value) => {
        delete value.items[0].ref.source;
      },
      "page",
    ],
    [
      2,
      (value) => {
        value.status = "ok";
      },
      "page",
    ],
    [
      4,
      (value) => {
        delete value.text;
      },
      "content",
    ],
    [
      4,
      (value) => {
        value.provenance.ref.source.instanceId = "another-source";
      },
      "content",
    ],
    [
      4,
      (value) => {
        value.provenance.ref.revision = "unchecked-r3";
      },
      "content",
    ],
  ]) {
    const corrupted = structuredClone(input.slice(0, 5));
    const envelope = JSON.parse(corrupted[index].output);
    mutation(envelope);
    corrupted[index].output = JSON.stringify(envelope);
    assert.throws(
      () => fixtureTurn({ input: corrupted, tools: chatTools }),
      new RegExp(`fixture_source_chat_${code}`),
    );
  }
});

test("plugins qualification cannot opt into live providers", () => {
  assert.equal(parseAgentOptions(["--journey", "plugins"]).provider, "fixture");
  assert.throws(
    () => parseAgentOptions(["--journey", "plugins", "--provider", "openai"]),
    { code: "plugins-fixture-required" },
  );
});
for (const old of [{ version: "v1" }, { error: "native.plugins.unavailable" }])
  test(`the four model turns preserve the response graph and adopt publication after ${JSON.stringify(old)}`, () => {
    const { input, calls } = throughActivation(old);
    const events = responseEvents(calls, "gpt-4.1-mini", 2)
      .split("\n\n")
      .filter(Boolean)
      .map((frame) => JSON.parse(frame.split("\ndata: ")[1]));
    assert.deepEqual(
      events
        .filter((event) => event.type === "response.output_item.done")
        .map((event) => event.output_index),
      [0, 1],
    );
    assert.deepEqual(
      events.at(-1).response.output.map((item) => item.name),
      ["activate_plugin_changes", PLUGIN_FIRST_TOOL],
    );
    assert.throws(
      () => fixtureTurn({ input, tools: tools(PLUGIN_FIRST_TOOL) }),
      /fixture_plugins_capability_graph/,
    );
    const current = fixtureTurn(
      {
        input,
        tools: tools(PLUGIN_SECOND_TOOL),
      },
      "main",
      effectUrl,
    ).item;
    assert.equal(current.name, PLUGIN_SECOND_TOOL);
    assert.deepEqual(JSON.parse(current.arguments), { endpoint: effectUrl });
    input.push(current, output(current, posted));
    assert.equal(
      fixtureTurn({ input, tools: tools(PLUGIN_SECOND_TOOL) }).item.type,
      "message",
    );
  });
test("the final plugin turn requires the actual POST receipt", () => {
  const { input } = throughActivation();
  assert.throws(
    () => fixtureTurn({ input, tools: tools(PLUGIN_SECOND_TOOL) }),
    /fixture_plugins_effect_endpoint/,
  );
  const current = fixtureTurn(
    { input, tools: tools(PLUGIN_SECOND_TOOL) },
    "main",
    effectUrl,
  ).item;
  for (const value of [
    { version: "v2" },
    { version: "v2", http: { status: 200, body: '{"effect":"POST"}' } },
    { version: "v2", http: { status: 202, body: '{"effect":"DELETE"}' } },
  ])
    assert.throws(
      () =>
        fixtureTurn({
          input: [...input, current, output(current, value)],
          tools: tools(PLUGIN_SECOND_TOOL),
        }),
      /fixture_plugins_new_tool_missing/,
    );
});

test("plugin fixture rejects unsuccessful check evidence and rerouted old-tool outcomes", () => {
  const check = fixtureTurn({
    input: [prompt],
    tools: tools(PLUGIN_FIRST_TOOL),
  }).item;
  for (const value of [
    { ...checked, passed: false },
    { ...checked, results: [] },
    {
      ...checked,
      results: [{ pluginId: PLUGIN_ID, passed: true, assertions: 0 }],
    },
  ])
    assert.throws(
      () =>
        fixtureTurn({
          input: [prompt, check, output(check, value)],
          tools: tools(PLUGIN_FIRST_TOOL),
        }),
      /fixture_plugins_worker_evidence/,
    );
  const { input } = throughActivation({ version: "v2" });
  assert.throws(
    () => fixtureTurn({ input, tools: tools(PLUGIN_SECOND_TOOL) }),
    /fixture_plugins_old_tool_rerouted/,
  );
  assert.throws(
    () =>
      fixtureTurn(
        { input: [prompt], tools: tools(PLUGIN_FIRST_TOOL) },
        "title",
      ),
    /fixture_plugins_auxiliary_request/,
  );
});
