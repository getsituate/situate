import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readBaseline,
  readConfiguration,
  inspectCandidateReservation,
  publicationEnvironment,
  productionStages,
} from "./pipeline-operations.mjs";
import { digest, sealPlan, operationDirectory } from "./pipeline-state.mjs";
import { checkpointFixture } from "./release-checkpoint-fixtures.mjs";
import { notesForCatalog } from "./github-release.mjs";

test("baseline lookup rejects symbolic source names before reading release state", async () => {
  await assert.rejects(
    readBaseline("unused", { source: "HEAD" }),
    /exact source commit/,
  );
});

test("publication creates a private download root and rejects linked storage", async (t) => {
  const f = checkpointFixture(t);
  const artifactRoot = join(f.root, "downloads");
  const bytes = JSON.stringify({ schemaVersion: 1, artifactRoot });
  const plan = {
    operation: "publish-synthetic",
    workflow: "publish",
    destination: "release@fixture.invalid",
    configurationDigest: digest(bytes),
  };
  const calls = [];
  const stages = await productionStages(f.root, plan, {
    environment: { CI: "true", SITUATE_RELEASE_CONFIG_JSON: bytes },
    publicationAdapter: {
      downloadRelease: async ({ destination }) => {
        calls.push(destination);
        mkdirSync(destination, { mode: 0o700 });
        return { receipt: {} };
      },
    },
  });
  await stages.download();
  assert.deepEqual(calls, [join(artifactRoot, plan.operation)]);
  assert.equal(lstatSync(artifactRoot).mode & 0o777, 0o700);
  rmSync(artifactRoot, { recursive: true });
  symlinkSync(f.directory, artifactRoot);
  await assert.rejects(stages.download(), /owned private directory/);
  assert.equal(calls.length, 1);
});

test("hosted GitHub creation bypasses recovery; legacy local creation retains its checkpoints", async (t) => {
  for (const path of ["ordinary", "reconcile", "hosted"])
    for (const failure of path === "hosted"
      ? ["none"]
      : ["before-commit", "lost-ack", "none"]) {
      const f = checkpointFixture(t);
      const configurationBytes = JSON.stringify({
        ...f.configuration,
        artifactRoot: f.root,
      });
      const plan = sealPlan({
        ...f.plan,
        configurationDigest: digest(configurationBytes),
      });
      const directory = operationDirectory(f.root, plan.operation);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(join(directory, "sealed-plan.json"), JSON.stringify(plan), {
        mode: 0o600,
      });
      const inputs = join(f.root, `${plan.operation}-inputs`);
      mkdirSync(inputs, { mode: 0o700 });
      for (const name of [
        "release-inputs.json",
        "situate-release-history.json",
      ])
        writeFileSync(
          join(inputs, name),
          readFileSync(join(f.directory, name)),
        );
      const operation = {
        ...f.operation,
        plan,
        stages: [
          {
            name: "build",
            status: "passed",
            output: { directory: f.directory },
          },
          {
            name: "qualify",
            status: "passed",
            output: { receipt: "synthetic" },
          },
          {
            name: "github",
            status: path === "reconcile" ? "unknown" : "running",
          },
        ],
      };
      const calls = [];
      const retained = [];
      const stages = await productionStages(f.root, plan, {
        environment: {
          SITUATE_RELEASE_CONFIG_JSON: configurationBytes,
          ...(path === "hosted" ? { PIPELINE_FRESH_RELEASE: "1" } : {}),
        },
        checkpointStore: {
          commit: async (value) => {
            const snapshot = JSON.parse(
              value.files.find((file) => file.name === "operation.json").bytes,
            );
            assert.equal(snapshot.publicationJournal.state, "complete");
            assert.equal(snapshot.stages.at(-1).status, "passed");
            calls.push("checkpoint");
            if (failure === "before-commit")
              throw new Error("terminal checkpoint failed");
            retained.push(snapshot);
            if (failure === "lost-ack")
              throw new Error("terminal acknowledgement lost");
            return {
              durable: true,
              checkpointId: value.descriptor.checkpointId,
            };
          },
        },
        publicationAdapter: {
          coordinator: { complete: async () => calls.push("complete") },
          evidence: () => ({ files: {}, evidence: {} }),
          createRelease: async (request, options) => {
            assert.equal(options.reconcile, path === "reconcile");
            calls.push("publish");
            writeFileSync(
              request.journalPath,
              JSON.stringify({
                schemaVersion: 1,
                state: "complete",
                identity: request.identity,
                releaseId: 42,
                evidenceSha256: "f".repeat(64),
              }),
              { mode: 0o600 },
            );
            return {
              identity: { ...request.identity, releaseId: 42 },
              release: { id: 42 },
              evidenceSha256: "f".repeat(64),
            };
          },
        },
      });
      const invoke = () =>
        path === "reconcile"
          ? stages.reconcile({ operation, observation: {} })
          : stages.github({ operation });
      if (path === "hosted") {
        assert.equal(stages.persistIntent, undefined);
        assert.equal(stages.persistOutcome, undefined);
        assert.equal((await invoke()).releaseId, 42);
        assert.deepEqual(calls, ["publish"]);
      } else if (failure !== "none") {
        await assert.rejects(invoke(), /terminal/);
        assert.deepEqual(calls, ["publish", "checkpoint"]);
        assert.equal(retained.length, failure === "lost-ack" ? 1 : 0);
        assert.notEqual(operation.stages.at(-1).status, "passed");
      } else {
        await invoke();
        await stages.persistOutcome({ operation, stage: "github" });
        assert.deepEqual(calls, ["publish", "checkpoint", "complete"]);
        assert.equal(retained.length, 1);
      }
    }
});

