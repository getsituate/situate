import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
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
  prepareReleaseDependencies,
  requireProvisioned,
  runReleaseStage,
  stageEnvironment,
} from "./actions-release.mjs";
import { operationDirectory, sealPlan } from "./pipeline-state.mjs";

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
test("full and toolchain-only release preparation install all declared Rust components", () => {
  const directory = new URL("../", import.meta.url).pathname;
  const declared = JSON.parse(
    readFileSync(join(directory, "client/rust-toolchain.toml"), "utf8").match(
      /components\s*=\s*(\[[^\]]*\])/,
    )[1],
  );
  assert.ok(declared.includes("llvm-tools"));
  for (const toolchainOnly of [false, true]) {
    const calls = [];
    prepareReleaseDependencies(directory, (...args) => calls.push(args), {
      toolchainOnly,
    });
    const install = calls.find(
      ([, args]) => args.includes("toolchain") && args.includes("install"),
    )[1];
    for (const component of declared)
      assert.ok(
        install.some(
          (arg, index) =>
            arg === "--component" && install[index + 1] === component,
        ),
        `${toolchainOnly}: ${component}`,
      );
    if (toolchainOnly)
      assert.ok(
        calls.every(
          ([, args]) =>
            !args.includes("fetch") && !args.includes("tools/npm-ci.mjs"),
        ),
      );
  }
});

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

function recordGitHubStage(root, plan, status = "passed") {
  const directory = operationDirectory(root, plan.operation);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "operation.json"),
    JSON.stringify({
      schemaVersion: 1,
      operationId: plan.operation,
      plan,
      status: "paused",
      stages: [{ name: "github", status, output: { releaseId: 314 } }],
    }),
  );
}

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
  const sealed = sealPlan({
    ...sourcePlan,
    operation: "actions-42-2",
    verificationPlan: sourcePlan,
  });
  const execute = (_command, args, options) => {
    assert.equal(options.env.PIPELINE_FRESH_RELEASE, "1");
    calls.push(args);
    if (args[1] === "plan") {
      const original = JSON.parse(
        readFileSync(args[args.indexOf("--verification-plan") + 1], "utf8"),
      );
      assert.deepEqual(original, sourcePlan);
      return JSON.stringify(sealed);
    }
    if (args.at(-1) === "github") recordGitHubStage(env.RUNNER_TEMP, sealed);
  };
  const { state } = await prepareCreate(env, execute, async (plan) => {
    assert.deepEqual(plan, sourcePlan);
    return receipts;
  });
  assert.deepEqual(
    JSON.parse(readFileSync(join(state, "receipts.json"), "utf8")),
    receipts,
  );
  for (const stage of ["inputs", "build", "qualify"])
    assert.equal(
      await runReleaseStage(env, "create", stage, execute),
      undefined,
    );
  assert.deepEqual(
    await runReleaseStage(env, "create", "github", execute, env.RUNNER_TEMP),
    { release_id: "314" },
  );
  assert.equal(calls.length, 5);
  for (const args of calls.slice(1)) {
    assert.ok(args.includes("--receipts"));
    assert.equal(
      args[args.indexOf("--confirm") + 1],
      sealed.authorizationDigest,
    );
  }
  recordGitHubStage(env.RUNNER_TEMP, sealed, "failed");
  await assert.rejects(
    runReleaseStage(env, "create", "github", () => {}, env.RUNNER_TEMP),
    /Missing completed GitHub Release identity/,
  );
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
    SITUATE_POSTHOG_TOKEN: "synthetic-public-project-token",
    TAURI_SIGNING_PRIVATE_KEY: "synthetic-updater",
    AWS_SECRET_ACCESS_KEY: "synthetic-unrelated",
    SITUATE_RELEASE_CONFIG_JSON: "synthetic-private-config",
    SITUATE_WINDOWS_UPDATER_PUBLIC_KEY: "synthetic-windows-key",
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
  assert.equal(signing.SITUATE_POSTHOG_TOKEN, "synthetic-public-project-token");
  const inputs = stageEnvironment(env, "create", "inputs");
  assert.equal(inputs.GH_TOKEN, "synthetic-gh");
  assert.equal(inputs.APPLE_API_PRIVATE_KEY, undefined);
  assert.equal(inputs.SITUATE_POSTHOG_TOKEN, undefined);
  const publisher = stageEnvironment(env, "publish");
  assert.equal(publisher.GH_TOKEN, "synthetic-gh");
  assert.equal(publisher.APPLE_TEAM_ID, "SYNTHETIC");
  assert.equal(
    publisher.SITUATE_WINDOWS_UPDATER_PUBLIC_KEY,
    "synthetic-windows-key",
  );
  assert.equal(
    publisher.SITUATE_RELEASE_SSH_KNOWN_HOSTS,
    "synthetic pinned host",
  );
  assert.equal(publisher.TAURI_SIGNING_PRIVATE_KEY, undefined);
  assert.equal(publisher.SITUATE_POSTHOG_TOKEN, undefined);
  assert.equal(publisher.AWS_SECRET_ACCESS_KEY, undefined);
});

