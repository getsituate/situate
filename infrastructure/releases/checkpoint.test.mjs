import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  checkpointFixture,
  runtimeFixture,
} from "../../tools/release-checkpoint-fixtures.mjs";
import { createQualificationRuntimeAuthorization } from "../../tools/release-runtime-authorization.mjs";
import { digest } from "../../tools/pipeline-state.mjs";
import { inspectWorkflow, restoreWorkflow } from "../../tools/pipeline.mjs";
import {
  createCheckpoint,
  checkpointIdentity,
} from "../../tools/release-checkpoint.mjs";
import { checkpointProgram, createHostCheckpointStore } from "./checkpoint.mjs";

function host(t, fixture = checkpointFixture(t)) {
  const storage = join(fixture.root, "host");
  mkdirSync(storage, { mode: 0o700 });
  const identity = checkpointIdentity(fixture.plan);
  writeFileSync(
    join(storage, "release-operations.jsonl"),
    `${JSON.stringify({ identity, state: "claimed" })}\n`,
    { mode: 0o600 },
  );
  const records = ["1", "2"].flatMap((suffix) =>
    ["intent", "submission", "completion"].map((phase) => ({
      operationId: `${identity.operationId}-${suffix.repeat(32)}`,
      entry: {
        parentOperationId: identity.operationId,
        file: `payload-${suffix}.zip`,
        sha256: suffix.repeat(64),
        phase,
        ...(phase !== "intent"
          ? { submissionId: "11111111-1111-1111-1111-111111111111" }
          : {}),
        ...(phase === "completion" ? { outcome: "success" } : {}),
      },
    })),
  );
  writeFileSync(
    join(storage, "release-notary-journal.jsonl"),
    records.map((record) => `${JSON.stringify(record)}\n`).join(""),
    { mode: 0o600 },
  );
  const program = checkpointProgram().replace(
    "ROOT = Path('/opt/situate')",
    `ROOT = Path(${JSON.stringify(storage)})`,
  );
  const store = createHostCheckpointStore(
    {},
    {
      start: () =>
        spawn("python3", ["-u", "-c", program], {
          stdio: ["pipe", "pipe", "pipe"],
        }),
    },
  );
  const raw = (request, payload = Buffer.alloc(0)) =>
    spawnSync("python3", ["-u", "-c", program], {
      input: Buffer.concat([
        Buffer.from(`${JSON.stringify(request)}\n`),
        payload,
      ]),
      maxBuffer: 8 * 1024 * 1024,
    });
  return { ...fixture, storage, identity, store, raw };
}
test("committed packages restore exactly without a builder, and lost acknowledgements cannot replay", async (t) => {
  const f = host(t);
  const checkpoint = createCheckpoint({ kind: "build", ...f });
  const ack = await f.store.commit(checkpoint);
  assert.equal(ack.durable, true);
  const inspected = await f.store.inspect({ plan: f.plan });
  assert.equal(inspected.checkpoints.length, 1);
  assert.equal(inspected.terminalNotary, true);
  await assert.rejects(
    f.store.commit(checkpoint),
    /inspect instead of replaying/,
  );
  const destination = join(f.root, "restored");
  await f.store.restore({
    plan: f.plan,
    checkpointId: ack.checkpointId,
    inspectionDigest: inspected.inspectionDigest,
    destination,
  });
  assert.deepEqual(
    readFileSync(join(destination, "manifest.json")),
    readFileSync(join(f.directory, "manifest.json")),
  );
  assert.deepEqual(
    readFileSync(join(destination, "Situate.dmg")),
    Buffer.from("dmg"),
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(destination, "operation.json"))),
    f.operation,
  );
  const bootstrap = await f.store.bootstrap({
    operationId: f.plan.operation,
    destination: join(f.root, "bootstrap"),
  });
  assert.deepEqual(JSON.parse(readFileSync(bootstrap.planFile)), f.plan);
});
test("restore commits only a complete validated successful transfer and never replaces a destination", async (t) => {
  for (const failure of [
    "metadata-only",
    "mid-asset",
    "bad-hash",
    "bad-manifest",
    "nonzero-exit",
    "existing",
    "concurrent",
    "none",
  ]) {
    const f = checkpointFixture(t);
    const checkpoint = createCheckpoint({ ...f, kind: "build" });
    const descriptor = structuredClone(checkpoint.descriptor);
    const payloads = checkpoint.files.map(
      (file) => file.bytes ?? readFileSync(file.file),
    );
    if (failure === "bad-manifest") {
      const index = descriptor.files.findIndex(
        (file) => file.name === "manifest.json",
      );
      const manifest = JSON.parse(payloads[index]);
      manifest.revision = "0".repeat(40);
      payloads[index] = Buffer.from(JSON.stringify(manifest));
      descriptor.files[index].size = payloads[index].length;
      descriptor.files[index].sha256 = digest(payloads[index]);
    }
    const header = Buffer.from(`${JSON.stringify(descriptor)}\n`);
    let payload = Buffer.concat([header, ...payloads]);
    if (failure === "metadata-only") payload = header;
    if (failure === "mid-asset") {
      const index = descriptor.files.findIndex(
        (file) => file.name === "Situate.dmg",
      );
      payload = payload.subarray(
        0,
        header.length +
          descriptor.files
            .slice(0, index)
            .reduce((size, file) => size + file.size, 0) +
          1,
      );
    }
    if (failure === "bad-hash") {
      payload = Buffer.from(payload);
      payload[payload.length - 1] ^= 1;
    }
    const destination = join(f.root, "restored");
    if (failure === "existing") mkdirSync(destination, { mode: 0o700 });
    let transfers = 0;
    const store = createHostCheckpointStore(
      {},
      {
        start: () => {
          transfers++;
          const code = `process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(Buffer.from(${JSON.stringify(payload.toString("base64"))},'base64'));${failure === "concurrent" ? `require('node:fs').mkdirSync(${JSON.stringify(destination)},{mode:0o700});` : ""}process.exitCode=${failure === "nonzero-exit" ? 1 : 0};});`;
          return spawn(process.execPath, ["-e", code], {
            stdio: ["pipe", "pipe", "pipe"],
          });
        },
      },
    );
    const adapters = {
      inspect: async () => ({ checkpoints: { inspectionDigest: "synthetic" } }),
      restore: async ({ checkpointId, destination }) => ({
        ...(await store.restore({
          plan: f.plan,
          checkpointId,
          destination,
          inspectionDigest: "synthetic",
        })),
        manifestSha256: descriptor.files.find(
          (file) => file.name === "manifest.json",
        ).sha256,
      }),
    };
    const inspection = await inspectWorkflow(f.root, f.plan.operation, {
      plan: f.plan,
      adapters,
    });
    const invoke = () =>
      restoreWorkflow(
        f.root,
        f.plan.operation,
        inspection.reconciliationDigest,
        {
          plan: f.plan,
          checkpointId: descriptor.checkpointId,
          destination,
          adapters,
        },
      );
    const authorization = join(
      f.root,
      ".release-operations",
      f.plan.operation,
      `restore-${descriptor.checkpointId}.json`,
    );
    if (failure === "none") {
      assert.equal((await invoke()).status, "restored");
      assert.equal(existsSync(join(destination, "manifest.json")), true);
      assert.equal(existsSync(authorization), true);
      assert.deepEqual(
        readdirSync(f.root).filter((name) =>
          name.startsWith(".release-restore-incomplete-"),
        ),
        [],
      );
    } else {
      await assert.rejects(invoke());
      assert.equal(existsSync(authorization), false);
      if (["existing", "concurrent"].includes(failure))
        assert.deepEqual(readdirSync(destination), []);
      else assert.equal(existsSync(destination), false);
      assert.equal(transfers, failure === "existing" ? 0 : 1);
      if (failure !== "existing")
        assert.equal(
          readdirSync(f.root).filter((name) =>
            name.startsWith(".release-restore-incomplete-"),
          ).length,
          1,
        );
    }
  }
});

