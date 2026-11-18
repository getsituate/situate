import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { aggregateReceipts, digest, validatePlan } from "./pipeline-state.mjs";

export const MAX_SOURCE_EVIDENCE_BYTES = 256 * 1024;
export const MAX_SOURCE_EVIDENCE_CANDIDATES = 20;
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const eligible = {
  frontend: ["client-vue", "client-types", "client-architecture"],
  rust: [
    "client-agent-runtime",
    "client-migrations",
    "client-core",
    "client-format",
    "client-clippy",
  ],
  browser: [
    "client-browser-chromium",
    "client-browser-webkit",
    "client-executor-integration",
  ],
  "macos-code": [
    "client-core-macos",
    "client-host",
    "client-host-clippy",
    "client-dictation-swift",
    "client-workspace-access-swift",
  ],
  "macos-native": [
    "client-native",
    "client-agent-e2e",
    "client-onboarding-e2e",
    "client-plugins-e2e",
  ],
};

function fields(value, allowed) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert(
    Object.keys(value).every((key) => allowed.includes(key)),
    "Unexpected evidence field",
  );
}

function exact(value, expected, message) {
  assert(isDeepStrictEqual(value, expected), message);
}

function identifier(value) {
  assert(typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value));
}

function text(value) {
  assert(
    typeof value === "string" && /^[\x20-\x7e]{1,240}$/.test(value),
    "Invalid public evidence text",
  );
}

function origin(value) {
  fields(value, [
    "repository",
    "repositoryId",
    "workflowId",
    "workflowPath",
    "runId",
    "runAttempt",
    "aggregateJobId",
    "workflowDefinitionDigest",
    "baseSHA",
    "headSHA",
  ]);
  assert.equal(value.repository, "getsituate/situate");
  for (const key of [
    "repositoryId",
    "workflowId",
    "runId",
    "runAttempt",
    "aggregateJobId",
  ])
    assert(
      typeof value[key] === "string" && /^[1-9][0-9]{0,19}$/.test(value[key]),
    );
  assert.equal(value.workflowPath, ".github/workflows/verify.yml");
  assert(sha.test(value.headSHA) && sha.test(value.baseSHA));
  assert(hash.test(value.workflowDefinitionDigest));
}

function host(value, lane) {
  fields(value, ["platform", "arch", "ImageOS", "ImageVersion", "ociDigest"]);
  assert.equal(value.platform, lane.host === "macos" ? "darwin" : "linux");
  assert(["arm64", "x64"].includes(value.arch));
  for (const key of ["ImageOS", "ImageVersion"]) {
    assert(
      typeof value[key] === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value[key]) &&
        !/^(unknown|latest|none|unset)$/i.test(value[key]),
      "Unresolved host identity",
    );
  }
  if (lane.host === "linux")
    assert(/^sha256:[a-f0-9]{64}$/.test(value.ociDigest));
  else assert.equal(value.ociDigest, null);
}

function contract(value, suites) {
  fields(value, ["schemaVersion", "toolsDigest", "suites"]);
  assert.equal(value.schemaVersion, 1);
  assert(hash.test(value.toolsDigest));
  assert(Array.isArray(value.suites));
  exact(
    value.suites.map(({ id }) => id).sort(),
    [...suites].sort(),
    "Contract coverage differs",
  );
  for (const entry of value.suites) {
    fields(entry, ["id", "commandDigest"]);
    identifier(entry.id);
    assert(hash.test(entry.commandDigest));
  }
}

const sourcePlanFields = [
  "schemaVersion",
  "workflow",
  "repository",
  "source",
  "base",
  "appImpact",
  "lanes",
  "reasons",
  "declaration",
  "authorizationDigest",
];

