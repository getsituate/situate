import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ordinaryEnvironment,
  main,
  planWorkflow,
  runLane,
  runWorkflow,
  inspectWorkflow,
  reconcileWorkflow,
  restoreWorkflow,
  validateDeclarations,
} from "./pipeline.mjs";
import { main as actionsMain } from "./actions-adapter.mjs";
import { digest, readOperation, sealPlan } from "./pipeline-state.mjs";

const source = "a".repeat(40),
  base = "b".repeat(40);
const selection = () => ({
  schemaVersion: 1,
  source,
  base,
  appImpact: false,
  lanes: [{ id: "tooling", host: "linux", suites: ["runner-unit"] }],
  reasons: [],
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-pipeline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function committedFixture(t) {
  const root = fixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Synthetic Maintainer");
  git("config", "user.email", "maintainer@example.invalid");
  writeFileSync(join(root, ".gitignore"), ".release-operations/\n");
  git("add", ".gitignore");
  git("commit", "-qm", "test: fixture");
  return { root, source: git("rev-parse", "HEAD") };
}
const receipt = (plan) => ({
  schemaVersion: 1,
  source: plan.source,
  planDigest: plan.authorizationDigest,
  lane: "tooling",
  host: "linux",
  status: "passed",
  results: [{ id: "runner-unit", status: "passed", exitCode: 0 }],
});

function declarationFixture(t) {
  const { root } = committedFixture(t);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
  git("branch", "-M", "main");
  mkdirSync(join(root, "client/packages/localization"), { recursive: true });
  writeFileSync(
    join(root, "client/packages/localization/locales.json"),
    JSON.stringify({ source: "en", locales: ["en", "de"] }),
  );
  git("add", ".");
  git("commit", "-qm", "test: locale inventory");
  const base = git("rev-parse", "HEAD");
  function branch(name, id = name) {
    git("checkout", "-qb", name, base);
    writeFileSync(join(root, `${name}.txt`), name);
    git("add", ".");
    git("commit", "-qm", `test: ${name}`);
    const fragment = {
      schemaVersion: 2,
      id,
      emptyReason: name,
      locales: {
        en: { title: "Changes", entries: [] },
        de: { title: "Änderungen", entries: [] },
      },
    };
    mkdirSync(join(root, "changes"), { recursive: true });
    writeFileSync(join(root, `changes/${id}.json`), JSON.stringify(fragment));
    git("add", ".");
    git("commit", "-qm", `test: declare ${name}`);
    return git("rev-parse", "HEAD");
  }
  return { root, git, base, branch };
}

test("declaration review rejects symbolic source or base before invoking Git", async () => {
  const commit = "a".repeat(40);
  for (const [source, base] of [
    ["HEAD", commit],
    [commit, "main"],
  ]) {
    await assert.rejects(
      validateDeclarations("unused", { source, base, heads: [commit] }),
      /exact source and base commits/,
    );
  }
});

test("merge groups review original branch heads and preserve their exact declarations", async (t) => {
  const { root, git, base, branch } = declarationFixture(t);
  const alpha = branch("alpha"),
    beta = branch("beta");
  git("checkout", "-qb", "integrated", base);
  git("merge", "--no-ff", alpha, beta, "-m", "test: integrated branches");
  const source = git("rev-parse", "HEAD");
  const declarations = await validateDeclarations(root, {
    source,
    base,
    heads: [alpha, beta],
  });
  assert.deepEqual(
    declarations.fragments.map(({ id }) => id),
    ["alpha", "beta"],
  );
  assert.deepEqual(
    declarations.heads.map(({ source }) => source),
    [alpha, beta],
  );
  await assert.rejects(
    validateDeclarations(root, { source, base, heads: [alpha] }),
    /Integrated declarations differ from branch inputs/,
  );
});

test("PR planning excludes declarations merged into main after the event base", async (t) => {
  const { root, git, base, branch } = declarationFixture(t);
  const alpha = branch("alpha"),
    beta = branch("beta");
  git("checkout", "-qb", "integrated", beta);
  git("merge", "--no-ff", alpha, "-m", "test: merge PR into updated main");
  const source = git("rev-parse", "HEAD");
  await assert.rejects(
    validateDeclarations(root, { source, base, heads: [alpha] }),
    /Integrated declarations differ/,
  );
  const event = join(root, "event.json");
  writeFileSync(
    event,
    JSON.stringify({
      pull_request: { base: { sha: base }, head: { sha: alpha } },
    }),
  );
  let plannedBase;
  await actionsMain(
    ["plan"],
    {
      GITHUB_REPOSITORY: "getsituate/situate",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_SHA: source,
      GITHUB_EVENT_PATH: event,
    },
    (command, args) => {
      if (command === "git") return git(...args);
      plannedBase = args[args.indexOf("--base") + 1];
      assert.equal(args[args.indexOf("--source") + 1], source);
      assert.equal(args[args.indexOf("--declaration-head") + 1], alpha);
      return JSON.stringify({
        schemaVersion: 1,
        source,
        base: plannedBase,
        appImpact: false,
        lanes: [],
        authorizationDigest: "a".repeat(64),
      });
    },
  );
  assert.equal(plannedBase, beta);
  const declarations = await validateDeclarations(root, {
    source,
    base: plannedBase,
    heads: [alpha],
  });
  assert.deepEqual(
    declarations.fragments.map(({ id }) => id),
    ["alpha"],
  );
});

test("merge groups require declarations only on branches that change the client", async (t) => {
  const { root, git, base, branch } = declarationFixture(t);
  const declared = branch("declared");
  git("checkout", "-qb", "docs", base);
  writeFileSync(join(root, "README.md"), "# Contributor guide\n");
  git("add", ".");
  git("commit", "-qm", "docs: add contributor guide");
  const docs = git("rev-parse", "HEAD");

  git("checkout", "-qb", "integrated", declared);
  git("merge", "--no-ff", docs, "-m", "test: integrate docs");
  const review = (head) =>
    validateDeclarations(root, {
      source: git("rev-parse", "HEAD"),
      base,
      heads: [declared, head],
    });
  assert.deepEqual(
    (await review(docs)).fragments.map(({ id }) => id),
    ["declared"],
  );

  git("checkout", "docs");
  writeFileSync(join(root, "client/Cargo.lock"), "# updated dependencies\n");
  git("add", ".");
  git("commit", "-qm", "build: update client dependencies");
  const undeclared = git("rev-parse", "HEAD");
  git("checkout", "integrated");
  git("merge", "--no-ff", undeclared, "-m", "test: integrate client change");
  await assert.rejects(
    review(undeclared),
    /Client changes require a new declaration/,
  );
});

test("integrated verification rejects overwriting a declaration added to the base", async (t) => {
  const { root, git, base, branch } = declarationFixture(t);
  const alpha = branch("alpha", "shared"),
    beta = branch("beta", "shared");
  git("checkout", "-qb", "integrated", alpha);
  assert.throws(() =>
    git("merge", "--no-ff", beta, "-m", "test: integrated branch"),
  );
  writeFileSync(
    join(root, "changes/shared.json"),
    git("show", `${beta}:changes/shared.json`),
  );
  git("add", ".");
  git("commit", "-qm", "test: resolve declaration conflict");
  await assert.rejects(
    validateDeclarations(root, {
      source: git("rev-parse", "HEAD"),
      base: alpha,
      heads: [beta],
    }),
    /immutable/i,
  );
  await assert.rejects(
    validateDeclarations(root, { source: alpha, base, heads: [] }),
    /branch heads/,
  );
});

test("injected release adapters and verification never read local secrets", async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, ".env"));
  const planned = await planWorkflow(
    root,
    "create",
    {
      source,
      base,
      operation: "synthetic-create",
    },
    {
      readBaseline: async () => ({ source: base }),
      createSourcePlan: async () => selection(),
    },
  );
  assert.equal(planned.destination, undefined);
  for (const workflow of ["verify", "create"]) {
    const plan = sealPlan({ ...selection(), workflow });
    assert.equal(
      (
        await runWorkflow(root, plan, {
          receipts: [receipt(plan)],
          environment: {},
        })
      ).status,
      "passed",
    );
  }
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "publish",
    repository: "getsituate/situate",
    operation: "secret-free",
    destination: "synthetic.invalid",
    releaseId: "8",
    lanes: [],
  });
  const adapters = {
    download: async () => ({}),
    verify: async () => ({}),
    promote: async () => ({}),
    inspect: async () => ({ status: "present" }),
  };
  await runWorkflow(root, plan, {
    confirmation: plan.authorizationDigest,
    adapters,
    environment: {},
  });
  assert.equal(
    (await main(["status", "--operation", plan.operation], { root })).status,
    "completed",
  );
  assert.equal(
    (await inspectWorkflow(root, plan.operation, { adapters, environment: {} }))
      .remote.status,
    "present",
  );
});