test("runtime authorizations persist one immutable intent and outcome per fresh route nonce", async (t) => {
  const input = runtimeFixture(t);
  const f = host(t, input);
  const built = createCheckpoint({ kind: "build", ...f });
  built.descriptor = input.recoveryAuthorization.descriptor;
  await f.store.commit(built);
  const state = await f.store.inspect({ plan: f.plan });
  const observation = {
    operationId: f.plan.operation,
    planDigest: f.plan.authorizationDigest,
    remote: { checkpoints: state },
  };
  input.inspection = {
    ...observation,
    reconciliationDigest: digest(observation),
  };
  input.recoveryAuthorization.inspectionDigest =
    input.inspection.reconciliationDigest;
  const authorization = createQualificationRuntimeAuthorization(input);
  const operation = {
    ...f.operation,
    qualificationAttempt: {
      authorizationDigest: authorization.authorizationDigest,
      status: "intent",
    },
  };
  const intent = createCheckpoint({
    ...f,
    kind: "runtime-authorization",
    operation,
    authorization,
  });
  await f.store.commit(intent);
  await assert.rejects(
    f.store.commit(
      createCheckpoint({
        ...f,
        kind: "runtime-authorization",
        operation,
        authorization,
      }),
    ),
  );
  operation.qualificationAttempt.status = "passed";
  await f.store.commit(
    createCheckpoint({
      ...f,
      kind: "runtime-authorization",
      operation,
      authorization,
    }),
  );
  await assert.rejects(
    f.store.commit(
      createCheckpoint({
        ...f,
        kind: "runtime-authorization",
        operation,
        authorization,
      }),
    ),
  );
  assert.equal(
    (await f.store.inspect({ plan: f.plan })).checkpoints.filter(
      (entry) => entry.kind === "runtime-authorization",
    ).length,
    2,
  );
});