function publicPlan(plan) {
  validatePlan(plan);
  fields(plan, sourcePlanFields);
  assert.equal(plan.workflow, "verify");
  assert.equal(plan.repository, "getsituate/situate");
  assert.equal(typeof plan.appImpact, "boolean");
  assert(plan.lanes.length > 0 && plan.lanes.length <= 16);
  const reasons = (values) => {
    assert(Array.isArray(values) && values.length <= 1000);
    values.forEach(text);
  };
  reasons(plan.reasons);
  for (const lane of plan.lanes) {
    fields(lane, [
      "id",
      "host",
      "execution",
      "timeoutSeconds",
      "suites",
      "reasons",
    ]);
    identifier(lane.id);
    assert(lane.suites.length <= 100);
    lane.suites.forEach(identifier);
    if (lane.execution !== undefined)
      assert(["host-docker", "native", "container"].includes(lane.execution));
    assert(Number.isInteger(lane.timeoutSeconds) && lane.timeoutSeconds > 0);
    reasons(lane.reasons);
  }
  if (plan.declaration !== undefined) {
    const declaration = plan.declaration;
    fields(declaration, ["head", "base", "heads", "fragments"]);
    assert(sha.test(declaration.base));
    if (declaration.head !== undefined) assert(sha.test(declaration.head));
    assert(Array.isArray(declaration.heads) && declaration.heads.length <= 100);
    for (const entry of declaration.heads) {
      fields(entry, ["source", "base"]);
      assert(sha.test(entry.source) && sha.test(entry.base));
    }
    assert(
      Array.isArray(declaration.fragments) &&
        declaration.fragments.length <= 1000,
    );
    for (const entry of declaration.fragments) {
      fields(entry, ["id", "sha256"]);
      text(entry.id);
      assert(hash.test(entry.sha256));
    }
  }
}

function publicReceipt(receipt) {
  fields(receipt, [
    "schemaVersion",
    "source",
    "planDigest",
    "lane",
    "host",
    "executionHost",
    "status",
    "results",
  ]);
  assert.equal(receipt.executionHost, receipt.host);
  for (const result of receipt.results) {
    fields(result, [
      "id",
      "project",
      "kind",
      "status",
      "exitCode",
      "signal",
      "durationMs",
      "preparationDurationMs",
      "resourceQueueWaitMs",
      "executionDurationMs",
      "cleanupIncomplete",
    ]);
    for (const key of ["project", "kind"])
      if (result[key] !== undefined) identifier(result[key]);
    for (const key of [
      "durationMs",
      "preparationDurationMs",
      "resourceQueueWaitMs",
      "executionDurationMs",
    ])
      if (result[key] !== undefined)
        assert(Number.isFinite(result[key]) && result[key] >= 0);
    assert(result.signal === undefined || result.signal === null);
    assert(
      result.cleanupIncomplete === undefined ||
        result.cleanupIncomplete === false,
    );
  }
}

function boundedCopy(value) {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  assert(
    typeof json === "string" &&
      Buffer.byteLength(json) <= MAX_SOURCE_EVIDENCE_BYTES,
    "Source evidence exceeds its size limit",
  );
  return JSON.parse(json);
}

export function validateSourceVerificationEvidence(input) {
  const value = boundedCopy(input);
  fields(value, [
    "schemaVersion",
    "origin",
    "testedSHA",
    "tree",
    "plan",
    "aggregate",
    "receipts",
    "lanes",
  ]);
  assert.equal(value.schemaVersion, 1);
  origin(value.origin);
  assert(sha.test(value.testedSHA) && sha.test(value.tree));
  publicPlan(value.plan);
  assert.equal(value.testedSHA, value.plan.source);
  assert(Array.isArray(value.receipts));
  value.receipts.forEach(publicReceipt);
  exact(
    value.aggregate,
    aggregateReceipts(value.plan, value.receipts),
    "Aggregate did not pass",
  );
  assert(
    Array.isArray(value.lanes) &&
      value.lanes.length > 0 &&
      value.lanes.length <= 16,
  );
  const seen = new Set();
  for (const entry of value.lanes) {
    fields(entry, ["lane", "jobId", "host", "contract", "checkout"]);
    assert(
      typeof entry.jobId === "string" && /^[1-9][0-9]{0,19}$/.test(entry.jobId),
    );
    const lane = value.plan.lanes.find(({ id }) => id === entry.lane);
    assert(lane && !seen.has(entry.lane));
    seen.add(entry.lane);
    host(entry.host, lane);
    contract(entry.contract, lane.suites);
    exact(
      entry.checkout,
      { before: "clean", after: "clean", cleanup: "complete" },
      "Incomplete checkout or cleanup",
    );
  }
  return value;
}

