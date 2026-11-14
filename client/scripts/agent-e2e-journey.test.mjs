import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../app/src-tauri/tests/support/agent-e2e.js", import.meta.url),
  "utf8",
);
const catalogWarning =
  "The model list could not be refreshed. You can still choose a compatible model manually. Your saved choice has not changed.";

test("sending waits for an enabled editable composer and uses the observed element", async () => {
  const sendSource = source.slice(
    source.indexOf("  async function send(text) {"),
    source.indexOf("  async function queueInput("),
  );
  const input = { disabled: true, readOnly: false };
  let current = input;
  let filled = false;
  let sent = false;
  await runInNewContext(
    `(async () => { ${sendSource}; await send('Synthetic request'); })()`,
    {
      field: () => current,
      wait: async (name, check) => {
        assert.equal(name, "composer-ready");
        assert.equal(check(), false);
        input.disabled = false;
        input.readOnly = true;
        assert.equal(check(), false);
        input.readOnly = false;
        const observed = check();
        assert.equal(observed, input);
        current = null;
        return observed;
      },
      fill: (element, text) => {
        assert.equal(element, input);
        assert.equal(element.disabled, false);
        assert.equal(element.readOnly, false);
        assert.equal(text, "Synthetic request");
        filled = true;
      },
      click: async (name) => {
        assert.equal(filled, true);
        assert.equal(name, "Send message");
        sent = true;
      },
    },
  );
  assert.equal(sent, true);
});

test("stopping waits for activity presentation to clear after draft recall", async () => {
  const start = source.indexOf(
    '      const recall = await wait("stopped-followup-recall"',
  );
  const program = source.slice(
    start,
    source.indexOf('      fill(field(), "");', start),
  );
  const draft = "Recover this follow-up\n\nKeep this draft";
  async function exercise(clearActivity) {
    let activity = true;
    const input = { value: "Keep this draft" };
    const polls = [];
    await runInNewContext(`(async () => {${program}})()`, {
      field: () => input,
      query: (selector) => {
        if (selector === ".chat-pane .edit-pending")
          return {
            click: () => {
              input.value = draft;
            },
          };
        assert.equal(selector, ".chat-activity");
        return activity ? {} : undefined;
      },
      wait: async (name, check) => {
        if (name !== "stopped-activity-cleared") return check();
        polls.push(check());
        if (clearActivity) activity = false;
        polls.push(check());
        if (!polls.at(-1)) throw new Error(name);
      },
      assert: (condition, code) => assert.ok(condition, code),
    });
    return polls;
  }
  assert.deepEqual(await exercise(true), [false, true]);
  await assert.rejects(exercise(false), /stopped-activity-cleared/);
});

const historyFlow = source.slice(
  source.indexOf("  async function historyEntry("),
  source.indexOf("  async function concurrentConversationReads("),
);
async function runHistory(expression, invoke, snapshot) {
  return runInNewContext(
    `(async () => {${historyFlow}; return ${expression};})()`,
    {
      invoke,
      snapshot,
      info: { scope: "workspace" },
      userText: (message) => message.content,
      assert: (condition, code) => assert.ok(condition, code),
      TextDecoder,
      Uint8Array,
    },
  );
}

test("retained input checks page originals and use the latest selected-path status", async () => {
  const calls = [];
  const retained = await runHistory(
    'inputHistory("chat", "Recalled original")',
    async (command, args) => {
      assert.equal(command, "ai_conversation_history");
      calls.push(args.before);
      return args.before === null
        ? {
            entries: [
              {
                type: "inputStatus",
                data: { inputId: "input", state: "consumed" },
              },
              {
                type: "inputStatus",
                data: { inputId: "input", state: "recalled" },
              },
            ],
            nextBefore: "older",
          }
        : {
            entries: [
              {
                id: "original",
                type: "message",
                data: {
                  message: { role: "user", content: "Recalled original" },
                  input: { id: "input", state: "waiting" },
                },
              },
            ],
            nextBefore: null,
          };
    },
  );
  assert.equal(retained.entry.id, "original");
  assert.equal(retained.state, "recalled");
  assert.deepEqual(calls, [null, "older", null]);
});

