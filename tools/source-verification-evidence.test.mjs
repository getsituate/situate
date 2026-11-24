import assert from "node:assert/strict";
import test from "node:test";
import { aggregateReceipts, sealPlan } from "./pipeline-state.mjs";
import { planWorkflow, runLane } from "./pipeline.mjs";
import { executeSuite, root, sourceFiles, suiteInventory } from "./test.mjs";
import {
  createSourceVerificationEvidence,
  createSourceVerificationReuseReceipt,
  MAX_SOURCE_EVIDENCE_BYTES,
  MAX_SOURCE_EVIDENCE_CANDIDATES,
  selectSourceVerificationEvidence,
  sanitizeSourceVerificationReceipts,
  validateSourceVerificationEvidence,
  validateSourceVerificationReuse,
} from "./source-verification-evidence.mjs";

const testedSHA = "a".repeat(40);
const mainSHA = "b".repeat(40);
const tree = "c".repeat(40);
const commandDigest = "d".repeat(64);
const toolsDigest = "e".repeat(64);

function fixture({
  laneId = "macos-native",
  suites = ["client-native", "client-agent-e2e"],
  linux = false,
} = {}) {
  const lane = {
    id: laneId,
    host: linux ? "linux" : "macos",
    timeoutSeconds: 1800,
    suites,
    reasons: ["Source inputs changed."],
  };
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "verify",
    repository: "getsituate/situate",
    source: testedSHA,
    base: "0".repeat(40),
    appImpact: true,
    lanes: [lane],
    reasons: [],
  });
  const receipts = [
    {
      schemaVersion: 1,
      source: testedSHA,
      planDigest: plan.authorizationDigest,
      lane: laneId,
      host: lane.host,
      executionHost: lane.host,
      status: "passed",
      results: suites.map((id) => ({
        id,
        status: "passed",
        exitCode: 0,
        signal: null,
        durationMs: 12,
      })),
    },
  ];
  const host = {
    platform: linux ? "linux" : "darwin",
    arch: linux ? "x64" : "arm64",
    ImageOS: linux ? "ubuntu24" : "macos15",
    ImageVersion: "20260101.1",
    ociDigest: linux ? `sha256:${"f".repeat(64)}` : null,
  };
  const contract = {
    schemaVersion: 1,
    toolsDigest,
    suites: suites.map((id) => ({ id, commandDigest })),
  };
  const evidence = createSourceVerificationEvidence({
    origin: {
      repository: "getsituate/situate",
      repositoryId: "123",
      workflowId: "456",
      workflowPath: ".github/workflows/verify.yml",
      runId: "789",
      runAttempt: "1",
      aggregateJobId: "900",
      workflowDefinitionDigest: "9".repeat(64),
      baseSHA: "0".repeat(40),
      headSHA: "1".repeat(40),
    },
    testedSHA,
    tree,
    plan,
    aggregate: aggregateReceipts(plan, receipts),
    receipts,
    lanes: [
      {
        lane: laneId,
        jobId: "901",
        host,
        contract,
        checkout: { before: "clean", after: "clean", cleanup: "complete" },
      },
    ],
  });
  const observation = {
    origin: structuredClone(evidence.origin),
    trusted: true,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    aggregateConclusion: "success",
    headRepositoryId: "123",
    checkedSHA: testedSHA,
    checkedParents: ["0".repeat(40), "1".repeat(40)],
    tree,
    jobs: [{ lane: laneId, jobId: "901", conclusion: "success" }],
  };
  return {
    candidates: [{ evidence, observation }],
    plan: sealPlan({ ...plan, source: mainSHA }),
    lane: laneId,
    host: structuredClone(host),
    contract: structuredClone(contract),
    source: { sha: mainSHA, tree, clean: true },
    reviewedWorkflowDigest: "9".repeat(64),
  };
}

function execute(input, reason) {
  const result = selectSourceVerificationEvidence(input);
  assert.equal(result.action, "execute");
  if (reason) assert.equal(result.reason, reason);
  assert.equal(result.binding, undefined);
}

