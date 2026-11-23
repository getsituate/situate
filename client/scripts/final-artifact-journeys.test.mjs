import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import test from "node:test";
import { fixtureTurn } from "./agent-e2e-fixture.mjs";
import {
  completionTurn,
  defaultFinalArtifactConfiguration,
  finalArtifactJourneys,
  startFinalArtifactProvider,
} from "./final-artifact-journeys.mjs";

const body = (messages, tools = []) => ({
  model: "gpt-4.1-mini",
  messages,
  tools,
});

test("default profile seals supplied operational facts without requiring AX JSON", () => {
  const facts = {
    account: { mode: "ephemeral-host" },
    routing: { endpoint: "https://example.invalid" },
    predecessor: { directory: "/synthetic" },
    runnerImage: "synthetic-image",
  };
  assert.deepEqual(defaultFinalArtifactConfiguration(facts), {
    profile: "macos-direct-v1",
    ...facts,
  });
});

test("Chat Completions fixture carries real tool-call results into the existing deterministic engine", () => {
  const messages = [{ role: "user", content: "[e2e:create]" }];
  const names = [];
  for (let step = 0; step < 5; step++) {
    const result = completionTurn(body(messages));
    messages.push(result);
    if (result.tool_calls) {
      const tool = result.tool_calls[0];
      names.push(tool.function.name);
      messages.push({
        role: "tool",
        tool_call_id: tool.id,
        content: JSON.stringify({
          revision: "synthetic-revision",
          text: "# Synthetic seed\n",
        }),
      });
    } else assert.equal(result.content, "Created the note.");
  }
  assert.deepEqual(names, ["ls", "read", "write", "read"]);
  assert.throws(
    () => completionTurn({ ...body([]), model: "unapproved" }),
    /model/,
  );
});