test("reopen inspection pages saved originals beyond the compacted continuation window", async () => {
  const current = {
    conversations: [
      {
        id: "chat",
        revision: 7,
        messages: [{ role: "user", content: "Recent continuation" }],
        runtime: { checkpoint: { sourceCount: 0, summary: "Earlier work" } },
      },
    ],
  };
  const calls = [];
  const invoke = async (command, args) => {
    assert.equal(command, "ai_conversation_history");
    assert.equal(args.conversation, "chat");
    calls.push(args.before);
    return {
      metadata: { revision: 7 },
      entries:
        args.before === null
          ? [
              {
                type: "message",
                data: {
                  message: { role: "user", content: "Recent continuation" },
                },
              },
              { type: "run", data: { id: "run", state: "completed" } },
            ]
          : [
              { type: "run", data: { id: "run", state: "running" } },
              {
                type: "message",
                data: {
                  message: {
                    role: "user",
                    content: "Original before compaction",
                  },
                },
              },
              { type: "event", data: { id: "intent", type: "tool_intent" } },
            ],
      nextBefore: args.before === null ? "older" : null,
    };
  };
  const result = await runHistory("savedHistorySnapshot()", invoke, async () =>
    structuredClone(current),
  );
  const record = result.conversations[0];
  assert.deepEqual(
    Array.from(record.messages, (message) => message.content),
    ["Original before compaction", "Recent continuation"],
  );
  assert.equal(record.runtime.runs.length, 1);
  assert.equal(record.runtime.runs[0].state, "completed");
  assert.equal(record.runtime.events[0].id, "intent");
  assert.equal(record.runtime.checkpoint.summary, "Earlier work");
  assert.deepEqual(calls, [null, "older"]);
  assert.equal(current.conversations[0].messages.length, 1);
  await assert.rejects(
    () =>
      runHistory(
        "savedHistorySnapshot()",
        async () => ({
          metadata: { revision: 8 },
          entries: [],
          nextBefore: null,
        }),
        async () => structuredClone(current),
      ),
    /history-revision-changed/,
  );
});

test("attachment checks require consumed original references, matching metadata and exact stored bytes", async () => {
  const text = '{"tasks":[]}\n';
  const bytes = [...new TextEncoder().encode(text)];
  const reference = {
    id: "attachment",
    name: "tasks.json",
    mimeType: "application/json",
    size: bytes.length,
  };
  const check = ({
    state = "consumed",
    attachments = [reference],
    stored = { reference, bytes },
  } = {}) =>
    runHistory(
      `verifyInputAttachments("chat", [["tasks.json", {text:${JSON.stringify(text)}}]], "attachment-mismatch")`,
      async (command, args) => {
        if (command === "ai_attachment_read") {
          assert.equal(args.id, "attachment");
          return stored;
        }
        assert.equal(command, "ai_conversation_history");
        return {
          entries: [
            {
              type: "message",
              data: {
                message: {
                  role: "user",
                  content: "[e2e:onboarding-import] Import sources",
                },
                input: { id: "input", state: "waiting", attachments },
              },
            },
            { type: "inputStatus", data: { inputId: "input", state } },
          ],
          nextBefore: null,
        };
      },
    );
  await check();
  for (const changed of [
    { state: "recalled" },
    { attachments: [] },
    { stored: { reference: { ...reference, mimeType: "text/plain" }, bytes } },
    {
      stored: {
        reference,
        bytes: bytes.map((byte, index) => (index === 0 ? 32 : byte)),
      },
    },
  ])
    await assert.rejects(() => check(changed), /attachment-mismatch/);
});

const settledStart = source.indexOf("    const actionPending = (record) =>");
assert.notEqual(settledStart, -1);
const settledFlow = source.slice(
  settledStart,
  source.indexOf("    const saved = await load();", settledStart),
);

async function pollSetup({
  taskActive = false,
  questionBusy = false,
  events = [],
  diskState = "completed",
} = {}) {
  let diskReads = 0;
  const record = { id: "setup", runtime: { runs: [{ state: diskState }] } };
  const result = await runInNewContext(
    `(async () => {${settledFlow}; return settled();})()`,
    {
      load: async () => ({ record: { conversationId: "setup" } }),
      liveSnapshot: async (id) => {
        assert.equal(id, "setup");
        return { taskActive, questionBusy, record: { runtime: { events } } };
      },
      setupConversation: async () => {
        diskReads++;
        return record;
      },
      snapshot: async () => ({}),
      verifyAlerts: async () => {},
      button: () => undefined,
      allRuns: (value) => value.runtime?.runs ?? [],
      assert: (condition, code) => assert.ok(condition, code),
      wait: async (_code, check) => check(),
    },
  );
  return { result, diskReads };
}