test("same whole tree, real host and contract bind reuse without rebasing original evidence", () => {
  const input = fixture();
  const original = structuredClone(input);
  const result = selectSourceVerificationEvidence(input);
  assert.equal(result.action, "reuse");
  assert.deepEqual(result.binding, {
    schemaVersion: 1,
    kind: "source-verification-reuse",
    source: mainSHA,
    planDigest: input.plan.authorizationDigest,
    lane: "macos-native",
    suites: ["client-native", "client-agent-e2e"],
    tree,
    testedSHA,
    originalPlanDigest: input.candidates[0].evidence.plan.authorizationDigest,
    coverage: "reused",
    executedSuites: ["client-native", "client-agent-e2e"],
    originalReceipt: input.candidates[0].evidence.receipts[0],
    contractDigest: result.binding.contractDigest,
    host: input.host,
    origin: input.candidates[0].evidence.origin,
    evidenceDigest: result.binding.evidenceDigest,
  });
  assert.match(result.binding.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.testedSHA, testedSHA);
  assert.equal(result.evidence.plan.source, testedSHA);
  assert.equal(result.evidence.receipts[0].source, testedSHA);
  assert.deepEqual(result.evidence, original.candidates[0].evidence);
  assert.deepEqual(input, original);
});

test("actual Main create source plans accept reuse without effect authorization", async () => {
  for (const baseline of [
    { source: "0".repeat(40), legacy: true },
    {
      source: "0".repeat(40),
      identity: {
        repository: "getsituate/situate",
        tag: "v1.0.0",
        sourceRevision: "0".repeat(40),
        version: "1.0.0",
        operationId: "synthetic-release",
        inputSha256: "2".repeat(64),
        releaseId: 123,
      },
      catalogSha256: "3".repeat(64),
    },
  ]) {
    const input = fixture();
    const selection = input.plan;
    input.plan = await planWorkflow(
      root,
      "create",
      { source: mainSHA, base: selection.base },
      {
        readBaseline: async () => baseline,
        createSourcePlan: async () => ({
          schemaVersion: 1,
          source: mainSHA,
          base: selection.base,
          appImpact: true,
          lanes: selection.lanes,
          reasons: [],
        }),
      },
    );
    assert.equal(input.plan.workflow, "create");
    assert.deepEqual(input.plan.baseline, baseline);
    const result = selectSourceVerificationEvidence(input);
    assert.equal(result.action, "reuse");
    assert.equal(result.binding.planDigest, input.plan.authorizationDigest);
    assert.equal(result.evidence.plan.workflow, "verify");
    for (const patch of [
      { operation: "synthetic-release" },
      { destination: "synthetic.invalid" },
      { verificationPlan: selection },
      { configurationFile: "synthetic-configuration.json" },
      { configurationDigest: "4".repeat(64) },
      { privateConfig: {} },
    ])
      execute(
        { ...input, plan: sealPlan({ ...input.plan, ...patch }) },
        "unresolved-target",
      );
  }
});

test("real runLane/runPlan result fields survive public receipt sanitization", async () => {
  const input = fixture();
  const previous = input.candidates[0].evidence;
  const raw = await runLane(root, previous.plan, "macos-native", {
    host: "darwin",
    assertCheckout: (_root, source) => assert.equal(source, testedSHA),
    environment: { PATH: process.env.PATH },
    inventory: suiteInventory(sourceFiles(root), "darwin"),
    prepare: async () => ({ release() {} }),
    execute: (suite, options) =>
      executeSuite(
        {
          ...suite,
          command: process.execPath,
          args: ["-e", ""],
          cwd: ".",
          kind: "unit",
        },
        { ...options, buildLease: false },
      ),
  });
  const original = structuredClone(raw);
  assert.equal(raw.status, "passed", JSON.stringify(raw.results));
  for (const result of raw.results) {
    assert.equal(result.project, "client");
    assert.equal(result.kind, "native");
    for (const key of [
      "durationMs",
      "preparationDurationMs",
      "resourceQueueWaitMs",
      "executionDurationMs",
    ])
      assert.equal(typeof result[key], "number");
  }
  const sanitized = sanitizeSourceVerificationReceipts(previous.plan, [raw]);
  assert.deepEqual(sanitized, [original]);
  assert.notEqual(sanitized[0], raw);
  assert.deepEqual(raw, original);
  assert.deepEqual(
    aggregateReceipts(previous.plan, sanitized),
    previous.aggregate,
  );
  input.candidates[0].evidence = createSourceVerificationEvidence({
    ...previous,
    receipts: [raw],
  });
  assert.equal(selectSourceVerificationEvidence(input).action, "reuse");
  const receipt =
    selectSourceVerificationEvidence(input).binding.originalReceipt;
  assert.equal(receipt.source, testedSHA);
  assert.equal(receipt.planDigest, previous.plan.authorizationDigest);
  assert.equal(receipt.status, "passed");
  for (const patch of [
    { command: "synthetic-command" },
    { cwd: "synthetic-directory" },
    { environment: { TOKEN: "synthetic" } },
    { stdout: "synthetic output" },
    { error: "synthetic diagnostic" },
    { reused: true },
    { cache: { status: "hit" } },
    { resourceQueueWaitMs: -1 },
    { executionDurationMs: "synthetic" },
    { cleanupIncomplete: true },
    { status: "failed" },
  ]) {
    const unsafe = structuredClone(raw);
    Object.assign(unsafe.results[0], patch);
    assert.throws(() =>
      sanitizeSourceVerificationReceipts(previous.plan, [unsafe]),
    );
  }
  for (const patch of [
    { source: mainSHA },
    { planDigest: "0".repeat(64) },
    { status: "cancelled" },
    { results: [] },
    { path: "synthetic-receipt.json" },
  ])
    assert.throws(() =>
      sanitizeSourceVerificationReceipts(previous.plan, [{ ...raw, ...patch }]),
    );
});

