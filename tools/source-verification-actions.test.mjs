import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { root, sourceFiles } from "./test.mjs";
import { aggregateReceipts, digest, sealPlan } from "./pipeline-state.mjs";
import {
  createSourceVerificationEvidence,
  createSourceVerificationReuseReceipt,
  MAX_SOURCE_EVIDENCE_BYTES,
  validateSourceVerificationReuse,
} from "./source-verification-evidence.mjs";
import {
  captureLaneEvidence,
  createSourceVerificationApi,
  publishSourceVerificationEvidence,
  readSourceVerificationArchive,
  readSourceVerificationArchiveMember,
  selectActionsSourceEvidence,
} from "./source-verification-actions.mjs";

const testedSHA = "a".repeat(40);
const mainSHA = "b".repeat(40);
const tree = "c".repeat(40);
const baseSHA = "d".repeat(40);
const headSHA = "e".repeat(40);
const workflow = "name: Verify\njobs: {}\n";
const files = sourceFiles(root);
const image = `ghcr.io/getsituate/situate-ci-linux@sha256:${"f".repeat(64)}`;

function zip(
  payload,
  {
    name = "evidence.json",
    method = 8,
    descriptor = true,
    mode = 0o100600,
  } = {},
) {
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(JSON.stringify(payload));
  const compressed = method === 8 ? deflateRawSync(data) : data;
  const filename = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(descriptor ? 8 : 0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(filename.length, 26);
  if (!descriptor) {
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
  }
  const trailer = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) {
    trailer.writeUInt32LE(0x08074b50);
    trailer.writeUInt32LE(crc32(data), 4);
    trailer.writeUInt32LE(compressed.length, 8);
    trailer.writeUInt32LE(data.length, 12);
  }
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(descriptor ? 8 : 0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE((mode << 16) >>> 0, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(
    local.length + filename.length + compressed.length + trailer.length,
    16,
  );
  return Buffer.concat([
    local,
    filename,
    compressed,
    trailer,
    central,
    filename,
    end,
  ]);
}

function fixture() {
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "verify",
    repository: "getsituate/situate",
    source: testedSHA,
    base: baseSHA,
    appImpact: true,
    reasons: [],
    lanes: [
      {
        id: "macos-native",
        host: "macos",
        suites: ["client-native"],
        timeoutSeconds: 1800,
        reasons: [],
      },
    ],
  });
  const measured = {
    host: {
      platform: "darwin",
      arch: "arm64",
      ImageOS: "macos15",
      ImageVersion: "20260101.1",
      ociDigest: null,
    },
    contract: {
      schemaVersion: 1,
      toolsDigest: "1".repeat(64),
      suites: [{ id: "client-native", commandDigest: "2".repeat(64) }],
    },
    checkout: { before: "clean", after: "clean", cleanup: "complete" },
  };
  const receipts = [
    {
      schemaVersion: 1,
      source: testedSHA,
      planDigest: plan.authorizationDigest,
      lane: "macos-native",
      host: "macos",
      executionHost: "macos",
      status: "passed",
      results: [
        {
          id: "client-native",
          status: "passed",
          exitCode: 0,
          resourceQueueWaitMs: 0,
          executionDurationMs: 1,
        },
      ],
    },
  ];
  const evidence = createSourceVerificationEvidence({
    origin: {
      repository: "getsituate/situate",
      repositoryId: "1455575895",
      workflowId: "417380313",
      workflowPath: ".github/workflows/verify.yml",
      runId: "123",
      runAttempt: "2",
      aggregateJobId: "456",
      workflowDefinitionDigest: digest(workflow),
      baseSHA,
      headSHA,
    },
    testedSHA,
    tree,
    plan,
    aggregate: aggregateReceipts(plan, receipts),
    receipts,
    lanes: [{ lane: "macos-native", jobId: "789", ...measured }],
  });
  const run = {
    id: 123,
    run_attempt: 2,
    workflow_id: 417380313,
    path: ".github/workflows/verify.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: headSHA,
    repository: { id: 1455575895, full_name: "getsituate/situate" },
    head_repository: { id: 1455575895, full_name: "getsituate/situate" },
    pull_requests: [
      {
        number: 31,
        base: { ref: "main", sha: baseSHA, repo: { id: 1455575895 } },
        head: { sha: headSHA, repo: { id: 1455575895 } },
      },
    ],
  };
  const jobs = [
    {
      id: 456,
      run_id: 123,
      run_attempt: 2,
      name: "PR verification",
      status: "completed",
      conclusion: "success",
    },
    {
      id: 789,
      run_id: 123,
      run_attempt: 2,
      name: "macos-native",
      status: "completed",
      conclusion: "success",
    },
  ];
  const bytes = zip(evidence);
  const artifact = {
    id: 987,
    name: "source-verification-2",
    expired: false,
    size_in_bytes: bytes.length,
    digest: `sha256:${digest(bytes)}`,
    workflow_run: {
      id: 123,
      repository_id: 1455575895,
      head_repository_id: 1455575895,
      head_sha: headSHA,
    },
  };
  const data = {
    workflow: {
      id: 417380313,
      path: ".github/workflows/verify.yml",
      state: "active",
    },
    run,
    jobs,
    artifacts: [artifact],
    bytes,
    listed: [run],
    proof: {
      checkedSHA: testedSHA,
      workflowSHA: testedSHA,
      subjectDigest: digest(Buffer.from(JSON.stringify(evidence))),
      runId: "123",
      runAttempt: "2",
    },
    associated: [
      {
        ...structuredClone(run.pull_requests[0]),
        state: "closed",
        merged_at: "2026-11-16T23:35:07Z",
        merge_commit_sha: mainSHA,
      },
    ],
    producerDefinition: workflow,
    producerCommit: {
      sha: testedSHA,
      tree: { sha: tree },
      parents: [{ sha: baseSHA }, { sha: headSHA }],
    },
  };
  const requests = [];
  const api = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/actions/workflows/417380313")
      return structuredClone(data.workflow);
    if (
      path ===
      "/actions/workflows/417380313/runs?event=pull_request&status=completed&per_page=20"
    )
      return {
        total_count: data.listed.length,
        workflow_runs: structuredClone(data.listed),
      };
    if (path === "/actions/runs/123/attempts/2")
      return structuredClone(data.run);
    if (path === `/commits/${headSHA}/pulls?per_page=100`)
      return structuredClone(data.associated);
    if (path === "/actions/runs/123/attempts/2/jobs?per_page=100")
      return {
        total_count: data.jobs.length,
        jobs: structuredClone(data.jobs),
      };
    if (path === "/actions/runs/123/artifacts?per_page=100")
      return {
        total_count: data.artifacts.length,
        artifacts: structuredClone(data.artifacts),
      };
    if (path === "/actions/artifacts/987/zip") return Buffer.from(data.bytes);
    if (path === `/git/commits/${testedSHA}`)
      return structuredClone(data.producerCommit);
    if (path === `/contents/.github/workflows/verify.yml?ref=${testedSHA}`)
      return {
        type: "file",
        path: ".github/workflows/verify.yml",
        encoding: "base64",
        size: Buffer.byteLength(data.producerDefinition),
        content: Buffer.from(data.producerDefinition).toString("base64"),
      };
    throw new Error(`Unexpected synthetic endpoint: ${path}`);
  };
  const execute = (command, args) => {
    assert.equal(command, "git");
    if (args.join(" ") === "rev-parse HEAD") return mainSHA;
    if (args[0] === "status") return "";
    if (args[0] === "show" && args.includes("--no-patch")) {
      if (args.includes(testedSHA))
        throw new Error("Producer commit not in local checkout");
      return `${tree}\n${baseSHA}\n`;
    }
    if (args.join(" ") === `show ${testedSHA}:.github/workflows/verify.yml`)
      throw new Error("Producer definition not in local checkout");
    if (args.join(" ") === `show ${mainSHA}:.github/workflows/verify.yml`)
      return workflow;
    throw new Error(`Unexpected synthetic Git command: ${args}`);
  };
  const options = {
    plan: sealPlan({
      ...plan,
      workflow: "create",
      source: mainSHA,
      baseline: { source: baseSHA, legacy: true },
    }),
    lane: "macos-native",
    environment: {
      GITHUB_REPOSITORY: "getsituate/situate",
      GITHUB_REPOSITORY_ID: "1455575895",
      CI: "true",
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "github-hosted",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REF_PROTECTED: "true",
      GITHUB_WORKFLOW_REF:
        "getsituate/situate/.github/workflows/release-macos.yml@refs/heads/main",
      GITHUB_SHA: mainSHA,
    },
    api,
    execute,
    capture: () => structuredClone(measured),
    verifyAttestation: async (_jsonBytes, context) => {
      assert.equal(context.runId, 123);
      assert.equal(context.runAttempt, 2);
      assert.equal(context.pullNumber, 31);
      return structuredClone(data.proof);
    },
  };
  return {
    plan,
    receipts,
    measured,
    evidence,
    data,
    api,
    execute,
    options,
    requests,
  };
}