test("production authorization and configuration checks precede SSH preparation", async (t) => {
  const root = fixture(t);
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "publish",
    repository: "getsituate/situate",
    operation: "unauthorized",
    destination: "synthetic.invalid",
    releaseId: "9",
    lanes: [],
  });
  const environment = { CI: "1", SITUATE_RELEASE_SSH_PRIVATE_KEY: "" };
  await assert.rejects(
    runWorkflow(root, plan, { environment }),
    /Confirm the exact/,
  );
  await assert.rejects(
    runWorkflow(root, plan, {
      environment,
      confirmation: plan.authorizationDigest,
    }),
    /private, reviewed release configuration/,
  );
  assert.equal(environment.SITUATE_RELEASE_SSH_PRIVATE_KEY, "");
});

test("null legacy SSH paths do not suppress inline local credentials", async (t) => {
  const root = fixture(t);
  const bytes = JSON.stringify({
    schemaVersion: 1,
    sshIdentity: null,
    sshKnownHosts: null,
    recoveryEvidence: { synthetic: true },
  });
  writeFileSync(
    join(root, ".env"),
    `SITUATE_RELEASE_CONFIG_JSON='${bytes}'\nSITUATE_RELEASE_SSH_PRIVATE_KEY=synthetic-key\nSITUATE_RELEASE_SSH_KNOWN_HOSTS=\n`,
    { mode: 0o600 },
  );
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "publish",
    repository: "getsituate/situate",
    operation: "inline-credentials",
    destination: "synthetic.invalid",
    releaseId: "9",
    lanes: [],
    configurationDigest: digest(bytes),
  });
  await assert.rejects(
    runWorkflow(root, plan, {
      environment: {},
      confirmation: plan.authorizationDigest,
    }),
    /SITUATE_RELEASE_SSH_KNOWN_HOSTS.*nonempty/,
  );
});