test("offline reuse receipts preserve the original execution and validate full coverage bindings", () => {
  const input = fixture();
  const selected = selectSourceVerificationEvidence(input);
  const selection = {
    ...selected,
    observation: input.candidates[0].observation,
    host: input.host,
    contract: input.contract,
    source: input.source,
    reviewedWorkflowDigest: input.reviewedWorkflowDigest,
  };
  const receipt = createSourceVerificationReuseReceipt(input.plan, selection);
  assert.deepEqual(receipt, {
    schemaVersion: 1,
    kind: "source-verification-reuse",
    coverage: "reused",
    source: mainSHA,
    planDigest: input.plan.authorizationDigest,
    lane: input.lane,
    host: "macos",
    executionHost: "macos",
    status: "passed",
    results: [
      {
        id: "client-native",
        status: "passed",
        exitCode: 0,
        coverage: "reused",
        testedSHA,
      },
      {
        id: "client-agent-e2e",
        status: "passed",
        exitCode: 0,
        coverage: "reused",
        testedSHA,
      },
    ],
    reuse: {
      binding: selected.binding,
      evidence: selected.evidence,
      observation: selection.observation,
      host: input.host,
      contract: input.contract,
      source: input.source,
      reviewedWorkflowDigest: input.reviewedWorkflowDigest,
    },
  });
  const original = structuredClone(receipt);
  assert.equal(validateSourceVerificationReuse(input.plan, receipt), receipt);
  assert.deepEqual(receipt, original);
  assert.equal(receipt.reuse.binding.originalReceipt.source, testedSHA);
  assert.notEqual(
    receipt.reuse.binding.originalReceipt.planDigest,
    receipt.planDigest,
  );
  assert.deepEqual(
    receipt.reuse.binding.originalReceipt,
    input.candidates[0].evidence.receipts[0],
  );
  assert.throws(() =>
    createSourceVerificationReuseReceipt(input.plan, { action: "execute" }),
  );
  assert.throws(
    () =>
      createSourceVerificationEvidence({
        ...selected.evidence,
        receipts: [
          {
            ...receipt,
            source: testedSHA,
            planDigest: selected.evidence.plan.authorizationDigest,
          },
        ],
      }),
    /Unexpected evidence field/,
  );
  assert.throws(
    () =>
      sanitizeSourceVerificationReceipts(selected.evidence.plan, [
        {
          ...selected.binding.originalReceipt,
          results: receipt.results,
        },
      ]),
    /Unexpected evidence field/,
  );
  for (const mutate of [
    (v) => {
      v.coverage = "executed";
    },
    (v) => {
      v.kind = "lane-receipt";
    },
    (v) => {
      v.results[0].testedSHA = mainSHA;
    },
    (v) => {
      v.results[0].coverage = "executed";
    },
    (v) => {
      v.results.pop();
    },
    (v) => {
      v.source = testedSHA;
    },
    (v) => {
      v.planDigest = "0".repeat(64);
    },
    (v) => {
      v.host = "linux";
    },
    (v) => {
      v.executionHost = "linux";
    },
    (v) => {
      v.status = "failed";
    },
    (v) => {
      v.results = v.reuse.binding.originalReceipt.results;
    },
    (v) => {
      v.reuse.binding.originalReceipt.source = mainSHA;
    },
    (v) => {
      v.reuse.binding.executedSuites = [];
    },
    (v) => {
      v.reuse.binding.suites = [];
    },
    (v) => {
      v.reuse.binding.evidenceDigest = "0".repeat(64);
    },
    (v) => {
      v.reuse.observation.aggregateConclusion = "failure";
    },
    (v) => {
      v.reuse.observation.tree = "0".repeat(40);
    },
    (v) => {
      v.reuse.contract.toolsDigest = "0".repeat(64);
    },
    (v) => {
      v.reuse.source.clean = false;
    },
    (v) => {
      v.reuse.host.ImageVersion = "unknown";
    },
    (v) => {
      v.reuse.extra = "unknown";
    },
  ]) {
    const invalid = structuredClone(receipt);
    mutate(invalid);
    assert.throws(
      () => validateSourceVerificationReuse(input.plan, invalid),
      mutate.toString(),
    );
  }
  const timeoutPlan = sealPlan({
    ...input.plan,
    lanes: [{ ...input.plan.lanes[0], timeoutSeconds: 600 }],
  });
  assert.throws(() => validateSourceVerificationReuse(timeoutPlan, receipt));
});