test("named production plugin fixture creates source, checks it, and requires successful activation", async () => {
  const input = [{ role: "user", content: "[e2e:final-artifact-plugin]" }];
  const names = [];
  let service;
  for (let step = 0; step < 6; step++) {
    const { item } = fixtureTurn({ input });
    if (step === 5) {
      assert.equal(item.content[0].text, "Final artifact plugin activated.");
      break;
    }
    names.push(item.name);
    const args = JSON.parse(item.arguments);
    if (step === 0)
      assert.deepEqual(args, {
        operation: "create",
        pluginId: "final-artifact",
      });
    if (step === 2) service = args.text;
    if (step === 3)
      assert.match(args.checks[0].script, /invokeTool\("preserved"/);
    if (step === 4) assert.deepEqual(args, { checkId: "checked-source" });
    const output =
      step === 3
        ? {
            passed: true,
            checkId: "checked-source",
            results: [
              { pluginId: "final-artifact", passed: true, assertions: 2 },
            ],
          }
        : step === 4
          ? { activated: true, publication: { status: "published" } }
          : { revision: "synthetic" };
    input.push(item, {
      type: "function_call_output",
      call_id: item.call_id,
      output: JSON.stringify(output),
    });
  }
  assert.deepEqual(names, [
    "inspect_plugin",
    "write",
    "write",
    "check_plugin_changes",
    "activate_plugin_changes",
  ]);
  const module = await import(
    `data:text/javascript,${encodeURIComponent(service)}`
  );
  const plugin = module.default();
  assert.equal(plugin.tools[0].name, "preserved");
  const result = await plugin.tools[0].execute();
  assert.equal(result.content[0].text, '{"version":"v1"}');
  assert.equal(result.details, undefined);
  const name = `plugin_${createHash("sha256").update("final-artifact").digest("hex").slice(0, 16)}_preserved`;
  const messages = [
    { role: "user", content: "[e2e:final-artifact-plugin-read]" },
  ];
  const tools = [{ type: "function", function: { name } }];
  const call = completionTurn(body(messages, tools));
  messages.push(call, {
    role: "tool",
    tool_call_id: call.tool_calls[0].id,
    content: result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  });
  assert.equal(
    completionTurn(body(messages, tools)).content,
    "Final artifact plugin v1 verified.",
  );
  input.at(-1).output = JSON.stringify({
    activated: false,
    publication: { status: "outcomeUnknown" },
  });
  assert.throws(() => fixtureTurn({ input }), /activation_failed/);
  input.splice(-2, 2);
  input.at(-1).output = JSON.stringify({ passed: false, checkId: "failed" });
  assert.throws(() => fixtureTurn({ input }), /check_failed/);
});

test("a retained plugin read requires the actual enabled production capability", () => {
  const input = [{ role: "user", content: "[e2e:final-artifact-plugin-read]" }];
  assert.throws(() => fixtureTurn({ input, tools: [] }), /tool_missing/);
  const name = `plugin_${createHash("sha256").update("final-artifact").digest("hex").slice(0, 16)}_preserved`;
  const { item } = fixtureTurn({ input, tools: [{ name }] });
  assert.equal(item.name, name);
  input.push(item, {
    type: "function_call_output",
    call_id: item.call_id,
    output: JSON.stringify({ version: "v1" }),
  });
  assert.equal(
    fixtureTurn({ input }).item.content[0].text,
    "Final artifact plugin v1 verified.",
  );
  input.at(-1).output = JSON.stringify({ version: "v2" });
  assert.throws(() => fixtureTurn({ input }), /tool_changed/);
});

test("default journeys retain saved state across restart and keep chat drafts in the live session", async () => {
  const actions = [];
  const files = [];
  const profile = finalArtifactJourneys({
    phase: "predecessor",
    actions: async (steps) => {
      actions.push(...steps);
    },
    seed: async (...args) => {
      files.push(args);
    },
    verifyFiles: async (...args) => {
      files.push(args);
    },
  });
  await profile.exercise();
  const model = {
    role: "AXComboBox",
    name: "Model",
    window: "Qualification predecessor — Situate",
  };
  const modelSelection = actions.findIndex(
    (step) => step.focus?.name === "Model",
  );
  assert.ok(modelSelection > 0);
  assert.deepEqual(actions.slice(modelSelection - 1, modelSelection + 5), [
    { assert: model },
    { focus: model },
    { key: { key: "down", modifiers: [] } },
    { assert: { ...model, role: "AXStaticText", name: "gpt-4.1-mini" } },
    { key: { key: "return", modifiers: [] } },
    { assert: { role: "AXButton", name: "Check and continue" } },
  ]);
  const newChat = actions.findIndex((step) => step.click?.name === "New chat");
  assert.ok(newChat >= 2);
  assert.deepEqual(actions.slice(newChat - 2, newChat), [
    { navigation: actions[newChat].click },
    { assert: actions[newChat].click },
  ]);
  const beforeRestart = actions.length;
  await profile.reopen();
  const restarted = actions.slice(beforeRestart);
  assert.deepEqual(
    restarted
      .filter((step) => step.assert?.name === "Message")
      .map((step) => step.assert.value),
    [""],
  );
  assert.ok(
    restarted.some(
      (step) => step.assert?.name === "Final artifact plugin v1 verified.",
    ),
  );
  await profile.close();
  for (const name of ["Open workspace…", "Close workspace"]) {
    assert.ok(
      actions.some(
        (action) =>
          action.click?.name === name && action.click.role === "AXMenuItem",
      ),
    );
  }
  assert.ok(
    actions.some((action) => action.click?.name === "OpenAI-compatible server"),
  );
  const fileActions = actions.findIndex(
    (action) => action.click?.name === "File actions",
  );
  const editSource = actions.findIndex(
    (action) =>
      action.click?.name === "Edit source" &&
      action.click.role === "AXMenuItem",
  );
  assert.ok(fileActions >= 0 && editSource > fileActions);
  assert.ok(
    !actions.some(
      (action) =>
        action.click?.name === "Edit source" &&
        action.click.role === "AXButton",
    ),
  );
  assert.ok(
    actions.some(
      (action) =>
        action.assert?.name === "Message" &&
        action.assert.value === "Unsent qualification draft",
    ),
  );
  assert.ok(actions.some((action) => action.assert?.name === "Disable"));
  assert.ok(actions.some((action) => action.windows === 2));
  assert.ok(
    files.some(
      ([, entries]) =>
        Array.isArray(entries) &&
        entries.some(([path]) => path === ".situate/working-method.md"),
    ),
  );
});

test("fresh installation identifies the failed plugin navigation step", async () => {
  const progress = [];
  const failure = new Error("Native UI target missing");
  const journey = finalArtifactJourneys({
    actions: async (items) => {
      if (items.some((item) => item.navigation?.name === "Plugins"))
        throw failure;
    },
    seed: async () => {},
    phase: "candidate",
    progress: (event) => progress.push(event),
  });
  await assert.rejects(journey.exercise(), (error) => error === failure);
  assert.deepEqual(progress.slice(-2), [
    "open_plugins:started",
    "open_plugins:failed",
  ]);
});

test("custom fixture server is loopback-only, authenticated, bounded and has no live fallback", async () => {
  let handle;
  let closes = 0;
  const serverFactory = (handler) => {
    handle = handler;
    return {
      once() {},
      listen(port, host, ready) {
        assert.equal(port, 0);
        assert.equal(host, "127.0.0.1");
        ready();
      },
      address: () => ({ port: 12345 }),
      closeAllConnections() {},
      close(done) {
        closes++;
        done();
      },
    };
  };
  const provider = await startFinalArtifactProvider({ serverFactory });
  async function request({
    auth = provider.token,
    payload = body([{ role: "user", content: "Hello" }]),
    url = "/v1/chat/completions",
  } = {}) {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
    Object.assign(req, {
      method: "POST",
      url,
      headers: { authorization: `Bearer ${auth}` },
    });
    const response = {
      status: 200,
      setHeader() {},
      writeHead(status) {
        this.status = status;
        return this;
      },
      end(text) {
        this.text = text;
      },
    };
    await handle(req, response);
    return response;
  }
  const streamed = await request({
    payload: { ...body([{ role: "user", content: "Hello" }]), stream: true },
  });
  assert.match(streamed.text, /chat.completion.chunk/);
  assert.match(streamed.text, /data: \[DONE\]/);
  assert.equal((await request({ auth: "wrong" })).status, 400);
  assert.equal((await request({ url: "/unexpected" })).status, 400);
  for (let i = 1; i < 64; i++) assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 400);
  assert.equal(provider.report().requests, 64);
  assert.equal(provider.report().budgetDenials, 1);
  assert.equal(provider.report().failed, true);
  await provider.close();
  await provider.close();
  assert.equal(closes, 1);
  const predecessorProvider = await startFinalArtifactProvider({
    serverFactory,
  });
  assert.notEqual(predecessorProvider.token, provider.token);
  assert.equal(predecessorProvider.report().requests, 0);
  assert.equal(predecessorProvider.report().failed, false);
  for (let i = 0; i < 64; i++)
    assert.equal(
      (await request({ auth: predecessorProvider.token })).status,
      200,
    );
  assert.equal(
    (await request({ auth: predecessorProvider.token })).status,
    400,
  );
  assert.equal(predecessorProvider.report().requests, 64);
  assert.equal(predecessorProvider.report().budgetDenials, 1);
  assert.equal(provider.report().requests, 64);
  await predecessorProvider.close();
  assert.equal(closes, 2);
});
