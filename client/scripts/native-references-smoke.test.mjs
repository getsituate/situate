import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL(
    "../app/src-tauri/tests/support/references-smoke.js",
    import.meta.url,
  ),
  "utf8",
);
const original = {
  kind: "live",
  workspaceId: "workspace",
  path: "native-reference.txt",
  anchorRevision: "b".repeat(40),
};
const copied = {
  ...original,
  path: "native-reference-copy.txt",
  anchorRevision: "c".repeat(40),
};
const historical = {
  kind: "historical",
  workspaceId: "workspace",
  path: original.path,
  revision: original.anchorRevision,
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const resolved = (reference, path) => ({
  status: "ok",
  reference,
  document: {
    path,
    version: { text: "Original reference text\n", revision: "a".repeat(40) },
  },
});

function fixture({
  restart = false,
  retarget = false,
  revived = false,
  wrongHistory = false,
  reordered = false,
  persistedScope,
  foreignAccepted = false,
  foreignPoisoned = false,
  rewritten = false,
} = {}) {
  const calls = [];
  const resolutions = restart
    ? []
    : [resolved(retarget ? copied : original, "native-reference-moved.txt")];
  resolutions.push(
    revived
      ? resolved(original, "native-reference-moved.txt")
      : { status: "deleted" },
    resolved(copied, "native-reference-copy-moved.txt"),
    {
      ...resolved(historical, original.path),
      document: {
        path: original.path,
        version: {
          text: "Original reference text\n",
          revision: wrongHistory ? "d".repeat(40) : original.anchorRevision,
        },
      },
    },
  );
  let captures = 0;
  let digest = "original-bytes";
  let poisoned = false;
  let position = 0;
  let record = {
    version: 2,
    id: "native-references",
    title: "Native references",
    revision: 2,
    messages: [],
    draft: "Unsent reference prompt",
    runtime: {
      draftAttachments: [],
      draftReferences: [original, copied, historical],
      pending: [
        {
          id: "queued-reference",
          kind: "followUp",
          state: "pending",
          text: "Queued reference prompt",
          attachments: [],
          references: [copied],
          timestamp: 1,
        },
      ],
      events: [],
      runs: [
        {
          id: "completed-reference",
          state: "completed",
          startedAt: 1,
          endedAt: 2,
          usage: [],
          references: [historical],
        },
      ],
    },
  };
  const window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        calls.push([command, clone(args ?? null)]);
        if (command === "workspace_snapshot")
          return { current: { id: "workspace" } };
        if (command === "smoke_progress") return;
        if (command === "smoke_conversation_fixture") {
          assert.equal(args.scope, "workspace");
          assert.equal(args.fixture, "references");
          assert.deepEqual(clone(args.references), [
            original,
            copied,
            historical,
          ]);
          return { id: record.id, revision: record.revision };
        }
        if (command === "ai_conversation_action") {
          assert.equal(args.scope, "workspace");
          assert.equal(args.conversation, "native-references");
          assert.equal(args.generation, "generation");
          assert.equal(args.action.version, 1);
          assert.equal(args.action.type, "draft");
          if (
            args.action.input.references[0]?.workspaceId === "foreign-workspace"
          ) {
            if (foreignAccepted) return { record: clone(record) };
            poisoned = foreignPoisoned;
            throw "native.ai.conversation.versionInvalid";
          }
          assert.deepEqual(clone(args.action.expected), {
            text: record.draft,
            attachments: [],
            references: record.runtime.draftReferences,
          });
          record.draft = args.action.input.text;
          record.runtime.draftReferences = clone(args.action.input.references);
          position++;
          return { record: clone(record), generation: "generation", position };
        }
        if (command === "ai_conversation_snapshot") {
          assert.equal(args.scope, "workspace");
          assert.equal(args.conversation, "native-references");
          assert.deepEqual(Object.keys(args).sort(), ["conversation", "scope"]);
          if (rewritten) digest = "rewritten-bytes";
          const reply = clone(record);
          if (reordered)
            reply.runtime.draftReferences = reply.runtime.draftReferences.map(
              (reference) =>
                Object.fromEntries(Object.entries(reference).reverse()),
            );
          return {
            version: 1,
            generation: "generation",
            position,
            record: reply,
            taskActive: poisoned,
            phase: poisoned ? "persistenceFailed" : "idle",
          };
        }
        if (command === "smoke_reference_fixture") {
          if (args.action === "prepare") return "a".repeat(40);
          assert.equal(args.action, "inspect");
          const stored = clone(record);
          for (const [name, references] of [
            ["draft", stored.runtime.draftReferences],
            ["pending", stored.runtime.pending[0].references],
            ["run", stored.runtime.runs[0].references],
          ]) {
            if (persistedScope !== name)
              for (const reference of references) delete reference.workspaceId;
          }
          return { record: stored, digest };
        }
        assert.equal(command, "files_request");
        assert.equal(args.request.workspaceId, "workspace");
        switch (args.request.operation) {
          case "snapshot":
            return { status: "ok", snapshot: { writable: true } };
          case "captureReference":
            return { status: "ok", reference: captures++ ? copied : original };
          case "resolveReference":
            assert.ok(resolutions.length, "Unexpected reference resolution");
            return resolutions.shift();
          case "rename":
          case "copy":
          case "delete":
            return { status: "ok" };
          default:
            assert.fail(`Unexpected file operation: ${args.request.operation}`);
        }
      },
    },
  };
  runInNewContext(source, { window, crypto: { randomUUID } });
  return { calls, run: () => window.runReferenceSmoke(restart) };
}