/** Reject non-public payloads rather than silently discarding execution evidence. */
export function sanitizeSourceVerificationReceipts(plan, receipts) {
  publicPlan(plan);
  const sanitized = boundedCopy(receipts);
  assert(Array.isArray(sanitized));
  sanitized.forEach(publicReceipt);
  aggregateReceipts(plan, sanitized);
  return sanitized;
}

export function createSourceVerificationEvidence(inputs) {
  const receipts = sanitizeSourceVerificationReceipts(
    inputs.plan,
    inputs.receipts,
  );
  return validateSourceVerificationEvidence({
    ...inputs,
    receipts,
    schemaVersion: 1,
  });
}

function verificationTargetPlan(plan) {
  validatePlan(plan);
  assert(["verify", "create"].includes(plan.workflow));
  fields(plan, [
    ...sourcePlanFields,
    ...(plan.workflow === "create" ? ["baseline"] : []),
  ]);
  assert.equal(plan.repository, "getsituate/situate");
  if (plan.workflow === "create") {
    fields(plan.baseline, ["source", "legacy", "identity", "catalogSha256"]);
    assert(sha.test(plan.baseline.source));
    if (plan.baseline.legacy !== undefined)
      assert.equal(plan.baseline.legacy, true);
    if (plan.baseline.catalogSha256 !== undefined)
      assert(hash.test(plan.baseline.catalogSha256));
    if (plan.baseline.identity !== undefined)
      fields(plan.baseline.identity, [
        "repository",
        "tag",
        "sourceRevision",
        "version",
        "operationId",
        "inputSha256",
        "releaseId",
      ]);
  }
}

/**
 * Each observation must come from trusted Actions/API and Git reads, never the
 * artifact: same-repository PR/run/attempt, trusted Verify workflow and PR head,
 * successful completed run/jobs, and the checked commit's full tree and parents.
 * baseSHA/headSHA are captured run inputs, not the PR's later live revisions.
 * reviewedWorkflowDigest identifies the independently approved workflow definition.
 * Contracts hash resolved argv/cwd/environment, runner implementation, features,
 * relevant configuration and tool versions/pins; hosts are
 * measured on the allocated runner before preparation, not inferred from labels.
 */
export function selectSourceVerificationEvidence({
  candidates,
  plan,
  lane: laneId,
  host: currentHost,
  contract: currentContract,
  source,
  reviewedWorkflowDigest,
}) {
  const miss = (reason) => ({ action: "execute", reason });
  if (!Array.isArray(candidates) || !candidates.length)
    return miss("evidence-absent");
  if (candidates.length > MAX_SOURCE_EVIDENCE_CANDIDATES)
    return miss("evidence-limit");
  let lane;
  try {
    verificationTargetPlan(plan);
    lane = plan.lanes.find(({ id }) => id === laneId);
    if (
      !lane ||
      !Object.hasOwn(eligible, laneId) ||
      !lane.suites.length ||
      lane.suites.some((id) => !eligible[laneId].includes(id))
    )
      return miss("lane-ineligible");
    assert.equal(lane.host, laneId.startsWith("macos-") ? "macos" : "linux");
    assert(
      lane.execution === undefined ||
        lane.execution === (lane.host === "macos" ? "native" : "container"),
    );
    host(currentHost, lane);
    contract(currentContract, lane.suites);
    exact(source, { sha: plan.source, tree: source.tree, clean: true });
    assert(sha.test(source.tree));
    assert(hash.test(reviewedWorkflowDigest));
  } catch {
    return miss("unresolved-target");
  }
  for (const candidate of candidates) {
    try {
      const { evidence: input, observation } = candidate;
      const evidence = validateSourceVerificationEvidence(input);
      origin(observation.origin);
      exact(observation.origin, evidence.origin, "Origin differs");
      assert.equal(
        evidence.origin.workflowDefinitionDigest,
        reviewedWorkflowDigest,
      );
      exact(
        observation,
        {
          origin: evidence.origin,
          trusted: true,
          event: "pull_request",
          status: "completed",
          conclusion: "success",
          aggregateConclusion: "success",
          headRepositoryId: evidence.origin.repositoryId,
          checkedSHA: evidence.testedSHA,
          checkedParents:
            evidence.testedSHA === evidence.origin.headSHA
              ? null
              : [evidence.origin.baseSHA, evidence.origin.headSHA],
          tree: evidence.tree,
          jobs: evidence.lanes.map(({ lane, jobId }) => ({
            lane,
            jobId,
            conclusion: "success",
          })),
        },
        "Untrusted producer",
      );
      assert.equal(evidence.tree, source.tree);
      const previousLane = evidence.plan.lanes.find(({ id }) => id === laneId);
      assert(
        previousLane &&
          previousLane.host === lane.host &&
          previousLane.execution === lane.execution &&
          (previousLane.timeoutSeconds ?? 600) === (lane.timeoutSeconds ?? 600),
      );
      assert(previousLane.suites.every((id) => eligible[laneId].includes(id)));
      const entry = evidence.lanes.find(({ lane }) => lane === laneId);
      assert(entry);
      exact(entry.host, currentHost, "Host differs");
      assert.equal(entry.contract.toolsDigest, currentContract.toolsDigest);
      for (const suite of currentContract.suites)
        exact(
          entry.contract.suites.find(({ id }) => id === suite.id),
          suite,
          "Command or coverage differs",
        );
      return {
        action: "reuse",
        evidence,
        binding: {
          schemaVersion: 1,
          kind: "source-verification-reuse",
          source: plan.source,
          planDigest: plan.authorizationDigest,
          lane: laneId,
          suites: [...lane.suites],
          tree: source.tree,
          testedSHA: evidence.testedSHA,
          originalPlanDigest: evidence.plan.authorizationDigest,
          coverage: "reused",
          executedSuites: [...previousLane.suites],
          originalReceipt: evidence.receipts.find(
            ({ lane }) => lane === laneId,
          ),
          contractDigest: digest(currentContract),
          host: { ...currentHost },
          origin: evidence.origin,
          evidenceDigest: digest(evidence),
        },
      };
    } catch {
      // Invalid or unavailable evidence never substitutes for executing a lane.
    }
  }
  return miss("no-matching-evidence");
}

