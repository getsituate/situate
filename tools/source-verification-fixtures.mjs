import { aggregateReceipts, sealPlan } from "./pipeline-state.mjs";
import {
  createSourceVerificationEvidence,
  createSourceVerificationReuseReceipt,
  selectSourceVerificationEvidence,
} from "./source-verification-evidence.mjs";

export function sourceVerificationFixture() {
  const source = "a".repeat(40),
    tested = "b".repeat(40),
    tree = "c".repeat(40);
  const lanes = [
    {
      id: "policy",
      host: "linux",
      timeoutSeconds: 600,
      suites: ["root-secrets"],
      reasons: [],
    },
    {
      id: "macos-native",
      host: "macos",
      timeoutSeconds: 3600,
      suites: ["client-native", "client-agent-e2e"],
      reasons: [],
    },
  ];
  const producer = sealPlan({
    schemaVersion: 1,
    repository: "getsituate/situate",
    workflow: "verify",
    source: tested,
    base: "d".repeat(40),
    appImpact: true,
    lanes,
    reasons: [],
  });
  const plan = sealPlan({
    ...producer,
    workflow: "create",
    source,
    baseline: { source: producer.base, legacy: true },
  });
  const fresh = (plan, lane) => ({
    schemaVersion: 1,
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
      signal: null,
    })),
  });
  const receipts = lanes.map((lane) => fresh(producer, lane));
  const host = {
    platform: "darwin",
    arch: "arm64",
    ImageOS: "macos26",
    ImageVersion: "20261116.1",
    ociDigest: null,
  };
  const contract = {
    schemaVersion: 1,
    toolsDigest: "f".repeat(64),
    suites: lanes[1].suites.map((id) => ({
      id,
      commandDigest: "1".repeat(64),
    })),
  };
  const origin = {
    repository: "getsituate/situate",
    repositoryId: "1455575895",
    workflowId: "417380313",
    workflowPath: ".github/workflows/verify.yml",
    runId: "101",
    runAttempt: "1",
    aggregateJobId: "102",
    workflowDefinitionDigest: "9".repeat(64),
    baseSHA: producer.base,
    headSHA: "e".repeat(40),
  };
  const evidence = createSourceVerificationEvidence({
    origin,
    testedSHA: tested,
    tree,
    plan: producer,
    aggregate: aggregateReceipts(producer, receipts),
    receipts,
    lanes: [
      {
        lane: lanes[1].id,
        jobId: "103",
        host,
        contract,
        checkout: { before: "clean", after: "clean", cleanup: "complete" },
      },
    ],
  });
  const observation = {
    origin,
    trusted: true,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    aggregateConclusion: "success",
    headRepositoryId: origin.repositoryId,
    checkedSHA: tested,
    checkedParents: [origin.baseSHA, origin.headSHA],
    tree,
    jobs: [{ lane: lanes[1].id, jobId: "103", conclusion: "success" }],
  };
  const measured = {
    host,
    contract,
    source: { sha: source, tree, clean: true },
    reviewedWorkflowDigest: origin.workflowDefinitionDigest,
  };
  const selection = selectSourceVerificationEvidence({
    candidates: [{ evidence, observation }],
    plan,
    lane: lanes[1].id,
    ...measured,
  });
  const reused = createSourceVerificationReuseReceipt(plan, {
    ...selection,
    observation,
    ...measured,
  });
  return {
    plan,
    source,
    tested,
    evidence,
    reused,
    receipts: [fresh(plan, lanes[0]), reused],
    fresh: lanes.map((lane) => fresh(plan, lane)),
  };
}
