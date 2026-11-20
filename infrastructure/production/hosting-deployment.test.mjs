import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deploymentGate } from "./hosting-deployment.mjs";

const revision = "a".repeat(40);
const environment = "hosting-production-operation";

function fixture(previousState = null) {
  const calls = [];
  let created = previousState !== null;
  let state = previousState;
  const make = () =>
    deploymentGate({
      token: "fixture",
      revision,
      runId: "123",
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
            return Response.json(state === "" ? [] : [{ state }]);
          return Response.json(created ? [{ id: 21, environment }] : []);
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
  await make().check();
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