test("consumer retrieves an attempt-bound artifact and independently resolves source provenance", async () => {
  const f = fixture();
  const result = await selectActionsSourceEvidence(root, f.options);
  assert.equal(result.action, "reuse");
  assert.equal(result.binding.source, mainSHA);
  assert.equal(result.binding.testedSHA, testedSHA);
  assert.deepEqual(result.binding.originalReceipt, f.receipts[0]);
  assert.deepEqual(result.observation.checkedParents, [baseSHA, headSHA]);
  assert.equal(result.source.tree, tree);
  assert.equal(result.contract.toolsDigest, f.measured.contract.toolsDigest);
  const receipt = createSourceVerificationReuseReceipt(f.options.plan, result);
  assert.equal(receipt.kind, "source-verification-reuse");
  assert.deepEqual(receipt.results, [
    {
      id: "client-native",
      status: "passed",
      exitCode: 0,
      coverage: "reused",
      testedSHA,
    },
  ]);
  assert.deepEqual(receipt.reuse.binding.originalReceipt, f.receipts[0]);
  assert.equal(
    validateSourceVerificationReuse(f.options.plan, receipt),
    receipt,
  );
  assert(f.requests.some(({ path }) => path === `/git/commits/${testedSHA}`));
  assert(f.requests.some(({ path }) => path.startsWith("/contents/")));
  assert(!f.requests.some(({ path }) => path.startsWith("/commits/")));
  assert.deepEqual(
    f.requests.find(({ path }) => path.endsWith("/zip")).options,
    { raw: true, maxBytes: MAX_SOURCE_EVIDENCE_BYTES + 1024 * 1024 },
  );
});

