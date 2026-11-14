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

const body = (messages, tools = []) => ({ model: "gpt-4.1-mini", messages, tools });

test("default profile seals supplied operational facts without requiring AX JSON", () => {
  const facts = { account: { mode: "ephemeral-host" }, routing: { endpoint: "https://example.invalid" }, predecessor: { directory: "/synthetic" }, runnerImage: "synthetic-image" };
  assert.deepEqual(defaultFinalArtifactConfiguration(facts), { profile: "macos-direct-v1", ...facts });
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
      messages.push({ role: "tool", tool_call_id: tool.id, content: JSON.stringify({ revision: "synthetic-revision", text: "# Synthetic seed\n" }) });
    } else assert.equal(result.content, "Created the note.");
  }
  assert.deepEqual(names, ["ls", "read", "write", "read"]);
  assert.throws(() => completionTurn({ ...body([]), model: "unapproved" }), /model/);
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
    if (step === 0) assert.deepEqual(args, { operation: "create", pluginId: "final-artifact" });
    if (step === 2) service = args.text;
    if (step === 3) assert.match(args.checks[0].script, /invokeTool\("preserved"/);
    if (step === 4) assert.deepEqual(args, { checkId: "checked-source" });
    const output = step === 3 ? { passed: true, checkId: "checked-source", results: [{ pluginId: "final-artifact", passed: true, assertions: 2 }] } : step === 4 ? { activated: true, publication: { status: "published" } } : { revision: "synthetic" };
    input.push(item, { type: "function_call_output", call_id: item.call_id, output: JSON.stringify(output) });
  }
  assert.deepEqual(names, ["inspect_plugin", "write", "write", "check_plugin_changes", "activate_plugin_changes"]);
  const module = await import(`data:text/javascript,${encodeURIComponent(service)}`);
  const plugin = module.default();
  assert.equal(plugin.tools[0].name, "preserved");
  const result = await plugin.tools[0].execute();
  assert.equal(result.content[0].text, '{"version":"v1"}');
  assert.equal(result.details, undefined);
  const name = `plugin_${createHash("sha256").update("final-artifact").digest("hex").slice(0, 16)}_preserved`;
  const messages = [{ role: "user", content: "[e2e:final-artifact-plugin-read]" }];
  const tools = [{ type: "function", function: { name } }];
  const call = completionTurn(body(messages, tools));
  messages.push(call, { role: "tool", tool_call_id: call.tool_calls[0].id, content: result.content.filter(part => part.type === "text").map(part => part.text).join("\n") });
  assert.equal(completionTurn(body(messages, tools)).content, "Final artifact plugin v1 verified.");
  input.at(-1).output = JSON.stringify({ activated: false, publication: { status: "outcomeUnknown" } });
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
  input.push(item, { type: "function_call_output", call_id: item.call_id, output: JSON.stringify({ version: "v1" }) });
  assert.equal(fixtureTurn({ input }).item.content[0].text, "Final artifact plugin v1 verified.");
  input.at(-1).output = JSON.stringify({ version: "v2" });
  assert.throws(() => fixtureTurn({ input }), /tool_changed/);
});

test("default journeys use product labels, verify reopened draft/files/plugin state, and cancel unsaved update", async () => {
  const actions = [];
  const files = [];
  const permissions = [];
  const profile = finalArtifactJourneys({
    phase: "predecessor",
    actions: async (steps) => { actions.push(...steps); },
    seed: async (...args) => { files.push(args); },
    writable: async (...args) => { permissions.push(args); },
    verifyFiles: async (...args) => { files.push(args); },
  });
  await profile.exercise();
  await profile.update();
  await profile.close();
  for (const name of ["Open workspace…", "Close workspace"]) {
    assert.ok(actions.some(action => action.click?.name === name && action.click.role === "AXMenuItem"));
  }
  assert.ok(actions.some(action => action.click?.name === "OpenAI-compatible server"));
  const fileActions = actions.findIndex(action => action.click?.name === "File actions");
  const editSource = actions.findIndex(action => action.click?.name === "Edit source" && action.click.role === "AXMenuItem");
  assert.ok(fileActions >= 0 && editSource > fileActions);
  assert.ok(!actions.some(action => action.click?.name === "Edit source" && action.click.role === "AXButton"));
  const cancel = actions.findIndex(action => action.click?.name === "Cancel");
  const retainedDraft = actions.findIndex((action, index) => index > cancel && action.assert?.name === "Markdown source" && action.assert.value === "# E2E note\n\nUnsaved cancellation marker\n");
  const replacedDraft = actions.findIndex((action, index) => index > cancel && action.type === "# E2E note\n\nBeta marker\n");
  assert.ok(retainedDraft > cancel && replacedDraft > retainedDraft);
  const installs = actions.flatMap((action, index) => action.click?.name === "Install and restart" ? [index] : []);
  assert.equal(installs.length, 4);
  assert.ok(installs[1] < cancel && cancel < installs[2]);
  assert.deepEqual(permissions, [["Qualification predecessor", false], ["Qualification predecessor", true]]);
  assert.ok(actions.some(action => action.assert?.name === "Message" && action.assert.value === "Unsent qualification draft"));
  assert.ok(actions.some(action => action.assert?.name === "Disable"));
  assert.ok(actions.some(action => action.windows === 2));
  assert.ok(files.some(([, entries]) => Array.isArray(entries) && entries.some(([path]) => path === ".situate/working-method.md")));
});

test("custom fixture server is loopback-only, authenticated, bounded and has no live fallback", async () => {
  let handle;
  let closes = 0;
  const serverFactory = handler => {
    handle = handler;
    return {
      once() {},
      listen(port, host, ready) { assert.equal(port, 0); assert.equal(host, "127.0.0.1"); ready(); },
      address: () => ({ port: 12345 }),
      closeAllConnections() {},
      close(done) { closes++; done(); },
    };
  };
  const provider = await startFinalArtifactProvider({ serverFactory });
  async function request({ auth = provider.token, payload = body([{ role: "user", content: "Hello" }]), url = "/v1/chat/completions" } = {}) {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
    Object.assign(req, { method: "POST", url, headers: { authorization: `Bearer ${auth}` } });
    const response = { status: 200, setHeader() {}, writeHead(status) { this.status = status; return this; }, end(text) { this.text = text; } };
    await handle(req, response);
    return response;
  }
  const streamed = await request({ payload: { ...body([{ role: "user", content: "Hello" }]), stream: true } });
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
  const predecessorProvider = await startFinalArtifactProvider({ serverFactory });
  assert.notEqual(predecessorProvider.token, provider.token);
  assert.equal(predecessorProvider.report().requests, 0);
  assert.equal(predecessorProvider.report().failed, false);
  for (let i = 0; i < 64; i++) assert.equal((await request({ auth: predecessorProvider.token })).status, 200);
  assert.equal((await request({ auth: predecessorProvider.token })).status, 400);
  assert.equal(predecessorProvider.report().requests, 64);
  assert.equal(predecessorProvider.report().budgetDenials, 1);
  assert.equal(provider.report().requests, 64);
  await predecessorProvider.close();
  assert.equal(closes, 2);
});