test("plans have no Actions event or runtime dependency", async (t) => {
  const root = fixture(t);
  const plan = await planWorkflow(
    root,
    "verify",
    { source, base },
    {
      createSourcePlan: async (request) => {
        assert.deepEqual(request, { root, source, base, mode: "verify" });
        return selection();
      },
    },
  );
  assert.equal(plan.workflow, "verify");
  assert.match(plan.authorizationDigest, /^[a-f0-9]{64}$/);
});

test("cumulative completed release evidence determines app impact independently of preceding push", async (t) => {
  const root = fixture(t);
  const baseline = { source: "c".repeat(40), catalogSha256: "d".repeat(64) };
  const plan = await planWorkflow(
    root,
    "create",
    { source, base },
    {
      readBaseline: async () => baseline,
      createSourcePlan: async (request) => {
        assert.equal(request.completedSource, baseline.source);
        return { ...selection(), appImpact: true };
      },
    },
  );
  assert.equal(plan.appImpact, true);
  assert.deepEqual(plan.baseline, baseline);
  await assert.rejects(
    planWorkflow(
      root,
      "create",
      { source, base, completedSource: base },
      {
        readBaseline: async () => baseline,
        createSourcePlan: async () => selection(),
      },
    ),
    /differs/,
  );
});

test("lane execution strips production credentials and records every selected suite", async (t) => {
  const plan = sealPlan({ ...selection(), workflow: "verify" });
  const result = await runLane(fixture(t), plan, "tooling", {
    host: "linux",
    assertCheckout: () => {},
    environment: {
      PATH: "/synthetic/bin",
      HOME: "/synthetic/home",
      GH_TOKEN: "synthetic-github-token",
      APPLE_SIGNING_P12_BASE64: "synthetic-signing-data",
      OPENAI_API_KEY: "synthetic-provider-key",
    },
    inventory: [{ id: "runner-unit", command: "node", args: [] }],
    runner: async (request, options) => {
      assert.deepEqual(
        request.suites.map((suite) => suite.id),
        ["runner-unit"],
      );
      assert.deepEqual(options.environment, {
        PATH: "/synthetic/bin",
        HOME: "/synthetic/home",
      });
      return {
        status: "passed",
        results: [{ id: "runner-unit", status: "passed", exitCode: 0 }],
      };
    },
  });
  assert.equal(result.planDigest, plan.authorizationDigest);
  assert.equal(result.status, "passed");
  await assert.rejects(
    runLane(
      "/unused",
      sealPlan({
        ...plan,
        lanes: [
          { id: "macos-native", host: "macos", suites: ["client-native"] },
        ],
      }),
      "macos-native",
      { host: "linux" },
    ),
    /different execution host/,
  );
  await assert.rejects(
    runLane("/unused", plan, "tooling", {
      host: "linux",
      assertCheckout: () => {},
      inventory: [],
    }),
    /unavailable/,
  );
});