test("consumer reports a host mismatch only after verifying candidate provenance", async () => {
  const f = fixture();
  f.measured.host.ImageVersion = "20990101.1";
  assert.deepEqual(await selectActionsSourceEvidence(root, f.options), {
    action: "execute",
    reason: "host-differs",
    diagnostics: { candidates: 1, rejected: { "host-differs": 1 } },
  });
  f.options.verifyAttestation = async () => {
    throw new Error("synthetic private value");
  };
  assert.deepEqual(await selectActionsSourceEvidence(root, f.options), {
    action: "execute",
    reason: "no-matching-evidence",
    diagnostics: { candidates: 1, rejected: { "attestation-rejected": 1 } },
  });
});

test("a completed post-merge run with no PR snapshot uses its unique merged head association", async () => {
  const f = fixture();
  f.data.run.pull_requests = [];
  assert.equal(f.data.associated[0].merged, undefined);
  const result = await selectActionsSourceEvidence(root, f.options);
  assert.equal(result.action, "reuse");
  assert.equal(result.observation.origin.baseSHA, baseSHA);
  assert.equal(result.observation.origin.headSHA, headSHA);
  assert.equal(result.observation.checkedSHA, testedSHA);
  assert.notEqual(
    result.observation.checkedSHA,
    f.data.associated[0].merge_commit_sha,
  );
  assert.deepEqual(result.observation.checkedParents, [baseSHA, headSHA]);
  assert.deepEqual(
    f.requests
      .filter(({ path }) => path.startsWith("/commits/"))
      .map(({ path }) => path),
    [`/commits/${headSHA}/pulls?per_page=100`],
  );
  const receipt = createSourceVerificationReuseReceipt(f.options.plan, result);
  assert.equal(
    validateSourceVerificationReuse(f.options.plan, receipt),
    receipt,
  );
});

test("post-merge associations must be unique, closed, merged and match the certified base/head and PR ref", async () => {
  for (const mutate of [
    (f) => {
      f.data.associated = [];
    },
    (f) => {
      f.data.associated = null;
    },
    (f) => {
      f.data.associated = {};
    },
    (f) => {
      f.data.associated = [null];
    },
    (f) => {
      f.data.associated.push(structuredClone(f.data.associated[0]));
    },
    (f) => {
      f.data.associated = Array(100).fill(f.data.associated[0]);
    },
    (f) => {
      f.data.associated[0].state = "open";
    },
    (f) => {
      f.data.associated[0].merged = false;
    },
    (f) => {
      f.data.associated[0].merged_at = null;
    },
    (f) => {
      f.data.associated[0].merged_at = "not-a-timestamp";
    },
    (f) => {
      f.data.associated[0].merge_commit_sha = null;
    },
    (f) => {
      f.data.associated[0].merge_commit_sha = "not-a-commit";
    },
    (f) => {
      f.data.associated[0].head.sha = mainSHA;
    },
    (f) => {
      f.data.associated[0].base.sha = mainSHA;
    },
    (f) => {
      f.data.associated[0].head.repo.id = 1;
    },
    (f) => {
      f.data.associated[0].base.repo.id = 1;
    },
    (f) => {
      f.data.associated[0].base.ref = "another-branch";
    },
    (f) => {
      f.data.associated[0].number = 0;
    },
    (f) => {
      f.data.associated[0].number = 1.5;
    },
    (f) => {
      f.data.associated[0].number = 32;
    },
    (f) => {
      f.options.api = (path, options) => {
        if (path.startsWith("/commits/"))
          throw new Error("Association API unavailable");
        return f.api(path, options);
      };
    },
  ]) {
    const f = fixture();
    f.data.run.pull_requests = [];
    mutate(f);
    const result = await selectActionsSourceEvidence(root, f.options);
    assert.equal(result.action, "execute", mutate.toString());
    assert.equal(result.binding, undefined);
  }
});

