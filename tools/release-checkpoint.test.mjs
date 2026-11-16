import assert from "node:assert/strict";
import {
  linkSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  createCheckpoint,
  checkpointFileHash,
  checkpointGitHubWrites,
} from "./release-checkpoint.mjs";
import { checkpointFixture } from "./release-checkpoint-fixtures.mjs";

test("only exact final assets, original authorization and predecessor inputs enter build inventory", (t) => {
  const f = checkpointFixture(t);
  writeFileSync(
    join(f.directory, ".env"),
    "SYNTHETIC_SECRET=not-for-checkpoint",
  );
  writeFileSync(join(f.directory, "raw.log"), "synthetic log");
  const checkpoint = createCheckpoint({ kind: "build", ...f });
  assert.equal(checkpoint.descriptor.files.length, 13);
  assert(
    !checkpoint.descriptor.files.some((item) => /env|log/.test(item.name)),
  );
  assert.deepEqual(
    checkpoint.files[1].bytes,
    Buffer.from(f.configurationBytes),
  );
  assert.equal(
    checkpoint.descriptor.files.find((item) => item.name === "Situate.dmg")
      .sha256,
    f.manifest.artifacts[0].sha256,
  );
  assert.equal(
    JSON.parse(checkpoint.files[2].bytes).stages[0].status,
    "running",
  );
});
test("publication journal durability precedes each GitHub write without affecting reads", async () => {
  const calls = [];
  let blocked = false;
  const adapter = checkpointGitHubWrites(
    {
      getRelease: async () => calls.push("read"),
      createDraft: async () => calls.push("create"),
      uploadAsset: async () => calls.push("upload"),
      finalize: async () => calls.push("finalize"),
    },
    async () => {
      calls.push("durable");
      if (blocked) throw new Error("acknowledgement lost");
    },
  );
  await adapter.getRelease();
  await adapter.createDraft();
  await adapter.uploadAsset();
  await adapter.finalize();
  assert.deepEqual(calls, [
    "read",
    "durable",
    "create",
    "durable",
    "upload",
    "durable",
    "finalize",
  ]);
  blocked = true;
  await assert.rejects(adapter.createDraft(), /acknowledgement lost/);
  assert.equal(calls.at(-1), "durable");
});

test("changed hashes and unsafe local payloads fail before upload", (t) => {
  const f = checkpointFixture(t);
  const file = join(f.directory, "Situate.dmg");
  const original = readFileSync(file);
  writeFileSync(file, "changed");
  assert.throws(
    () => createCheckpoint({ kind: "build", ...f }),
    /hash differs/,
  );
  unlinkSync(file);
  symlinkSync(join(f.directory, "Situate.app.tar.gz"), file);
  assert.throws(() => checkpointFileHash(file));
  unlinkSync(file);
  writeFileSync(file, original);
  linkSync(file, join(f.root, "linked.dmg"));
  assert.throws(() => createCheckpoint({ kind: "build", ...f }), /single-link/);
  assert.throws(
    () =>
      createCheckpoint({
        kind: "intent",
        ...f,
        configurationBytes: `${f.configurationBytes} `,
      }),
    /configuration differs/,
  );
});
