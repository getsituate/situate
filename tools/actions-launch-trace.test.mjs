import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLaunchTrace } from "./actions-launch-trace.mjs";

function fixture(t) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-launch-controller-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const restored = join(directory, "restored");
  mkdirSync(restored, { mode: 0o700 });
  const identity = {
    operationId: "synthetic-operation",
    planDigest: "a".repeat(64),
    sourceRevision: "b".repeat(40),
  };
  const environment = {
    RUNNER_TEMP: directory,
    GITHUB_WORKFLOW_REF:
      "getsituate/situate/.github/workflows/release-launch-trace.yml@refs/heads/main",
    RECOVERY_ACTION: "qualify",
    WEBSITE_DEPLOY_HOST: "synthetic-destination",
  };
  const calls = [];
  const adapters = {
    recover: async (root, env, { workflow, adapters }) => {
      assert.equal(workflow, "launch-trace");
      await adapters.qualify(root, {
        recoveryAuthorization: {
          descriptor: { identity },
          directory: restored,
        },
        environment: env,
      });
    },
    requalify: async (root, input) =>
      input.adapters.qualify(root, { directory: restored }),
    prepared: async (root, input) =>
      input.executeWorker(
        process.execPath,
        [join(root, "tools/release-qualification-worker.mjs")],
        { env: { PATH: "/synthetic" } },
      ),
    execute: async (_command, args, options) => {
      assert.equal(options.env.GH_TOKEN, undefined);
      assert.equal(args.at(-2), "--launch-trace");
      writeFileSync(
        args.at(-1),
        JSON.stringify({
          kind: "macos-launch-diagnostic",
          qualification: false,
          launch: { private: "synthetic UI text" },
        }),
        { mode: 0o600 },
      );
      throw new Error("Synthetic diagnostic stop");
    },
    ssh: async (_options, use) =>
      use({
        WEBSITE_SSH_IDENTITY: "private-identity",
        WEBSITE_SSH_KNOWN_HOSTS: "private-known-hosts",
      }),
    retain: async (config, input) => {
      calls.push("retain");
      assert.equal(config.WEBSITE_SSH_IDENTITY, "private-identity");
      assert.deepEqual(input.identity, identity);
      assert.match(input.bytes.toString(), /synthetic UI text/);
      return {
        traceId: input.traceId,
        sha256: "c".repeat(64),
        size: input.bytes.length,
      };
    },
  };
  return { directory, restored, environment, identity, calls, adapters };
}

test("pre-abort does not inspect, restore or prepare another attempt", async (t) => {
  const f = fixture(t),
    abort = new AbortController();
  abort.abort(new Error("Synthetic pre-abort"));
  await assert.rejects(
    runLaunchTrace(f.directory, f.environment, {
      ...f.adapters,
      signal: abort.signal,
      recover: async () => assert.fail("Pre-abort cannot start recovery"),
    }),
    /Synthetic pre-abort/,
  );
  assert.deepEqual(f.calls, []);
});

test("direct tracing retains only private bytes and cannot return a qualification result", async (t) => {
  const f = fixture(t);
  const result = await runLaunchTrace(f.directory, f.environment, f.adapters);
  assert.equal(result.status, "trace-retained");
  assert.equal(result.operation, f.identity.operationId);
  assert.deepEqual(f.calls, ["retain"]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic UI|private-identity|restored|Users/,
  );
});

test("a completed qualification or unexpected workflow cannot be disguised as tracing", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    runLaunchTrace(
      f.directory,
      { ...f.environment, GITHUB_WORKFLOW_REF: "foreign/workflow" },
      f.adapters,
    ),
    /protected/,
  );
  await assert.rejects(
    runLaunchTrace(f.directory, f.environment, {
      ...f.adapters,
      recover: async () => ({ status: "qualified" }),
    }),
    /cannot produce qualification/,
  );
  assert.deepEqual(f.calls, []);
});

test("cancellation and a qualification receipt prevent private retention from reporting completion", async (t) => {
  const f = fixture(t),
    abort = new AbortController();
  const execute = async (...args) => {
    try {
      await f.adapters.execute(...args);
    } finally {
      abort.abort(new Error("Synthetic cancellation"));
    }
  };
  await assert.rejects(
    runLaunchTrace(f.directory, f.environment, {
      ...f.adapters,
      execute,
      signal: abort.signal,
    }),
    /Synthetic cancellation/,
  );
  assert.deepEqual(f.calls, []);
  writeFileSync(join(f.restored, "release-qualification.json"), "{}", {
    mode: 0o600,
  });
  await assert.rejects(
    runLaunchTrace(f.directory, f.environment, f.adapters),
    /cannot produce qualification/,
  );
  assert.deepEqual(f.calls, []);
});
