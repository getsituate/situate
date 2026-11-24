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
  resolvePullRequestBase,
  validatePlan,
  verificationNeeds,
  diagnosticPlan,
  sonarLcov,
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

test("Sonar coverage maps Vue source paths without changing coverage records", () => {
  assert.equal(
    sonarLcov(
      "TN:\nSF:src/App.vue\nDA:12,1\nend_of_record\n",
      "/work/client/app",
    ),
    "TN:\nSF:/work/client/app/src/App.vue\nDA:12,1\nend_of_record\n",
  );
  assert.throws(
    () => sonarLcov("TN:\n", "/work/client/app"),
    /no source paths/,
  );
  assert.throws(
    () => sonarLcov("SF:src/App.vue\nSF:other.ts\n", "/work/client/app"),
    /relative to the Vue app/,
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
    "client-browser-webkit-smoke",
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

test("PR base resolution rejects unrelated history and mismatched merge parents", () => {
  const head = "d".repeat(40),
    currentBase = "e".repeat(40);
  for (const parents of [
    `${source} ${currentBase}`,
    `${source} ${currentBase} ${base}`,
    `${source} ${currentBase} ${head} ${base}`,
  ]) {
    assert.throws(
      () => resolvePullRequestBase(source, base, head, () => parents),
      /merge commit does not match/,
    );
  }
  assert.throws(
    () =>
      resolvePullRequestBase(source, base, head, (_command, args) => {
        if (args[0] === "rev-list") return `${source} ${currentBase} ${head}`;
        assert.deepEqual(args, [
          "merge-base",
          "--is-ancestor",
          base,
          currentBase,
        ]);
        throw new Error("Not an ancestor");
      }),
    /Not an ancestor/,
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

test("merge-group source mismatches fail before lookup and test workers receive no token", () => {
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
  assert.doesNotMatch(lanes.split("\n  required:")[0], /GH_TOKEN|secrets\./);
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

test("Verify requires the shared ARM64 job and only the selected lane receipts", () => {
  const otherJobs = statuses();
  for (const id of ["tooling-macos", "macos-code", "macos-native"])
    delete otherJobs[id];
  const needsFor = (job) => ({ ...otherJobs, "macos-arm64": job });
  const skipped = needsFor({ result: "skipped" });
  assert.equal(
    aggregate(plan, [receipt], verificationNeeds(plan, skipped)).status,
    "passed",
  );

  const selected = {
    ...plan,
    lanes: [
      ...plan.lanes,
      {
        id: "macos-native",
        host: "macos",
        suites: ["client-native"],
        reasons: [],
      },
    ],
  };
  const receipts = [
    receipt,
    { ...receipt, lane: "macos-native", host: "macos" },
  ];
  const outputs = {
    "tooling-macos-result": "skipped",
    "macos-code-result": "skipped",
    "macos-native-result": "success",
    "macos-native-receipt": "native-receipt",
    "macos-native-evidence": "native-evidence",
  };
  const success = needsFor({ result: "success", outputs });
  const needs = verificationNeeds(selected, success);
  assert.deepEqual(needs["macos-native"].outputs, {
    receipt: "native-receipt",
    evidence: "native-evidence",
  });
  assert.deepEqual(aggregate(selected, receipts, needs).lanes, [
    "policy",
    "macos-native",
  ]);
  assert.throws(() => aggregate(selected, [receipt], needs), /lane receipts/);
  for (const result of ["failure", "cancelled", "skipped"])
    assert.throws(
      () => verificationNeeds(selected, needsFor({ result, outputs })),
      /macos-arm64 job result/,
    );
  assert.throws(
    () => verificationNeeds(plan, success),
    /macos-arm64 job result/,
  );
  for (const [lane, result] of [
    ["macos-native", "skipped"],
    ["macos-code", "success"],
  ]) {
    const invalid = needsFor({
      result: "success",
      outputs: { ...outputs, [`${lane}-result`]: result },
    });
    assert.throws(
      () => aggregate(selected, receipts, verificationNeeds(selected, invalid)),
      new RegExp(`Unexpected ${lane}`),
    );
  }
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

test("selected browser jobs must each succeed and return their own receipt", () => {
  const lanes = [
    { id: "browser", suites: ["client-browser-chromium"] },
    { id: "browser-webkit", suites: ["client-browser-webkit-smoke"] },
  ].map((lane) => ({ ...lane, host: "linux", reasons: ["Product changes"] }));
  const browserPlan = { ...plan, lanes };
  const receipts = lanes.map((lane) => ({
    ...receipt,
    lane: lane.id,
    results: [{ id: lane.suites[0], status: "passed", exitCode: 0 }],
  }));
  const needs = {
    ...statuses(),
    policy: { result: "skipped" },
    browser: { result: "success" },
    "browser-webkit": { result: "success" },
  };
  assert.deepEqual(aggregate(browserPlan, receipts, needs).lanes, [
    "browser",
    "browser-webkit",
  ]);
  assert.throws(
    () => aggregate(browserPlan, [receipts[0], receipts[0]], needs),
    /invalid receipt/,
  );
  assert.throws(
    () =>
      aggregate(browserPlan, receipts, {
        ...needs,
        "browser-webkit": { result: "skipped" },
      }),
    /Unexpected browser-webkit job result/,
  );
});

test("the Actions adapter does not accept a plan path", async () => {
  const env = {
    PIPELINE_PLAN: JSON.stringify(plan),
    PIPELINE_PLAN_DIGEST: digest(plan),
  };
  const never = () => assert.fail("The adapter must not execute a lane");
  await assert.rejects(
    main(["lane", "--lane", "policy", "--plan", "fixture.json"], env, never),
    { code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" },
  );
});

test("PR base resolution rejects non-commit identities before executing Git", () => {
  const never = () => assert.fail("Git must not run for an invalid identity");
  for (const inputs of [
    ["HEAD", base, source],
    [source, "main", base],
    [source, base, "HEAD"],
  ])
    assert.throws(() => resolvePullRequestBase(...inputs, never), /Exact PR/);
});

test("adapter subprocess transports plan-bound receipts and reports planner failures without Actions APIs", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-adapter-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "tools"));
  writeFileSync(
    join(directory, "tools/actions-receipts.mjs"),
    readFileSync(new URL("./actions-receipts.mjs", import.meta.url)),
  );
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
          outputs: {
            receipt: readFileSync(output, "utf8")
              .split("\n")
              .find((line) => line.startsWith("receipt="))
              .slice("receipt=".length),
          },
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

  writeFileSync(
    join(directory, "tools/pipeline.mjs"),
    "console.error('Client changes require a new declaration'); process.exitCode = 1;",
  );
  const previousOutput = readFileSync(output, "utf8");
  const failedPlan = spawnSync(
    process.execPath,
    ["tools/actions-adapter.mjs", "plan"],
    { cwd: directory, env, encoding: "utf8" },
  );
  assert.equal(failedPlan.status, 1);
  assert.match(failedPlan.stderr, /Client changes require a new declaration/);
  assert.match(failedPlan.stderr, /failed \(1\)/);
  assert.equal(failedPlan.stdout, "");
  assert.equal(readFileSync(output, "utf8"), previousOutput);
});

test("signing diagnostics forward only signing inputs after trusted-main authorization", async () => {
  const signing = {
    PATH: "/synthetic/bin",
    HOME: "/synthetic/home",
    CI: "true",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    APPLE_TEAM_ID: "TEAM123456",
    APPLE_MACOS_SIGNING_IDENTITY:
      "Developer ID Application: Example (TEAM123456)",
    APPLE_DEVELOPER_ID_P12_BASE64: "c3ludGhldGlj",
    APPLE_DEVELOPER_ID_P12_PASSWORD: "synthetic-password",
  };
  const env = {
    ...environment,
    ...signing,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    DIAGNOSTIC_TARGET: "native",
    GH_TOKEN: "unrelated-secret",
    APPLE_API_PRIVATE_KEY: "unrelated-secret",
    TAURI_SIGNING_PRIVATE_KEY: "unrelated-secret",
    SSH_AUTH_SOCK: "/synthetic/agent",
    OTHER_SECRET: "unrelated-secret",
  };
  const calls = [];
  const execute = (command, args, options) =>
    calls.push({ command, args, options });
  await main(["diagnostics", "--lane", "signing"], env, execute);
  assert.deepEqual(calls, [
    {
      command: process.execPath,
      args: ["tools/signing-check.mjs"],
      options: { stdio: "inherit", env: signing },
    },
  ]);
  for (const changed of [
    { GITHUB_REPOSITORY: "other/repository" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_EVENT_NAME: "push" },
    { DIAGNOSTIC_TARGET: "portable" },
    { CI: "false" },
    { GITHUB_ACTIONS: "false" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
  ]) {
    await assert.rejects(
      main(
        ["diagnostics", "--lane", "signing"],
        { ...env, ...changed },
        execute,
      ),
      /trusted main|macOS|GitHub-hosted/,
    );
  }
  assert.equal(calls.length, 1);
});

test("qualification route diagnostics authorize trusted hosted dispatch before forwarding scoped inputs", async () => {
  const scoped = {
    PATH: "/synthetic/bin",
    HOME: "/synthetic/home",
    CI: "true",
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    SITUATE_RELEASE_CONFIG_JSON: "synthetic-config",
    SITUATE_RELEASE_CONFIG_SHA256: "a".repeat(64),
    SITUATE_UPDATER_ENDPOINT: "https://updates.example.test/update.json",
    WEBSITE_DEPLOY_HOST: "synthetic.example.test",
    SITUATE_RELEASE_SSH_PRIVATE_KEY: "synthetic-ssh-key",
    SITUATE_RELEASE_SSH_KNOWN_HOSTS: "synthetic-host-key",
  };
  const env = {
    ...environment,
    ...scoped,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    DIAGNOSTIC_TARGET: "native",
    APPLE_API_PRIVATE_KEY: "unrelated-secret",
    TAURI_SIGNING_PRIVATE_KEY: "unrelated-secret",
    APPLE_DEVELOPER_ID_P12_BASE64: "unrelated-secret",
    GH_TOKEN: "unrelated-secret",
    SSH_AUTH_SOCK: "unrelated-secret",
  };
  const calls = [];
  const execute = (command, args, options) =>
    calls.push({ command, args, options });
  await main(["diagnostics", "--lane", "qualification-route"], env, execute);
  assert.deepEqual(calls, [
    {
      command: process.execPath,
      args: ["tools/qualification-route-check.mjs"],
      options: { stdio: "inherit", env: scoped },
    },
  ]);
  for (const changed of [
    { GITHUB_REPOSITORY: "other/repository" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_EVENT_NAME: "push" },
    { DIAGNOSTIC_TARGET: "portable" },
    { CI: "false" },
    { GITHUB_ACTIONS: "false" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
  ])
    await assert.rejects(
      main(
        ["diagnostics", "--lane", "qualification-route"],
        { ...env, ...changed },
        execute,
      ),
      /trusted main|GitHub-hosted/,
    );
  assert.equal(calls.length, 1);
});

test("automatic release selection honors the pause without consulting the current main SHA", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-release-selection-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = {
    GITHUB_REPOSITORY: "getsituate/situate",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_WORKFLOW_REF:
      "getsituate/situate/.github/workflows/release-macos.yml@refs/heads/main",
    GITHUB_OUTPUT: join(directory, "output"),
    GITHUB_SHA: "a".repeat(40),
    PIPELINE_RELEASE_ENABLED: "false",
  };
  const execute = () =>
    assert.fail("Selection must not run planning, dependencies or effects");
  assert.deepEqual(
    await main(["release-selection", "--workflow", "create"], env, execute),
    { enabled: false, reason: "paused" },
  );
  assert.equal(readFileSync(env.GITHUB_OUTPUT, "utf8"), "enabled=false\n");
  assert.deepEqual(
    await main(
      ["release-selection", "--workflow", "create"],
      { ...env, PIPELINE_RELEASE_ENABLED: "true" },
      execute,
    ),
    { enabled: true, reason: "enabled" },
  );
  assert.equal(
    readFileSync(env.GITHUB_OUTPUT, "utf8"),
    "enabled=false\nenabled=true\n",
  );
  for (const changed of [
    { GITHUB_REPOSITORY: "other/repository" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF_PROTECTED: "false" },
    {
      GITHUB_WORKFLOW_REF:
        "other/repository/.github/workflows/release-macos.yml@refs/heads/main",
    },
    { PIPELINE_RELEASE_ENABLED: "" },
  ])
    await assert.rejects(
      main(
        ["release-selection", "--workflow", "create"],
        { ...env, ...changed },
        execute,
      ),
      /protected main|explicit release automation/,
    );
});

test("unprovisioned remote operations and paid diagnostics fail visibly before executing commands", async () => {
  const execute = () => {
    throw new Error("Unexpected external command");
  };
  await assert.rejects(main(["blocked"], {}, execute), /disabled pending/);
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
