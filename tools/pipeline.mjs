#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  aggregateReceipts,
  atomicJson,
  digest,
  openOperation,
  operationDirectory,
  readOperation,
  requireReconciliation,
  saveOperation,
  sealPlan,
  validatePlan,
  withOperationLock,
} from "./pipeline-state.mjs";
import { coordinated, runCoordinated } from "./run-coordinated.mjs";

export { aggregateReceipts } from "./pipeline-state.mjs";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const workflowStages = {
  create: ["compatibility", "reserve", "inputs", "build", "qualify", "github"],
  publish: ["download", "verify", "promote"],
};
const externalStages = new Set([
  "compatibility",
  "reserve",
  "build",
  "github",
  "promote",
]);
const git = (root, args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...ordinaryEnvironment(),
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1",
    },
  }).trim();

export function ordinaryEnvironment(environment = process.env) {
  const names = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "VOLTA_HOME",
    "CI",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "CARGO_NET_OFFLINE",
    "RUSTUP_TOOLCHAIN",
    "npm_config_cache",
    "PLAYWRIGHT_BROWSERS_PATH",
    "CARGO_INCREMENTAL",
    "CARGO_PROFILE_DEV_DEBUG",
    "CARGO_PROFILE_TEST_DEBUG",
    "LIBGL_ALWAYS_SOFTWARE",
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "SITUATE_CI_IMAGE",
    "SITUATE_TOOL_CONTAINER",
    "SITUATE_COORDINATED_WORKTREE",
    "SITUATE_NATIVE_EXECUTOR",
    "SITUATE_NATIVE_VM_CONFIG",
    "SITUATE_COMPILER_CACHE",
    "SCCACHE_DIR",
  ];
  if (environment.SITUATE_TOOL_CONTAINER === "1") {
    names.push("NSS_WRAPPER_PASSWD", "NSS_WRAPPER_GROUP");
    if (environment.SITUATE_TOOL_BUILD_SLOTS === "1")
      names.push("SITUATE_TOOL_BUILD_SLOTS");
    if (environment.LD_PRELOAD === "/opt/ci-tools/libnss_wrapper.so")
      names.push("LD_PRELOAD");
  }
  return Object.fromEntries(
    names
      .filter((key) => Object.hasOwn(environment, key))
      .map((key) => [key, environment[key]]),
  );
}

function assertSource(root, source) {
  assert.equal(
    git(root, ["rev-parse", "HEAD"]),
    source,
    "Checkout differs from the planned source commit",
  );
  assert.equal(
    git(root, ["status", "--porcelain", "--untracked-files=all"]),
    "",
    "Verification requires the exact clean source checkout; preserve local changes first",
  );
}