test("captured PR snapshots and unsuccessful attempts cannot be replaced by a later association", async () => {
  for (const mutate of [
    (f) => {
      f.data.run.pull_requests[0].base.sha = mainSHA;
    },
    (f) => {
      f.data.run.pull_requests = null;
    },
    (f) => {
      f.data.run.pull_requests = {};
    },
    (f) => {
      f.data.run.pull_requests = [];
      f.data.run.status = "in_progress";
      f.data.run.conclusion = null;
    },
    (f) => {
      f.data.run.pull_requests = [];
      f.data.run.conclusion = "failure";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(
      (await selectActionsSourceEvidence(root, f.options)).action,
      "execute",
    );
    assert(!f.requests.some(({ path }) => path.startsWith("/commits/")));
  }
});

test("commit associations use one fixed bounded GET and reject pagination or other commit routes", async () => {
  const f = fixture();
  const requests = [];
  const api = createSourceVerificationApi({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), method: options.method });
      return new Response(JSON.stringify(f.data.associated));
    },
  });
  const endpoint = `/commits/${headSHA}/pulls?per_page=100`;
  assert.deepEqual(await api(endpoint), f.data.associated);
  assert.deepEqual(requests, [
    {
      url: `https://api.github.com/repos/getsituate/situate${endpoint}`,
      method: "GET",
    },
  ]);
  for (const endpoint of [
    `/commits/${headSHA}/pulls`,
    `/commits/${headSHA}/pulls?per_page=1`,
    `/commits/${headSHA}/pulls?per_page=100&page=2`,
    `/commits/${headSHA}/pulls?per_page=100\n`,
    `/commits/${headSHA}`,
    "/commits/not-a-commit/pulls?per_page=100",
    "/pulls/31",
    "https://example.org/commits/other/pulls?per_page=100",
  ])
    await assert.rejects(api(endpoint));
  assert.equal(requests.length, 1);
  const truncated = createSourceVerificationApi({
    fetchImpl: async () =>
      new Response(JSON.stringify(f.data.associated), {
        headers: {
          link: `<https://api.github.com/repos/getsituate/situate${endpoint}&page=2>; rel="next"`,
        },
      }),
  });
  await assert.rejects(truncated(endpoint), /Truncated/);
});

test("attested execution, not an artifact-selected merge with the same parents, anchors reuse", async () => {
  const f = fixture();
  const actualSHA = "f".repeat(40);
  const actual = {
    sha: actualSHA,
    tree: { sha: "0".repeat(40) },
    parents: [{ sha: baseSHA }, { sha: headSHA }],
  };
  assert.deepEqual(actual.parents, f.data.producerCommit.parents);
  assert.notEqual(actual.tree.sha, f.data.producerCommit.tree.sha);
  f.data.proof.checkedSHA = actualSHA;
  const api = f.options.api;
  f.options.api = (path, options) =>
    path === `/git/commits/${actualSHA}`
      ? structuredClone(actual)
      : api(path, options);
  assert.equal(
    (await selectActionsSourceEvidence(root, f.options)).action,
    "execute",
  );
  assert(!f.requests.some(({ path }) => path === `/git/commits/${testedSHA}`));
});

test("a claimed PR head cannot replace the platform-attested test merge", async () => {
  const f = fixture();
  const plan = sealPlan({ ...f.plan, source: headSHA });
  const receipts = f.receipts.map((receipt) => ({
    ...receipt,
    source: headSHA,
    planDigest: plan.authorizationDigest,
  }));
  const evidence = createSourceVerificationEvidence({
    ...f.evidence,
    testedSHA: headSHA,
    plan,
    receipts,
    aggregate: aggregateReceipts(plan, receipts),
  });
  const raw = Buffer.from(JSON.stringify(evidence));
  f.data.bytes = zip(raw);
  f.data.artifacts[0].digest = `sha256:${digest(f.data.bytes)}`;
  f.data.artifacts[0].size_in_bytes = f.data.bytes.length;
  f.data.proof.subjectDigest = digest(raw);
  const api = f.options.api;
  f.options.api = (path, options) => {
    if (path === `/git/commits/${headSHA}`)
      return { sha: headSHA, tree: { sha: tree }, parents: [{ sha: baseSHA }] };
    if (path === `/contents/.github/workflows/verify.yml?ref=${headSHA}`)
      return {
        type: "file",
        path: ".github/workflows/verify.yml",
        encoding: "base64",
        size: Buffer.byteLength(workflow),
        content: Buffer.from(workflow).toString("base64"),
      };
    return api(path, options);
  };
  assert.equal(f.data.proof.checkedSHA, testedSHA);
  assert.equal(
    (await selectActionsSourceEvidence(root, f.options)).action,
    "execute",
  );
});

