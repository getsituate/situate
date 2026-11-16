import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  checkQualificationRoute,
  routeCheckEnvironment,
  workerProgram,
} from "./qualification-route-check.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = JSON.stringify({
  schemaVersion: 1,
  qualification: { profile: "macos-direct-v1", tls: { hostPort: 24443 } },
});
const environment = {
  PATH: process.env.PATH,
  HOME: "/synthetic",
  CI: "true",
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  SITUATE_RELEASE_CONFIG_JSON: json,
  SITUATE_RELEASE_CONFIG_SHA256: hash(json),
  SITUATE_UPDATER_ENDPOINT:
    "https://getsituate.com/releases/current/update.json",
  WEBSITE_DEPLOY_HOST: "synthetic.example.test",
  SITUATE_RELEASE_SSH_PRIVATE_KEY: "synthetic-private-key",
  SITUATE_RELEASE_SSH_KNOWN_HOSTS: "synthetic-known-hosts",
  APPLE_API_PRIVATE_KEY: "must-not-reach-child",
  APPLE_DEVELOPER_ID_P12_PASSWORD: "must-not-reach-child",
  GH_TOKEN: "must-not-reach-child",
  OPENAI_API_KEY: "must-not-reach-child",
  SSH_AUTH_SOCK: "must-not-reach-child",
};
function fixture(overrides = {}) {
  const calls = [];
  const options = {
    environment,
    platform: "darwin",
    resolvePublic: async (hostname, options) => {
      assert.equal(hostname, "getsituate.com");
      assert.deepEqual(options, { family: 4 });
      return { address: "192.0.2.1" };
    },
    fetchPublic: async (url) => {
      calls.push("public:" + url);
      return new Response(
        url.endsWith("/identity.json") ? null : '{"version":"previous"}',
        {
          status: url.endsWith("/identity.json") ? 404 : 200,
        },
      );
    },
    prepareSSH: async ({ environment: selected }, use) => {
      assert(!JSON.stringify(selected).includes("must-not-reach-child"));
      return use({
        ...selected,
        WEBSITE_SSH_IDENTITY: "/synthetic/key",
        WEBSITE_SSH_KNOWN_HOSTS: "/synthetic/known",
      });
    },
    createHost: () => ({
      prepare: () => {
        calls.push("prepare");
        return {
          identityPath: "/identity.json",
          identitySha256: "b".repeat(64),
        };
      },
      stage: ({ files }) => {
        calls.push("stage");
        assert.equal(files.length, 1);
      },
      serve: () => {
        calls.push("serve");
      },
      cleanup: () => {
        calls.push("cleanup");
        return { status: "cleaned" };
      },
    }),
    withRoute: async (_request, worker) => {
      calls.push("route");
      await worker({}, new AbortController().signal);
    },
    execute: async (_command, args, options) => {
      calls.push("worker");
      const text = JSON.stringify({ args, env: options.env });
      for (const value of [
        "synthetic-private-key",
        "synthetic-known-hosts",
        "must-not-reach-child",
        "/synthetic/key",
      ])
        assert(!text.includes(value));
      assert.equal(options.capture, true);
      return '{"status":"passed","phase":"complete"}';
    },
    ...overrides,
  };
  return { calls, options };
}

test("route diagnostic exercises the shared route with a credential-free worker and restores the public feed", async () => {
  const f = fixture();
  const report = await checkQualificationRoute(f.options);
  assert.equal(report.status, "passed");
  assert.equal(report.phase, "complete");
  assert.equal(report.cleanup, "confirmed");
  assert.match(report.operationNonce, /^route-probe-[a-f0-9-]+$/);
  assert.deepEqual(
    f.calls.filter((x) => !x.startsWith("public:")),
    ["prepare", "stage", "serve", "route", "worker", "cleanup"],
  );
  assert.equal(f.calls.filter((x) => x.startsWith("public:")).length, 3);
});

test("worker failure remains failed with its safe network phase and always cleans the listener", async () => {
  const f = fixture({
    execute: async () =>
      '{"status":"failed","phase":"private-identity","failureCode":"ECONNRESET"}',
  });
  const report = await checkQualificationRoute(f.options);
  assert.equal(report.status, "failed");
  assert.equal(report.phase, "private-identity");
  assert.equal(report.workerFailureCode, "ECONNRESET");
  assert.equal(report.cleanup, "confirmed");
  assert(f.calls.includes("cleanup"));
});

