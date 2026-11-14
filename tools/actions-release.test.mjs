import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  configureRelease,
  prepareCreate,
  preparePublish,
  requireProvisioned,
  resolveProducerRelease,
  runReleaseStage,
  stageEnvironment,
} from "./actions-release.mjs";

const source = "a".repeat(40);
const sourcePlan = {
  schemaVersion: 1,
  workflow: "create",
  repository: "getsituate/situate",
  source,
  base: "b".repeat(40),
  appImpact: true,
  lanes: [
    {
      id: "policy",
      host: "linux",
      suites: ["root-secrets"],
      reasons: ["Policy"],
    },
  ],
  authorizationDigest: "c".repeat(64),
};
function environment(t, workflow = "create") {
  const directory = mkdtempSync(join(tmpdir(), "situate-actions-release-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = JSON.stringify({ schemaVersion: 1 });
  return {
    CI: "true",
    RUNNER_TEMP: directory,
    GITHUB_RUN_ID: "42",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_REPOSITORY: "getsituate/situate",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_WORKFLOW_REF: `getsituate/situate/.github/workflows/${workflow === "create" ? "release-macos" : "publish-macos"}.yml@refs/heads/main`,
    GITHUB_EVENT_NAME: workflow === "create" ? "push" : "workflow_dispatch",
    PIPELINE_RELEASE_ENABLED: "true",
    SITUATE_RELEASE_CONFIG_JSON: config,
    SITUATE_RELEASE_CONFIG_SHA256: createHash("sha256")
      .update(config)
      .digest("hex"),
    WEBSITE_DEPLOY_HOST: "synthetic-destination",
    PIPELINE_PLAN: JSON.stringify(sourcePlan),
    PIPELINE_NEEDS: "{}",
  };
}
test("enabled delivery requires exact protected workflow and attested private configuration", (t) => {
  const env = environment(t);
  for (const changed of [
    { PIPELINE_RELEASE_ENABLED: "" },
    { GITHUB_REF_PROTECTED: "false" },
    { GITHUB_REPOSITORY: "attacker/fork" },
    { GITHUB_EVENT_NAME: "pull_request" },
    {
      GITHUB_WORKFLOW_REF:
        "getsituate/situate/.github/workflows/verify.yml@refs/heads/main",
    },
  ])
    assert.throws(
      () => requireProvisioned({ ...env, ...changed }, "create"),
      /blocked/,
    );
  assert.throws(
    () =>
      configureRelease(
        { ...env, SITUATE_RELEASE_CONFIG_SHA256: "f".repeat(64) },
        "create",
      ),
    /attestation/,
  );
  assert.throws(
    () => configureRelease({ ...env, WEBSITE_DEPLOY_HOST: "" }, "create"),
    /explicit destination/,
  );
  const { configuration, state } = configureRelease(env, "create");
  assert.equal(statSync(configuration).mode & 0o777, 0o600);
  assert.equal(statSync(state).mode & 0o777, 0o700);
  assert.equal(
    readFileSync(configuration, "utf8"),
    env.SITUATE_RELEASE_CONFIG_JSON,
  );
  assert.throws(() => configureRelease(env, "create"), /EEXIST/);
});
test("legacy recovery metadata remains readable without validating operational recovery", (t) => {
  const env = environment(t);
  const bytes = JSON.stringify({
    schemaVersion: 1,
    recoveryEvidence: { synthetic: true },
  });
  env.SITUATE_RELEASE_CONFIG_JSON = bytes;
  env.SITUATE_RELEASE_CONFIG_SHA256 = createHash("sha256")
    .update(bytes)
    .digest("hex");
  const { configuration } = configureRelease(env, "create");
  assert.equal(readFileSync(configuration, "utf8"), bytes);
});

test("creator retains original receipts and authorizes final staged plan without recovery evidence or rebinding", async (t) => {
  const env = environment(t);
  const receipts = [
    {
      source,
      planDigest: sourcePlan.authorizationDigest,
      lane: "policy",
      host: "linux",
      status: "passed",
      results: [{ id: "root-secrets", status: "passed", exitCode: 0 }],
    },
  ];
  const calls = [];
  const execute = (_command, args) => {
    calls.push(args);
    if (args[1] === "plan") {
      const original = JSON.parse(
        readFileSync(args[args.indexOf("--verification-plan") + 1], "utf8"),
      );
      assert.deepEqual(original, sourcePlan);
      return JSON.stringify({
        ...sourcePlan,
        operation: "actions-42-2",
        verificationPlan: original,
        authorizationDigest: "d".repeat(64),
      });
    }
  };
  const { state } = await prepareCreate(env, execute, async (plan) => {
    assert.deepEqual(plan, sourcePlan);
    return receipts;
  });
  assert.deepEqual(
    JSON.parse(readFileSync(join(state, "receipts.json"), "utf8")),
    receipts,
  );
  for (const stage of ["inputs", "build", "qualify", "github"])
    await runReleaseStage(env, "create", stage, execute);
  assert.equal(calls.length, 5);
  for (const args of calls.slice(1)) {
    assert.ok(args.includes("--receipts"));
    assert.equal(args[args.indexOf("--confirm") + 1], "d".repeat(64));
  }
  await assert.rejects(
    () => runReleaseStage(env, "create", "skip-qualification", execute),
    /Unsupported/,
  );
});
test("stage credentials exclude signing and GitHub access from private qualification setup", () => {
  const env = {
    PATH: "/tools",
    HOME: "/home/fixture",
    GH_TOKEN: "synthetic-gh",
    SSH_AUTH_SOCK: "/fixture/agent",
    APPLE_TEAM_ID: "SYNTHETIC",
    SITUATE_RELEASE_SSH_PRIVATE_KEY: "synthetic-ssh-key",
    SITUATE_RELEASE_SSH_KNOWN_HOSTS: "synthetic pinned host",
    APPLE_API_PRIVATE_KEY: "synthetic-apple",
    TAURI_SIGNING_PRIVATE_KEY: "synthetic-updater",
    AWS_SECRET_ACCESS_KEY: "synthetic-unrelated",
    SITUATE_RELEASE_CONFIG_JSON: "synthetic-private-config",
  };
  assert.deepEqual(stageEnvironment(env, "create", "qualify"), {
    PATH: "/tools",
    HOME: "/home/fixture",
    SITUATE_RELEASE_SSH_PRIVATE_KEY: "synthetic-ssh-key",
    SITUATE_RELEASE_SSH_KNOWN_HOSTS: "synthetic pinned host",
  });
  const signing = stageEnvironment(env, "create", "build");
  assert.equal(signing.SSH_AUTH_SOCK, undefined);
  assert.equal(signing.SITUATE_RELEASE_SSH_PRIVATE_KEY, "synthetic-ssh-key");
  assert.equal(signing.APPLE_API_PRIVATE_KEY, "synthetic-apple");
  assert.equal(signing.GH_TOKEN, undefined);
  const inputs = stageEnvironment(env, "create", "inputs");
  assert.equal(inputs.GH_TOKEN, "synthetic-gh");
  assert.equal(inputs.APPLE_API_PRIVATE_KEY, undefined);
  const publisher = stageEnvironment(env, "publish");
  assert.equal(publisher.GH_TOKEN, "synthetic-gh");
  assert.equal(publisher.APPLE_TEAM_ID, "SYNTHETIC");
  assert.equal(
    publisher.SITUATE_RELEASE_SSH_KNOWN_HOSTS,
    "synthetic pinned host",
  );
  assert.equal(publisher.TAURI_SIGNING_PRIVATE_KEY, undefined);
  assert.equal(publisher.AWS_SECRET_ACCESS_KEY, undefined);
});

test("hosted stages forward shared SSH inputs only to operations that need the host", async (t) => {
  for (const workflow of ["create", "publish"]) {
    const env = {
      ...environment(t, workflow),
      SITUATE_RELEASE_SSH_PRIVATE_KEY: "synthetic-private-key",
      SITUATE_RELEASE_SSH_KNOWN_HOSTS:
        "fixture.invalid ssh-ed25519 synthetic-pinned-host",
      SSH_AUTH_SOCK: "/synthetic/agent",
    };
    const { state } = configureRelease(env, workflow);
    writeFileSync(
      join(state, "plan.json"),
      JSON.stringify({ ...sourcePlan, workflow }),
      { mode: 0o600 },
    );
    const execute = (_command, _args, { env: child }) => {
      assert.equal(
        child.SITUATE_RELEASE_SSH_PRIVATE_KEY,
        env.SITUATE_RELEASE_SSH_PRIVATE_KEY,
      );
      assert.equal(
        child.SITUATE_RELEASE_SSH_KNOWN_HOSTS,
        env.SITUATE_RELEASE_SSH_KNOWN_HOSTS,
      );
      assert.equal(child.WEBSITE_SSH_IDENTITY, undefined);
      assert.equal(child.WEBSITE_SSH_KNOWN_HOSTS, undefined);
      assert.equal(child.SSH_AUTH_SOCK, undefined);
      assert.equal(child.SITUATE_RELEASE_CONFIG_JSON, undefined);
    };
    for (const stage of workflow === "create"
      ? ["inputs", "build", "qualify", "github"]
      : [undefined])
      await runReleaseStage(env, workflow, stage, execute);
    await assert.rejects(
      () =>
        runReleaseStage(
          env,
          workflow,
          workflow === "create" ? "inputs" : undefined,
          (...args) => {
            execute(...args);
            throw new Error("Synthetic child failure");
          },
        ),
      /Synthetic child failure/,
    );
    assert.deepEqual(readdirSync(env.RUNNER_TEMP), [
      `situate-${workflow}-42-2`,
    ]);
    if (workflow === "create")
      await runReleaseStage(
        env,
        workflow,
        "qualify",
        (_command, _args, { env: child }) => {
          assert.equal(
            child.SITUATE_RELEASE_SSH_PRIVATE_KEY,
            env.SITUATE_RELEASE_SSH_PRIVATE_KEY,
          );
          assert.equal(
            child.SITUATE_RELEASE_SSH_KNOWN_HOSTS,
            env.SITUATE_RELEASE_SSH_KNOWN_HOSTS,
          );
          assert.equal(child.APPLE_API_PRIVATE_KEY, undefined);
          assert.equal(child.GH_TOKEN, undefined);
          assert.equal(child.WEBSITE_SSH_IDENTITY, undefined);
          assert.equal(child.WEBSITE_SSH_KNOWN_HOSTS, undefined);
          assert.equal(child.SSH_AUTH_SOCK, undefined);
        },
      );
  }
});

test("build uses the shared certificate preparation and never forwards its raw value", async (t) => {
  const bytes = Buffer.from([0, 1, 2, 255]);
  const env = {
    ...environment(t),
    APPLE_DEVELOPER_ID_P12_BASE64: bytes.toString("base64"),
    APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-password",
  };
  const { state } = configureRelease(env, "create");
  writeFileSync(join(state, "plan.json"), JSON.stringify(sourcePlan), {
    mode: 0o600,
  });
  const paths = [];
  const execute = (_command, _args, { env: child }) => {
    const path = child.APPLE_DEVELOPER_ID_P12_FILE;
    paths.push(path);
    assert.deepEqual(readFileSync(path), bytes);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
    assert.equal(child.APPLE_DEVELOPER_ID_P12_BASE64, undefined);
    assert.equal(child.APPLE_DEVELOPER_ID_P12_PASSWORD, "synthetic-password");
  };
  await runReleaseStage(env, "create", "build", execute);
  assert.ok(paths.every((path) => !existsSync(path)));
  await assert.rejects(
    () =>
      runReleaseStage(env, "create", "build", (...args) => {
        execute(...args);
        throw new Error("Synthetic signing failure");
      }),
    /Synthetic signing failure/,
  );
  assert.ok(paths.every((path) => !existsSync(path)));
  await runReleaseStage(
    env,
    "create",
    "qualify",
    (_command, _args, { env: child }) => {
      assert.equal(child.APPLE_DEVELOPER_ID_P12_FILE, undefined);
      assert.equal(child.APPLE_DEVELOPER_ID_P12_BASE64, undefined);
      assert.equal(child.APPLE_DEVELOPER_ID_P12_PASSWORD, undefined);
    },
  );
  for (const encoded of [
    "not base64!",
    "YQ",
    "YQ==\n",
    "Zh==",
    "YQ__",
    Buffer.alloc(1024 * 1024 + 1).toString("base64"),
  ])
    await assert.rejects(
      () =>
        runReleaseStage(
          { ...env, APPLE_DEVELOPER_ID_P12_BASE64: encoded },
          "create",
          "build",
          () => assert.fail("Invalid certificate reached the child"),
        ),
      /canonical base64/,
    );
  await assert.rejects(
    () =>
      runReleaseStage(
        {
          ...env,
          APPLE_DEVELOPER_ID_P12_FILE: "/synthetic/existing.p12",
          SITUATE_RELEASE_SSH_PRIVATE_KEY: "synthetic-key",
          SITUATE_RELEASE_SSH_KNOWN_HOSTS: "synthetic-host",
        },
        "create",
        "build",
        () => assert.fail("Ambiguous certificate reached the child"),
      ),
    /only one/,
  );
  const existing = join(env.RUNNER_TEMP, "existing.p12");
  writeFileSync(existing, bytes, { mode: 0o600 });
  await runReleaseStage(
    {
      ...env,
      APPLE_DEVELOPER_ID_P12_BASE64: "",
      APPLE_DEVELOPER_ID_P12_FILE: existing,
    },
    "create",
    "build",
    (_command, _args, { env: child }) =>
      assert.equal(child.APPLE_DEVELOPER_ID_P12_FILE, existing),
  );
  assert.deepEqual(readFileSync(existing), bytes);
  assert.deepEqual(readdirSync(env.RUNNER_TEMP).sort(), [
    "existing.p12",
    "situate-create-42-2",
  ]);
});

test("publisher selects exact explicit release and calls standalone publish, never builder", async (t) => {
  const env = { ...environment(t, "publish"), PIPELINE_RELEASE_ID: "314" };
  const calls = [];
  const execute = (_command, args) => {
    calls.push(args);
    return JSON.stringify({
      schemaVersion: 1,
      workflow: "publish",
      repository: "getsituate/situate",
      releaseId: "314",
      authorizationDigest: "e".repeat(64),
    });
  };
  assert.equal(preparePublish(env, execute).release_id, "314");
  await runReleaseStage(env, "publish", undefined, execute);
  assert.ok(calls[0].includes("--release-id"));
  assert.ok(calls[1].includes("publish"));
  assert.ok(!calls[1].includes("--receipts"));
  assert.ok(!calls.flat().some((value) => /build|latest/.test(value)));
});
function producerFixture() {
  const run = {
    id: 42,
    run_attempt: 2,
    repository: { full_name: "getsituate/situate" },
    head_repository: { full_name: "getsituate/situate" },
    path: ".github/workflows/release-macos.yml",
    event: "push",
    head_branch: "main",
    conclusion: "success",
    head_sha: source,
  };
  const release = {
    id: 314,
    tag_name: "v2026.11.1",
    draft: false,
    published_at: "2026-11-13T00:00:00Z",
    assets: [{ id: 2718, name: "github-release.json", size: 200 }],
  };
  const evidence = {
    identity: {
      repository: "getsituate/situate",
      operationId: "actions-42-2",
      sourceRevision: source,
      tag: release.tag_name,
    },
  };
  const jobs = {
    total_count: 1,
    jobs: [{ name: "Create GitHub Release", conclusion: "success" }],
  };
  return { run, release, evidence, jobs, event: { workflow_run: run } };
}
test("automatic handoff binds exact repository, workflow attempt, source, operation and completed release", () => {
  const fixture = producerFixture();
  const execute = (_command, args) => {
    const url = args[1];
    if (url.includes("/jobs?")) return JSON.stringify(fixture.jobs);
    if (url.includes("releases/assets/"))
      return JSON.stringify(fixture.evidence);
    if (url.includes("releases?")) return JSON.stringify([[fixture.release]]);
    return JSON.stringify(fixture.run);
  };
  assert.equal(resolveProducerRelease(fixture.event, execute), "314");
  fixture.evidence.identity.sourceRevision = "f".repeat(40);
  assert.throws(
    () => resolveProducerRelease(fixture.event, execute),
    /differs/,
  );
  fixture.jobs.jobs[0].conclusion = "skipped";
  assert.equal(resolveProducerRelease(fixture.event, execute), null);
  fixture.run.path = ".github/workflows/verify.yml";
  assert.throws(
    () => resolveProducerRelease(fixture.event, execute),
    /Untrusted/,
  );
});
