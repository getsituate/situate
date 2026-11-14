import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  aggregate,
  digest,
  eventSelection,
  laneHosts,
  main,
  matrices,
  resolveMergeGroupHeads,
  validatePlan,
  diagnosticPlan,
  imageBuildRequired,
} from "./actions-adapter.mjs";

test("desktop preflight uses the shared adapter without production credentials", async () => {
  const evidence = { desktopUnlocked: true, accessibilityTrusted: true };
  const result = await main(
    ["desktop"],
    {
      ImageOS: "macos26",
      ImageVersion: "20261101.1",
      GITHUB_TOKEN: "synthetic-secret",
      APPLE_API_PRIVATE_KEY: "synthetic-secret",
    },
    (command, args, options) => {
      assert.equal(command, process.execPath);
      assert(args[0].endsWith("/tools/release-desktop.mjs"));
      assert.deepEqual(options.env, {
        ImageOS: "macos26",
        ImageVersion: "20261101.1",
      });
      assert.equal(options.timeout, 30_000);
      return JSON.stringify(evidence);
    },
  );
  assert.deepEqual(result, evidence);
  await assert.rejects(
    main(["desktop"], {}, () => {
      throw new Error("Synthetic unavailable desktop");
    }),
    /Synthetic unavailable desktop/,
  );
});

test("tool-image selection ignores unchanged tool inputs and honors an explicit rebuild", () => {
  const pinned = "a".repeat(64);
  assert.equal(imageBuildRequired("push", pinned, pinned), false);
  assert.equal(imageBuildRequired("push", "b".repeat(64), pinned), true);
  assert.equal(imageBuildRequired("workflow_dispatch", pinned, pinned), true);
  assert.throws(
    () => imageBuildRequired("pull_request", pinned, pinned),
    /selection/,
  );
});

test("optional diagnostics separate portable coverage, native coverage and Docker orchestration", async () => {
  assert.deepEqual(
    (await diagnosticPlan("coverage", "portable")).suites.map(({ id }) => id),
    ["client-vue-coverage"],
  );
  assert.deepEqual(
    (await diagnosticPlan("coverage", "native")).suites.map(({ id }) => id),
    ["client-rust-coverage"],
  );
  const portable = (await diagnosticPlan("design", "portable")).suites.map(
    ({ id }) => id,
  );
  for (const id of [
    "root-swift",
    "client-browser-chromium",
    "client-browser-webkit",
    "client-core",
    "dev-tui-unit",
  ])
    assert(portable.includes(id));
  for (const id of [
    "client-host",
    "client-native",
    "client-core-macos",
    "client-docker-context",
  ])
    assert(!portable.includes(id));
  assert.deepEqual(
    (await diagnosticPlan("design", "docker")).suites
      .map(({ id }) => id)
      .sort(),
    ["client-docker-context", "design-website-hosting"],
  );
  await assert.rejects(diagnosticPlan("provider", "portable"), /selection/);
});

const source = "a".repeat(40);
const base = "b".repeat(40);
const plan = {
  schemaVersion: 1,
  source,
  base,
  appImpact: false,
  lanes: [
    {
      id: "policy",
      host: "linux",
      suites: ["root-secrets"],
      reasons: ["Source policy"],
    },
  ],
  authorizationDigest: "c".repeat(64),
};
const receipt = {
  schemaVersion: 1,
  source,
  planDigest: plan.authorizationDigest,
  lane: "policy",
  host: "linux",
  status: "passed",
  results: [{ id: "root-secrets", status: "passed", exitCode: 0 }],
};
const statuses = () => ({
  plan: { result: "success" },
  ...Object.fromEntries(
    Object.keys(laneHosts).map((id) => [
      id,
      { result: id === "policy" ? "success" : "skipped" },
    ]),
  ),
});
const environment = {
  GITHUB_REPOSITORY: "getsituate/situate",
  GITHUB_SHA: source,
  GITHUB_REF: "refs/heads/main",
};