test("non-app merges end after relevant checks without release adapters or an operation", async (t) => {
  const plan = sealPlan({ ...selection(), workflow: "create" });
  const result = await runWorkflow(fixture(t), plan, {
    receipts: [receipt(plan)],
    adapters: new Proxy(
      {},
      {
        get() {
          assert.fail("release stage touched");
        },
      },
    ),
  });
  assert.equal(result.status, "passed");
});

test("creation verifies once and executes the shared dependency order", async (t) => {
  const { root, source: revision } = committedFixture(t);
  const plan = sealPlan({
    ...selection(),
    source: revision,
    workflow: "create",
    appImpact: true,
    repository: "getsituate/situate",
    operation: "release-1",
    destination: "synthetic.invalid",
  });
  const calls = [];
  const names = [
    "compatibility",
    "reserve",
    "inputs",
    "build",
    "qualify",
    "github",
  ];
  const adapters = Object.fromEntries(
    names.map((name) => [
      name,
      async ({ operation }) => {
        assert.equal(operation.verification.status, "passed");
        assert.deepEqual(
          operation.stages.slice(0, -1).map((stage) => stage.name),
          calls,
        );
        calls.push(name);
        return { evidence: name };
      },
    ]),
  );
  await assert.rejects(
    runWorkflow(root, plan, {
      adapters,
      receipts: [receipt(plan)],
      confirmation: "yes",
    }),
    /Confirm/,
  );
  const result = await runWorkflow(root, plan, {
    adapters,
    receipts: [receipt(plan)],
    confirmation: plan.authorizationDigest,
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, names);
  assert.equal(readOperation(root, plan.operation).stages.length, 6);
  await assert.rejects(
    runWorkflow(root, plan, {
      adapters,
      receipts: [receipt(plan)],
      confirmation: plan.authorizationDigest,
    }),
    /inspect/,
  );
});

test("durable stage intent precedes effects and failed checkpoint acknowledgements never pass a build", async (t) => {
  const { root, source: revision } = committedFixture(t);
  const plan = sealPlan({
    ...selection(),
    source: revision,
    workflow: "create",
    appImpact: true,
    operation: "checkpoint-ack",
    repository: "getsituate/situate",
    destination: "synthetic.invalid",
  });
  const calls = [];
  const adapters = Object.fromEntries(
    ["compatibility", "reserve", "inputs", "build", "qualify", "github"].map(
      (name) => [
        name,
        async () => {
          calls.push(name);
          if (name === "build")
            throw new Error("Checkpoint acknowledgement lost; inspect");
          return { evidence: name };
        },
      ],
    ),
  );
  adapters.persistIntent = async ({ stage }) => {
    calls.push(`intent:${stage}`);
  };
  const events = [];
  await assert.rejects(
    runWorkflow(root, plan, {
      adapters,
      receipts: [receipt(plan)],
      confirmation: plan.authorizationDigest,
      onEvent: (event) => events.push(event),
    }),
    /acknowledgement lost/,
  );
  assert.deepEqual(calls, [
    "intent:compatibility",
    "compatibility",
    "intent:reserve",
    "reserve",
    "intent:inputs",
    "inputs",
    "intent:build",
    "build",
  ]);
  assert.equal(
    readOperation(root, plan.operation).stages.at(-1).status,
    "unknown",
  );
  assert(
    !events.some(
      (event) => event.stage === "build" && event.status === "passed",
    ),
  );
});

test("private release authorization retains original source receipts without rebinding them", async (t) => {
  const { root, source: revision } = committedFixture(t);
  const adapters = {
    readBaseline: async () => ({ source: revision, legacy: true }),
    createSourcePlan: async () => ({
      ...selection(),
      source: revision,
      appImpact: true,
      lanes: [
        {
          id: "tooling",
          host: "linux",
          suites: ["runner-unit", "delivery-unit"],
        },
        { id: "macos-native", host: "macos", suites: ["client-native"] },
      ],
    }),
  };
  const original = await planWorkflow(
    root,
    "create",
    { source: revision, base },
    adapters,
  );
  const final = await planWorkflow(
    root,
    "create",
    {
      source: revision,
      base,
      operation: "release-private",
      destination: "synthetic.invalid",
      verificationPlan: original,
    },
    {
      ...adapters,
      readBaseline: async () =>
        assert.fail(
          "Private authorization must not request GitHub credentials",
        ),
    },
  );
  assert.notEqual(final.authorizationDigest, original.authorizationDigest);
  const sourceReceipt = receipt(original);
  sourceReceipt.results.push({
    id: "delivery-unit",
    status: "passed",
    exitCode: 0,
  });
  const nativeReceipt = {
    ...receipt(original),
    lane: "macos-native",
    host: "macos",
    results: [{ id: "client-native", status: "passed", exitCode: 0 }],
  };
  const stages = Object.fromEntries(
    ["compatibility", "reserve", "inputs", "build", "qualify", "github"].map(
      (name) => [
        name,
        async ({ operation }) => {
          assert.deepEqual(operation.verification, {
            schemaVersion: 1,
            source: revision,
            planDigest: original.authorizationDigest,
            status: "passed",
            lanes: ["macos-native", "tooling"],
            results: [
              { id: "tooling", status: "passed", exitCode: 0 },
              { id: "macos-native", status: "passed", exitCode: 0 },
            ],
          });
          return { evidence: name };
        },
      ],
    ),
  );
  assert.equal(
    (
      await runWorkflow(root, final, {
        adapters: stages,
        receipts: [sourceReceipt, nativeReceipt],
        confirmation: final.authorizationDigest,
      })
    ).status,
    "completed",
  );
  assert.equal(sourceReceipt.planDigest, original.authorizationDigest);
  await assert.rejects(
    planWorkflow(
      root,
      "create",
      { source: revision, base, verificationPlan: original },
      {
        ...adapters,
        createSourcePlan: async () => ({
          ...selection(),
          source: revision,
          appImpact: true,
          lanes: [],
        }),
      },
    ),
    /Verification inputs changed: lanes/,
  );
});

test("lane evidence never hides a failed or nonzero suite result", async (t) => {
  const { root, source: revision } = committedFixture(t);
  let effects = 0;
  for (const [index, failed] of [
    { id: "delivery-unit", status: "failed", exitCode: 1 },
    { id: "delivery-unit", status: "passed", exitCode: 1 },
  ].entries()) {
    const plan = sealPlan({
      ...selection(),
      source: revision,
      workflow: "create",
      appImpact: true,
      repository: "getsituate/situate",
      operation: `failed-suite-${index}`,
      destination: "synthetic.invalid",
      lanes: [
        {
          id: "tooling",
          host: "linux",
          suites: ["runner-unit", "delivery-unit"],
        },
      ],
    });
    const sourceReceipt = receipt(plan);
    sourceReceipt.results.push(failed);
    await assert.rejects(
      runWorkflow(root, plan, {
        receipts: [sourceReceipt],
        confirmation: plan.authorizationDigest,
        adapters: {
          compatibility: async () => {
            effects++;
          },
        },
      }),
      /A selected suite did not pass/,
    );
  }
  assert.equal(effects, 0);
});

test("staging executes prerequisites once and an intentional pause can continue", async (t) => {
  const root = fixture(t);
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "publish",
    repository: "getsituate/situate",
    operation: "staged-publication",
    destination: "synthetic.invalid",
    releaseId: "9",
    lanes: [],
  });
  const calls = [];
  const adapters = Object.fromEntries(
    ["download", "verify", "promote"].map((name) => [
      name,
      async () => {
        calls.push(name);
        return { releaseId: "9" };
      },
    ]),
  );
  const first = await runWorkflow(root, plan, {
    adapters,
    confirmation: plan.authorizationDigest,
    until: "verify",
  });
  assert.equal(first.status, "paused");
  assert.deepEqual(calls, ["download", "verify"]);
  assert.equal(
    (
      await runWorkflow(root, plan, {
        adapters,
        confirmation: plan.authorizationDigest,
        until: "verify",
      })
    ).status,
    "paused",
  );
  assert.deepEqual(calls, ["download", "verify"]);
  assert.equal(
    (
      await runWorkflow(root, plan, {
        adapters,
        confirmation: plan.authorizationDigest,
      })
    ).status,
    "completed",
  );
  assert.deepEqual(calls, ["download", "verify", "promote"]);
});