test("route failure preserves only structured diagnostics, not exception messages", async () => {
  const diagnostic = {
    phase: "guardian-startup",
    guardianFailure: "ssh-start",
    cleaned: true,
  };
  const f = fixture({
    withRoute: async () => {
      throw Object.assign(new Error("synthetic-private-key"), { diagnostic });
    },
  });
  const report = await checkQualificationRoute(f.options);
  assert.equal(report.status, "failed");
  assert.equal(report.phase, "route");
  assert.deepEqual(report.route, diagnostic);
  assert.equal(report.cleanup, "confirmed");
  assert(!JSON.stringify(report).includes("synthetic-private-key"));
});

test("unknown cleanup or changed public bytes cannot report success", async () => {
  for (const kind of ["cleanup", "public-feed"]) {
    let count = 0;
    const f = fixture(
      kind === "cleanup"
        ? {
            createHost: () => ({
              prepare: () => {
                throw Error("synthetic partial effect");
              },
              cleanup: () => {
                throw Error("synthetic unknown cleanup");
              },
            }),
          }
        : {
            fetchPublic: async (url) => {
              if (url.endsWith("/identity.json"))
                return new Response(null, { status: 404 });
              return new Response(
                ++count === 1
                  ? '{"version":"previous"}'
                  : '{"version":"changed"}',
              );
            },
          },
    );
    const report = await checkQualificationRoute(f.options);
    assert.equal(report.status, "failed");
    if (kind === "cleanup") assert.equal(report.cleanup, "uncertain");
    else assert.equal(report.phase, "public-restoration");
  }
});

test("untrusted platforms and contexts are rejected before any boundary access", async () => {
  for (const changed of [
    { platform: "linux" },
    { environment: { ...environment, CI: "false" } },
    { environment: { ...environment, GITHUB_ACTIONS: "false" } },
    { environment: { ...environment, RUNNER_ENVIRONMENT: "self-hosted" } },
  ]) {
    const f = fixture(changed);
    await assert.rejects(checkQualificationRoute(f.options), /GitHub-hosted/);
    assert.deepEqual(f.calls, []);
  }
});

test("real worker reports only allowlisted routing phases and failure codes", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-routing-worker-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [phase, code, expected] of [
    [
      "private-identity",
      "ECONNRESET",
      {
        status: "failed",
        phase: "private-identity",
        failureCode: "ECONNRESET",
      },
    ],
    [
      "synthetic-private-value",
      "synthetic-private-value",
      { status: "failed", phase: "routing", failureCode: "unknown" },
    ],
  ]) {
    const module = join(directory, "routing.mjs");
    writeFileSync(
      module,
      `export const createQualificationRouting = () => ({inspect() { throw Object.assign(new Error('synthetic-private-value'), { qualificationRoutingPhase: ${JSON.stringify(phase)}, code: ${JSON.stringify(code)} }); }});`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        workerProgram,
        JSON.stringify({ module: pathToFileURL(module).href, routing: {} }),
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), expected);
    assert(!result.stdout.includes("synthetic-private-value"));
  }
});

test("coordination entry passes the filtered environment through the supervisor API", () => {
  const source = readFileSync(
    new URL("./qualification-route-check.mjs", import.meta.url),
    "utf8",
  );
  const entry = source.slice(source.lastIndexOf("runCoordinated({"));
  assert.match(entry, /environment: routeCheckEnvironment\(process\.env\)/);
  assert.doesNotMatch(entry, /\benv:/);
});

test("non-production endpoints, unsupported profiles and invalid public references cannot prepare a host", async () => {
  const unsupported = JSON.stringify({
    schemaVersion: 1,
    qualification: { profile: "other", tls: {} },
  });
  for (const changed of [
    {
      environment: {
        ...environment,
        SITUATE_UPDATER_ENDPOINT: "https://other.example.test/update.json",
      },
    },
    {
      environment: {
        ...environment,
        SITUATE_RELEASE_CONFIG_JSON: unsupported,
        SITUATE_RELEASE_CONFIG_SHA256: hash(unsupported),
      },
    },
    { resolvePublic: async () => ({ address: "127.0.0.1" }) },
    { resolvePublic: async () => ({ address: "::1" }) },
  ]) {
    const f = fixture(changed);
    const report = await checkQualificationRoute(f.options);
    assert.equal(report.status, "failed");
    assert.equal(report.cleanup, "not-needed");
    assert(!f.calls.includes("prepare"));
  }
});

test("mismatched configuration is rejected before SSH and only scoped controller inputs are retained", async () => {
  const f = fixture({
    environment: {
      ...environment,
      SITUATE_RELEASE_CONFIG_SHA256: "a".repeat(64),
    },
  });
  assert.equal(
    (await checkQualificationRoute(f.options)).phase,
    "configuration",
  );
  assert.deepEqual(f.calls, []);
  assert(
    !JSON.stringify(routeCheckEnvironment(environment)).includes(
      "must-not-reach-child",
    ),
  );
});