test("interrupted uploads never become committed candidates and cannot be overwritten", async (t) => {
  const f = host(t);
  const checkpoint = createCheckpoint({ kind: "intent", ...f });
  const request = {
    action: "stage",
    identity: f.identity,
    descriptor: checkpoint.descriptor,
  };
  assert.notEqual(f.raw(request, Buffer.from("partial")).status, 0);
  assert.notEqual(f.raw(request).status, 0);
  assert.equal((await f.store.inspect({ plan: f.plan })).checkpoints.length, 0);
});
test("host rejects traversal, symlinks, hardlinks, corruption and changed inspection", async (t) => {
  const f = host(t);
  const checkpoint = createCheckpoint({ kind: "build", ...f });
  const bad = structuredClone(checkpoint.descriptor);
  bad.files[0].name = "../plan.json";
  assert.notEqual(
    f.raw({ action: "stage", identity: f.identity, descriptor: bad }).status,
    0,
  );
  await f.store.commit(checkpoint);
  const inspected = await f.store.inspect({ plan: f.plan });
  await assert.rejects(
    f.store.restore({
      plan: f.plan,
      checkpointId: checkpoint.descriptor.checkpointId,
      inspectionDigest: "0".repeat(64),
      destination: join(f.root, "stale"),
    }),
  );
  const retained = join(
    f.storage,
    "release-checkpoints",
    f.plan.operation,
    checkpoint.descriptor.checkpointId,
  );
  writeFileSync(join(retained, "Situate.dmg"), "changed");
  await assert.rejects(f.store.inspect({ plan: f.plan }));
  writeFileSync(join(retained, "Situate.dmg"), "dmg");
  linkSync(join(retained, "Situate.dmg"), join(f.root, "hardlink"));
  await assert.rejects(f.store.inspect({ plan: f.plan }));
  assert.equal(inspected.checkpoints.length, 1);
  symlinkSync(f.storage, join(f.root, "linked-host"));
  const linked = checkpointProgram().replace(
    "ROOT = Path('/opt/situate')",
    `ROOT = Path(${JSON.stringify(join(f.root, "linked-host"))})`,
  );
  assert.notEqual(
    spawnSync("python3", ["-c", linked], {
      input: JSON.stringify({ action: "inspect", identity: f.identity }) + "\n",
    }).status,
    0,
  );
});
test("publication intentions and completed claims cannot authorize package restoration", async (t) => {
  for (const reason of ["publication", "completed"]) {
    const f = host(t);
    const checkpoint = createCheckpoint({ kind: "build", ...f });
    await f.store.commit(checkpoint);
    if (reason === "publication") {
      const operation = {
        ...f.operation,
        stages: [...f.operation.stages, { name: "github", status: "running" }],
      };
      await f.store.commit(
        createCheckpoint({ ...f, kind: "intent", operation }),
      );
    } else {
      writeFileSync(
        join(f.storage, "release-operations.jsonl"),
        ["claimed", "completed"]
          .map(
            (state) => `${JSON.stringify({ identity: f.identity, state })}\n`,
          )
          .join(""),
        { mode: 0o600 },
      );
    }
    const inspected = await f.store.inspect({ plan: f.plan });
    await assert.rejects(
      f.store.restore({
        plan: f.plan,
        checkpointId: checkpoint.descriptor.checkpointId,
        inspectionDigest: inspected.inspectionDigest,
        destination: join(f.root, "blocked"),
      }),
    );
    assert.equal(existsSync(join(f.root, "blocked", "manifest.json")), false);
  }
});

test("unknown notary journals block restoration", async (t) => {
  const f = host(t);
  const checkpoint = createCheckpoint({ kind: "build", ...f });
  await f.store.commit(checkpoint);
  writeFileSync(
    join(f.storage, "release-notary-journal.jsonl"),
    `${JSON.stringify({ operationId: "unknown", entry: { phase: "unexpected" } })}\n`,
    { mode: 0o600 },
  );
  const inspected = await f.store.inspect({ plan: f.plan });
  assert.equal(inspected.terminalNotary, false);
  await assert.rejects(
    f.store.restore({
      plan: f.plan,
      checkpointId: checkpoint.descriptor.checkpointId,
      inspectionDigest: inspected.inspectionDigest,
      destination: join(f.root, "unknown"),
    }),
  );
  assert.equal(existsSync(join(f.root, "unknown", "manifest.json")), false);
  writeFileSync(join(f.storage, "release-notary-journal.jsonl"), "truncated");
  await assert.rejects(f.store.inspect({ plan: f.plan }));
});