test("successful superset coverage can satisfy an explicitly selected nonempty subset", () => {
  const input = fixture();
  input.plan = sealPlan({
    ...input.plan,
    lanes: [{ ...input.plan.lanes[0], suites: ["client-native"] }],
  });
  input.contract.suites = [input.contract.suites[0]];
  const result = selectSourceVerificationEvidence(input);
  assert.equal(result.action, "reuse");
  assert.deepEqual(result.binding.suites, ["client-native"]);
  assert.equal(result.evidence.receipts[0].results.length, 2);
});

test("changed whole tree, source checkout, tools, command, coverage and host all execute", () => {
  const mutations = [
    (v) => {
      v.source.tree = "f".repeat(40);
    },
    (v) => {
      v.source.sha = testedSHA;
    },
    (v) => {
      v.source.clean = false;
    },
    (v) => {
      v.contract.toolsDigest = "0".repeat(64);
    },
    (v) => {
      v.contract.suites[0].commandDigest = "0".repeat(64);
    },
    (v) => {
      v.contract.suites.pop();
    },
    (v) => {
      v.plan = sealPlan({
        ...v.plan,
        lanes: [{ ...v.plan.lanes[0], timeoutSeconds: 600 }],
      });
    },
    (v) => {
      v.plan = sealPlan({
        ...v.plan,
        lanes: [
          {
            ...v.plan.lanes[0],
            suites: [...v.plan.lanes[0].suites, "client-plugins-e2e"],
          },
        ],
      });
      v.contract.suites.push({ id: "client-plugins-e2e", commandDigest });
    },
    (v) => {
      v.host.platform = "linux";
    },
    (v) => {
      v.host.arch = "x64";
    },
    (v) => {
      v.host.ImageOS = "macos14";
    },
    (v) => {
      v.host.ImageVersion = "20260102.1";
    },
    (v) => {
      delete v.host.ImageVersion;
    },
    (v) => {
      v.host.ImageOS = "unknown";
    },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input);
    execute(input);
  }
});

test("a passing native receipt cannot bypass a failed aggregate policy lane", () => {
  const input = fixture();
  const evidence = input.candidates[0].evidence;
  evidence.plan = sealPlan({
    ...evidence.plan,
    lanes: [
      ...evidence.plan.lanes,
      {
        id: "policy",
        host: "linux",
        timeoutSeconds: 600,
        suites: ["root-lint"],
        reasons: [],
      },
    ],
  });
  evidence.receipts[0].planDigest = evidence.plan.authorizationDigest;
  evidence.receipts.push({
    schemaVersion: 1,
    source: testedSHA,
    planDigest: evidence.plan.authorizationDigest,
    lane: "policy",
    host: "linux",
    executionHost: "linux",
    status: "passed",
    results: [{ id: "root-lint", status: "passed", exitCode: 0 }],
  });
  evidence.aggregate = aggregateReceipts(evidence.plan, evidence.receipts);
  assert.equal(selectSourceVerificationEvidence(input).action, "reuse");
  evidence.receipts[1].results[0].status = "failed";
  execute(input, "no-matching-evidence");
});

test("portable reuse requires the same pinned digest and actual Linux identity", () => {
  const input = fixture({
    laneId: "frontend",
    suites: ["client-vue"],
    linux: true,
  });
  assert.equal(selectSourceVerificationEvidence(input).action, "reuse");
  for (const ociDigest of [null, "latest", `sha256:${"0".repeat(64)}`])
    execute({ ...input, host: { ...input.host, ociDigest } });
});