test("unknown external effects persist and cannot be blindly rerun", async (t) => {
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "publish",
    repository: "getsituate/situate",
    operation: "publication-1",
    destination: "synthetic.invalid",
    releaseId: "7",
    lanes: [],
  });
  const root = fixture(t);
  let attempts = 0;
  const adapters = {
    download: async () => ({ releaseId: "7" }),
    verify: async () => ({ hashes: "verified" }),
    promote: async () => {
      attempts++;
      throw new Error("connection lost");
    },
    inspect: async () => ({ state: "unknown" }),
    reconcile: async () => {},
  };
  await assert.rejects(
    runWorkflow(root, plan, {
      adapters,
      confirmation: plan.authorizationDigest,
    }),
    /connection lost/,
  );
  assert.equal(readOperation(root, plan.operation).status, "unknown");
  await assert.rejects(
    runWorkflow(root, plan, {
      adapters,
      confirmation: plan.authorizationDigest,
    }),
    /inspect/,
  );
  const observation = await inspectWorkflow(root, plan.operation, { adapters });
  assert.match(observation.reconciliationDigest, /^[a-f0-9]{64}$/);
  await assert.rejects(
    reconcileWorkflow(root, plan.operation, "yes", { adapters }),
    /Confirm/,
  );
  await assert.rejects(
    reconcileWorkflow(root, plan.operation, observation.reconciliationDigest, {
      adapters,
    }),
    /Unresolved/,
  );
  assert.equal(attempts, 1);
  const stored = JSON.parse(
    readFileSync(
      join(root, ".release-operations", plan.operation, "inspection.json"),
    ),
  );
  assert.equal(digest(stored), observation.reconciliationDigest);
});

