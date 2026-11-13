import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
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
  planWorkflow,
  runLane,
  runWorkflow,
  inspectWorkflow,
  reconcileWorkflow,
  validateDeclarations,
} from "./pipeline.mjs";
import { behaviorDigest, fragmentHashes } from "./change-fragments.mjs";
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
      schemaVersion: 1,
      id,
      behaviorDigest: behaviorDigest(root, git("rev-parse", "HEAD")),
      emptyReason: name,
      locales: {
        en: { title: "Changes", entries: [] },
        de: { title: "Änderungen", entries: [] },
      },
    };
    const hashes = fragmentHashes(fragment);
    fragment.sourceApproval = {
      action: "approve",
      sourceHash: hashes.sourceHash,
    };
    fragment.translationApprovals = {
      de: {
        sourceHash: hashes.sourceHash,
        translationHash: hashes.translations.de,
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
    validateDeclarations(root, { source, base, heads: [source] }),
    /behavior|binding|bound/i,
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

test("private release authorization retains original source receipts without rebinding them", async (t) => {
  const { root, source: revision } = committedFixture(t);
  const adapters = {
    readBaseline: async () => ({ source: revision, legacy: true }),
    createSourcePlan: async () => ({
      ...selection(),
      source: revision,
      appImpact: true,
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
  const stages = Object.fromEntries(
    ["compatibility", "reserve", "inputs", "build", "qualify", "github"].map(
      (name) => [
        name,
        async ({ operation }) => {
          assert.equal(
            operation.verification.planDigest,
            original.authorizationDigest,
          );
          return { evidence: name };
        },
      ],
    ),
  );
  assert.equal(
    (
      await runWorkflow(root, final, {
        adapters: stages,
        receipts: [sourceReceipt],
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

test("ordinary subprocess environments contain no signing/publication/provider credentials", () => {
  assert.deepEqual(
    ordinaryEnvironment({
      PATH: "path",
      GH_TOKEN: "not-forwarded",
      APPLE_ID: "not-forwarded",
      WEBSITE_DEPLOY_HOST: "not-forwarded",
      SITUATE_UPDATER_PRIVATE_KEY: "not-forwarded",
    }),
    { PATH: "path" },
  );
});