test("split browser reuse binds only the suites requested in its own lane", () => {
  const chromium = "client-browser-chromium";
  const executor = "client-executor-integration";
  const webkit = "client-browser-webkit-smoke";
  const fullWebkit = "client-browser-webkit";
  const website = "design-website-browser";
  const browser = fixture({
    laneId: "browser",
    suites: [chromium, executor],
    linux: true,
  });
  const splitWebkit = fixture({
    laneId: "browser-webkit",
    suites: [webkit],
    linux: true,
  });
  const mixed = fixture({
    laneId: "browser",
    suites: [chromium, executor, website],
    linux: true,
  });
  const old = fixture({
    laneId: "browser",
    suites: [chromium, executor, fullWebkit],
    linux: true,
  });
  const oldSplit = fixture({
    laneId: "browser-webkit",
    suites: [fullWebkit],
    linux: true,
  });

  const reused = selectSourceVerificationEvidence({
    ...browser,
    candidates: mixed.candidates,
  });
  assert.equal(reused.action, "reuse");
  assert.deepEqual(reused.binding.suites, [chromium, executor]);
  assert.deepEqual(reused.binding.executedSuites, [
    chromium,
    executor,
    website,
  ]);
  execute(mixed, "lane-ineligible");
  assert.equal(selectSourceVerificationEvidence(splitWebkit).action, "reuse");
  execute({ ...browser, candidates: old.candidates }, "lane-contract-differs");
  execute(
    { ...splitWebkit, candidates: old.candidates },
    "lane-evidence-absent",
  );
  execute(
    { ...splitWebkit, candidates: oldSplit.candidates },
    "lane-contract-differs",
  );
});

test("only authenticated evidence supplies equivalence mismatch reasons", () => {
  const input = fixture();
  const differentHost = {
    ...input,
    host: { ...input.host, ImageVersion: "20260102.1" },
  };
  execute(differentHost, "host-differs");
  execute(
    { ...differentHost, source: { ...input.source, tree: "0".repeat(40) } },
    "tree-differs",
  );
  execute(
    { ...input, contract: { ...input.contract, toolsDigest: "0".repeat(64) } },
    "tools-differ",
  );
  const badCommand = structuredClone(input);
  badCommand.contract.suites[0].commandDigest = "0".repeat(64);
  execute(badCommand, "suite-command-differs");
  const narrow = fixture({ suites: ["client-native"] });
  execute(
    { ...input, candidates: narrow.candidates },
    "suite-coverage-incomplete",
  );
  assert.equal(
    selectSourceVerificationEvidence({
      ...input,
      candidates: [...narrow.candidates, ...input.candidates],
    }).action,
    "reuse",
  );
  input.candidates[0].observation.trusted = false;
  execute(differentHost, "no-matching-evidence");
});

test("failed, cancelled, forked, untrusted or forged origin cannot authorize reuse", () => {
  for (const patch of [
    { trusted: false },
    { event: "push" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "cancelled" },
    { aggregateConclusion: "skipped" },
    { headRepositoryId: "999" },
    { checkedSHA: mainSHA },
    { tree: "0".repeat(40) },
  ]) {
    const input = fixture();
    Object.assign(input.candidates[0].observation, patch);
    execute(input);
  }
  for (const [key, value] of Object.entries({
    repository: "other/project",
    repositoryId: "999",
    workflowId: "999",
    workflowPath: ".github/workflows/other.yml",
    runId: "999",
    runAttempt: "2",
    aggregateJobId: "999",
    workflowDefinitionDigest: "0".repeat(64),
    baseSHA: mainSHA,
    headSHA: mainSHA,
  })) {
    const input = fixture();
    input.candidates[0].evidence.origin[key] = value;
    execute(input);
  }
});

test("test-merge parents must match the run-captured base/head, not a newer main", () => {
  const input = fixture();
  assert.notEqual(
    input.candidates[0].evidence.testedSHA,
    input.candidates[0].evidence.origin.headSHA,
  );
  for (const checkedParents of [
    [mainSHA, "1".repeat(40)],
    ["0".repeat(40), mainSHA],
    ["1".repeat(40), "0".repeat(40)],
    [],
    null,
  ]) {
    const changed = structuredClone(input);
    changed.candidates[0].observation.checkedParents = checkedParents;
    execute(changed, "no-matching-evidence");
  }
  const changed = structuredClone(input);
  changed.reviewedWorkflowDigest = "0".repeat(64);
  execute(changed, "no-matching-evidence");
  changed.reviewedWorkflowDigest = undefined;
  execute(changed, "unresolved-target");
});