test("an inspected compatibility failure can resume without repeating source checks", async (t) => {
  const { root, source: revision } = committedFixture(t);
  const plan = sealPlan({
    ...selection(),
    source: revision,
    workflow: "create",
    appImpact: true,
    repository: "getsituate/situate",
    operation: "compatibility-recovery",
    destination: "synthetic.invalid",
  });
  const calls = [];
  const adapters = Object.fromEntries(
    ["reserve", "inputs", "build", "qualify", "github"].map((name) => [
      name,
      async () => {
        calls.push(name);
        return { evidence: name };
      },
    ]),
  );
  adapters.compatibility = async () => {
    throw new Error("history unavailable");
  };
  adapters.inspect = async () => ({
    reservation: { status: "absent" },
    claim: plan.operation,
  });
  adapters.reconcile = async ({ operation, resolution }) => {
    assert.equal(resolution, "resume");
    operation.stages[0].output = { history: "verified" };
    operation.stages[0].status = "passed";
  };
  await assert.rejects(
    runWorkflow(root, plan, {
      adapters,
      receipts: [receipt(plan)],
      confirmation: plan.authorizationDigest,
    }),
    /history unavailable/,
  );
  const inspected = await inspectWorkflow(root, plan.operation, { adapters });
  const result = await reconcileWorkflow(
    root,
    plan.operation,
    inspected.reconciliationDigest,
    { adapters },
  );
  assert.equal(result.type, "result");
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["reserve", "inputs", "build", "qualify", "github"]);
});