test("build stages retain hosted runner context without forwarding unrelated credentials", () => {
  const build = stageEnvironment(
    {
      CI: "true",
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "github-hosted",
      APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-password",
      GH_TOKEN: "unrelated-secret",
      OTHER_SECRET: "unrelated-secret",
    },
    "create",
    "build",
  );
  assert.deepEqual(build, {
    CI: "true",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-password",
  });
});

test("compiler cache opt-in reaches only trusted hosted creation builds", () => {
  const env = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "macOS",
    RUNNER_ARCH: "ARM64",
    HOME: "/Users/runner",
    GITHUB_REPOSITORY: "getsituate/situate",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_EVENT_NAME: "push",
    GITHUB_WORKFLOW_REF:
      "getsituate/situate/.github/workflows/release-macos.yml@refs/heads/main",
    GITHUB_SHA: "a".repeat(40),
    SITUATE_RELEASE_BUILD_CACHE: "1",
    SITUATE_RELEASE_CACHE_SOCKET: "/runner-temp/situate-rc-21-1/s",
    RUNNER_TEMP: "/runner-temp",
    GITHUB_RUN_ID: "21",
    GITHUB_RUN_ATTEMPT: "1",
    CARGO_HOME: "/foreign/cargo",
    RUSTC_WRAPPER: "/foreign/wrapper",
    SCCACHE_DIR: "/foreign/cache",
    SCCACHE_BUCKET: "private",
    SCCACHE_S3_KEY_PREFIX: "private",
    AWS_SECRET_ACCESS_KEY: "synthetic",
  };
  const build = stageEnvironment(env, "create", "build");
  assert.equal(build.SITUATE_RELEASE_BUILD_CACHE, "1");
  assert.equal(
    build.SITUATE_RELEASE_CACHE_SOCKET,
    env.SITUATE_RELEASE_CACHE_SOCKET,
  );
  assert.equal(build.GITHUB_WORKFLOW_REF, env.GITHUB_WORKFLOW_REF);
  assert.equal(
    build.CARGO_HOME,
    "/Users/runner/Library/Caches/situate/release-build-v1/cargo",
  );
  for (const name of [
    "RUSTC_WRAPPER",
    "SCCACHE_DIR",
    "SCCACHE_BUCKET",
    "SCCACHE_S3_KEY_PREFIX",
    "AWS_SECRET_ACCESS_KEY",
  ])
    assert.equal(build[name], undefined);
  for (const stage of ["inputs", "qualify", "github", undefined]) {
    const child = stageEnvironment(env, "create", stage);
    assert.equal(child.SITUATE_RELEASE_BUILD_CACHE, undefined);
    assert.equal(child.SITUATE_RELEASE_CACHE_SOCKET, undefined);
  }
  assert.equal(
    stageEnvironment(env, "publish").SITUATE_RELEASE_BUILD_CACHE,
    undefined,
  );
  assert.equal(
    stageEnvironment(
      { ...env, RUNNER_ENVIRONMENT: "self-hosted" },
      "create",
      "build",
    ).SITUATE_RELEASE_BUILD_CACHE,
    undefined,
  );
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
    const plan = sealPlan({
      ...sourcePlan,
      workflow,
      operation: "actions-42-2",
    });
    writeFileSync(join(state, "plan.json"), JSON.stringify(plan), {
      mode: 0o600,
    });
    if (workflow === "create") recordGitHubStage(state, plan);
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
      await runReleaseStage(env, workflow, stage, execute, state);
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
test("automatic publication only accepts an exact release from the same run and source", (t) => {
  for (const [operationId, sourceRevision, accepted] of [
    ["actions-42-2", source, true],
    ["actions-42-1", source, true],
    ["actions-42-3", source, false],
    ["actions-417-2", source, false],
    ["actions-42-2", "f".repeat(40), false],
  ]) {
    const env = {
      ...environment(t),
      GITHUB_SHA: source,
      PIPELINE_RELEASE_ID: "314",
    };
    const execute = (_command, args) => {
      assert.equal(args[args.indexOf("--release-id") + 1], "314");
      return JSON.stringify({
        workflow: "publish",
        repository: "getsituate/situate",
        releaseId: "314",
        release: { identity: { operationId, sourceRevision } },
      });
    };
    if (accepted) assert.equal(preparePublish(env, execute).release_id, "314");
    else
      assert.throws(
        () => preparePublish(env, execute),
        /differs from its producer/,
      );
  }
  const env = environment(t, "publish");
  assert.throws(
    () => requireProvisioned({ ...env, GITHUB_EVENT_NAME: "push" }, "publish"),
    /blocked/,
  );
  assert.throws(() => requireProvisioned(env, "create"), /blocked/);
});