test("event adapter rejects missing history and uses integrated PR source, preceding push, and merge queue base", () => {
  for (const [event, body] of [
    [
      "pull_request",
      { pull_request: { base: { sha: base }, head: { sha: "d".repeat(40) } } },
    ],
    ["push", { before: base }],
    [
      "merge_group",
      {
        merge_group: {
          base_sha: base,
          head_sha: source,
          base_ref: "refs/heads/main",
        },
      },
    ],
  ])
    assert.deepEqual(
      eventSelection({ ...environment, GITHUB_EVENT_NAME: event }, body),
      {
        source,
        base,
        ...(event === "pull_request"
          ? { declarationHead: "d".repeat(40) }
          : {}),
      },
    );
  for (const invalid of ["", "0".repeat(40), "main"])
    assert.throws(
      () =>
        eventSelection(
          { ...environment, GITHUB_EVENT_NAME: "push" },
          { before: invalid },
        ),
      /history/,
    );
  assert.throws(
    () =>
      eventSelection(
        {
          ...environment,
          GITHUB_REPOSITORY: "attacker/fork",
          GITHUB_EVENT_NAME: "push",
        },
        { before: base },
      ),
    /repository/,
  );
  assert.throws(
    () =>
      eventSelection(
        { ...environment, GITHUB_EVENT_NAME: "pull_request_target" },
        {},
      ),
    /Unsupported/,
  );
});

const pullRequest = (number, overrides = {}) => ({
  number,
  state: "open",
  head: { sha: number.toString(16).padStart(40, "0") },
  base: { ref: "main", repo: { full_name: "getsituate/situate" } },
  ...overrides,
});

test("merge groups resolve complete open-PR membership and fetch exact heads without changing checkout", () => {
  const calls = [];
  let selected;
  const pages = [
    Array.from({ length: 100 }, (_, index) =>
      pullRequest(index + 1, { state: "closed" }),
    ),
    [pullRequest(102), pullRequest(101)],
  ];
  const heads = resolveMergeGroupHeads(source, environment, (command, args) => {
    calls.push([command, args]);
    if (command === "gh") return JSON.stringify(pages.shift());
    if (args[0] === "fetch") {
      selected = Number(args.at(-1).split("/")[2]);
      return "";
    }
    if (args[0] === "rev-parse") return pullRequest(selected).head.sha;
    if (args[0] === "cat-file") return "commit";
    assert.fail("Unexpected Git operation");
  });
  assert.deepEqual(heads, [
    pullRequest(101).head.sha,
    pullRequest(102).head.sha,
  ]);
  assert.equal(calls.filter(([command]) => command === "gh").length, 2);
  assert.match(calls[0][1][1], /per_page=100&page=1$/);
  assert.match(calls[1][1][1], /per_page=100&page=2$/);
  for (const [, args] of calls)
    assert.ok(!args.some((value) => /checkout|--force|^\+/.test(value)));
  assert.deepEqual(
    calls
      .filter(([, args]) => args[0] === "fetch")
      .map(([, args]) => args.at(-1)),
    ["refs/pull/101/head", "refs/pull/102/head"],
  );
});

test("merge-group membership fails closed on empty, malformed, duplicate or wrong-base listings", () => {
  const first = pullRequest(1);
  for (const listing of [
    [],
    {},
    null,
    [pullRequest(1, { state: "closed" })],
    [first, first],
    [first, pullRequest(2, { head: first.head })],
    [
      pullRequest(1, {
        base: { ref: "other", repo: { full_name: "getsituate/situate" } },
      }),
    ],
    [
      pullRequest(1, {
        base: { ref: "main", repo: { full_name: "attacker/fork" } },
      }),
    ],
    [pullRequest(1, { head: { sha: [first.head.sha] } })],
    [pullRequest(1, { number: "1" })],
  ])
    assert.throws(() =>
      resolveMergeGroupHeads(source, environment, (command) => {
        assert.equal(command, "gh");
        return JSON.stringify(listing);
      }),
    );
  let pages = 0;
  assert.throws(
    () =>
      resolveMergeGroupHeads(source, environment, () => {
        pages++;
        return JSON.stringify(
          Array.from({ length: 100 }, (_, index) => pullRequest(index + 1)),
        );
      }),
    /supported limit/,
  );
  assert.equal(pages, 10);
});

test("merge-group fetch races, missing commits and service failures cannot become passing selection", () => {
  for (const [fetched, type] of [
    ["f".repeat(40), "commit"],
    [pullRequest(1).head.sha, "tag"],
  ])
    assert.throws(
      () =>
        resolveMergeGroupHeads(source, environment, (command, args) => {
          if (command === "gh") return JSON.stringify([pullRequest(1)]);
          if (args[0] === "fetch") return "";
          return args[0] === "rev-parse" ? fetched : type;
        }),
      /differs/,
    );
  assert.throws(
    () =>
      resolveMergeGroupHeads(source, environment, () => {
        throw new Error("Synthetic service failure");
      }),
    /service failure/,
  );
  assert.throws(
    () =>
      resolveMergeGroupHeads(source, environment, (command) => {
        if (command === "gh") return JSON.stringify([pullRequest(1)]);
        throw new Error("Synthetic fetch failure");
      }),
    /fetch failure/,
  );
});