test("production stages do not require or forward operational recovery evidence", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-pipeline-stages-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const publisher = join(root, "infrastructure", "releases");
  mkdirSync(publisher, { recursive: true });
  writeFileSync(
    join(publisher, "publish.mjs"),
    `import assert from "node:assert/strict";
assert.equal(process.argv[2], "publish");
assert.ok(!process.argv.includes("--recovery-evidence"));
assert.ok(process.argv.includes("--release-receipt"));
assert.ok(process.argv.includes("--confirm"));
console.log("synthetic publication");
`,
  );
  for (const recoveryEvidence of [
    undefined,
    { synthetic: true },
    join(root, "missing-legacy-evidence.json"),
  ]) {
    const bytes = JSON.stringify({
      schemaVersion: 1,
      recoveryEvidence,
      artifactRoot: root,
    });
    const environment = { CI: "true", SITUATE_RELEASE_CONFIG_JSON: bytes };
    const plan = {
      operation: "synthetic-operation",
      configurationDigest: digest(bytes),
      destination: "release@fixture.invalid",
      releaseId: 42,
      release: { identity: { version: "2026.11.1" } },
    };
    for (const workflow of ["create", "publish"]) {
      const stages = await productionStages(
        root,
        { ...plan, workflow },
        { environment },
      );
      assert.equal(typeof stages.build, "function");
      assert.equal(typeof stages.qualify, "function");
      if (workflow === "publish")
        assert.deepEqual(
          await stages.promote({
            operation: {
              stages: [
                {
                  name: "verify",
                  status: "passed",
                  output: { directory: root },
                },
              ],
            },
          }),
          { releaseId: 42, outputSha256: digest("synthetic publication\n") },
        );
    }
    assert.equal(existsSync(join(root, ".release-operations")), false);
    await assert.rejects(
      productionStages(
        root,
        { ...plan, configurationDigest: "0".repeat(64) },
        { environment },
      ),
      /private, reviewed release configuration/,
    );
  }
});

test("publication forwards public verification identity and GitHub reads but no signing or provider keys", () => {
  const allowed = {
    PATH: "/synthetic/bin",
    APPLE_TEAM_ID: "TEAM123456",
    SITUATE_UPDATER_PUBLIC_KEY: "synthetic-public-key",
    GH_TOKEN: "synthetic-read-token",
    GH_CONFIG_DIR: "/synthetic/gh",
  };
  assert.deepEqual(
    publicationEnvironment({
      ...allowed,
      APPLE_API_PRIVATE_KEY: "synthetic-private-key",
      APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-password",
      TAURI_SIGNING_PRIVATE_KEY: "synthetic-signing-key",
      OPENAI_API_KEY: "synthetic-provider-key",
      SITUATE_RELEASE_CONFIG_JSON: "synthetic-private-configuration",
    }),
    allowed,
  );
});