test("onboarding waits for the live owner before inspecting reconstructed terminal runs", async () => {
  for (const live of [{ taskActive: true }, { questionBusy: true }]) {
    assert.deepEqual(await pollSetup({ ...live, diskState: "interrupted" }), {
      result: false,
      diskReads: 0,
    });
  }
  const settled = await pollSetup();
  assert.equal(settled.result.id, "setup");
  assert.equal(settled.diskReads, 1);
});

test("onboarding waits for contextual question actions to settle", async () => {
  const events = [
    {
      type: "question_presented",
      data: { id: "question", context: { action: "confirm" } },
    },
    { type: "question_answered", data: { questionId: "question" } },
  ];
  assert.deepEqual(await pollSetup({ events }), {
    result: false,
    diskReads: 0,
  });
  events.push({
    type: "question_action_completed",
    data: { questionId: "question" },
  });
  assert.equal((await pollSetup({ events })).result.id, "setup");
});

test("a quiescent onboarding owner does not conceal interrupted or failed durable runs", async () => {
  for (const diskState of ["interrupted", "error"])
    await assert.rejects(
      () => pollSetup({ diskState }),
      /onboarding-run-not-completed/,
    );
});

async function run({
  warning = catalogWarning,
  available = true,
  focused = true,
  nativeFocused = focused,
  role = "primary",
  journey = "onboarding",
  focusAfter = 1,
} = {}) {
  let open = true;
  let probing = false;
  let focusRequests = 0;
  let dismissals = 0;
  let loads = 0;
  let failure;
  const dismiss = {
    disabled: false,
    cloneNode: () => ({
      querySelectorAll: () => [],
      textContent: "Dismiss",
    }),
    click: () => {
      open = false;
      dismissals++;
    },
  };
  const dialog = {
    querySelector: () => ({ textContent: warning }),
    querySelectorAll: () => [dismiss],
  };
  const state = { conversations: [] };
  const invoke = async (command, args) => {
    switch (command) {
      case "workspace_snapshot":
        return { ready: true };
      case "agent_e2e_info":
        if (probing && role === "primary" && (!nativeFocused || !focused)) {
          focusRequests++;
          nativeFocused = focusRequests >= focusAfter;
          if (nativeFocused) focused = true;
        }
        return {
          role,
          scope: "alpha",
          model: "gpt-4.1-mini",
          journey,
          readyScopes: ["beta"],
        };
      case "ai_status":
        if (role === "primary") {
          assert.equal(focused, true);
          assert.equal(nativeFocused, true);
        }
        assert.equal(args.scope, "alpha");
        return {
          available,
          selectedModel: "gpt-4.1-mini",
          catalog: { source: "unknown" },
        };
      case "onboarding_load":
        loads++;
        throw "snapshot-fixture-end";
      case "agent_e2e_snapshot":
        return state;
      case "agent_e2e_finish":
        failure = args.error;
        return;
      default:
        throw new Error(`Unexpected command: ${command}`);
    }
  };
  await runInNewContext(source, {
    window: {
      __TAURI_INTERNALS__: { invoke },
      runOnboardingSmoke: async () => false,
      nativeSmokeWait: {
        async wait(probe) {
          for (let attempt = 0; attempt < 5; attempt++) {
            probing = true;
            try {
              const value = await probe();
              if (value) return value;
            } finally {
              probing = false;
            }
          }
          throw new Error("fixture-wait-exhausted");
        },
      },
    },
    document: {
      visibilityState: "visible",
      hasFocus: () => focused,
      querySelector: (selector) => {
        assert.equal(selector, "dialog.model-error[open]");
        return open ? dialog : null;
      },
      querySelectorAll: () => [],
    },
  });
  return { dismissals, loads, failure, focusRequests };
}

const publicationCheck = source.slice(
  source.indexOf("  function verifyPublishedDocuments("),
  source.indexOf("  function verifyTools("),
);
const assertJourney = (condition, code) => {
  if (!condition) throw new Error(code);
};
const verifyPublication = runInNewContext(
  `${publicationCheck}; verifyPublishedDocuments`,
  { assert: assertJourney },
);