test("directly tested PR head is distinct from a verified synthetic merge", () => {
  const input = fixture();
  input.candidates[0].evidence.origin.headSHA = testedSHA;
  input.candidates[0].observation.origin.headSHA = testedSHA;
  input.candidates[0].observation.checkedParents = null;
  assert.equal(selectSourceVerificationEvidence(input).action, "reuse");
});

test("missing, failed or mismatched execution jobs cannot satisfy coverage", () => {
  for (const jobs of [
    [],
    [{ lane: "macos-native", jobId: "901", conclusion: "cancelled" }],
    [{ lane: "macos-native", jobId: "999", conclusion: "success" }],
    [{ lane: "macos-code", jobId: "901", conclusion: "success" }],
  ]) {
    const input = fixture();
    input.candidates[0].observation.jobs = jobs;
    execute(input);
  }
});

test("incomplete, failed, empty or modified receipts and plans are rejected", () => {
  const mutations = [
    (v) => {
      v.aggregate.status = "failed";
    },
    (v) => {
      v.receipts[0].status = "cancelled";
    },
    (v) => {
      v.receipts[0].results[0].exitCode = 1;
    },
    (v) => {
      v.receipts[0].results[0].cleanupIncomplete = true;
    },
    (v) => {
      v.receipts[0].results[0].signal = "SIGTERM";
    },
    (v) => {
      v.receipts[0].results[0].status = "not-run";
    },
    (v) => {
      v.receipts[0].results = [];
    },
    (v) => {
      v.receipts[0].source = mainSHA;
    },
    (v) => {
      v.receipts[0].planDigest = "0".repeat(64);
    },
    (v) => {
      v.plan.source = mainSHA;
    },
    (v) => {
      v.lanes[0].checkout.after = "dirty";
    },
    (v) => {
      v.lanes[0].checkout.cleanup = "incomplete";
    },
    (v) => {
      v.lanes[0].contract.suites.pop();
    },
    (v) => {
      v.receipts.push(v.receipts[0]);
    },
    (v) => {
      v.lanes.push(v.lanes[0]);
    },
  ];
  for (const mutate of mutations) {
    const input = fixture();
    mutate(input.candidates[0].evidence);
    assert.throws(() =>
      validateSourceVerificationEvidence(input.candidates[0].evidence),
    );
    execute(input);
  }
});

test("policy, history, unknown suites and unsupported lanes always execute", () => {
  for (const [laneId, suites] of [
    ["policy", ["root-lint", "root-history-secrets"]],
    ["tooling", ["runner-unit"]],
    ["future-lane", ["future-suite"]],
    ["macos-native", ["future-suite"]],
    ["macos-native", ["root-history-secrets"]],
  ])
    execute(fixture({ laneId, suites }), "lane-ineligible");
  const input = fixture();
  input.plan = sealPlan({ ...input.plan, lanes: [] });
  execute(input, "lane-ineligible");
});

test("JSON size, candidate count, unknown public fields and logs are bounded or rejected", () => {
  const input = fixture();
  const evidence = input.candidates[0].evidence;
  assert.deepEqual(
    validateSourceVerificationEvidence(JSON.stringify(evidence)),
    evidence,
  );
  for (const mutate of [
    (v) => {
      v.environment = { TOKEN: "synthetic" };
    },
    (v) => {
      v.receipts[0].results[0].stdout = "synthetic output";
    },
    (v) => {
      v.plan.destination = "synthetic-private-host";
    },
    (v) => {
      v.lanes[0].host.runnerName = "synthetic-runner";
    },
  ]) {
    const value = structuredClone(evidence);
    mutate(value);
    assert.throws(() => createSourceVerificationEvidence(value));
  }
  assert.throws(
    () =>
      validateSourceVerificationEvidence(
        " ".repeat(MAX_SOURCE_EVIDENCE_BYTES + 1),
      ),
    /size limit/,
  );
  execute(
    {
      ...input,
      candidates: Array(MAX_SOURCE_EVIDENCE_CANDIDATES + 1).fill(
        input.candidates[0],
      ),
    },
    "evidence-limit",
  );
  execute({ ...input, candidates: [] }, "evidence-absent");
  execute(
    { ...input, candidates: [{ evidence }, null, { evidence: "not JSON" }] },
    "no-matching-evidence",
  );
  assert.equal(
    selectSourceVerificationEvidence({
      ...input,
      candidates: [null, input.candidates[0]],
    }).action,
    "reuse",
  );
});
