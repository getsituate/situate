import assert from "node:assert/strict";
import { aggregateReceipts, validatePlan } from "./pipeline-state.mjs";
import { validateSourceVerificationReuse } from "./source-verification-evidence.mjs";

const revision = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const sameKeys = (value, keys) =>
  assert.deepEqual(Object.keys(value ?? {}).sort(), [...keys].sort());

export function buildSourceVerification(plan, receipts) {
  const aggregate = aggregateReceipts(plan, receipts);
  const reuse = receipts.filter(
    (receipt) => receipt.kind === "source-verification-reuse",
  );
  if (!reuse.length)
    return {
      ...aggregate,
      results: receipts.map(({ lane, status }) => ({
        id: lane,
        status,
        exitCode: 0,
      })),
    };
  const summary = {
    ...aggregate,
    schemaVersion: 2,
    plan: structuredClone(plan),
    reuse: structuredClone(reuse),
    results: receipts.map((receipt) => ({
      id: receipt.lane,
      status: receipt.status,
      exitCode: 0,
      coverage:
        receipt.kind === "source-verification-reuse" ? "reused" : "executed",
      testedSHA:
        receipt.kind === "source-verification-reuse"
          ? receipt.reuse.binding.testedSHA
          : plan.source,
    })),
  };
  return validateSourceVerification(summary, { source: plan.source });
}

export function validateSourceVerification(
  verification,
  { source, releaseInputsSha256 } = {},
) {
  try {
    const mixed = verification?.schemaVersion === 2;
    assert(mixed || verification?.schemaVersion === 1);
    sameKeys(verification, [
      "schemaVersion",
      "status",
      "source",
      "planDigest",
      "lanes",
      "results",
      ...(mixed ? ["plan", "reuse"] : []),
      ...(releaseInputsSha256 === undefined ? [] : ["releaseInputsSha256"]),
    ]);
    assert(
      verification.status === "passed" &&
        verification.source === source &&
        revision.test(source) &&
        sha256.test(verification.planDigest),
    );
    if (releaseInputsSha256 !== undefined)
      assert(
        sha256.test(releaseInputsSha256) &&
          verification.releaseInputsSha256 === releaseInputsSha256,
      );
    const lanes = verification.lanes;
    assert(
      Array.isArray(lanes) &&
        lanes.length > 0 &&
        lanes.length <= 16 &&
        new Set(lanes).size === lanes.length &&
        lanes.every((id) => /^[a-z][a-z0-9-]{0,127}$/.test(id)),
    );
    assert(Array.isArray(verification.results));
    assert.deepEqual(
      verification.results.map(({ id }) => id).sort(),
      [...lanes].sort(),
    );
    if (mixed) {
      validatePlan(verification.plan);
      assert(
        verification.plan.source === source &&
          verification.plan.authorizationDigest === verification.planDigest,
      );
      assert.deepEqual(
        verification.plan.lanes.map(({ id }) => id).sort(),
        [...lanes].sort(),
      );
      assert(
        Array.isArray(verification.reuse) &&
          verification.reuse.length > 0 &&
          verification.reuse.length <= lanes.length,
      );
      const seen = new Set();
      for (const receipt of verification.reuse) {
        validateSourceVerificationReuse(verification.plan, receipt);
        assert(!seen.has(receipt.lane));
        seen.add(receipt.lane);
      }
    }
    for (const result of verification.results) {
      sameKeys(result, [
        "id",
        "status",
        "exitCode",
        ...(mixed ? ["coverage", "testedSHA"] : []),
      ]);
      assert(result.status === "passed" && result.exitCode === 0);
      if (!mixed) continue;
      const reused = verification.reuse.filter(
        ({ lane }) => lane === result.id,
      );
      assert(reused.length <= 1);
      if (reused.length)
        assert(
          result.coverage === "reused" &&
            result.testedSHA === reused[0].reuse.binding.testedSHA,
        );
      else
        assert(result.coverage === "executed" && result.testedSHA === source);
    }
    return structuredClone(verification);
  } catch (cause) {
    throw new Error(
      "Source verification does not cover the selected release lanes",
      { cause },
    );
  }
}