test("the attested workflow revision must contain the approved definition", async () => {
  const f = fixture();
  const executedWorkflowSHA = "9".repeat(40);
  const unapproved = "name: Unapproved\n";
  f.data.proof.workflowSHA = executedWorkflowSHA;
  const api = f.options.api;
  let readExecuted = false;
  f.options.api = (path, options) => {
    if (
      path ===
      `/contents/.github/workflows/verify.yml?ref=${executedWorkflowSHA}`
    ) {
      readExecuted = true;
      return {
        type: "file",
        path: ".github/workflows/verify.yml",
        encoding: "base64",
        size: Buffer.byteLength(unapproved),
        content: Buffer.from(unapproved).toString("base64"),
      };
    }
    return api(path, options);
  };
  assert.equal(
    (await selectActionsSourceEvidence(root, f.options)).action,
    "execute",
  );
  assert(readExecuted);
});

test("unattested and byte-changed artifacts execute even when parsed evidence is identical", async () => {
  const f = fixture();
  f.options.verifyAttestation = async () => null;
  assert.equal(
    (await selectActionsSourceEvidence(root, f.options)).action,
    "execute",
  );
  const changed = fixture();
  const raw = Buffer.from(`${JSON.stringify(changed.evidence, null, 2)}\n`);
  changed.data.bytes = zip(raw);
  changed.data.artifacts[0].digest = `sha256:${digest(changed.data.bytes)}`;
  changed.data.artifacts[0].size_in_bytes = changed.data.bytes.length;
  assert.deepEqual(
    readSourceVerificationArchive(changed.data.bytes),
    changed.evidence,
  );
  assert.deepEqual(
    readSourceVerificationArchiveMember(changed.data.bytes).jsonBytes,
    raw,
  );
  assert.notEqual(changed.data.proof.subjectDigest, digest(raw));
  assert.equal(
    (await selectActionsSourceEvidence(root, changed.options)).action,
    "execute",
  );
  const noCredentials = fixture();
  delete noCredentials.options.verifyAttestation;
  assert.equal(
    (await selectActionsSourceEvidence(root, noCredentials.options)).action,
    "execute",
  );
});

