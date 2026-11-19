import assert from "node:assert/strict";
import { test } from "node:test";
import { rollOut, rolloutSteps } from "./continuous-rollout.mjs";

function fixture(failure) {
  const calls = [];
  const driver = {
    async preflight() {
      calls.push("preflight");
    },
    async perform(step) {
      calls.push(step);
      if (step === failure) throw new Error("injected failure");
      return { verified: true };
    },
    async finish() {
      calls.push("finish");
    },
  };
  const gate = {
    async begin() {
      calls.push("begin");
      if (failure === "begin") throw new Error("unresolved deployment");
    },
    async succeed() {
      calls.push("success");
    },
  };
  return { calls, run: () => rollOut("unused", driver, gate) };
}

test("the gate precedes staging and success follows verified retirement", async () => {
  const { calls, run } = fixture();
  await run();
  assert.deepEqual(calls, [
    "preflight",
    "qualify",
    "begin",
    ...rolloutSteps.slice(1),
    "finish",
    "success",
  ]);
});

test("an unresolved deployment or failed stage leaves the old host alone", async () => {
  for (const failure of ["begin", "stage", "prepare"]) {
    const { calls, run } = fixture(failure);
    await assert.rejects(run(), /stopped at (stage|prepare)/);
    assert.ok(!calls.includes("fence") && !calls.includes("success"));
  }
});

test("a failed handoff or public check stops without resume or retirement", async () => {
  for (const failure of [
    "detach",
    "attach",
    "verifyCandidate",
    "route",
    "verifyPublic",
  ]) {
    const { calls, run } = fixture(failure);
    await assert.rejects(run(), new RegExp(`stopped at ${failure}`));
    assert.equal(calls.at(-1), failure);
    assert.ok(
      !calls.includes("resume") &&
        !calls.includes("unprotect") &&
        !calls.includes("retire") &&
        !calls.includes("success"),
    );
  }
});