test("GitHub notes group current English entries by category and keep their order within each category", () => {
  const notes = notesForCatalog({
    installedVersion: "2026.11.1",
    releases: [
      {
        version: "2026.11.1",
        locales: {
          en: {
            title: "Changes",
            entries: [
              {
                type: "fixed",
                title: "Drafts",
                paragraphs: ["Resume drafts."],
              },
              {
                type: "new",
                title: "Search",
                paragraphs: ["Find notes.", "Keep filters."],
              },
              {
                type: "important",
                title: "Back up",
                paragraphs: ["Keep a copy of your workspace."],
              },
              {
                type: "new",
                title: "Filters",
                paragraphs: ["Filter by date."],
              },
              {
                type: "changed",
                title: "History",
                paragraphs: ["See the latest changes first."],
              },
            ],
          },
          de: {
            title: "Änderungen",
            entries: [{ title: "Suche", paragraphs: ["Synthetischer Text."] }],
          },
          fr: {
            title: "Changements",
            entries: [
              { title: "Recherche", paragraphs: ["Texte synthétique."] },
            ],
          },
        },
      },
      {
        version: "2026.10.1",
        locales: {
          en: {
            title: "Changes",
            entries: [{ title: "Older entry", paragraphs: ["Older change."] }],
          },
        },
      },
    ],
    emptyReason: "Internal synthetic reason",
  });
  assert.equal(
    notes,
    [
      "## Important",
      "### Back up",
      "Keep a copy of your workspace.",
      "## Features",
      "### Search",
      "Find notes.",
      "Keep filters.",
      "### Filters",
      "Filter by date.",
      "## Changes",
      "### History",
      "See the latest changes first.",
      "## Fixes",
      "### Drafts",
      "Resume drafts.",
    ].join("\n\n"),
  );
  assert.equal(
    notesForCatalog({
      installedVersion: "2026.11.1",
      releases: [
        {
          version: "2026.11.1",
          locales: {
            en: { title: "Changes", entries: [] },
            de: {
              title: "Änderungen",
              entries: [{ title: "Suche", paragraphs: ["Nur Deutsch."] }],
            },
          },
        },
      ],
    }),
    "",
  );
});

test("reservation inspection reconstructs interrupted identity from durable intent or tags", async () => {
  const reservation = {
    schemaVersion: 1,
    kind: "situate-release-reservation",
    operationId: "candidate-1",
    sourceRevision: "a".repeat(40),
    fragmentDigest: "b".repeat(64),
    generatedInputDigest: "c".repeat(64),
    version: "2026.11.1",
    tag: "v2026.11.1",
    buildSequence: 10000,
    buildNumber: "1.0.0",
  };
  const request = {
    operationId: reservation.operationId,
    sourceRevision: reservation.sourceRevision,
    fragmentDigest: reservation.fragmentDigest,
  };
  const adapter = (pending, tags = []) => ({
    withAllocatorLock: (action) => action({ pending: async () => pending }),
    readInventory: async () => ({ complete: true, tags }),
  });
  assert.deepEqual(await inspectCandidateReservation(request, adapter(null)), {
    status: "absent",
    reservation: null,
  });
  assert.deepEqual(
    await inspectCandidateReservation(request, adapter(reservation)),
    { status: "unresolved", reservation },
  );
  assert.deepEqual(
    await inspectCandidateReservation(
      request,
      adapter(null, [{ reservation }]),
    ),
    { status: "reserved", reservation },
  );
  await assert.rejects(
    inspectCandidateReservation(
      request,
      adapter({ ...reservation, sourceRevision: "d".repeat(40) }),
    ),
    /different workflow inputs/,
  );
  await assert.rejects(
    inspectCandidateReservation(
      request,
      adapter(null, [{ reservation }, { reservation }]),
    ),
    /Multiple reservations/,
  );
});

