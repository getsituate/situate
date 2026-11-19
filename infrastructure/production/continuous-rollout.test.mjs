import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rollOut, rolloutSteps } from "./continuous-rollout.mjs";

const revision = "a".repeat(40);
const request = { revision, digest: "b".repeat(64), target: "simulation" };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-simulation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const effects = new Map();
  let fault;
  const driver = {
    async preflight() {},
    async perform(step) {
      calls.push(step);
      if (step === fault?.step && !fault.applied)
        throw new Error("injected failure");
      const result = { completed: true };
      effects.set(step, result);
      if (step === fault?.step) throw new Error("injected lost response");
      return result;
    },
    async observe(step) {
      return effects.get(step);
    },
    async finish() {},
  };
  return {
    root,
    calls,
    driver,
    setFault: (value) => {
      fault = value;
    },
  };
}

test("rollout stages the candidate before freezing writers and retires only after public acceptance", async (t) => {
  const { root, driver, calls } = fixture(t);
  const result = await rollOut(root, request, driver);
  assert.deepEqual(calls, rolloutSteps);
  assert.deepEqual(Object.keys(result.completed), rolloutSteps);
});

test("failed capacity allocation cannot reach the serving VM or be replayed", async (t) => {
  const { root, driver, calls, setFault } = fixture(t);
  setFault({ step: "stage" });
  await assert.rejects(rollOut(root, request, driver), /injected failure/);
  await assert.rejects(rollOut(root, request, driver), /Cannot confirm stage/);
  await assert.rejects(
    rollOut(root, { ...request, revision: "c".repeat(40) }, driver),
    /unresolved rollout/,
  );
  assert.deepEqual(calls, ["qualify", "stage"]);
});

test("a lost acknowledgement is reconciled without reissuing the mutation", async (t) => {
  const { root, driver, calls, setFault } = fixture(t);
  setFault({ step: "attach", applied: true });
  await assert.rejects(rollOut(root, request, driver), /lost response/);
  await rollOut(root, request, driver);
  assert.deepEqual(calls, rolloutSteps);
});

test("failed public verification leaves the previous VM protected", async (t) => {
  const { root, driver, calls, setFault } = fixture(t);
  setFault({ step: "verifyPublic" });
  await assert.rejects(rollOut(root, request, driver), /injected failure/);
  assert.equal(calls.at(-1), "verifyPublic");
  assert.doesNotMatch(calls.join(" "), /resume|unprotect|retire/);
});