test("an explicit inspected abandonment does not run later stages", async (t) => {
  const { root, source: revision } = committedFixture(t);
  const plan = sealPlan({
    ...selection(),
    source: revision,
    workflow: "create",
    appImpact: true,
    repository: "getsituate/situate",
    operation: "abandon-fixture",
    destination: "synthetic.invalid",
  });
  const adapters = {
    compatibility: async () => {
      throw new Error("unavailable");
    },
    inspect: async () => ({ reservation: { status: "absent" } }),
    reconcile: async ({ operation, resolution }) => {
      assert.equal(resolution, "abandon");
      operation.status = "abandoned";
    },
    reserve: () => assert.fail("abandoned operation continued"),
  };
  await assert.rejects(
    runWorkflow(root, plan, {
      adapters,
      receipts: [receipt(plan)],
      confirmation: plan.authorizationDigest,
    }),
    /unavailable/,
  );
  const inspected = await inspectWorkflow(root, plan.operation, { adapters });
  assert.equal(
    (
      await reconcileWorkflow(
        root,
        plan.operation,
        inspected.reconciliationDigest,
        { adapters, resolution: "abandon" },
      )
    ).status,
    "abandoned",
  );
  assert.equal(readOperation(root, plan.operation).status, "abandoned");
});

test("publication never uses builder or source verification lanes", async (t) => {
  const root = fixture(t);
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "publish",
    repository: "getsituate/situate",
    operation: "publication-2",
    destination: "synthetic.invalid",
    releaseId: "8",
    lanes: [],
  });
  const calls = [];
  const adapters = Object.fromEntries(
    ["download", "verify", "promote"].map((name) => [
      name,
      async () => {
        calls.push(name);
        return { releaseId: "8" };
      },
    ]),
  );
  adapters.build = () => assert.fail("publisher built an app");
  assert.equal(
    (
      await runWorkflow(root, plan, {
        adapters,
        confirmation: plan.authorizationDigest,
      })
    ).status,
    "completed",
  );
  assert.deepEqual(calls, ["download", "verify", "promote"]);
});

