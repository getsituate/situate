import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { notarize } from "../client/scripts/apple-release.mjs";
import { createBuilderNotaryJournal } from "../infrastructure/releases/allocator.mjs";

test("Apple submission and durable host journals agree for both final payloads", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-notary-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "target/apple-release"), { recursive: true });
  const records = new Map();
  const events = [];
  const operationId = "synthetic-candidate";
  const journal = createBuilderNotaryJournal(
    {},
    {
      operationId,
      withAllocatorLock: (action) =>
        action({
          journal: async (action, request) => {
            assert.equal(action, "journal-append");
            const prior = records.get(request.operationId) ?? [];
            if (request.entry.phase === "intent") assert.equal(prior.length, 0);
            if (request.entry.phase === "submission")
              assert.equal(prior[0].phase, "intent");
            if (request.entry.phase === "completion")
              assert.equal(request.entry.outcome, "success");
            prior.push(request.entry);
            records.set(request.operationId, prior);
            events.push(request.entry.phase);
            return { durable: true, operationId: request.operationId };
          },
        }),
    },
  );
  for (const [index, name] of ["application.zip", "installer.dmg"].entries()) {
    const file = join(root, name);
    writeFileSync(file, `synthetic payload ${index}`);
    const id = `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`;
    await notarize(
      file,
      { notaryProfile: "synthetic-profile", notaryJournal: journal },
      async (command, args) => {
        assert.equal(command, "xcrun");
        if (args[1] === "submit") {
          assert.equal(events.at(-1), "intent");
          events.push("submit");
          return JSON.stringify({ id });
        }
        assert.equal(args[1], "wait");
        assert.equal(events.at(-1), "submission");
        events.push("wait");
        return JSON.stringify({ id, status: "Accepted" });
      },
      { cwd: root },
    );
  }
  assert.equal(records.size, 2);
  assert.deepEqual(events, [
    "intent",
    "submit",
    "submission",
    "wait",
    "completion",
    "completion",
    "intent",
    "submit",
    "submission",
    "wait",
    "completion",
    "completion",
  ]);
  for (const [id, values] of records) {
    assert.match(id, /^synthetic-candidate-[a-f0-9]{32}$/);
    assert.equal(values.at(-1).outcome, "success");
    assert.equal(values.at(-1).parentOperationId, operationId);
  }
});