test("merge-group planning sends actual declaration heads separately from integrated source", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-merge-group-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const event = join(directory, "event.json");
  writeFileSync(
    event,
    JSON.stringify({
      merge_group: {
        base_sha: base,
        head_sha: source,
        base_ref: "refs/heads/main",
      },
    }),
  );
  let invoked = false;
  const result = await main(
    ["plan"],
    {
      ...environment,
      GITHUB_EVENT_NAME: "merge_group",
      GITHUB_EVENT_PATH: event,
    },
    (command, args) => {
      if (command === "gh") return JSON.stringify([pullRequest(1)]);
      if (command === "git")
        return args[0] === "fetch"
          ? ""
          : args[0] === "cat-file"
            ? "commit"
            : pullRequest(1).head.sha;
      invoked = true;
      assert.deepEqual(
        JSON.parse(args[args.indexOf("--declaration-heads") + 1]),
        [pullRequest(1).head.sha],
      );
      assert.equal(args[args.indexOf("--source") + 1], source);
      assert.equal(args.includes("--declaration-head"), false);
      return JSON.stringify(plan);
    },
  );
  assert.equal(invoked, true);
  assert.equal(result.source, source);
});

test("merge-group source mismatches fail before membership lookup and its token stays in planning", () => {
  for (const group of [
    { head_sha: "f".repeat(40), base_ref: "refs/heads/main", base_sha: base },
    { head_sha: source, base_ref: "refs/heads/other", base_sha: base },
  ])
    assert.throws(
      () =>
        eventSelection(
          { ...environment, GITHUB_EVENT_NAME: "merge_group" },
          { merge_group: group },
        ),
      /source and main base/,
    );
  const workflow = readFileSync(
    new URL("../.github/workflows/verify.yml", import.meta.url),
    "utf8",
  );
  const [planning, lanes] = workflow.split("\n  policy:");
  assert.match(planning, /pull-requests: read/);
  assert.ok(
    planning.includes(
      "GH_TOKEN: ${{ github.event_name == 'merge_group' && github.token || '' }}",
    ),
  );
  assert.doesNotMatch(lanes, /GH_TOKEN|secrets\./);
});

test("matrices contain only fixed lane IDs; unknown hosts and duplicate suites fail", () => {
  assert.deepEqual(matrices(plan), {
    linux: { include: [{ lane: "policy" }] },
    macos: { include: [] },
  });
  for (const lane of [
    { ...plan.lanes[0], host: "windows" },
    { ...plan.lanes[0], id: "$(command)" },
    { ...plan.lanes[0], suites: ["root-secrets", "root-secrets"] },
  ])
    assert.throws(() => validatePlan({ ...plan, lanes: [lane] }));
  assert.throws(() =>
    validatePlan({ ...plan, lanes: [...plan.lanes, plan.lanes[0]] }),
  );
  assert.throws(() =>
    validatePlan({ ...plan, authorizationDigest: undefined }),
  );
});

test("aggregate distinguishes deliberate unselection from failure, cancellation, absent or duplicate receipts", () => {
  assert.equal(aggregate(plan, [receipt], statuses()).status, "passed");
  for (const result of ["failure", "cancelled", "skipped", undefined])
    assert.throws(() =>
      aggregate(plan, [receipt], { ...statuses(), policy: { result } }),
    );
  assert.throws(() =>
    aggregate(plan, [receipt], {
      ...statuses(),
      frontend: { result: "success" },
    }),
  );
  for (const receipts of [
    [],
    [receipt, receipt],
    [{ ...receipt, source: base }],
    [{ ...receipt, planDigest: "f".repeat(64) }],
    [{ ...receipt, status: "cancelled" }],
  ])
    assert.throws(() => aggregate(plan, receipts, statuses()));
  assert.throws(() =>
    aggregate(plan, [receipt], { ...statuses(), plan: { result: "failure" } }),
  );
});

