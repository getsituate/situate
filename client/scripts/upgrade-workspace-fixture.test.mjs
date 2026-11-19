import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  materializeUpgradeWorkspace,
  upgradeNote,
  upgradeNoteBefore,
  upgradeNoteAfter,
  verifyUpgradeDraft,
  verifyUpgradeWorkspace,
} from "./upgrade-workspace-fixture.mjs";
import { upgradeWorkspaceJourney } from "./upgrade-workspace-journey.mjs";

function materialized(t) {
  const parent = mkdtempSync(
    join(realpathSync(tmpdir()), "situate-upgrade-test-"),
  );
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, root: materializeUpgradeWorkspace(parent) };
}

test("historical fixture retains file revisions, both transcripts and plugin code", (t) => {
  const { parent, root } = materialized(t);
  verifyUpgradeWorkspace(root, upgradeNoteBefore);
  assert.throws(() => materializeUpgradeWorkspace(parent), { code: "EEXIST" });
  const history = (id) =>
    readFileSync(
      join(root, ".situate/conversations", id, "history.jsonl"),
      "utf8",
    )
      .trimEnd()
      .split("\n")
      .map(JSON.parse);
  const messages = [
    "21111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]
    .flatMap(history)
    .map((entry) => entry.data.message);
  const calls = messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.content
        .filter((block) => block.type === "toolCall")
        .map((block) => block.name),
    );
  assert.deepEqual(calls, [
    "ls",
    "read",
    "find",
    "grep",
    "history",
    "read_revision",
    "write",
    "edit",
    "create_batch",
    "list_conversations",
    "read_conversation",
    "web_search",
    "web_fetch",
    "open_view",
    "reveal_content",
    "open_conversation",
    "shell",
    "ask_question",
  ]);
  assert.equal(
    messages.filter(
      (message) => message.role === "toolResult" && message.isError,
    ).length,
    3,
  );
  assert.throws(
    () => verifyUpgradeWorkspace(root, upgradeNoteAfter),
    /expected saved content/,
  );
  writeFileSync(join(root, upgradeNote), upgradeNoteAfter);
  verifyUpgradeWorkspace(root, upgradeNoteAfter);
  writeFileSync(join(root, "Checklist.md"), "overwritten");
  assert.throws(
    () => verifyUpgradeWorkspace(root, upgradeNoteAfter),
    /lost retained state/,
  );
});

test("cancellation requires the predecessor's exact persisted draft", (t) => {
  const { root } = materialized(t);
  const draft = `${upgradeNoteAfter}\nUnsaved cancellation marker\n`;
  const file = join(
    root,
    ".situate/drafts/8219f709db5ea809757bda962d9c1bf13ace0317.json",
  );
  assert.throws(() => verifyUpgradeDraft(root, draft), { code: "ENOENT" });
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      draft: {
        path: upgradeNote,
        base: { text: upgradeNoteAfter },
        text: draft,
      },
    }),
  );
  verifyUpgradeDraft(root, draft);
  assert.throws(
    () => verifyUpgradeDraft(root, upgradeNoteAfter),
    /exact draft/,
  );
});

test("fixture verification rejects linked retained files", (t) => {
  const { parent, root } = materialized(t);
  const outside = join(parent, "outside.md");
  writeFileSync(outside, upgradeNoteBefore);
  rmSync(join(root, upgradeNote));
  symlinkSync(outside, join(root, upgradeNote));
  assert.throws(
    () => verifyUpgradeWorkspace(root, upgradeNoteBefore),
    /is linked/,
  );
});

test("the retained document source returns bounded synthetic data for its own references", async (t) => {
  const { root } = materialized(t);
  const code = readFileSync(
    join(root, ".situate/plugins/upgrade-fixture/code/service.js"),
  );
  const { default: source } = await import(
    `data:text/javascript;base64,${code.toString("base64")}`
  );
  const service = source().exports;
  const descriptor = await service.documentSourceDescribe();
  assert.equal(descriptor.label, "Sample field archive");
  const list = await service.documentSourceList();
  const [item] = list.items;
  assert.deepEqual(item.ref.source, descriptor.source);
  const result = await service.documentSourceContent({
    ref: item.ref,
    maxChars: 128,
  });
  assert.equal(result.text, "Station A: light rain.");
  assert.deepEqual(result.provenance.ref, item.ref);
  assert.equal(
    (await service.documentSourceContent({ ref: item.ref, maxChars: 9 }))
      .truncated,
    true,
  );
  assert.equal(
    (
      await service.documentSourceContent({
        ref: { ...item.ref, id: "elsewhere" },
        maxChars: 128,
      })
    ).status,
    "error",
  );
});

test("the upgrade launches the installed updater and verifies cancellation before replacing the app", async () => {
  const steps = [];
  const journey = upgradeWorkspaceJourney({
    actions: async (items) => steps.push(...items),
    verify: async (note) => steps.push({ saved: note }),
    verifyCancellation: async (draft) => steps.push({ cancelledDraft: draft }),
    writable: async (value) => steps.push({ writable: value }),
  });
  await journey.open();
  await journey.author();
  await journey.update();
  await journey.reopen();
  const indices = steps.flatMap((step, index) =>
    step.click?.name === "Install and restart" ? [index] : [],
  );
  const cancellation = steps.findIndex((step) => step.click?.name === "Cancel");
  const notices = steps.flatMap((step, index) =>
    step.click?.name === "Update available" ? [index] : [],
  );
  const retry = steps.findIndex(
    (step) => step.click?.name === "Try installation again",
  );
  const unsaved = `${upgradeNoteAfter}\nUnsaved cancellation marker\n`;
  const draft = steps.findIndex(
    (step) =>
      step.assert?.name === "Retained unsaved source" &&
      step.assert.value === unsaved,
  );
  const unchanged = steps.findIndex((step) => step.cancelledDraft === unsaved);
  const writable = steps.findIndex((step) => step.writable === true);
  assert.equal(indices.length, 3);
  assert.equal(notices.length, 1);
  assert.ok(
    notices[0] < indices[0] && indices[1] < draft && draft < cancellation,
  );
  assert.ok(cancellation < unchanged && unchanged < writable);
  assert.ok(writable < retry && retry < indices[2]);
  assert.deepEqual(
    steps.filter((step) => "writable" in step),
    [{ writable: false }, { writable: true }],
  );
  assert.deepEqual(
    steps.filter((step) => "saved" in step).map((step) => step.saved),
    [upgradeNoteBefore, upgradeNoteAfter, unsaved],
  );
});