test("consumer never trusts failed, forked, raced, altered or incomplete producers", async () => {
  const mutations = [
    (f) => {
      f.data.run.repository.id = 1;
    },
    (f) => {
      f.data.run.head_repository.id = 1;
    },
    (f) => {
      f.data.run.workflow_id = 1;
    },
    (f) => {
      f.data.workflow.path = ".github/workflows/other.yml";
    },
    (f) => {
      f.data.run.run_attempt = 3;
    },
    (f) => {
      f.data.run.conclusion = "failure";
    },
    (f) => {
      f.data.run.event = "push";
    },
    (f) => {
      f.data.run.pull_requests[0].base.sha = mainSHA;
    },
    (f) => {
      f.data.run.pull_requests[0].head.sha = mainSHA;
    },
    (f) => {
      f.data.run.pull_requests = null;
    },
    (f) => {
      f.data.jobs[0].conclusion = "skipped";
    },
    (f) => {
      f.data.jobs[1].conclusion = "cancelled";
    },
    (f) => {
      f.data.jobs[1].id = 777;
    },
    (f) => {
      f.data.jobs.push(f.data.jobs[1]);
    },
    (f) => {
      f.data.artifacts.push(f.data.artifacts[0]);
    },
    (f) => {
      f.data.artifacts[0].name = "source-verification-1";
    },
    (f) => {
      f.data.artifacts[0].workflow_run.head_sha = mainSHA;
    },
    (f) => {
      f.data.artifacts[0].workflow_run.repository_id = 1;
    },
    (f) => {
      f.data.artifacts[0].expired = true;
    },
    (f) => {
      f.data.artifacts[0].size_in_bytes = 2 * 1024 * 1024;
    },
    (f) => {
      f.data.artifacts[0].digest = `sha256:${"0".repeat(64)}`;
    },
    (f) => {
      f.data.producerDefinition = "name: Unapproved\n";
    },
    (f) => {
      f.data.producerCommit.tree.sha = "0".repeat(40);
    },
    (f) => {
      f.data.producerCommit.parents[0].sha = mainSHA;
    },
    (f) => {
      f.options.capture = () => null;
    },
    (f) => {
      f.options.execute = () => {
        throw new Error("Unreadable checkout");
      };
    },
    (f) => {
      f.options.execute = (command, args, options) =>
        args[0] === "status" && f.requests.length
          ? " M changed-during-lookup"
          : f.execute(command, args, options);
    },
    (f) => {
      f.options.environment.GITHUB_REF_PROTECTED = "false";
    },
    (f) => {
      f.options.environment.GITHUB_WORKFLOW_REF =
        "getsituate/situate/.github/workflows/other.yml@refs/heads/main";
    },
    (f) => {
      f.options.environment.GITHUB_REPOSITORY_ID = "1";
    },
    (f) => {
      f.options.environment.GITHUB_SHA = testedSHA;
    },
    (f) => {
      f.data.listed = Array(21).fill(f.data.run);
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    const result = await selectActionsSourceEvidence(root, f.options);
    assert.equal(result.action, "execute", mutate.toString());
    assert.equal(result.binding, undefined);
  }
});

test("missing artifacts, unavailable APIs and optional digests never invent coverage", async () => {
  const f = fixture();
  f.data.artifacts = [];
  f.data.listed = Array(20).fill(f.data.run);
  assert.deepEqual(await selectActionsSourceEvidence(root, f.options), {
    action: "execute",
    reason: "no-matching-evidence",
    diagnostics: { candidates: 20, rejected: { "artifact-missing": 20 } },
  });
  assert.deepEqual(
    await selectActionsSourceEvidence(root, {
      ...f.options,
      api: async () => {
        throw new Error("synthetic private value");
      },
    }),
    {
      action: "execute",
      reason: "evidence-unavailable",
      stage: "candidate-list-unavailable",
      diagnostics: { candidates: 0, rejected: {} },
    },
  );
  const fresh = fixture();
  delete fresh.data.artifacts[0].digest;
  assert.equal(
    (await selectActionsSourceEvidence(root, fresh.options)).action,
    "reuse",
  );
});

test("ZIP parsing accepts small stored/deflated Actions members without extracting files", () => {
  const f = fixture();
  for (const method of [0, 8])
    for (const descriptor of [false, true])
      assert.deepEqual(
        readSourceVerificationArchive(zip(f.evidence, { method, descriptor })),
        f.evidence,
      );
  for (const options of [
    { name: "../evidence.json" },
    { name: "folder/evidence.json" },
    { mode: 0o120600 },
    { mode: 0o100700 },
  ])
    assert.throws(() =>
      readSourceVerificationArchive(zip(f.evidence, options)),
    );
  for (const mutate of [
    (b) => b.writeUInt16LE(2, b.length - 12),
    (b) => b.writeUInt16LE(1, 6),
    (b) => b.writeUInt32LE(0, b.length - 16),
    (b) =>
      b.writeUInt32LE(
        MAX_SOURCE_EVIDENCE_BYTES + 1,
        b.readUInt32LE(b.length - 6) + 24,
      ),
    (b) => b.writeUInt32LE(0, b.readUInt32LE(b.length - 6) + 16),
  ]) {
    const bytes = Buffer.from(f.data.bytes);
    mutate(bytes);
    assert.throws(() => readSourceVerificationArchive(bytes));
  }
  assert.throws(() =>
    readSourceVerificationArchive(
      zip(Buffer.from(" ".repeat(MAX_SOURCE_EVIDENCE_BYTES + 1))),
    ),
  );
  assert.throws(() =>
    readSourceVerificationArchive(
      Buffer.concat([f.data.bytes, Buffer.from("extra")]),
    ),
  );
});

test("GET transport bounds streamed bytes and never carries auth to artifact storage", async () => {
  const calls = [];
  const api = createSourceVerificationApi({
    token: "synthetic-token",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1)
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://productionresults123.blob.core.windows.net/artifact?synthetic=1",
          },
        });
      return new Response(Buffer.from("zip"));
    },
  });
  assert.deepEqual(
    await api("/actions/artifacts/987/zip", { raw: true, maxBytes: 10 }),
    Buffer.from("zip"),
  );
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer synthetic-token",
  );
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.redirect, "error");
  assert(calls.every(({ options }) => options.method === "GET"));
  for (const location of [
    "https://example.org/payload",
    "http://productionresults123.blob.core.windows.net/a",
    "https://user:pass@productionresults123.blob.core.windows.net/a",
    "https://api.github.com/repos/other/project",
  ]) {
    let count = 0;
    const denied = createSourceVerificationApi({
      token: "synthetic-token",
      fetchImpl: async () => {
        count++;
        return new Response(null, { status: 302, headers: { location } });
      },
    });
    await assert.rejects(denied("/actions/artifacts/987/zip", { raw: true }));
    assert.equal(count, 1);
  }
  const bounded = createSourceVerificationApi({
    fetchImpl: async () => new Response("12345"),
  });
  await assert.rejects(
    bounded("/actions/workflows/417380313", { maxBytes: 4 }),
  );
  const declared = createSourceVerificationApi({
    fetchImpl: async () =>
      new Response("{}", { headers: { "content-length": "99999999" } }),
  });
  await assert.rejects(declared("/actions/workflows/417380313"));
  await assert.rejects(bounded("https://example.org"));
  await assert.rejects(bounded("/actions/../../other/project"));
});

test("only a newly uploaded archive retries 404 and stops after six retries", async () => {
  const endpoint = "/actions/artifacts/987/zip";
  const statuses = [404, 403, 404, 200, ...Array(7).fill(404)];
  const waits = [];
  const api = createSourceVerificationApi({
    fetchImpl: async (url) => {
      assert.equal(url.pathname, `/repos/getsituate/situate${endpoint}`);
      assert(statuses.length);
      return new Response("zip", { status: statuses.shift() });
    },
    wait: async (ms) => waits.push(ms),
  });
  await assert.rejects(api(endpoint, { raw: true }), { actual: 404 });
  const options = { raw: true, newlyUploaded: true };
  await assert.rejects(api(endpoint, options), { actual: 403 });
  assert.deepEqual(waits, []);
  assert.deepEqual(await api(endpoint, options), Buffer.from("zip"));
  assert.deepEqual(waits, [5_000]);
  await assert.rejects(api(endpoint, options), { actual: 404 });
  assert.deepEqual(waits, Array(7).fill(5_000));
  assert.deepEqual(statuses, []);
});