function reuseReceipt(plan, selection) {
  assert.equal(selection?.action, "reuse");
  const lane = plan.lanes.find(({ id }) => id === selection.binding.lane);
  assert(lane);
  return {
    schemaVersion: 1,
    kind: "source-verification-reuse",
    coverage: "reused",
    source: plan.source,
    planDigest: plan.authorizationDigest,
    lane: lane.id,
    host: lane.host,
    executionHost: lane.host,
    status: "passed",
    results: lane.suites.map((id) => ({
      id,
      status: "passed",
      exitCode: 0,
      coverage: "reused",
      testedSHA: selection.binding.testedSHA,
    })),
    reuse: {
      binding: selection.binding,
      evidence: selection.evidence,
      observation: selection.observation,
      host: selection.host,
      contract: selection.contract,
      source: selection.source,
      reviewedWorkflowDigest: selection.reviewedWorkflowDigest,
    },
  };
}

export function createSourceVerificationReuseReceipt(plan, selection) {
  return validateSourceVerificationReuse(plan, reuseReceipt(plan, selection));
}

/**
 * Validate an offline receipt from the trusted main-lane controller. Its observation
 * must already have been independently resolved by selectActionsSourceEvidence;
 * this consistency check does not authenticate artifact-supplied observations.
 */
export function validateSourceVerificationReuse(plan, receipt) {
  const reuse = receipt?.reuse;
  assert(reuse);
  const selected = selectSourceVerificationEvidence({
    candidates: [{ evidence: reuse.evidence, observation: reuse.observation }],
    plan,
    lane: receipt.lane,
    host: reuse.host,
    contract: reuse.contract,
    source: reuse.source,
    reviewedWorkflowDigest: reuse.reviewedWorkflowDigest,
  });
  assert.equal(
    selected.action,
    "reuse",
    "Reuse no longer covers the selected lane",
  );
  exact(
    receipt,
    reuseReceipt(plan, {
      ...selected,
      observation: reuse.observation,
      host: reuse.host,
      contract: reuse.contract,
      source: reuse.source,
      reviewedWorkflowDigest: reuse.reviewedWorkflowDigest,
    }),
    "Reuse receipt binding differs",
  );
  return receipt;
}