test("ordinary environments preserve only a restrictive single build slot outside containers", () => {
  assert.deepEqual(
    ordinaryEnvironment({
      SITUATE_TOOL_BUILD_SLOTS: "1",
      SITUATE_HOST_ADMISSION: "untrusted",
      GH_TOKEN: "untrusted",
    }),
    { SITUATE_TOOL_BUILD_SLOTS: "1" },
  );
  for (const value of ["0", "2", "invalid"])
    assert.deepEqual(
      ordinaryEnvironment({ SITUATE_TOOL_BUILD_SLOTS: value }),
      {},
    );
});

test("only tool containers retain the pinned NSS runtime for arbitrary numeric users", () => {
  const runtime = {
    LD_PRELOAD: "/opt/ci-tools/libnss_wrapper.so",
    NSS_WRAPPER_PASSWD: "/tmp/situate-ci-home/ci-passwd",
    NSS_WRAPPER_GROUP: "/tmp/situate-ci-home/ci-group",
  };
  assert.deepEqual(ordinaryEnvironment(runtime), {});
  assert.deepEqual(
    ordinaryEnvironment({ ...runtime, SITUATE_TOOL_CONTAINER: "1" }),
    { ...runtime, SITUATE_TOOL_CONTAINER: "1" },
  );
  assert.equal(
    ordinaryEnvironment({
      SITUATE_TOOL_CONTAINER: "1",
      LD_PRELOAD: "/tmp/untrusted.so",
    }).LD_PRELOAD,
    undefined,
  );
});

test("fresh checkpoint inspection and explicit restoration preserve original operation paths and reject stale observations", async (t) => {
  const root = fixture(t);
  const plan = sealPlan({
    schemaVersion: 1,
    workflow: "create",
    source,
    base,
    operation: "fresh-restore",
    lanes: [],
    configurationDigest: "c".repeat(64),
  });
  let remote = { checkpoints: { inspectionDigest: "host-inspection" } };
  let restores = 0;
  const adapters = {
    inspect: async () => remote,
    restore: async ({ checkpointId, destination }) => {
      restores++;
      assert.equal(checkpointId, "selected-checkpoint");
      return {
        directory: destination,
        manifestSha256: "d".repeat(64),
        descriptor: { checkpointId },
      };
    },
  };
  const inspection = await inspectWorkflow(root, plan.operation, {
    plan,
    adapters,
  });
  await assert.rejects(
    restoreWorkflow(root, plan.operation, "wrong-confirmation", {
      plan,
      adapters,
      checkpointId: "selected-checkpoint",
      destination: "/synthetic/restore",
    }),
  );
  assert.equal(restores, 0);
  remote = { changed: true };
  await assert.rejects(
    restoreWorkflow(root, plan.operation, inspection.reconciliationDigest, {
      plan,
      adapters,
      checkpointId: "selected-checkpoint",
      destination: "/synthetic/restore",
    }),
    /External state changed/,
  );
  assert.equal(restores, 0);
  remote = inspection.remote;
  const result = await restoreWorkflow(
    root,
    plan.operation,
    inspection.reconciliationDigest,
    {
      plan,
      adapters,
      checkpointId: "selected-checkpoint",
      destination: "/synthetic/restore",
    },
  );
  assert.equal(result.status, "restored");
  assert.equal(
    result.recoveryAuthorization.inspectionDigest,
    inspection.reconciliationDigest,
  );
  assert.equal(restores, 1);
  assert.equal(
    existsSync(
      join(root, ".release-operations", plan.operation, "operation.json"),
    ),
    false,
  );
});

test("ordinary subprocess environments contain no signing/publication/provider credentials", () => {
  assert.deepEqual(
    ordinaryEnvironment({
      PATH: "path",
      DEVELOPER_DIR: "/Applications/Test-Xcode.app/Contents/Developer",
      GH_TOKEN: "not-forwarded",
      APPLE_ID: "not-forwarded",
      WEBSITE_DEPLOY_HOST: "not-forwarded",
      SITUATE_UPDATER_PRIVATE_KEY: "not-forwarded",
    }),
    {
      PATH: "path",
      DEVELOPER_DIR: "/Applications/Test-Xcode.app/Contents/Developer",
    },
  );
});
