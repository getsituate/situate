import assert from "node:assert/strict";
import { test } from "node:test";
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
        const path = new URL(url).pathname;
        const body = options.body && JSON.parse(options.body);
        calls.push([options.method, path, body?.state]);
        if (options.method === "GET") {
          if (path.endsWith("/statuses"))
            return Response.json(state === "" ? [] : [{ state }]);
          return Response.json(created ? [{ id: 21, environment }] : []);
        }
        if (path.endsWith("/statuses")) {
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
