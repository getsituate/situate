import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha = /^[a-f0-9]{40}$/;
const identifier = /^[a-z][a-z0-9-]{0,63}$/;
export const laneHosts = {
  policy: "linux",
  tooling: "linux",
  "tooling-macos": "macos",
  frontend: "linux",
  "macos-code": "macos",
  "macos-browser": "macos",
  "macos-native": "macos",
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
        JSON.parse(needs[id]?.outputs?.receipt || "null"),
      );
      aggregate(plan, receipts.filter(Boolean), needs);
      const { aggregateReceipts } = await import("./pipeline-state.mjs");
      aggregateReceipts(plan, receipts);
      return receipts;
    });
  }
  if (command === "prepare-release") {
    const { prepareReleaseDependencies } =
      await import("./actions-release.mjs");
    return prepareReleaseDependencies(root, execute);
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
    const { readImageLock } = await import("./ci-image.mjs");
    const lock = readImageLock(root);
    execute(
      "docker",
      [
        "run",
        "--rm",
        "--platform",
        "linux/amd64",
        "--user",
        `${process.getuid()}:${process.getgid()}`,
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--env",
        "HOME=/tmp/home",
        "--env",
        "CARGO_HOME=/tmp/cargo",
        "--env",
        "npm_config_cache=/tmp/npm",
        "--env",
        "PATH=/opt/volta/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin",
        "--volume",
        `${root}:/workspace`,
        "--workdir",
        "/workspace",
        lock.image,
        "node",
        "tools/dependency-monitoring.mjs",
      ],
      { stdio: "inherit" },
    );
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
    const suites = {
      coverage: ["client-rust-coverage"],
      design: [
        "root-secrets",
        "root-rust",
        "root-swift",
        "dev-tui-unit",
        "client-browser",
        "client-native",
      ],
      provider: ["client-agent-e2e"],
      visual: [],
    }[env.DIAGNOSTIC_SELECTION];
    if (!suites) throw new Error("Unknown diagnostic selection.");
    const { prepareLane } = await import("./pipeline-setup.mjs");
    await prepareLane(
      { id: "diagnostics", host: "macos", suites },
      { environment: env, execute },
    );
    for (const target of ["client", "requirements"])
      execute(process.execPath, ["tools/npm-ci.mjs", target], {
        stdio: "inherit",
      });
    return;
  }
  if (command === "diagnostics") {
    if (
      env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    )
      throw new Error("Diagnostics require an explicit trusted main dispatch.");
    const commands = {
      coverage: ["tools/test.mjs", "--coverage"],
      design: ["tools/test.mjs", "--extended"],
      visual: ["tools/ci-container.mjs", "--visual", "check"],
      provider: [
        "client/scripts/test-agent-e2e.mjs",
        "--provider",
        "openai",
        "--max-requests",
        "24",
        "--build-timeout",
        "1800",
      ],
    };
    const selection = values.lane ?? env.DIAGNOSTIC_SELECTION;
    if (!commands[selection]) throw new Error("Unknown diagnostic selection.");
    if (
      selection === "provider" &&
      (!env.TEST_OPENAI_API_KEY || env.PAID_DIAGNOSTICS_AUTHORIZED !== "true")
    )
      throw new Error(
        "Paid diagnostics require protected authorization and a scoped test credential.",
      );
    const args = commands[selection];
    execute(
      process.execPath,
      ["coverage", "design"].includes(selection)
        ? args
        : ["tools/run-coordinated.mjs", "--", process.execPath, ...args],
      { stdio: "inherit" },
    );
    return;
  }
  if (
    ["image-transfer-gate", "image-upload", "image-download"].includes(command)
  ) {
    const mode =
      command === "image-transfer-gate"
        ? "gate"
        : command === "image-upload"
          ? "upload"
          : "download";
    execute(
      process.execPath,
      [
        "tools/ci-image-transport.mjs",
        mode,
        ...(mode === "gate" ? [] : [join(env.RUNNER_TEMP, "ci-image")]),
      ],
      { stdio: "inherit", env },
    );
    return;
  }
  if (command === "image-build") {
    const { inputDigest, checkBrowserPins } = await import("./ci-image.mjs");
    const { context } = await import("./ci-publish.mjs");
    const expected = context(env);
    checkBrowserPins(root);
    const revision = execute("git", ["rev-parse", "HEAD"]).trim();
    if (revision !== env.GITHUB_SHA)
      throw new Error("Image source differs from trusted run.");
    const imageDirectory = join(env.RUNNER_TEMP, "ci-image");
    mkdirSync(imageDirectory, { recursive: false });
    execute(
      "docker",
      [
        "build",
        "--provenance=false",
        "--target",
        "ci",
        "--platform",
        "linux/amd64",
        "--label",
        `org.opencontainers.image.source=https://github.com/${repository}`,
        "--label",
        `org.opencontainers.image.revision=${revision}`,
        "--tag",
        expected.localTag,
        "--file",
        "client/docker/Dockerfile",
        ".",
      ],
      { stdio: "inherit" },
    );
    execute(
      "docker",
      [
        "run",
        "--rm",
        "--platform",
        "linux/amd64",
        "--user",
        "1000:1000",
        "--network",
        "none",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--pids-limit",
        "256",
        "--memory",
        "4g",
        "--cpus",
        "2",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=1g",
        "--tmpfs",
        "/ci-cache:rw,nosuid,nodev,size=64m",
        "--env",
        "HOME=/tmp/home",
        "--env",
        "CARGO_HOME=/tmp/cargo",
        "--env",
        "npm_config_cache=/tmp/npm",
        "--env",
        "PLAYWRIGHT_BROWSERS_PATH=/ci-cache/browsers",
        "--mount",
        `type=bind,src=${root}/client/docker/ci-verify.mjs,dst=/ci-verify.mjs,readonly`,
        "--entrypoint",
        "/opt/volta/bin/node",
        expected.localTag,
        "/ci-verify.mjs",
      ],
      { stdio: "inherit" },
    );
    execute(
      "docker",
      [
        "save",
        "--output",
        join(imageDirectory, "image.tar"),
        expected.localTag,
      ],
      { stdio: "inherit" },
    );
    execute(
      process.execPath,
      ["tools/ci-publish.mjs", "seal", imageDirectory],
      {
        stdio: "inherit",
        env: {
          ...env,
          SOURCE_REVISION: revision,
          INPUTS_SHA256: inputDigest(root),
        },
      },
    );
    return;
  }
  if (command === "image-publish") {
    const { context } = await import("./ci-publish.mjs");
    context(env);
    const imageDirectory = join(env.RUNNER_TEMP, "ci-image");
    execute(
      process.execPath,
      ["tools/ci-publish.mjs", "publish", imageDirectory],
      { stdio: "inherit" },
    );
    return;
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
    if (env.RECOVERY_ACTION !== "inspect")
      throw new Error(
        "Reconciliation is disabled pending gate provisioning; inspect the exact operation first.",
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
    const { source, base, declarationHead } = eventSelection(env, event);
    const declarationHeads =
      env.GITHUB_EVENT_NAME === "merge_group"
        ? resolveMergeGroupHeads(source, env, execute)
        : undefined;
    const plan = validatePlan(
      JSON.parse(
        execute(process.execPath, [
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
        ]),
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
  if (command === "setup") {
    const lane = plan.lanes.find(({ id }) => id === values.lane);
    if (!lane) throw new Error("Lane was not selected.");
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
      if (process.platform === "linux" && env.GITHUB_ACTIONS === "true") {
        const { readImageLock } = await import("./ci-image.mjs");
        const { linuxLaneArguments } = await import("./pipeline-setup.mjs");
        execute(
          "docker",
          linuxLaneArguments(
            root,
            directory,
            workflow,
            values.lane,
            readImageLock(root).image,
          ),
          { stdio: "inherit" },
        );
      } else {
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
      }
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
      output({ receipt: result }, env);
      return result;
    }
    if (command === "aggregate") {
      const needs = JSON.parse(env.PIPELINE_NEEDS);
      const receipts = plan.lanes.map(({ id }) =>
        JSON.parse(needs[id]?.outputs?.receipt || "null"),
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
