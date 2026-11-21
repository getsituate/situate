import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
  rmSync,
  statSync,
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
  main as qualifyMain,
  requalifyCheckpoint,
} from "../../tools/release-checkpoint-qualify.mjs";
import {
  main as restoreMain,
  restoreQualifiedCheckpoint,
} from "../../tools/release-checkpoint-restore-qualified.mjs";
import {
  main as continueMain,
  continueQualifiedCheckpoint,
} from "../../tools/release-checkpoint-continue.mjs";
import {
  createCheckpoint,
  checkpointIdentity,
} from "../../tools/release-checkpoint.mjs";
import { checkpointProgram, createHostCheckpointStore } from "./checkpoint.mjs";

function host(
  t,
  fixture = checkpointFixture(t),
  storage = join(fixture.root, "host"),
) {
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
  const program = checkpointProgram()
    .replace(
      "ROOT = Path('/opt/situate')",
      `ROOT = Path(${JSON.stringify(storage)})`,
    )
    .replace(
      "\ncheckpoint_main()",
      "\nqualification_listener['owned_container'] = lambda state: None\ncheckpoint_main()",
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
test("checkpoint recovery CLI inputs must be owned bounded single-link files", async (t) => {
  const { root } = checkpointFixture(t);
  const source = join(root, "observation.json");
  const linked = join(root, "linked.json");
  const large = join(root, "large.json");
  const parent = join(root, "alias");
  writeFileSync(source, "{}");
  linkSync(source, linked);
  symlinkSync(root, parent);
  writeFileSync(large, Buffer.alloc(8 * 1024 * 1024 + 1, " "));
  await assert.rejects(
    continueMain(["--restore-authorization", linked]),
    /single-link regular file/,
  );
  await assert.rejects(
    qualifyMain(["--restore-authorization", large]),
    /metadata exceeds bound/,
  );
  await assert.rejects(
    restoreMain([
      "--inspection",
      join(parent, "observation.json"),
      "--plan",
      source,
    ]),
    /linked storage/,
  );
});

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
  const ancestor = join(f.root, "search-only");
  const shared = join(ancestor, "shared");
  mkdirSync(shared, { recursive: true });
  chmodSync(shared, 0o777);
  const destination = join(shared, "restored");
  chmodSync(ancestor, 0o100);
  try {
    await f.store.restore({
      plan: f.plan,
      checkpointId: ack.checkpointId,
      inspectionDigest: inspected.inspectionDigest,
      destination,
    });
  } finally {
    chmodSync(ancestor, 0o700);
  }
  assert.equal(statSync(destination).mode & 0o777, 0o700);
  assert.equal(
    statSync(join(destination, "manifest.json")).mode & 0o777,
    0o600,
  );
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
test("restore refuses linked ancestors before creating staging or opening a transfer", async (t) => {
  const { root, plan } = checkpointFixture(t);
  const parent = join(root, "parent");
  const actual = join(parent, "nested");
  const alias = join(root, "alias");
  mkdirSync(actual, { recursive: true, mode: 0o700 });
  symlinkSync(parent, alias);
  const store = createHostCheckpointStore(
    {},
    {
      start: () =>
        assert.fail("Transfer started before destination validation"),
    },
  );
  const restore = (parent) =>
    store.restore({ plan, destination: join(parent, "restore") });

  await assert.rejects(restore(join(alias, "nested")), /linked storage/);
  assert.deepEqual(readdirSync(actual), []);
});

test("restore commits only a complete validated successful transfer and never replaces a destination", async (t) => {
  for (const failure of [
    "metadata-only",
    "mid-asset",
    "bad-hash",
    "bad-manifest",
    "nonzero-exit",
    "staging-moved",
    "staging-exposed",
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
          if (["staging-moved", "staging-exposed"].includes(failure)) {
            const name = readdirSync(f.root).find((name) =>
              name.startsWith(".release-restore-incomplete-"),
            );
            assert(name);
            const staging = join(f.root, name);
            if (failure === "staging-moved")
              renameSync(staging, `${staging}-moved`);
            else chmodSync(staging, 0o755);
          }
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
      if (failure !== "existing") {
        const staging = readdirSync(f.root).filter((name) =>
          name.startsWith(".release-restore-incomplete-"),
        );
        assert.equal(staging.length, 1);
        if (["staging-moved", "staging-exposed"].includes(failure))
          assert.deepEqual(readdirSync(join(f.root, staging[0])), []);
      }
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
  const receipt = {
    sourceRevision: f.plan.source,
    manifestSha256: authorization.manifestSha256,
    runtimeAuthorizationDigest: authorization.authorizationDigest,
  };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  const checkpoint = () =>
    createCheckpoint({
      ...f,
      kind: "runtime-authorization",
      operation,
      authorization,
      recoveryAuthorization: input.recoveryAuthorization,
      inspection: input.inspection,
      receiptBytes,
    });
  await f.store.commit(checkpoint());
  await assert.rejects(f.store.commit(checkpoint()));
  operation.qualificationAttempt.status = "passed";
  operation.qualificationAttempt.receipt = {
    path: join(f.directory, "release-qualification.json"),
    receipt,
  };
  await f.store.commit(checkpoint());
  await assert.rejects(f.store.commit(checkpoint()));
  assert.equal(
    (await f.store.inspect({ plan: f.plan })).checkpoints.filter(
      (entry) => entry.kind === "runtime-authorization",
    ).length,
    2,
  );
});

test("qualified checkpoints survive loss of both producer roots and continue from an explicit fresh mapping without rebuilding", async (t) => {
  const input = runtimeFixture(t);
  const durable = checkpointFixture(t);
  const f = host(t, input, join(durable.root, "host"));
  const built = createCheckpoint({ ...input, kind: "build" });
  built.descriptor = input.recoveryAuthorization.descriptor;
  await f.store.commit(built);
  const runner = checkpointFixture(t);
  const firstDirectory = join(runner.root, "restored");
  const remote = async () => {
    const state = await f.store.inspect({ plan: input.plan });
    return {
      checkpoints: state,
      coordination: state.coordination,
      notarization: state.notarization,
      reservation: {
        status: "reserved",
        reservation: input.operation.reservation,
      },
      githubRelease: null,
    };
  };
  const inspected = await inspectWorkflow(runner.root, input.plan.operation, {
    plan: input.plan,
    adapters: { inspect: remote },
  });
  const restored = await restoreWorkflow(
    runner.root,
    input.plan.operation,
    inspected.reconciliationDigest,
    {
      plan: input.plan,
      checkpointId: built.descriptor.checkpointId,
      destination: firstDirectory,
      adapters: {
        inspect: remote,
        restore: async ({ destination }) => ({
          ...(await f.store.restore({
            plan: input.plan,
            checkpointId: built.descriptor.checkpointId,
            inspectionDigest: inspected.remote.checkpoints.inspectionDigest,
            destination,
          })),
          manifestSha256: input.recoveryAuthorization.manifestSha256,
        }),
      },
    },
  );
  const originalRecovery = restored.recoveryAuthorization;
  const authorization = createQualificationRuntimeAuthorization({
    ...input,
    inspection: inspected,
    recoveryAuthorization: originalRecovery,
  });
  let qualifications = 0;
  const receipt = {
    sourceRevision: input.plan.source,
    manifestSha256: authorization.manifestSha256,
    runtimeAuthorizationDigest: authorization.authorizationDigest,
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const qualified = await requalifyCheckpoint(runner.root, {
    recoveryAuthorization: originalRecovery,
    inspection: inspected,
    runtimeAuthorization: authorization,
    adapters: {
      inspection: { inspect: remote },
      store: f.store,
      qualify: async (_root, options) => {
        qualifications++;
        const path = join(options.directory, "release-qualification.json");
        writeFileSync(path, receiptBytes, { mode: 0o600 });
        return { path, receipt };
      },
    },
  });
  const state = await f.store.inspect({ plan: input.plan });
  const passed = state.checkpoints.find(
    (value) =>
      value.kind === "runtime-authorization" &&
      value.files.some((item) => item.name === "release-qualification.json"),
  );
  assert(passed);
  assert.equal(qualified.checkpointId, passed.checkpointId);
  assert.equal(
    passed.files.find((item) => item.name === "release-qualification.json")
      .sha256,
    digest(receiptBytes),
  );
  const { authorizationDigest: _, ...fields } = authorization;
  const priorFields = {
    ...fields,
    routeNonce: "qualification-incomplete",
    hostInspectionDigest: state.inspectionDigest,
  };
  const prior = { ...priorFields, authorizationDigest: digest(priorFields) };
  for (const status of ["intent", "unknown"]) {
    await f.store.commit(
      createCheckpoint({
        ...input,
        kind: "runtime-authorization",
        operation: {
          ...input.operation,
          qualificationAttempt: {
            status,
            authorizationDigest: prior.authorizationDigest,
          },
        },
        authorization: prior,
        ...{ recoveryAuthorization: originalRecovery, inspection: inspected },
      }),
    );
  }
  const after = await f.store.inspect({ plan: input.plan });
  const restore = (destination) =>
    f.store.restoreQualified({
      plan: input.plan,
      checkpointId: qualified.checkpointId,
      inspectionDigest: after.inspectionDigest,
      destination,
    });
  await assert.rejects(restore(join(durable.root, "missing-listener")));
  const listener = join(f.storage, ".qualification-host");
  const token = digest(Buffer.from(prior.routeNonce));
  const entry = join(listener, token);
  mkdirSync(entry, { recursive: true, mode: 0o700 });
  writeFileSync(join(listener, "lock"), "", { mode: 0o600 });
  const listenerState = {
    operationId: input.plan.operation,
    operationNonce: prior.routeNonce,
    config: {
      caddyContainer: "production",
      hostname: "example.com",
      hostPort: 8443,
      publicFeedSha256: "0".repeat(64),
      feedPath: "releases/current/update.json",
      certificateMount: "/data",
      certificatePath: "certificate.crt",
      keyPath: "certificate.key",
    },
    status: "serving",
    identityPath: `/releases/.qualification/${token}/identity.json`,
    identitySha256: "1".repeat(64),
    imageId: "image",
    certificateVolume: "volume",
    containerName: `situate-qualification-${token.slice(0, 32)}`,
  };
  const stateFile = join(entry, "state.json");
  const writeState = () =>
    writeFileSync(stateFile, JSON.stringify(listenerState), { mode: 0o600 });
  writeState();
  await assert.rejects(restore(join(durable.root, "serving-listener")));
  listenerState.status = "cleaned-retained";
  listenerState.uncertain = true;
  writeState();
  await assert.rejects(restore(join(durable.root, "uncertain-listener")));
  listenerState.uncertain = false;
  writeState();
  rmSync(input.root, { recursive: true, force: true });
  rmSync(runner.root, { recursive: true, force: true });
  assert.equal(existsSync(input.root), false);
  assert.equal(existsSync(runner.root), false);
  const fresh = checkpointFixture(t);
  const bootstrap = await f.store.bootstrap({
    operationId: input.plan.operation,
    destination: join(fresh.root, "bootstrap"),
  });
  const plan = JSON.parse(readFileSync(bootstrap.planFile));
  assert.deepEqual(plan, input.plan);
  const current = await inspectWorkflow(fresh.root, plan.operation, {
    plan,
    adapters: { inspect: remote },
  });
  const destination = join(fresh.root, "qualified");
  const recovered = await restoreQualifiedCheckpoint(fresh.root, {
    plan,
    checkpointId: passed.checkpointId,
    destination,
    inspection: current,
    confirmation: current.reconciliationDigest,
    adapters: { inspection: { inspect: remote }, store: f.store },
  });
  assert.deepEqual(recovered.recoveryAuthorization, originalRecovery);
  assert.deepEqual(recovered.qualificationInspection, inspected);
  assert.deepEqual(recovered.runtimeAuthorization, authorization);
  assert.equal(recovered.recoveryAuthorization.directory, firstDirectory);
  assert.notEqual(recovered.directory, firstDirectory);
  assert.equal(statSync(recovered.mappingFile).mode & 0o077, 0);
  assert.deepEqual(
    readFileSync(join(destination, "configuration.json")),
    Buffer.from(input.configurationBytes),
  );
  assert.deepEqual(
    readFileSync(join(destination, "release-qualification.json")),
    receiptBytes,
  );
  let publications = 0;
  let completed = false;
  const continuation = {
    recoveryAuthorization: recovered.recoveryAuthorization,
    qualificationInspection: recovered.qualificationInspection,
    runtimeAuthorization: recovered.runtimeAuthorization,
    restoredDirectory: recovered.directory,
    publicationInspection: current,
    confirmation: current.reconciliationDigest,
    adapters: {
      inspection: { inspect: remote },
      store: f.store,
      coordinator: {
        inspect: async () => (await f.store.inspect({ plan })).coordination,
        complete: async () => {
          const terminal = await f.store.inspect({ plan });
          assert(terminal.checkpoints.some((value) => value.kind === "intent"));
          completed = true;
        },
      },
      evidence: ({ directory }) => {
        assert.equal(directory, destination);
        assert.deepEqual(
          readFileSync(join(directory, "release-qualification.json")),
          receiptBytes,
        );
        return { files: {}, evidence: {} };
      },
      createRelease: async (request, { authorize }) => {
        publications++;
        await authorize({ identity: request.identity });
        writeFileSync(
          request.journalPath,
          JSON.stringify({
            schemaVersion: 1,
            state: "complete",
            identity: request.identity,
            releaseId: 77,
            evidenceSha256: "a".repeat(64),
          }),
          { mode: 0o600 },
        );
        return {
          identity: { ...request.identity, releaseId: 77 },
          evidenceSha256: "a".repeat(64),
        };
      },
    },
  };
  writeFileSync(join(destination, "release-qualification.json"), "changed");
  await assert.rejects(continueQualifiedCheckpoint(fresh.root, continuation));
  assert.equal(publications, 0);
  writeFileSync(join(destination, "release-qualification.json"), receiptBytes);
  assert.equal(
    (await continueQualifiedCheckpoint(fresh.root, continuation)).status,
    "created",
  );
  assert.equal(publications, 1);
  assert.equal(qualifications, 1);
  assert.equal(completed, true);
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(destination, "original-recovery-authorization.json")),
    ),
    originalRecovery,
  );
});

test("qualified restoration rejects interrupted, unknown and legacy incomplete attempts without synthesizing authorization inputs", async (t) => {
  for (const status of ["intent", "unknown", "legacy-passed"]) {
    const input = runtimeFixture(t);
    const f = host(t, input);
    const build = createCheckpoint({ ...input, kind: "build" });
    build.descriptor = input.recoveryAuthorization.descriptor;
    await f.store.commit(build);
    const state = await f.store.inspect({ plan: f.plan });
    const observation = {
      operationId: f.plan.operation,
      planDigest: f.plan.authorizationDigest,
      remote: { checkpoints: state },
    };
    const inspection = {
      ...observation,
      reconciliationDigest: digest(observation),
    };
    const recoveryAuthorization = {
      ...input.recoveryAuthorization,
      directory: f.directory,
      inspectionDigest: inspection.reconciliationDigest,
    };
    const authorization = createQualificationRuntimeAuthorization({
      ...input,
      inspection,
      recoveryAuthorization,
    });
    const operation = {
      ...f.operation,
      qualificationAttempt: {
        status: "intent",
        authorizationDigest: authorization.authorizationDigest,
      },
    };
    const receipt = {
      sourceRevision: f.plan.source,
      manifestSha256: authorization.manifestSha256,
      runtimeAuthorizationDigest: authorization.authorizationDigest,
    };
    const checkpoint = () =>
      createCheckpoint({
        ...f,
        kind: "runtime-authorization",
        operation,
        authorization,
        inspection,
        recoveryAuthorization,
        receiptBytes: Buffer.from(JSON.stringify(receipt)),
      });
    let selected = checkpoint();
    await f.store.commit(selected);
    if (status !== "intent") {
      operation.qualificationAttempt.status =
        status === "unknown" ? "unknown" : "passed";
      if (status === "legacy-passed")
        operation.qualificationAttempt.receipt = {
          path: join(f.directory, "release-qualification.json"),
          receipt,
        };
      selected = checkpoint();
      if (status === "legacy-passed") {
        const legacy = new Set([
          "plan.json",
          "configuration.json",
          "operation.json",
          "runtime-authorization.json",
        ]);
        selected.files = selected.files.filter((item) => legacy.has(item.name));
        selected.descriptor.files = selected.descriptor.files.filter((item) =>
          legacy.has(item.name),
        );
      }
      await f.store.commit(selected);
    }
    const current = await f.store.inspect({ plan: f.plan });
    const destination = join(f.root, "not-qualified");
    await assert.rejects(
      f.store.restoreQualified({
        plan: f.plan,
        checkpointId: selected.descriptor.checkpointId,
        inspectionDigest: current.inspectionDigest,
        destination,
      }),
    );
    assert.equal(existsSync(destination), false);
  }
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