test("inline release configuration uses identical dotenv and hosted environment bytes without materializing files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-pipeline-config-env-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes =
    '{"schemaVersion":1,"recoveryEvidence":{"synthetic":"$(not-a-command)"}}\n';
  writeFileSync(
    join(root, ".env"),
    `SITUATE_RELEASE_CONFIG_JSON='${bytes}'\nUNRELATED_SECRET=private-sentinel\n`,
    { mode: 0o600 },
  );
  const local = readConfiguration(root, undefined, { environment: {} });
  const hosted = readConfiguration(root, undefined, {
    environment: { CI: "true", SITUATE_RELEASE_CONFIG_JSON: bytes },
  });
  const expected = {
    bytes,
    sha256: digest(bytes),
    configuration: {
      schemaVersion: 1,
      recoveryEvidence: { synthetic: "$(not-a-command)" },
    },
  };
  assert.deepEqual(local, expected);
  assert.deepEqual(hosted, expected);
  assert.equal(existsSync(join(root, ".release-operations")), false);
  assert.equal(JSON.stringify(local).includes("private-sentinel"), false);
  assert.notEqual(
    readConfiguration(root, undefined, {
      environment: { SITUATE_RELEASE_CONFIG_JSON: bytes.trim() },
    }).sha256,
    local.sha256,
  );
});

test("configuration precedence preserves explicit empty values and rejects ambiguous or secret-bearing invalid JSON", (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-pipeline-config-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "config.json");
  const bytes = '{"schemaVersion":1,"recoveryEvidence":{"synthetic":true}}';
  writeFileSync(file, bytes, { mode: 0o600 });
  writeFileSync(join(root, ".env"), `SITUATE_RELEASE_CONFIG_FILE=${file}\n`, {
    mode: 0o600,
  });
  assert.equal(
    readConfiguration(root, undefined, { environment: {} }).file,
    file,
  );
  assert.equal(
    readConfiguration(root, undefined, {
      environment: { SITUATE_RELEASE_CONFIG_JSON: bytes },
    }).sha256,
    digest(bytes),
  );
  assert.equal(
    readConfiguration(root, file, {
      environment: { SITUATE_RELEASE_CONFIG_JSON: "invalid" },
    }).file,
    file,
  );
  assert.throws(
    () =>
      readConfiguration(root, undefined, {
        environment: { SITUATE_RELEASE_CONFIG_JSON: "" },
      }),
    /must contain a release configuration/,
  );
  assert.equal(
    readConfiguration(root, undefined, {
      environment: { SITUATE_RELEASE_CONFIG_FILE: "" },
    }),
    null,
  );
  assert.equal(
    readConfiguration(root, undefined, { environment: { CI: "true" } }),
    null,
  );
  assert.throws(
    () =>
      readConfiguration(root, undefined, {
        environment: {
          SITUATE_RELEASE_CONFIG_JSON: bytes,
          SITUATE_RELEASE_CONFIG_FILE: file,
        },
      }),
    /not both/,
  );
  assert.throws(
    () =>
      readConfiguration(root, undefined, {
        environment: {
          SITUATE_RELEASE_CONFIG_JSON: '{"PRIVATE_SENTINEL":invalid}',
        },
      }),
    (error) => {
      assert.equal(
        error.message,
        "Release configuration must contain valid JSON",
      );
      assert.equal(error.message.includes("PRIVATE_SENTINEL"), false);
      return true;
    },
  );
});

test("release configuration is explicit private data bound to exact bytes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-pipeline-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "config.json");
  assert.equal(readConfiguration(root, file), null);
  const bytes = '{"schemaVersion":1,"recoveryEvidence":{"schemaVersion":1}}\n';
  writeFileSync(file, bytes, { mode: 0o600 });
  assert.equal(readConfiguration(root, file).sha256, digest(bytes));
  chmodSync(file, 0o644);
  assert.throws(() => readConfiguration(root, file), /private regular file/);
  chmodSync(file, 0o600);
  writeFileSync(file, '{"schemaVersion":99}\n');
  assert.throws(() => readConfiguration(root, file), /Unsupported/);
});