test("adapter subprocess executes fixture runner and transports exact plan-bound receipt without Actions APIs", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-adapter-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "tools"));
  writeFileSync(
    join(directory, "tools/actions-adapter.mjs"),
    readFileSync(new URL("./actions-adapter.mjs", import.meta.url)),
  );
  writeFileSync(
    join(directory, "tools/pipeline.mjs"),
    `import {writeFileSync} from 'node:fs';const args=process.argv.slice(2);if(args[0]==='plan')console.log(${JSON.stringify(JSON.stringify(plan))});else writeFileSync(args[args.indexOf('--receipt')+1],${JSON.stringify(JSON.stringify(receipt))});`,
  );
  writeFileSync(
    join(directory, "tools/pipeline-state.mjs"),
    "export function aggregateReceipts(plan, receipts) { if(receipts[0].results[0].id !== plan.lanes[0].suites[0]) throw Error('Wrong suite'); return {status:'passed',results:receipts}; }",
  );
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "--quiet",
    "-m",
    "test: fixture",
  );
  const actualSource = git("rev-parse", "HEAD");
  const actualPlan = { ...plan, source: actualSource };
  const actualReceipt = { ...receipt, source: actualSource };
  writeFileSync(
    join(directory, "tools/pipeline.mjs"),
    `import {writeFileSync} from 'node:fs';const args=process.argv.slice(2);if(args[0]==='plan')console.log(${JSON.stringify(JSON.stringify(actualPlan))});else writeFileSync(args[args.indexOf('--receipt')+1],${JSON.stringify(JSON.stringify(actualReceipt))});`,
  );
  const event = join(directory, "event.json");
  const output = join(directory, "outputs");
  writeFileSync(event, JSON.stringify({ before: base }));
  const env = {
    ...process.env,
    ...environment,
    GITHUB_SHA: actualSource,
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: event,
    GITHUB_OUTPUT: output,
    PIPELINE_PLAN: JSON.stringify(actualPlan),
    PIPELINE_PLAN_DIGEST: digest(actualPlan),
  };
  delete env.ACTIONS_RUNTIME_TOKEN;
  delete env.ACTIONS_RESULTS_URL;
  delete env.GH_TOKEN;
  for (const args of [["plan"], ["lane", "--lane", "policy"], ["aggregate"]]) {
    if (args[0] === "aggregate")
      env.PIPELINE_NEEDS = JSON.stringify({
        ...statuses(),
        policy: {
          result: "success",
          outputs: { receipt: JSON.stringify(actualReceipt) },
        },
      });
    const result = spawnSync(
      process.execPath,
      ["tools/actions-adapter.mjs", ...args],
      { cwd: directory, env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  assert.match(readFileSync(output, "utf8"), /receipt=/);
  const result = spawnSync(
    process.execPath,
    ["tools/actions-adapter.mjs", "lane", "--lane", "policy"],
    {
      cwd: directory,
      env: { ...env, PIPELINE_PLAN_DIGEST: "f".repeat(64) },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /digest mismatch/);
});

test("unprovisioned remote operations and paid diagnostics fail visibly before executing commands", async () => {
  const execute = () => {
    throw new Error("Unexpected external command");
  };
  await assert.rejects(main(["blocked"], {}, execute), /disabled pending/);
  await assert.rejects(main(["image-build"], {}, execute), /main-branch run/);
  await assert.rejects(
    main(
      ["diagnostics", "--lane", "provider"],
      { ...environment, GITHUB_EVENT_NAME: "workflow_dispatch" },
      execute,
    ),
    /protected authorization/,
  );
  await assert.rejects(
    main(
      ["diagnostics", "--lane", "coverage"],
      { ...environment, GITHUB_EVENT_NAME: "push" },
      execute,
    ),
    /explicit trusted/,
  );
});

test("recovery inspects only an exact operation and rejects reconciliation without provisioning", async () => {
  const env = {
    ...environment,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    RECOVERY_WORKFLOW: "publish",
    RECOVERY_OPERATION: "operation-1",
    RECOVERY_ACTION: "inspect",
  };
  const calls = [];
  await main(["recovery"], env, (command, args) => calls.push([command, args]));
  assert.deepEqual(calls[0][1], [
    "tools/pipeline.mjs",
    "inspect",
    "publish",
    "--operation",
    "operation-1",
  ]);
  await assert.rejects(
    main(["recovery"], { ...env, RECOVERY_ACTION: "reconcile" }),
    /disabled pending/,
  );
  await assert.rejects(
    main(["recovery"], { ...env, RECOVERY_OPERATION: "../other" }),
    /identity/,
  );
});

test("weekly monitoring is opt-in while explicit dispatch remains available", async () => {
  assert.equal(
    (await main(["monitoring-policy"], { GITHUB_EVENT_NAME: "schedule" }))
      .enabled,
    false,
  );
  assert.equal(
    (
      await main(["monitoring-policy"], {
        GITHUB_EVENT_NAME: "schedule",
        MONITORING_WEEKLY: "true",
      })
    ).enabled,
    true,
  );
  assert.equal(
    (
      await main(["monitoring-policy"], {
        GITHUB_EVENT_NAME: "workflow_dispatch",
      })
    ).enabled,
    true,
  );
});