export async function validateDeclarations(root, { source, base, heads }) {
  assert(
    Array.isArray(heads) &&
      heads.length > 0 &&
      heads.length <= 100 &&
      new Set(heads).size === heads.length &&
      heads.every((head) => /^[a-f0-9]{40}$/.test(head)),
    "Declaration review requires unique exact branch heads",
  );
  const { validateFragmentRange } = await import("./change-fragments.mjs");
  const approved = new Map();
  const reviewed = [];
  for (const head of heads) {
    const ancestor = git(root, ["merge-base", base, head]);
    const fragments = validateFragmentRange(root, {
      base: ancestor,
      head,
      requireNew: ancestor !== head,
    });
    for (const { id, sha256 } of fragments) {
      assert(
        !approved.has(id) || approved.get(id) === sha256,
        "Branch declarations collide",
      );
      approved.set(id, sha256);
    }
    reviewed.push({ source: head, base: ancestor });
  }
  const integratedBase = git(root, ["merge-base", base, source]);
  const integrated = validateFragmentRange(root, {
    base: integratedBase,
    head: source,
    requireNew: integratedBase !== source,
    checkBehavior: false,
  });
  const fragments = integrated
    .map(({ id, sha256 }) => ({ id, sha256 }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const expected = [...approved]
    .map(([id, sha256]) => ({ id, sha256 }))
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(
    fragments,
    expected,
    "Integrated declarations differ from approved branch inputs",
  );
  return {
    ...(heads.length === 1 ? { head: heads[0] } : {}),
    base: reviewed.length === 1 ? reviewed[0].base : integratedBase,
    heads: reviewed,
    fragments,
  };
}

export async function planWorkflow(root, workflow, options, adapters = {}) {
  assert(
    ["verify", "create", "publish"].includes(workflow),
    "Unknown workflow",
  );
  const { repository = "getsituate/situate", operation, destination } = options;
  let configurationBinding = {};
  if (workflow !== "verify" && !adapters.createSourcePlan) {
    const { readConfiguration } = await import("./pipeline-operations.mjs");
    const configured = readConfiguration(root, options.configuration);
    if (configured)
      configurationBinding = {
        configurationFile: configured.file,
        configurationDigest: configured.sha256,
      };
  }
  if (workflow === "publish") {
    assert.equal(
      repository,
      "getsituate/situate",
      "Unexpected release repository",
    );
    assert(
      /^[1-9][0-9]*$/.test(String(options.releaseId ?? "")),
      "Select an exact GitHub Release ID",
    );
    assert(destination, "Select an explicit publication destination");
    operationDirectory(root, operation);
    const resolveRelease =
      adapters.resolveRelease ??
      (await import("./pipeline-operations.mjs")).resolveRelease;
    const release = await resolveRelease(root, {
      repository,
      releaseId: options.releaseId,
    });
    return sealPlan({
      schemaVersion: 1,
      workflow,
      repository,
      operation,
      destination,
      releaseId: String(options.releaseId),
      release,
      source: release.identity.sourceRevision,
      lanes: [],
      appImpact: false,
      ...configurationBinding,
    });
  }
  let baseline;
  if (workflow === "create") {
    if (options.verificationPlan) {
      const verified = validatePlan(options.verificationPlan);
      assert.equal(
        verified.workflow,
        "create",
        "Expected a creation verification plan",
      );
      assert(
        verified.baseline,
        "Verification plan has no completed release baseline",
      );
      baseline = verified.baseline;
    } else {
      const readBaseline =
        adapters.readBaseline ??
        (await import("./pipeline-operations.mjs")).readBaseline;
      baseline = await readBaseline(root, {
        repository,
        source: options.source,
      });
    }
    if (options.completedSource !== undefined)
      assert.equal(
        options.completedSource,
        baseline.source,
        "Requested completed baseline differs from verified release history",
      );
  }
  const createSourcePlan =
    adapters.createSourcePlan ??
    (await import("./pipeline-plan.mjs")).createPlan;
  const selected = await createSourcePlan({
    root,
    source: options.source,
    base: options.base,
    mode: workflow === "create" ? "release" : "verify",
    ...(baseline ? { completedSource: baseline.source } : {}),
  });
  let declaration;
  if (workflow === "verify" && !adapters.createSourcePlan) {
    assert(
      !(options.declarationHead && options.declarationHeads),
      "Select one declaration head input",
    );
    declaration = await validateDeclarations(root, {
      source: options.source,
      base: options.base,
      heads: options.declarationHeads ?? [
        options.declarationHead ?? options.source,
      ],
    });
  }
  if (workflow === "create" && selected.appImpact && operation)
    operationDirectory(root, operation);
  let verificationPlan;
  if (options.verificationPlan) {
    assert.equal(
      workflow,
      "create",
      "Only release creation can bind an earlier verification plan",
    );
    verificationPlan = validatePlan(options.verificationPlan);
    assert.equal(
      verificationPlan.workflow,
      "create",
      "Expected a creation verification plan",
    );
    const actual = { ...selected, baseline, repository };
    for (const key of [
      "source",
      "base",
      "appImpact",
      "lanes",
      "baseline",
      "repository",
    ])
      assert.equal(
        digest(verificationPlan[key]),
        digest(actual[key]),
        `Verification inputs changed: ${key}`,
      );
    assert(
      !verificationPlan.verificationPlan,
      "Nested verification plans are unsupported",
    );
  }
  return sealPlan({
    ...selected,
    workflow,
    ...(verificationPlan ? { verificationPlan } : {}),
    repository,
    ...(declaration ? { declaration } : {}),
    ...(operation ? { operation } : {}),
    ...(destination ? { destination } : {}),
    ...(baseline ? { baseline } : {}),
    ...configurationBinding,
  });
}

export async function runLane(
  root,
  plan,
  laneId,
  {
    host = process.platform,
    environment = process.env,
    execute,
    prepare,
    signal,
    onEvent = () => {},
    assertCheckout = assertSource,
    inventory,
    runner,
  } = {},
) {
  validatePlan(plan);
  const lane = plan.lanes.find((entry) => entry.id === laneId);
  assert(lane, "Lane was not selected by this workflow plan");
  const actualHost = host === "darwin" ? "macos" : host;
  assert(
    ["linux", "macos"].includes(actualHost) &&
      (lane.host === actualHost ||
        (actualHost === "macos" && lane.host === "linux")),
    "Selected lane requires a different execution host",
  );
  assertCheckout(root, plan.source);
  const tests = await import("./test.mjs");
  const available =
    inventory ?? tests.suiteInventory(tests.sourceFiles(root), host);
  const suites = lane.suites.map((id) => {
    const suite = available.find((entry) => entry.id === id);
    assert(suite, `Selected suite is unavailable on this host: ${id}`);
    if (id === "root-commits")
      return {
        ...suite,
        args: [
          ...suite.args,
          "--base",
          plan.declaration?.base ??
            git(root, ["merge-base", plan.base, plan.source]),
          ...(plan.declaration?.heads?.length > 1
            ? [
                "--heads",
                JSON.stringify(
                  plan.declaration.heads.map((entry) => entry.source),
                ),
              ]
            : ["--head", plan.declaration?.head ?? plan.source]),
        ],
      };
    if (id === "root-history-secrets")
      return {
        ...suite,
        args: [
          ...suite.args,
          "--log-opts",
          `${git(root, ["merge-base", plan.base, plan.source])}..${plan.source}`,
        ],
      };
    return suite;
  });
  if (lane.host === "linux" && lane.execution !== "host-docker" && !runner) {
    if (environment.SITUATE_TOOL_CONTAINER !== "1") {
      const { runContainerLane } = await import("./pipeline-container.mjs");
      return runContainerLane(root, plan, laneId, {
        environment,
        signal,
        onEvent,
      });
    }
    assert(
      process.platform === "linux" && existsSync("/.dockerenv"),
      "Portable checks require the pinned Linux tool container",
    );
    const { readImageLock } = await import("./ci-image.mjs");
    assert.equal(
      environment.SITUATE_CI_IMAGE,
      readImageLock(root).image,
      "Unexpected tool image",
    );
  }
  if (environment.SITUATE_TOOL_CONTAINER === "1" && !runner) {
    const { prepareContainerLane } =
      await import("./pipeline-container-entry.mjs");
    prepareContainerLane(root, suites);
  }
  const executionEnvironment =
    lane.execution === "host-docker"
      ? (await import("./pipeline-container.mjs")).hostContainerEnvironment(
          environment,
        )
      : ordinaryEnvironment(environment);
  const report = await (runner ?? tests.runPlan)(
    { profile: "supported", suites },
    {
      directory: root,
      jobs: 1,
      timeout: lane.timeoutSeconds ?? 600,
      output: process.stderr,
      environment: executionEnvironment,
      ...(execute ? { execute } : {}),
      ...(prepare ? { prepare } : {}),
      signal,
      onStart: (suite) =>
        onEvent({
          type: "suite",
          lane: laneId,
          suite: suite.id,
          status: "running",
        }),
      onResult: (result) =>
        onEvent({
          type: "suite",
          lane: laneId,
          suite: result.id,
          status: result.status,
        }),
    },
  );
  assertCheckout(root, plan.source);
  return {
    schemaVersion: 1,
    source: plan.source,
    planDigest: plan.authorizationDigest,
    lane: laneId,
    host: lane.host,
    executionHost: actualHost,
    status: report.status,
    results: report.results,
  };
}

async function executeStages(
  root,
  operation,
  adapters,
  { signal, onEvent = () => {}, until } = {},
) {
  const stages = workflowStages[operation.plan.workflow];
  if (
    until &&
    operation.stages.some(
      (stage) => stage.name === until && stage.status === "passed",
    )
  )
    return operation;
  for (const name of stages) {
    if (
      operation.stages.some(
        (stage) => stage.name === name && stage.status === "passed",
      )
    )
      continue;
    signal?.throwIfAborted();
    const invoke = adapters[name];
    assert.equal(
      typeof invoke,
      "function",
      `Missing workflow stage implementation: ${name}`,
    );
    const inputDigest = digest({
      planDigest: operation.plan.authorizationDigest,
      predecessors: operation.stages,
    });
    const stage = { name, inputDigest, status: "running" };
    operation.stages.push(stage);
    saveOperation(root, operation);
    onEvent({
      type: "stage",
      stage: name,
      status: "running",
      operation: operation.operationId,
    });
    try {
      stage.output = await invoke({
        root,
        plan: operation.plan,
        operation,
        signal,
      });
      assert(stage.output !== undefined, `Stage ${name} returned no evidence`);
      stage.status = "passed";
      saveOperation(root, operation);
      onEvent({
        type: "stage",
        stage: name,
        status: "passed",
        operation: operation.operationId,
      });
    } catch (error) {
      stage.status = externalStages.has(name) ? "unknown" : "failed";
      operation.status = stage.status;
      saveOperation(root, operation);
      onEvent({
        type: "stage",
        stage: name,
        status: stage.status,
        operation: operation.operationId,
      });
      throw error;
    }
    if (until === name) {
      operation.status = "paused";
      saveOperation(root, operation);
      return operation;
    }
  }
  operation.status = "completed";
  saveOperation(root, operation);
  return operation;
}

export async function runWorkflow(
  root,
  plan,
  {
    confirmation,
    receipts,
    adapters,
    signal,
    onEvent = () => {},
    laneOptions,
    until,
  } = {},
) {
  validatePlan(plan);
  if (
    plan.workflow === "verify" ||
    (plan.workflow === "create" && !plan.appImpact)
  ) {
    const results =
      receipts ??
      (await runLocalLanes(root, plan, { ...laneOptions, signal, onEvent }));
    return {
      type: "result",
      ...aggregateReceipts(plan, results),
      workflow: plan.workflow,
      appImpact: plan.appImpact,
    };
  }
  assert.equal(
    confirmation,
    plan.authorizationDigest,
    "Confirm the exact workflow plan before external operations",
  );
  assert.equal(
    plan.repository,
    "getsituate/situate",
    "Unexpected release repository",
  );
  assert(plan.destination, "Select the exact controlled release destination");
  operationDirectory(root, plan.operation);
  if (plan.workflow === "create") assertSource(root, plan.source);
  if (until)
    assert(
      workflowStages[plan.workflow].includes(until),
      "Unknown workflow stage",
    );
  adapters ??= await (
    await import("./pipeline-operations.mjs")
  ).productionStages(root, plan);
  return withOperationLock(root, plan.operation, async () => {
    const journal = join(
      operationDirectory(root, plan.operation),
      "operation.json",
    );
    const retained = existsSync(journal)
      ? readOperation(root, plan.operation)
      : undefined;
    const resuming = retained?.status === "paused";
    const operation = resuming ? retained : openOperation(root, plan);
    assert.equal(
      operation.plan.authorizationDigest,
      plan.authorizationDigest,
      "Operation belongs to another workflow plan",
    );
    if (resuming)
      assert(
        operation.stages.every((stage) => stage.status === "passed"),
        "Paused operation has unresolved work; inspect it first",
      );
    if (plan.workflow === "create" && !resuming) {
      const results =
        receipts ??
        (await runLocalLanes(root, plan.verificationPlan ?? plan, {
          ...laneOptions,
          signal,
          onEvent,
        }));
      operation.verification = {
        ...aggregateReceipts(plan.verificationPlan ?? plan, results),
        results: results
          .flatMap((receipt) => receipt.results)
          .map(({ id, status, exitCode }) => ({ id, status, exitCode })),
      };
      saveOperation(root, operation);
    }
    const result = await executeStages(root, operation, adapters, {
      signal,
      onEvent,
      until,
    });
    return {
      type: "result",
      status: result.status,
      workflow: plan.workflow,
      operation: plan.operation,
      planDigest: plan.authorizationDigest,
    };
  });
}

async function runLocalLanes(root, plan, options) {
  const receipts = [];
  for (const lane of plan.lanes)
    receipts.push(await runLane(root, plan, lane.id, options));
  return receipts;
}

export async function inspectWorkflow(root, operationId, { adapters } = {}) {
  const operation = readOperation(root, operationId);
  adapters ??= await (
    await import("./pipeline-operations.mjs")
  ).productionStages(root, operation.plan);
  assert.equal(
    typeof adapters.inspect,
    "function",
    "Remote inspection is unavailable",
  );
  const remote = await adapters.inspect({
    root,
    operation,
    plan: operation.plan,
  });
  const observation = {
    schemaVersion: 1,
    operationId,
    planDigest: operation.plan.authorizationDigest,
    stateDigest: digest(operation),
    remote,
  };
  atomicJson(
    join(operationDirectory(root, operationId), "inspection.json"),
    observation,
  );
  return { ...observation, reconciliationDigest: digest(observation) };
}

export async function reconcileWorkflow(
  root,
  operationId,
  confirmation,
  { adapters, signal, onEvent, resolution = "resume" } = {},
) {
  assert(
    ["resume", "abandon"].includes(resolution),
    "Unknown reconciliation resolution",
  );
  return withOperationLock(root, operationId, async () => {
    const operation = readOperation(root, operationId);
    if (resolution === "abandon")
      assert.equal(
        operation.plan.workflow,
        "create",
        "Publication outcomes cannot be abandoned or rolled back",
      );
    if (operation.plan.workflow === "create")
      assertSource(root, operation.plan.source);
    const observation = JSON.parse(
      readFileSync(
        join(operationDirectory(root, operationId), "inspection.json"),
        "utf8",
      ),
    );
    requireReconciliation(operation, observation, confirmation);
    adapters ??= await (
      await import("./pipeline-operations.mjs")
    ).productionStages(root, operation.plan);
    assert.equal(
      typeof adapters.reconcile,
      "function",
      "Explicit remote reconciliation is unavailable",
    );
    const currentRemote = await adapters.inspect({
      root,
      operation,
      plan: operation.plan,
    });
    assert.equal(
      digest(currentRemote),
      digest(observation.remote),
      "External state changed after inspection; inspect and authorize it again",
    );
    await adapters.reconcile({
      root,
      operation,
      plan: operation.plan,
      observation,
      signal,
      resolution,
    });
    if (operation.status === "abandoned") {
      saveOperation(root, operation);
      return {
        type: "result",
        status: "abandoned",
        workflow: operation.plan.workflow,
        operation: operationId,
        planDigest: operation.plan.authorizationDigest,
      };
    }
    assert(
      operation.stages.every((stage) => stage.status === "passed"),
      "Unresolved operation must be reconciled against exact external evidence before continuation",
    );
    operation.status = "running";
    saveOperation(root, operation);
    const result = await executeStages(root, operation, adapters, {
      signal,
      onEvent,
    });
    return {
      type: "result",
      status: result.status,
      workflow: operation.plan.workflow,
      operation: operationId,
      planDigest: operation.plan.authorizationDigest,
    };
  });
}

export async function main(
  argv = process.argv.slice(2),
  {
    root = repositoryRoot,
    onEvent = (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    ...adapters
  } = {},
) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...Object.fromEntries(
        [
          "source",
          "base",
          "completed-source",
          "plan",
          "output",
          "lane",
          "receipt",
          "operation",
          "destination",
          "repository",
          "release-id",
          "confirm",
          "receipts",
          "stage",
          "configuration",
          "declaration-head",
          "declaration-heads",
          "verification-plan",
          "resolution",
        ].map((name) => [name, { type: "string" }]),
      ),
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help)
    return {
      usage:
        "node tools/pipeline.mjs plan|run|stage|status|inspect|reconcile verify|create|publish --source FULL_SHA --base FULL_SHA [--plan FILE] [--operation ID] [--destination SSH_HOST] [--release-id ID] [--confirm DIGEST]",
    };
  const [command, workflow] = positionals;
  assert(
    ["plan", "run", "stage", "status", "inspect", "reconcile"].includes(
      command,
    ),
    "Unknown workflow command",
  );
  assert(positionals.length <= 2, "Unexpected workflow arguments");
  const options = {
    source: values.source,
    base: values.base,
    completedSource: values["completed-source"],
    operation: values.operation,
    destination: values.destination,
    repository: values.repository,
    releaseId: values["release-id"],
    configuration: values.configuration,
    declarationHead: values["declaration-head"],
    declarationHeads: values["declaration-heads"]
      ? JSON.parse(values["declaration-heads"])
      : undefined,
    verificationPlan: values["verification-plan"]
      ? JSON.parse(readFileSync(values["verification-plan"], "utf8"))
      : undefined,
  };
  if (command === "plan") {
    const plan = await planWorkflow(root, workflow, options, adapters);
    if (values.output) atomicJson(resolve(values.output), plan);
    return plan;
  }
  if (command === "status") return readOperation(root, values.operation);
  if (command === "inspect")
    return inspectWorkflow(root, values.operation, adapters);
  if (command === "reconcile")
    return reconcileWorkflow(root, values.operation, values.confirm, {
      ...adapters,
      onEvent,
      resolution: values.resolution,
    });
  assert(
    values.plan && existsSync(values.plan),
    "Read an explicit workflow plan file first",
  );
  const plan = validatePlan(JSON.parse(readFileSync(values.plan, "utf8")));
  assert.equal(
    plan.workflow,
    workflow,
    "Workflow differs from the selected plan",
  );
  if (values.lane) {
    assert.equal(command, "run", "Lane execution uses run");
    const result = await runLane(root, plan, values.lane, {
      ...adapters,
      onEvent,
    });
    if (values.receipt) atomicJson(resolve(values.receipt), result);
    return result;
  }
  if (command === "stage")
    assert(
      values.stage,
      "Select the final prerequisite stage with --stage NAME",
    );
  const receipts = values.receipts
    ? JSON.parse(readFileSync(values.receipts, "utf8"))
    : undefined;
  return runWorkflow(root, plan, {
    confirmation: values.confirm,
    receipts,
    ...adapters,
    onEvent,
    ...(command === "stage" ? { until: values.stage } : {}),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const argv = process.argv.slice(2);
  const readOnly =
    ["plan", "status", "inspect"].includes(argv[0]) || argv.includes("--help");
  try {
    if (!readOnly && !coordinated(repositoryRoot)) {
      process.exitCode = await runCoordinated({
        directory: repositoryRoot,
        command: process.execPath,
        args: process.argv.slice(1),
      });
    } else {
      const result = await main(argv);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (["failed", "cancelled", "unknown", "not-run"].includes(result.status))
        process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