test("native publication acknowledgements must match saved destinations and revisions", () => {
  const document = {
    path: "later-imported-tasks.md",
    version: { text: "Saved tasks", revision: "r1" },
  };
  const batch = {
    role: "toolResult",
    toolName: "create_batch",
    details: {
      historyRevision: "a".repeat(40),
      files: [{ path: document.path, revision: "r1" }],
    },
  };
  verifyPublication({ messages: [batch] }, [document]);
  verifyPublication(
    {
      messages: [
        {
          role: "toolResult",
          toolName: "write",
          details: {
            change: {
              path: document.path,
              after: "Saved tasks",
              afterRevision: "r1",
            },
          },
        },
      ],
    },
    [document],
  );
  for (const result of [
    { ...batch, isError: true },
    { ...batch, details: { ...batch.details, historyRevision: null } },
    {
      ...batch,
      details: {
        ...batch.details,
        files: [{ path: "other.md", revision: "r1" }],
      },
    },
    {
      ...batch,
      details: {
        ...batch.details,
        files: [{ path: document.path, revision: "r2" }],
      },
    },
    {
      role: "toolResult",
      toolName: "write",
      details: {
        change: {
          path: document.path,
          after: "Different",
          afterRevision: "r1",
        },
      },
    },
  ]) {
    assert.throws(
      () => verifyPublication({ messages: [result] }, [document]),
      /published-destination-revision-mismatch/,
    );
  }
});

const ordinaryStart = source.indexOf(
  '    await navigation();\n    await click("New chat");\n    await send(\n      "[e2e:ordinary-import]',
);
assert.notEqual(ordinaryStart, -1);
const ordinaryFlow = source.slice(
  ordinaryStart,
  source.indexOf('    await invoke("agent_e2e_ready");', ordinaryStart),
);
async function runOrdinary({
  reusedTask = false,
  changedSource = false,
  changedCopies = false,
  setupConversation = false,
  batchError = false,
} = {}) {
  const controls = [];
  let prompt;
  let completedMarker;
  const originals = {
    json: { text: '{"tasks":[]}', revision: "source-json" },
    markdown: { text: "# Note\n", revision: "source-note" },
  };
  const instructions = { revision: "instructions" };
  const after = { tasks: [{ id: "previous-task" }] };
  const baseline = { conversationId: "setup" };
  const messages = [
    {
      role: "toolResult",
      toolName: "create_batch",
      isError: batchError,
      details: {
        historyRevision: "b".repeat(40),
        files: [
          { path: "later-imported-tasks.md" },
          { path: "later-imported-notes.md" },
        ],
      },
    },
  ];
  await runInNewContext(`(async () => {${ordinaryFlow}})()`, {
    originals,
    instructions,
    after,
    baseline,
    info: { mode: "fixture" },
    assert: assertJourney,
    navigation: async () => controls.push("navigation"),
    click: async (label) => controls.push(label),
    send: async (text) => {
      prompt = text;
    },
    completed: async (marker) => {
      completedMarker = marker;
      return { id: setupConversation ? "setup" : "ordinary", messages };
    },
    load: async () => ({ record: { step: "complete" } }),
    inspectImport: async (options) =>
      options?.later
        ? { tasks: [{ id: reusedTask ? "previous-task" : "fresh-task" }] }
        : changedCopies
          ? { tasks: [] }
          : after,
    sameImport: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    read: async (path) =>
      path === ".situate/working-method.md"
        ? instructions
        : changedSource
          ? { text: "changed", revision: "changed" }
          : path === "seed.json"
            ? originals.json
            : originals.markdown,
  });
  return { controls, prompt, completedMarker, originals };
}

test("the later import starts a new ordinary chat with unchanged named sources and native task intent", async () => {
  const result = await runOrdinary();
  assert.deepEqual(result.controls, ["navigation", "New chat"]);
  assert.equal(result.completedMarker, "[e2e:ordinary-import]");
  assert.ok(
    result.prompt.includes("tasks.json\n" + result.originals.json.text),
  );
  assert.ok(
    result.prompt.includes("notes.md\n" + result.originals.markdown.text),
  );
  assert.match(
    result.prompt,
    /later-imported-tasks\.md and later-imported-notes\.md/,
  );
  assert.match(result.prompt, /situate-task-id: null/);
  assert.match(result.prompt, /prepareCopy: true/);
});

