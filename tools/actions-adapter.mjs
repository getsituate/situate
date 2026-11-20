import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  encodeActionsReceipt,
  decodeActionsReceipt,
} from "./actions-receipts.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = /^[a-f0-9]{40}$/;
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
export const laneHosts = {
  policy: "linux",
  tooling: "linux",
  "tooling-macos": "macos",
  "docker-integration": "linux",
  frontend: "linux",
  rust: "linux",
  "macos-code": "macos",
  browser: "linux",
  "macos-native": "macos",
  "macos-compatibility": "macos",
};
export const repository = "getsituate/situate";
export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function validatePlan(plan) {
  if (
    plan?.schemaVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(plan.authorizationDigest ?? "") ||
    !sha.test(plan.source ?? "") ||
    !sha.test(plan.base ?? "") ||
    typeof plan.appImpact !== "boolean" ||
    !Array.isArray(plan.lanes)
  )
    throw new Error("Invalid pipeline plan identity.");
  const ids = new Set();
  const suites = new Set();
  for (const lane of plan.lanes) {
    if (
      !identifier.test(lane.id ?? "") ||
      ids.has(lane.id) ||
      laneHosts[lane.id] !== lane.host ||
      !Array.isArray(lane.suites) ||
      !lane.suites.length ||
      !Array.isArray(lane.reasons)
    )
      throw new Error("Invalid or duplicate pipeline lane.");
    ids.add(lane.id);
    for (const suite of lane.suites) {
      if (typeof suite !== "string" || !suite || suites.has(suite))
        throw new Error("Invalid or duplicate selected suite.");
      suites.add(suite);
    }
  }
  return plan;
}
export function matrices(plan) {
  validatePlan(plan);
  return Object.fromEntries(
    ["linux", "macos"].map((host) => [
      host,
      {
        include: plan.lanes
          .filter((lane) => lane.host === host)
          .map(({ id }) => ({ lane: id })),
      },
    ]),
  );
}
export function aggregate(plan, receipts, needs) {
  validatePlan(plan);
  if (needs.plan?.result !== "success")
    throw new Error("Planning did not succeed.");
  for (const id of Object.keys(laneHosts)) {
    const selected = plan.lanes.some((lane) => lane.id === id);
    if (needs[id]?.result !== (selected ? "success" : "skipped"))
      throw new Error(`Unexpected ${id} job result.`);
  }
  if (receipts.length !== plan.lanes.length)
    throw new Error("Missing or unexpected lane receipts.");
  for (const lane of plan.lanes) {
    const matching = receipts.filter((receipt) => receipt.lane === lane.id);
    if (
      matching.length !== 1 ||
      matching[0].planDigest !== plan.authorizationDigest ||
      matching[0].source !== plan.source ||
      matching[0].status !== "passed"
    )
      throw new Error(`Missing or invalid receipt: ${lane.id}`);
  }
  return {
    schemaVersion: 1,
    source: plan.source,
    planDigest: plan.authorizationDigest,
    status: "passed",
    lanes: plan.lanes.map(({ id }) => id),
  };
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed (${result.status ?? result.error?.code}).`,
    );
  return result.stdout;
}
function output(values, env) {
  if (env.GITHUB_OUTPUT)
    for (const [name, value] of Object.entries(values))
      appendFileSync(
        env.GITHUB_OUTPUT,
        `${name}=${typeof value === "string" ? value : JSON.stringify(value)}\n`,
      );
}
export function eventSelection(env, event) {
  if (env.GITHUB_REPOSITORY !== repository)
    throw new Error("Unexpected workflow repository.");
  let source = env.GITHUB_SHA;
  let base;
  let declarationHead;
  switch (env.GITHUB_EVENT_NAME) {
    case "pull_request":
      source = env.GITHUB_SHA;
      base = event.pull_request?.base?.sha;
      declarationHead = event.pull_request?.head?.sha;
      if (!sha.test(declarationHead ?? ""))
        throw new Error("Exact declaration head is required.");
      break;
    case "merge_group":
      if (
        event.merge_group?.head_sha !== source ||
        event.merge_group?.base_ref !== "refs/heads/main"
      )
        throw new Error(
          "Merge-group source and main base must match the workflow event.",
        );
      base = event.merge_group?.base_sha;
      break;
    case "push":
      if (env.GITHUB_REF !== "refs/heads/main")
        throw new Error("Expected main push.");
      base = event.before;
      break;
    default:
      throw new Error("Unsupported planning event.");
  }
  if (!sha.test(source ?? "") || !sha.test(base ?? "") || /^0+$/.test(base))
    throw new Error("Complete source and base history is required.");
  return { source, base, ...(declarationHead ? { declarationHead } : {}) };
}
export function resolvePullRequestBase(source, base, head, execute = run) {
  const parents = execute("git", ["rev-list", "--parents", "-n", "1", source])
    .trim()
    .split(/\s+/);
  if (
    parents.length !== 3 ||
    parents[0] !== source ||
    parents[2] !== head ||
    !sha.test(parents[1])
  )
    throw new Error("PR merge commit does not match the declared head.");
  execute("git", ["merge-base", "--is-ancestor", base, parents[1]]);
  return parents[1];
}
export function resolveMergeGroupHeads(source, env, execute = run) {
  if (env.GITHUB_REPOSITORY !== repository || !sha.test(source ?? ""))
    throw new Error("Invalid merge-group repository or source.");
  const pulls = [];
  let complete = false;
  for (let page = 1; page <= 10; page++) {
    const batch = JSON.parse(
      execute(
        "gh",
        [
          "api",
          `repos/${repository}/commits/${source}/pulls?per_page=100&page=${page}`,
        ],
        { env },
      ),
    );
    if (!Array.isArray(batch) || batch.length > 100)
      throw new Error("Malformed merge-group pull request listing.");
    pulls.push(...batch);
    if (batch.length < 100) {
      complete = true;
      break;
    }
  }
  if (!complete)
    throw new Error(
      "Merge-group pull request listing exceeds the supported limit.",
    );
  const numbers = new Set();
  const heads = new Set();
  const selected = [];
  for (const pull of pulls) {
    if (
      !pull ||
      !Number.isSafeInteger(pull.number) ||
      pull.number < 1 ||
      !["open", "closed"].includes(pull.state) ||
      typeof pull.head?.sha !== "string" ||
      !sha.test(pull.head.sha) ||
      typeof pull.base?.repo?.full_name !== "string" ||
      typeof pull.base?.ref !== "string"
    )
      throw new Error("Malformed merge-group pull request identity.");
    if (numbers.has(pull.number))
      throw new Error("Ambiguous merge-group pull request listing.");
    numbers.add(pull.number);
    if (pull.state !== "open") continue;
    if (
      pull.base.repo.full_name !== repository ||
      pull.base.ref !== "main" ||
      heads.has(pull.head.sha)
    )
      throw new Error("Ambiguous merge-group head or base repository.");
    heads.add(pull.head.sha);
    selected.push(pull);
  }
  if (!selected.length)
    throw new Error("Merge-group has no associated open pull requests.");
  selected.sort((left, right) => left.number - right.number);
  for (const pull of selected) {
    execute(
      "git",
      [
        "fetch",
        "--no-tags",
        "--recurse-submodules=no",
        "origin",
        `refs/pull/${pull.number}/head`,
      ],
      { env },
    );
    const fetched = execute(
      "git",
      ["rev-parse", "--verify", "--end-of-options", "FETCH_HEAD^{commit}"],
      { env },
    ).trim();
    if (
      fetched !== pull.head.sha ||
      execute("git", ["cat-file", "-t", pull.head.sha], { env }).trim() !==
        "commit"
    )
      throw new Error(
        "Fetched pull request head differs from the listed commit.",
      );
  }
  return selected.map(({ head }) => head.sha);
}
export async function diagnosticPlan(selection, target) {
  if (
    !["coverage", "design"].includes(selection) ||
    !["portable", "native", "docker"].includes(target)
  )
    throw new Error("Unknown diagnostic selection or execution environment.");
  const { createPlan } = await import("./test.mjs");
  const { suiteExecution } = await import("./test-scope.mjs");
  const plan = createPlan({
    coverage: selection === "coverage",
    extended: selection === "design",
    platform: target === "native" ? "darwin" : "linux",
  });
  const execution = {
    portable: "container",
    native: "native",
    docker: "host-docker",
  }[target];
  const suites = plan.suites.filter(
    (suite) => suiteExecution(suite) === execution,
  );
  if (!suites.length)
    throw new Error("No diagnostics selected for this execution environment.");
  return { ...plan, suites };
}

export function sonarLcov(report) {
  let sources = 0;
  const normalized = report.replace(/^SF:(.*)$/gm, (_, path) => {
    if (!path.startsWith("src/"))
      throw new Error("Expected an LCOV source path relative to the Vue app.");
    sources++;
    return `SF:client/app/${path}`;
  });
  if (!sources) throw new Error("Vue LCOV report has no source paths.");
  return normalized;
}

export async function main(
  args = process.argv.slice(2),
  env = process.env,
  execute = run,
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      workflow: { type: "string", default: "verify" },
      lane: { type: "string" },
      plan: { type: "string" },
      stage: { type: "string" },
    },
  });
  const [command] = positionals;
  const workflow = values.workflow;
  if (!["verify", "create", "publish"].includes(workflow))
    throw new Error("Unknown pipeline workflow.");
  if (command === "sonar-coverage") {
    if (!env.RUNNER_TEMP) throw new Error("RUNNER_TEMP is required.");
    const {
      suites: [suite],
    } = await diagnosticPlan("coverage", "portable");
    const options = { env, stdio: "inherit" };
    execute(process.execPath, ["tools/npm-ci.mjs", suite.npm], options);
    execute(
      process.execPath,
      [
        join(root, "tools/run-coordinated.mjs"),
        "--",
        suite.command,
        ...suite.args,
      ],
      { ...options, cwd: join(root, suite.cwd) },
    );
    const report = readFileSync(
      join(root, "client/target/coverage/vue/lcov.info"),
      "utf8",
    );
    writeFileSync(join(env.RUNNER_TEMP, "situate-vue.lcov"), sonarLcov(report));
    return;
  }
  if (command === "desktop") {
    return JSON.parse(
      execute(process.execPath, [join(root, "tools/release-desktop.mjs")], {
        env: Object.fromEntries(
          ["ImageOS", "ImageVersion"]
            .filter((name) => env[name] !== undefined)
            .map((name) => [name, env[name]]),
        ),
        timeout: 30_000,
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
  }
  if (command === "release-selection") {
    if (
      workflow !== "create" ||
      env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_EVENT_NAME !== "push" ||
      env.GITHUB_REF_PROTECTED !== "true" ||
      env.GITHUB_WORKFLOW_REF !==
        `${repository}/.github/workflows/release-macos.yml@refs/heads/main`
    )
      throw new Error(
        "Release selection requires the protected main workflow.",
      );
    if (!["true", "false"].includes(env.PIPELINE_RELEASE_ENABLED))
      throw new Error("Select an explicit release automation state.");
    const enabled = env.PIPELINE_RELEASE_ENABLED === "true";
    output({ enabled: String(enabled) }, env);
    return { enabled, reason: enabled ? "enabled" : "paused" };
  }
  if (command === "release-gate") {
    const { requireProvisioned } = await import("./actions-release.mjs");
    requireProvisioned(env, workflow);
    return { status: "ready" };
  }
  if (command === "create-prepare") {
    const { prepareCreate } = await import("./actions-release.mjs");
    return prepareCreate(env, execute, async (plan, needs) => {
      if (digest(plan) !== env.PIPELINE_PLAN_DIGEST)
        throw new Error("Workflow plan digest mismatch.");
      const receipts = plan.lanes.map(({ id }) =>
        decodeActionsReceipt(needs[id]?.outputs?.receipt || "null"),
      );
      aggregate(plan, receipts.filter(Boolean), needs);
      const { aggregateReceipts } = await import("./pipeline-state.mjs");
      aggregateReceipts(plan, receipts);
      return receipts;
    });
  }
  if (["prepare-release", "prepare-release-toolchain"].includes(command)) {
    const { prepareReleaseDependencies } =
      await import("./actions-release.mjs");
    return prepareReleaseDependencies(root, execute, {
      toolchainOnly: command === "prepare-release-toolchain",
    });
  }
  if (command === "create-stage" || command === "publish-run") {
    const { runReleaseStage } = await import("./actions-release.mjs");
    return runReleaseStage(
      env,
      command === "create-stage" ? "create" : "publish",
      values.stage,
      execute,
    );
  }
  if (command === "publish-prepare") {
    const { preparePublish } = await import("./actions-release.mjs");
    const result = preparePublish(env, execute);
    output(
      {
        selected: String(result.selected),
        ...(result.release_id ? { release_id: result.release_id } : {}),
      },
      env,
    );
    return result;
  }
  if (command === "monitor") {
    if (env.SITUATE_TOOL_CONTAINER === "1") {
      execute(process.execPath, ["tools/dependency-monitoring.mjs"], {
        stdio: "inherit",
      });
    } else {
      execute(
        "python3",
        ["tools/pipeline-container.py", "actions", "monitor"],
        { stdio: "inherit" },
      );
    }
    return;
  }
  if (command === "monitoring-policy") {
    const enabled =
      env.GITHUB_EVENT_NAME === "workflow_dispatch" ||
      env.MONITORING_WEEKLY === "true";
    output({ enabled: String(enabled) }, env);
    return {
      enabled,
      cadence: enabled ? "weekly-or-explicit" : "weekly-awaiting-authorization",
    };
  }
  if (command === "prepare-diagnostics") {
    const selection = env.DIAGNOSTIC_SELECTION;
    const target = env.DIAGNOSTIC_TARGET;
    if (target === "portable") return;
    const { prepareLane } = await import("./pipeline-setup.mjs");
    if (target === "docker")
      return prepareLane(
        { host: "linux", execution: "host-docker", suites: [] },
        { environment: env, execute },
      );
    const suites =
      selection === "provider"
        ? ["client-agent-e2e"]
        : (await diagnosticPlan(selection, target)).suites.map(({ id }) => id);
    return prepareLane(
      { id: "diagnostics", host: "macos", suites },
      { environment: env, execute },
    );
  }
  if (command === "diagnostics") {
    if (
      env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    )
      throw new Error("Diagnostics require an explicit trusted main dispatch.");
    const selection = values.lane ?? env.DIAGNOSTIC_SELECTION;
    if (selection === "qualification-route") {
      if (
        env.DIAGNOSTIC_TARGET !== "native" ||
        env.CI !== "true" ||
        env.GITHUB_ACTIONS !== "true" ||
        env.RUNNER_ENVIRONMENT !== "github-hosted"
      )
        throw new Error(
          "Qualification route diagnostics require a GitHub-hosted macOS runner.",
        );
      const { routeCheckEnvironment } =
        await import("./qualification-route-check.mjs");
      execute(process.execPath, ["tools/qualification-route-check.mjs"], {
        stdio: "inherit",
        env: routeCheckEnvironment(env),
      });
      return;
    }
    if (selection === "signing") {
      if (env.DIAGNOSTIC_TARGET !== "native")
        throw new Error("Signing diagnostics require macOS execution.");
      if (
        env.CI !== "true" ||
        env.GITHUB_ACTIONS !== "true" ||
        env.RUNNER_ENVIRONMENT !== "github-hosted"
      )
        throw new Error("Signing diagnostics require a GitHub-hosted runner.");
      const { signingEnvironment } = await import("./signing-check.mjs");
      execute(process.execPath, ["tools/signing-check.mjs"], {
        stdio: "inherit",
        env: signingEnvironment(env),
      });
      return;
    }
    if (selection === "provider") {
      if (
        env.DIAGNOSTIC_TARGET !== "native" ||
        !env.TEST_OPENAI_API_KEY ||
        env.PAID_DIAGNOSTICS_AUTHORIZED !== "true"
      )
        throw new Error(
          "Paid diagnostics require protected authorization on macOS and a scoped test credential.",
        );
      execute(
        process.execPath,
        [
          "tools/run-coordinated.mjs",
          "--",
          process.execPath,
          "client/scripts/test-agent-e2e.mjs",
          "--provider",
          "openai",
          "--max-requests",
          "24",
          "--build-timeout",
          "1800",
        ],
        { stdio: "inherit" },
      );
      return;
    }
    if (selection === "visual") {
      if (env.DIAGNOSTIC_TARGET !== "docker")
        throw new Error(
          "Visual diagnostics require host Docker orchestration.",
        );
      execute(
        process.execPath,
        [
          "tools/run-coordinated.mjs",
          "--",
          process.execPath,
          "tools/ci-container.mjs",
          "--visual",
          "check",
        ],
        { stdio: "inherit" },
      );
      return;
    }
    await diagnosticPlan(selection, env.DIAGNOSTIC_TARGET);
    execute(
      process.execPath,
      [
        "tools/run-coordinated.mjs",
        "--",
        process.execPath,
        "tools/diagnostic-checks.mjs",
        selection,
        env.DIAGNOSTIC_TARGET,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  if (command === "launch-trace") {
    const abort = new AbortController();
    const cancel = () => abort.abort(new Error("Launch trace cancelled"));
    process.on("SIGINT", cancel);
    process.on("SIGTERM", cancel);
    try {
      const { runLaunchTrace } = await import("./actions-launch-trace.mjs");
      return await runLaunchTrace(root, env, { signal: abort.signal });
    } catch {
      throw new Error(
        "Private launch trace did not complete; inspect the retained operation before another attempt",
      );
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }
  if (command === "recovery") {
    if (
      env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    )
      throw new Error("Recovery requires an explicit trusted main dispatch.");
    if (
      !["create", "publish"].includes(env.RECOVERY_WORKFLOW) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(env.RECOVERY_OPERATION ?? "")
    )
      throw new Error("Invalid recovery operation identity.");
    if (
      env.RECOVERY_WORKFLOW === "create" &&
      ["inspect", "qualify", "continue"].includes(env.RECOVERY_ACTION)
    ) {
      const { runCheckpointRecovery } = await import("./actions-recovery.mjs");
      return runCheckpointRecovery(root, env);
    }
    if (env.RECOVERY_ACTION !== "inspect")
      throw new Error(
        "Use the local pipeline CLI with the original operation journal for reconciliation.",
      );
    execute(
      process.execPath,
      [
        "tools/pipeline.mjs",
        "inspect",
        env.RECOVERY_WORKFLOW,
        "--operation",
        env.RECOVERY_OPERATION,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  if (command === "blocked")
    throw new Error(
      "Release automation is disabled pending repository protections, isolated qualification, recovery and signing gate provisioning.",
    );
  if (command === "plan") {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    const {
      source,
      base: eventBase,
      declarationHead,
    } = eventSelection(env, event);
    const base =
      env.GITHUB_EVENT_NAME === "pull_request"
        ? resolvePullRequestBase(source, eventBase, declarationHead, execute)
        : eventBase;
    const declarationHeads =
      env.GITHUB_EVENT_NAME === "merge_group"
        ? resolveMergeGroupHeads(source, env, execute)
        : undefined;
    const plan = validatePlan(
      JSON.parse(
        execute(
          process.execPath,
          [
            "tools/pipeline.mjs",
            "plan",
            workflow,
            "--source",
            source,
            "--base",
            base,
            ...(declarationHead ? ["--declaration-head", declarationHead] : []),
            ...(declarationHeads
              ? ["--declaration-heads", JSON.stringify(declarationHeads)]
              : []),
          ],
          { stdio: ["ignore", "pipe", "inherit"] },
        ),
      ),
    );
    if (plan.source !== source)
      throw new Error("Planner source differs from workflow source.");
    const matrix = matrices(plan);
    output(
      {
        plan,
        digest: digest(plan),
        linux: matrix.linux,
        macos: matrix.macos,
        has_linux: String(matrix.linux.include.length > 0),
        has_macos: String(matrix.macos.include.length > 0),
        app_impact: String(plan.appImpact),
      },
      env,
    );
    return plan;
  }
  const plan = validatePlan(
    JSON.parse(
      values.plan ? readFileSync(values.plan, "utf8") : env.PIPELINE_PLAN,
    ),
  );
  if (digest(plan) !== env.PIPELINE_PLAN_DIGEST)
    throw new Error("Workflow plan digest mismatch.");
  if (command === "source-reuse") {
    const { selectActionsSourceEvidence, createSourceVerificationApi } =
      await import("./source-verification-actions.mjs");
    const selection = await selectActionsSourceEvidence(root, {
      plan,
      lane: values.lane,
      environment: env,
      api: createSourceVerificationApi({ token: env.GH_TOKEN }),
    });
    if (selection.action !== "reuse") {
      output({ reused: "false" }, env);
      return { reused: false, reason: selection.reason };
    }
    const { createSourceVerificationReuseReceipt } =
      await import("./source-verification-evidence.mjs");
    const receipt = createSourceVerificationReuseReceipt(plan, selection);
    if (Buffer.byteLength(JSON.stringify(receipt)) > 256 * 1024)
      throw new Error("Reused lane receipt exceeds its job output limit");
    let encoded;
    try {
      encoded = encodeActionsReceipt(receipt);
    } catch {
      output({ reused: "false" }, env);
      return { reused: false, reason: "receipt-output-limit" };
    }
    output({ reused: "true", receipt: encoded }, env);
    return { reused: true, testedSHA: selection.evidence.testedSHA };
  }
  if (command === "source-evidence") {
    const { publishSourceVerificationEvidence, createSourceVerificationApi } =
      await import("./source-verification-actions.mjs");
    const needs = JSON.parse(env.PIPELINE_NEEDS);
    const receipts = plan.lanes.map(({ id }) =>
      decodeActionsReceipt(needs[id]?.outputs?.receipt || "null"),
    );
    aggregate(plan, receipts.filter(Boolean), needs);
    for (const { id } of plan.lanes) {
      const metadata = needs[id]?.outputs?.evidence;
      if (metadata)
        needs[id].outputs.evidence = JSON.stringify(
          decodeActionsReceipt(metadata),
        );
    }
    const path = await publishSourceVerificationEvidence(root, {
      plan,
      receipts,
      needs,
      environment: env,
      api: createSourceVerificationApi({ token: env.GH_TOKEN }),
    });
    output(
      {
        created: String(Boolean(path)),
        ...(path
          ? {
              path: relative(root, path),
              sha256: createHash("sha256")
                .update(readFileSync(path))
                .digest("hex"),
            }
          : {}),
      },
      env,
    );
    return { created: Boolean(path) };
  }
  if (command === "source-evidence-check") {
    if (
      !/^[1-9][0-9]*$/.test(env.PIPELINE_SOURCE_ARTIFACT_ID ?? "") ||
      !/^[a-f0-9]{64}$/.test(env.PIPELINE_SOURCE_ARTIFACT_SHA256 ?? "")
    )
      throw new Error("Select the exact uploaded source evidence artifact");
    const { createSourceVerificationApi, readSourceVerificationArchiveMember } =
      await import("./source-verification-actions.mjs");
    const api = createSourceVerificationApi({ token: env.GH_TOKEN });
    const bytes = await api(
      `/actions/artifacts/${env.PIPELINE_SOURCE_ARTIFACT_ID}/zip`,
      { raw: true, maxBytes: 1280 * 1024, newlyUploaded: true },
    );
    const { digest: canonicalDigest } = await import("./pipeline-state.mjs");
    const { evidence, jsonBytes } = readSourceVerificationArchiveMember(bytes);
    if (
      canonicalDigest(bytes) !== env.PIPELINE_SOURCE_ARTIFACT_SHA256 ||
      !jsonBytes.equals(readFileSync(env.PIPELINE_SOURCE_EVIDENCE_FILE))
    )
      throw new Error(
        "Uploaded source evidence differs from its verified bytes",
      );
    const { verifySourceVerificationAttestation } =
      await import("./source-verification-attestation.mjs");
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    const proof = verifySourceVerificationAttestation(jsonBytes, {
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
      pullNumber: event.pull_request?.number,
      environment: env,
    });
    if (
      !proof ||
      proof.checkedSHA !== plan.source ||
      canonicalDigest(
        execute("git", [
          "show",
          `${proof.workflowSHA}:.github/workflows/verify.yml`,
        ]),
      ) !== evidence.origin.workflowDefinitionDigest
    )
      throw new Error(
        "Uploaded source evidence has no verified execution attestation",
      );
    return { status: "passed" };
  }
  if (command === "setup") {
    const lane = plan.lanes.find(({ id }) => id === values.lane);
    if (!lane) throw new Error("Lane was not selected.");
    if (lane.id === "macos-compatibility" && process.arch !== "x64")
      throw new Error(
        "Hosted macOS compatibility checks require an Intel runner.",
      );
    const { prepareLane } = await import("./pipeline-setup.mjs");
    return prepareLane(lane, { environment: env, execute });
  }
  const directory = mkdtempSync(join(tmpdir(), "situate-pipeline-"));
  try {
    const planFile = join(directory, "plan.json");
    writeFileSync(planFile, JSON.stringify(plan));
    if (command === "lane") {
      if (!plan.lanes.some(({ id }) => id === values.lane))
        throw new Error("Lane was not selected.");
      if (execute("git", ["rev-parse", "HEAD"]).trim() !== plan.source)
        throw new Error("Checkout does not match planned source.");
      const receipt = join(directory, "runner.json");
      execute(
        process.execPath,
        [
          "tools/pipeline.mjs",
          "run",
          workflow,
          "--plan",
          planFile,
          "--lane",
          values.lane,
          "--receipt",
          receipt,
        ],
        { stdio: "inherit" },
      );
      const result = JSON.parse(readFileSync(receipt, "utf8"));
      if (
        result.status !== "passed" ||
        result.source !== plan.source ||
        result.planDigest !== plan.authorizationDigest ||
        result.lane !== values.lane
      )
        throw new Error("Runner receipt does not match selected lane.");
      if (Buffer.byteLength(JSON.stringify(result)) > 32 * 1024)
        throw new Error("Lane receipt exceeds job output limit.");
      let evidence;
      if (
        ["frontend", "rust", "browser", "macos-code", "macos-native"].includes(
          values.lane,
        )
      ) {
        const { captureLaneEvidence } =
          await import("./source-verification-actions.mjs");
        evidence = captureLaneEvidence(root, {
          plan,
          lane: values.lane,
          environment: env,
          execute,
        });
      }
      let metadata;
      if (evidence) {
        try {
          metadata = encodeActionsReceipt(evidence);
        } catch {
          /* Metadata is optional; execution receipts remain required. */
        }
      }
      output(
        {
          receipt: encodeActionsReceipt(result),
          ...(metadata ? { evidence: metadata } : {}),
        },
        env,
      );
      return result;
    }
    if (command === "aggregate") {
      const needs = JSON.parse(env.PIPELINE_NEEDS);
      const receipts = plan.lanes.map(({ id }) =>
        decodeActionsReceipt(needs[id]?.outputs?.receipt || "null"),
      );
      aggregate(plan, receipts.filter(Boolean), needs);
      const { aggregateReceipts } = await import("./pipeline-state.mjs");
      return aggregateReceipts(plan, receipts);
    }
    throw new Error("Unknown Actions adapter command.");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((result) => {
      if (result) console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