test("source reuse requires the named lane step to pass on the shared ARM64 runner", async () => {
  const f = fixture();
  const job = f.data.jobs[1];
  job.name = "macos-arm64";
  job.steps = [
    { name: "macos-code", status: "completed", conclusion: "success" },
    { name: "macos-native", status: "completed", conclusion: "success" },
  ];
  assert.equal(
    (await selectActionsSourceEvidence(root, f.options)).action,
    "reuse",
  );
  job.steps[1].conclusion = "skipped";
  assert.equal(
    (await selectActionsSourceEvidence(root, f.options)).action,
    "execute",
  );
  job.steps.pop();
  assert.equal(
    (await selectActionsSourceEvidence(root, f.options)).action,
    "execute",
  );
});

function publisherFixture(t) {
  const f = fixture();
  f.data.run.status = "in_progress";
  f.data.run.conclusion = null;
  f.data.jobs[0].status = "in_progress";
  f.data.jobs[0].conclusion = null;
  f.data.jobs[1].name = "macos-arm64";
  f.data.jobs[1].steps = [
    { name: "macos-native", status: "completed", conclusion: "success" },
  ];
  const temporary = realpathSync(
    mkdtempSync(join(tmpdir(), "source-evidence-")),
  );
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const environment = {
    ...f.options.environment,
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_JOB: "required",
    GITHUB_SHA: testedSHA,
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "2",
    RUNNER_TEMP: temporary,
  };
  const execute = (command, args, options) => {
    if (args.join(" ") === "rev-parse HEAD") return testedSHA;
    if (args[0] === "show" && args.includes("--no-patch"))
      return `${tree}\n${baseSHA} ${headSHA}\n`;
    if (args.join(" ") === `show ${testedSHA}:.github/workflows/verify.yml`)
      return workflow;
    return f.execute(command, args, options);
  };
  const needs = {
    plan: { result: "success" },
    "macos-native": {
      result: "success",
      outputs: { evidence: JSON.stringify(f.measured) },
    },
  };
  return {
    f,
    temporary,
    options: {
      plan: f.plan,
      receipts: f.receipts,
      needs,
      environment,
      execute,
      api: f.api,
    },
  };
}

test("publisher writes only a bounded owned artifact after independent job and merge checks", async (t) => {
  const { f, options, temporary } = publisherFixture(t);
  const { needs, environment, execute } = options;
  for (const rejected of [
    { ...options, environment: { ...environment, GITHUB_JOB: "unrecognized" } },
    { ...options, receipts: [{ ...f.receipts[0], status: "cancelled" }] },
    {
      ...options,
      needs: {
        ...needs,
        "macos-native": {
          result: "success",
          outputs: {
            evidence: JSON.stringify({
              ...f.measured,
              environment: { TOKEN: "synthetic" },
            }),
          },
        },
      },
    },
    {
      ...options,
      execute: (command, args, config) =>
        args.includes("--no-patch")
          ? `${tree}\n${mainSHA} ${headSHA}\n`
          : execute(command, args, config),
    },
  ]) {
    assert.match(
      (await publishSourceVerificationEvidence(root, rejected)).reason,
      /^(publisher-context|receipt-validation|lane-capture-invalid|producer-checkout)$/,
    );
    assert(!existsSync(join(temporary, "source-verification-2")));
  }
  assert.deepEqual(
    await publishSourceVerificationEvidence(root, {
      ...options,
      needs: { ...needs, "macos-native": { result: "success" } },
    }),
    { reason: "lane-capture-absent" },
  );
  const { path, capturedLanes } = await publishSourceVerificationEvidence(
    root,
    options,
  );
  assert.equal(capturedLanes, 1);
  assert.equal(path, join(temporary, "source-verification-2/evidence.json"));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), f.evidence);
  assert.deepEqual(await publishSourceVerificationEvidence(root, options), {
    reason: "evidence-storage",
  });
  needs["macos-native"].result = "failure";
  assert.deepEqual(await publishSourceVerificationEvidence(root, options), {
    reason: "lane-job-provenance",
  });
});

