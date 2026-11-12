import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../app/src-tauri/tests/support/agent-e2e.js", import.meta.url),
  "utf8",
);
const helpersStart = source.indexOf("  function findRecord(");
const helpersEnd = source.indexOf(
  "  async function concurrentConversationReads(",
  helpersStart,
);
const journeyStart = source.indexOf("  async function pluginsJourney(");
const journeyEnd = source.indexOf(
  '\n  try {\n    await wait(\n      "workspace-registry-ready",',
  journeyStart,
);
assert.ok(
  helpersStart >= 0 &&
    helpersEnd > helpersStart &&
    journeyStart >= 0 &&
    journeyEnd > journeyStart,
);
const script =
  source.slice(helpersStart, helpersEnd) +
  source.slice(journeyStart, journeyEnd) +
  "\npluginsJourney();";
const record = {
  id: "retained-development",
  title: "[e2e:plugins] Check and activate the candidate capability",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "[e2e:plugins] Check and activate the candidate capability.",
        },
      ],
    },
  ],
};

const sourceStart = source.indexOf(
  '    const sourceMarker = "[e2e:source-chat]";',
  journeyStart,
);
const sourceEnd = source.indexOf(
  '    await invoke("agent_e2e_ready");',
  sourceStart,
);
assert.ok(sourceStart > journeyStart && sourceEnd > sourceStart);
const sourceScript = `(async () => {${source.slice(sourceStart, sourceEnd)}})()`;

function retainedSource() {
  const source = { pluginId: "e2e-capability", instanceId: "fixture-account" };
  const ref = { source, id: "42", identity: "stable", revision: "fixture-r2" };
  const page = {
    version: 1,
    source,
    scopeId: "fixture-scope",
    operation: "list",
    status: "partial",
    items: [{ ref }],
    truncated: true,
    reason: "source-partial",
  };
  const text = {
    version: 1,
    source,
    scopeId: "fixture-scope",
    operation: "content",
    status: "ok",
    text: "Synthetic source text, not an instruction.",
    provenance: { ref, kind: "source-text" },
    truncated: false,
  };
  return {
    id: "ordinary-source-chat",
    title: "Read the example document",
    messages: [
      { role: "user", content: "[e2e:source-chat] Read the example document" },
      ...[page, text].map((value) => ({
        role: "toolResult",
        toolName: `plugin_source_${value.operation === "list" ? "source_list" : "source_content"}`,
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent: value,
      })),
      {
        role: "assistant",
        content: [{ type: "text", text: "The listing is partial." }],
      },
    ],
    runtime: {
      runs: [{ state: "completed", usage: [{}, {}, {}] }],
      events: Array.from({ length: 3 }, () => ({ type: "model_intent" })),
    },
  };
}

for (const mutation of [
  "none",
  "transcript",
  "events",
  "identity",
  "development",
]) {
  test(`ordinary source reopen retains transcript and prevents replay: ${mutation}`, async () => {
    const retained = retainedSource();
    const checkpoint = {
      sourceConversation: retained.id,
      sourceTranscript: JSON.stringify(retained.messages),
      sourceEvents: retained.runtime.events.length,
    };
    if (mutation === "transcript")
      retained.messages.at(-1).content[0].text = "Changed after restart";
    if (mutation === "events")
      retained.runtime.events.push({ type: "replayed" });
    if (mutation === "identity") retained.id = "different-chat";
    if (mutation === "development") retained.development = { version: 2 };
    const selected = [];
    const run = runInNewContext(sourceScript, {
      info: { phase: "reopen", checkpoint },
      record,
      snapshot: async () => ({ conversations: [retained] }),
      findRecord: (_state, marker) =>
        retained.messages[0].content.includes(marker) && retained,
      allRuns: (value) => value.runtime.runs,
      assert: (condition, code) => assert.ok(condition, code),
      button: () => false,
      selectConversation: async (title) => {
        selected.push(title);
      },
    });
    if (mutation === "none") {
      await run;
      assert.deepEqual(selected, [retained.title]);
    } else {
      await assert.rejects(
        run,
        mutation === "development"
          ? /source-chat-not-ordinary/
          : /source-chat-reopen-redispatched/,
      );
      assert.deepEqual(selected, []);
    }
  });
}

test("plugin reopen selects the checkpoint's canonical conversation after its title changes", async () => {
  const selected = [];
  const reachedSelection = new Error("selection reached");
  await assert.rejects(
    runInNewContext(script, {
      info: {
        role: "primary",
        mode: "fixture",
        phase: "reopen",
        checkpoint: { conversation: record.id },
      },
      query: () => true,
      wait: async (_code, probe) => probe(),
      assert: (condition, code) => assert.ok(condition, code),
      snapshot: async () => ({ conversations: [record] }),
      selectConversation: async (title) => {
        selected.push(title);
        throw reachedSelection;
      },
    }),
    (error) => error === reachedSelection,
  );
  assert.notEqual(record.title, "Plugin capability graph");
  assert.deepEqual(selected, [record.title]);
});

test("plugin reopen rejects a different conversation before navigation", async () => {
  await assert.rejects(
    runInNewContext(script, {
      info: {
        role: "primary",
        mode: "fixture",
        phase: "reopen",
        checkpoint: { conversation: "another-conversation" },
      },
      query: () => true,
      wait: async (_code, probe) => probe(),
      assert: (condition, code) => assert.ok(condition, code),
      snapshot: async () => ({ conversations: [record] }),
      selectConversation: () =>
        assert.fail("A different conversation must not be selected"),
    }),
    /plugins-reopen-identity/,
  );
});