for (const [options, reason] of [
  [{ reusedTask: true }, "ordinary-import-reused-task-identities"],
  [{ changedSource: true }, "ordinary-import-changed-source"],
  [{ changedCopies: true }, "ordinary-import-changed-earlier-copies"],
  [{ setupConversation: true }, "ordinary-import-used-setup-conversation"],
  [{ batchError: true }, "ordinary-import-batch-history-missing"],
]) {
  test(`the later import rejects ${reason}`, async () => {
    await assert.rejects(runOrdinary(options), new RegExp(reason));
  });
}

const batchPreviewStart = source.indexOf("        batchSummary.click();");
assert.notEqual(batchPreviewStart, -1);
const batchPreviewFlow = source.slice(
  batchPreviewStart,
  source.indexOf("\n      }\n      const imported =", batchPreviewStart),
);

async function runBatchPreview({
  preloaded = false,
  wrongVersion = false,
} = {}) {
  let expanded = false;
  let selected;
  const actions = [];
  const rows = ["imported-tasks.md", "imported-notes.md"].map((path) => ({
    textContent: path,
    click() {
      selected = path;
      actions.push(path);
    },
  }));
  await runInNewContext(`(async () => {${batchPreviewFlow}})()`, {
    batchSummary: {
      click() {
        expanded = true;
      },
      parentElement: {
        querySelectorAll: () => (expanded ? rows : []),
        querySelector: () => (preloaded ? {} : null),
      },
    },
    buttonText: (element) => element.textContent,
    visible: () => true,
    assert: assertJourney,
    wait: async (code, check) => {
      assert.ok(await check(), code);
    },
    query: () =>
      selected
        ? {
            querySelector: (selector) => ({
              textContent:
                selector === ".change-path"
                  ? wrongVersion
                    ? "another.md"
                    : selected
                  : "# Saved content",
            }),
          }
        : null,
    click: async (label) => {
      assert.equal(label, "Close dialog");
      selected = undefined;
      actions.push("close");
    },
  });
  return actions;
}

test("the native import review opens and closes each file from the batch list", async () => {
  assert.deepEqual(await runBatchPreview(), [
    "imported-tasks.md",
    "close",
    "imported-notes.md",
    "close",
  ]);
});

test("the native import review rejects eager contents and mismatched file previews", async () => {
  await assert.rejects(
    runBatchPreview({ preloaded: true }),
    /onboarding-batch-content-loaded-without-selection/,
  );
  await assert.rejects(
    runBatchPreview({ wrongVersion: true }),
    /onboarding-batch-written-text-visible/,
  );
});

test("the native journey dismisses only the usable saved-model catalog warning before continuing", async () => {
  assert.deepEqual(await run(), {
    dismissals: 1,
    loads: 1,
    failure: "snapshot-fixture-end",
    focusRequests: 0,
  });
});

test("unexpected model recovery remains a journey failure", async () => {
  assert.deepEqual(await run({ warning: "Model choices could not be read." }), {
    dismissals: 0,
    loads: 0,
    failure: "unexpected-model-recovery",
    focusRequests: 0,
  });
});

test("a visible but unfocused primary waits for native focus before continuing", async () => {
  assert.deepEqual(await run({ focused: false, focusAfter: 2 }), {
    dismissals: 1,
    loads: 1,
    failure: "snapshot-fixture-end",
    focusRequests: 2,
  });
});

test("native activation precedes control checks even when DOM focus is stale", async () => {
  assert.deepEqual(await run({ focused: true, nativeFocused: false }), {
    dismissals: 1,
    loads: 1,
    failure: "snapshot-fixture-end",
    focusRequests: 1,
  });
});

test("the primary does not exercise controls when native focus never arrives", async () => {
  assert.deepEqual(await run({ focused: false, focusAfter: Infinity }), {
    dismissals: 0,
    loads: 0,
    failure: "secondary-window-ready",
    focusRequests: 5,
  });
});

test("an unfocused secondary never requests foreground ownership", async () => {
  const result = await run({
    focused: false,
    role: "secondary",
    journey: "workspace",
  });
  assert.equal(result.focusRequests, 0);
  assert.equal(result.loads, 0);
});

test("a catalog warning cannot hide unavailable AI access", async () => {
  assert.deepEqual(await run({ available: false }), {
    dismissals: 0,
    loads: 0,
    failure: "alert-model-unavailable",
    focusRequests: 0,
  });
});