test("native reference smoke exercises structural operations and stores original anchors in a conversation", async () => {
  const { calls, run } = fixture();
  await run();
  assert.deepEqual(
    calls
      .filter(([command]) => command === "files_request")
      .map(([, { request }]) => request.operation),
    [
      "snapshot",
      "captureReference",
      "rename",
      "resolveReference",
      "copy",
      "captureReference",
      "rename",
      "delete",
      "copy",
      "resolveReference",
      "resolveReference",
      "resolveReference",
    ],
  );
  assert.equal(
    calls.filter(([command]) => command === "smoke_conversation_fixture")
      .length,
    1,
  );
  assert.deepEqual(calls.at(-1), [
    "smoke_progress",
    { stage: "references-verified" },
  ]);
});

test("native restart verifies stored anchors without recapture or repeated structural mutation", async () => {
  const { calls, run } = fixture({ restart: true });
  await run();
  assert.deepEqual(
    calls
      .filter(([command]) => command === "files_request")
      .map(([, { request }]) => request.operation),
    ["snapshot", "resolveReference", "resolveReference", "resolveReference"],
  );
  assert.ok(
    !calls.some(([command]) => command === "smoke_conversation_fixture"),
  );
  assert.ok(
    calls
      .filter(([command]) => command === "smoke_reference_fixture")
      .every(([, args]) => args.action === "inspect"),
  );
  assert.deepEqual(calls.at(-1), [
    "smoke_progress",
    { stage: "references-verified" },
  ]);
});

test("native restart accepts equivalent references with different JSON property order", async () => {
  await fixture({ restart: true, reordered: true }).run();
});

for (const [name, options, error] of [
  ["anchor changes", { retarget: true }, /changed the stored anchor/],
  [
    "revived deletions",
    { restart: true, revived: true },
    /revived a deleted reference/,
  ],
  [
    "historical substitutions",
    { restart: true, wrongHistory: true },
    /retained source history/,
  ],
  ...["draft", "pending", "run"].map((slot) => [
    `persisted ${slot} scope`,
    { restart: true, persistedScope: slot },
    /runtime scope on disk/,
  ]),
  [
    "foreign draft action acceptance",
    { restart: true, foreignAccepted: true },
    /accepted a foreign/,
  ],
  [
    "foreign reference owner poisoning",
    { restart: true, foreignPoisoned: true },
    /stranded the native conversation/,
  ],
  [
    "load-time rewriting",
    { restart: true, rewritten: true },
    /rewrote the stored conversation/,
  ],
]) {
  test(`native reference smoke rejects ${name} before reporting success`, async () => {
    const { calls, run } = fixture(options);
    await assert.rejects(run(), error);
    assert.ok(!calls.some(([command]) => command === "smoke_progress"));
  });
}
