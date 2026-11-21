import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { probeReleaseHost } from "../releases/hosting-readiness.mjs";
import { deploymentGate, hostingReadiness } from "./hosting-deployment.mjs";
import { hostingDigest } from "./hosting-inputs.mjs";

const revision = "a".repeat(40);
const environment = "hosting-production-operation";
const creator = { login: "github-actions[bot]" };
const verified = { id: 21, sha: revision, environment, creator };

function fixture(previousState = null) {
  const calls = [];
  let created = previousState !== null;
  let state = previousState;
  const make = () =>
    deploymentGate({
      token: "fixture",
      revision,
      runId: "123",
      digest: () => "same",
      fetchImpl: async (url, options) => {
        assert.equal(url.origin, "https://api.github.com");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.Authorization, "Bearer fixture");
        const path = url.pathname;
        assert.match(
          path,
          /^\/repos\/getsituate\/situate\/deployments(?:\/21\/statuses)?$/,
        );
        const body = options.body && JSON.parse(options.body);
        if (options.method === "GET") {
          assert.equal(url.searchParams.get("per_page"), "1");
          assert.equal(
            url.searchParams.get("environment"),
            path.endsWith("/statuses") ? null : environment,
          );
        }
        calls.push([options.method, path, body?.state]);
        if (options.method === "GET") {
          if (path.endsWith("/statuses"))
            return Response.json(
              state === "" ? [] : [{ state, creator, environment }],
            );
          return Response.json(created ? [verified] : []);
        }
        if (path.endsWith("/statuses")) {
          assert.equal(
            body.log_url,
            "https://github.com/getsituate/situate/actions/runs/123",
          );
          assert.equal(body.auto_inactive, false);
          state = body.state;
          return Response.json({ state });
        }
        created = true;
        assert.equal(body.auto_merge, false);
        assert.deepEqual(body.required_contexts, []);
        return Response.json({ id: 21, sha: revision, environment });
      },
    });
  return { calls, make };
}

test("an open GitHub deployment blocks a later run without replaying the failed job", async () => {
  const { make, calls } = fixture();
  await make().begin();
  await assert.rejects(make().begin(), /Deployment 21 is unresolved/);
  assert.equal(calls.filter(([method]) => method === "POST").length, 2);
});

test("only success or manual inactivation clears the gate", async () => {
  for (const status of ["", "error", "pending", "in_progress", "failure"]) {
    const { make } = fixture(status);
    await assert.rejects(make().check(), /unresolved/);
  }
  for (const status of ["success", "inactive"])
    await fixture(status).make().check();
  const { make } = fixture();
  const gate = make();
  await gate.begin();
  await gate.succeed();
  assert.equal((await make().check()).ready, true);
});

function observe({
  applied = verified,
  states = ["success"],
  digest = () => "same",
  author = creator,
} = {}) {
  const requests = [];
  return {
    requests,
    read: () =>
      hostingReadiness({
        token: "fixture",
        revision: "b".repeat(40),
        digest,
        fetchImpl: async (url, options) => {
          const { pathname } = new URL(url);
          assert.equal(options.method, "GET");
          assert.match(pathname, /^\/repos\/getsituate\/situate\/deployments/);
          requests.push(pathname);
          if (!pathname.endsWith("/statuses"))
            return Response.json(applied ? [applied] : []);
          const state = states.length > 1 ? states.shift() : states[0];
          return Response.json(
            state ? [{ state, creator: author, environment }] : [],
          );
        },
      }),
  };
}

test("the input digest tracks installed files and ignores rollout scripts", () => {
  const tree = (runtime, runner) => () =>
    [
      "100644 blob pinned\tinfrastructure/production/immutable/bake.sh",
      `100644 blob ${runner}\tinfrastructure/production/immutable/continuous-deploy.mjs`,
      `100644 blob ${runtime}\tinfrastructure/production/immutable/qualification-nginx.conf`,
    ].join("\n");
  const a = hostingDigest(revision, tree("old", "old"));
  assert.equal(a, hostingDigest(revision, tree("old", "new")));
  assert.notEqual(a, hostingDigest(revision, tree("new", "new")));
});