test("capture measures actual process identity and excludes tokens and ephemeral locations", () => {
  const f = fixture();
  const linux = process.platform === "linux";
  const plan = sealPlan({
    ...f.plan,
    lanes: [
      {
        id: linux ? "browser-webkit" : "macos-native",
        host: linux ? "linux" : "macos",
        suites: [linux ? "client-browser-webkit-smoke" : "client-native"],
        timeoutSeconds: 1800,
        reasons: [],
      },
    ],
  });
  const environment = {
    PATH: process.env.PATH,
    ImageOS: linux ? "ubuntu24" : "macos15",
    ImageVersion: "20260101.1",
    SITUATE_TOOL_CONTAINER: linux ? "1" : "0",
    SITUATE_CI_IMAGE: image,
    GITHUB_TOKEN: "synthetic-secret",
    HOME: "/synthetic/home",
    TMPDIR: "/synthetic/tmp",
  };
  const probes = [];
  const execute = (command, args, options) => {
    if (command !== "git") {
      probes.push(options.env);
      if (command === "rustup" || command.startsWith("/synthetic/toolchain/")) {
        assert.equal(options.cwd, join(root, "client"));
        assert.equal(options.env.RUSTUP_AUTO_INSTALL, "0");
        if (command === "rustup") return `/synthetic/toolchain/bin/${args[1]}`;
        if (command.endsWith("/rustc"))
          return "rustc 1.98.1 (synthetic)\nrelease: 1.98.1\nhost: synthetic-host";
        return "cargo 1.98.1 (synthetic)";
      }
      return command === "npm" ? "11.12.0" : "synthetic-tool-version";
    }
    if (args.join(" ") === "rev-parse HEAD") return testedSHA;
    if (args[0] === "status") return "";
    if (args.includes("--no-patch")) return `${tree}\n${baseSHA} ${headSHA}\n`;
    if (args[0] === "ls-tree") return files.join("\n");
    if (args[1].endsWith(":package.json"))
      return JSON.stringify({
        volta: { node: process.versions.node, npm: "11.12.0" },
      });
    if (args[1].endsWith(":tools/ci-image.lock.json"))
      return JSON.stringify({ image });
    if (args[1].endsWith(":client/rust-toolchain.toml"))
      return '[toolchain]\nchannel = "1.98.1"';
    throw new Error(`Unexpected synthetic command: ${command} ${args}`);
  };
  const options = { plan, lane: plan.lanes[0].id, environment, execute };
  const measured = captureLaneEvidence(root, options);
  if (linux && !existsSync("/.dockerenv")) {
    assert.equal(measured, null);
    return;
  }
  assert(measured);
  assert.equal(measured.host.platform, process.platform);
  assert.equal(measured.host.arch, process.arch);
  assert(!JSON.stringify(measured).includes("synthetic-secret"));
  assert(probes.every((env) => env.GITHUB_TOKEN === undefined));
  const rustPlan = sealPlan({
    ...plan,
    lanes: [
      {
        ...plan.lanes[0],
        id: linux ? "rust" : "macos-native",
        suites: [linux ? "client-core" : "client-native"],
      },
    ],
  });
  const rustOptions = {
    ...options,
    plan: rustPlan,
    lane: rustPlan.lanes[0].id,
  };
  assert(captureLaneEvidence(root, rustOptions));
  assert.equal(
    captureLaneEvidence(root, {
      ...rustOptions,
      execute: (command, args, config) =>
        command.endsWith("/rustc")
          ? "rustc 1.98.0 (wrong toolchain)\nrelease: 1.98.0"
          : execute(command, args, config),
    }),
    null,
  );
  assert.equal(
    captureLaneEvidence(root, {
      ...rustOptions,
      execute: (command, args, config) => {
        if (command === "rustup")
          throw new Error("Pinned toolchain is not installed");
        return execute(command, args, config);
      },
    }),
    null,
  );
  const relocated = captureLaneEvidence(root, {
    ...options,
    environment: {
      ...environment,
      HOME: "/different/home",
      TMPDIR: "/different/tmp",
      npm_config_cache: "/different/cache",
    },
  });
  assert.deepEqual(relocated.contract, measured.contract);
  const changed = captureLaneEvidence(root, {
    ...options,
    environment: { ...environment, LANG: "C" },
  });
  assert.notEqual(changed.contract.toolsDigest, measured.contract.toolsDigest);
  const timeout = captureLaneEvidence(root, {
    ...options,
    plan: sealPlan({
      ...plan,
      lanes: [{ ...plan.lanes[0], timeoutSeconds: 600 }],
    }),
  });
  assert.notEqual(
    timeout.contract.suites[0].commandDigest,
    measured.contract.suites[0].commandDigest,
  );
  assert.equal(
    captureLaneEvidence(root, {
      ...options,
      execute: (command, args, config) =>
        command === "npm" ? "" : execute(command, args, config),
    }),
    null,
  );
  assert.equal(
    captureLaneEvidence(root, {
      ...options,
      environment: { ...environment, ImageVersion: "unknown" },
    }),
    null,
  );
  assert.equal(
    captureLaneEvidence(root, {
      ...options,
      environment: {
        ...environment,
        SITUATE_NATIVE_VM_CONFIG: "/synthetic/vm.json",
      },
    }),
    null,
  );
  assert.equal(
    captureLaneEvidence(root, {
      ...options,
      execute: (command, args, config) =>
        args[0] === "status" ? " M changed" : execute(command, args, config),
    }),
    null,
  );
});