test("the macOS probe requires baked provenance and private HTTPS on the verified SSH host", () => {
  const env = {
    WEBSITE_DEPLOY_HOST: "deploy@getsituate.com",
    SITUATE_RELEASE_SSH_PRIVATE_KEY: "synthetic identity",
    SITUATE_RELEASE_SSH_KNOWN_HOSTS: "synthetic known hosts",
  };
  const execute = (command, args, options) => {
    assert.equal(command, "ssh");
    assert.ok(args.includes("StrictHostKeyChecking=yes"));
    assert.match(args.at(-1), new RegExp(`source_revision=${revision}`));
    assert.match(args.at(-1), /127\.0\.0\.1:24443/);
    assert.equal(options.env.SITUATE_RELEASE_SSH_PRIVATE_KEY, undefined);
    return "204";
  };
  probeReleaseHost(revision, env, execute);
  assert.throws(
    () => probeReleaseHost(revision, env, () => "200"),
    /private HTTPS probe/,
  );
  assert.throws(
    () =>
      probeReleaseHost(revision, env, () => {
        throw new Error("private stderr");
      }),
    {
      message:
        "The verified release host did not pass the SSH provenance and private HTTPS probe.",
    },
  );
});

test("an app-only main revision can use the previously verified host with no HCP calls", async () => {
  const { read, requests } = observe();
  assert.deepEqual(await read(), {
    ready: true,
    deploymentId: verified.id,
    revision,
  });
  assert.equal(requests.length, 4);
});

test("an undeployed hosting change cannot use a healthy predecessor", async () => {
  assert.deepEqual(await observe({ digest: (sha) => sha }).read(), {
    ready: false,
    reason: "The verified host has different hosting inputs.",
  });
});

test("missing, inactive or unresolved deployments do not authorize publication", async () => {
  for (const state of ["inactive", "in_progress", "failure", undefined])
    assert.equal((await observe({ states: [state] }).read()).ready, false);
  assert.equal((await observe({ applied: null }).read()).ready, false);
  assert.equal(
    (await observe({ states: ["success", "in_progress"] }).read()).ready,
    false,
  );
  await assert.rejects(
    observe({ author: { login: "untrusted" } }).read(),
    /no trusted success/,
  );
});

test("retries a transient GitHub read failure but never retries a write", async () => {
  const methods = [];
  const gate = deploymentGate({
    token: "fixture",
    revision,
    runId: "123",
    fetchImpl: async (_url, { method }) => {
      methods.push(method);
      return methods.length === 2
        ? Response.json([])
        : new Response(null, { status: 503 });
    },
  });
  await assert.rejects(gate.begin(), /request failed \(503\)/);
  assert.deepEqual(methods, ["GET", "GET", "POST"]);
});

test("rejects invalid workflow run and deployment identities before using them", async () => {
  const fetchImpl = () => assert.fail("Unexpected API request");
  for (const runId of [0, "0", "001", "not-a-run", "9007199254740992"]) {
    assert.throws(
      () => deploymentGate({ token: "fixture", revision, runId, fetchImpl }),
      /Missing GitHub deployment identity/,
    );
  }
  const gate = deploymentGate({
    token: "fixture",
    revision,
    runId: "123",
    fetchImpl: async (url) => {
      assert.equal(url.pathname, "/repos/getsituate/situate/deployments");
      return Response.json([{ id: "21", environment }]);
    },
  });
  await assert.rejects(gate.check(), /Unexpected GitHub deployment identity/);
});

test("deployment CLI reports a fixed diagnostic when authorization is absent", () => {
  const script = fileURLToPath(
    new URL("immutable/continuous-deploy.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [script], {
    env: {},
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    "Production deployment stopped. Inspect the GitHub deployment gate, Terraform, Hetzner and DNS before retrying or clearing the gate.\n",
  );
});
