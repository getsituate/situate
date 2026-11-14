import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseLcov, delta, measure } from "./coverage.mjs";
import {
  validateReport,
  eligible,
  render,
  ownComment,
  marker,
  readArchive,
  validArtifact,
} from "./coverage-comment.mjs";

const lcov = "TN:\nSF:src/a.ts\nDA:1,4\nDA:2,0\nLF:2\nLH:1\nend_of_record\n";
const head = "a".repeat(40),
  main = "b".repeat(40);
const identity = {
  repository: "owner/project",
  run: 123,
  attempt: 1,
  pr: 42,
  head,
  side: "head",
};
const report = () => ({
  version: 1,
  ...identity,
  main,
  status: "measured",
  vue: { found: 4, hit: 3 },
  rust: { found: 10, hit: 2 },
});
const run = () => ({
  repository: { full_name: identity.repository },
  workflow_id: 7,
  path: ".github/workflows/coverage.yml",
  event: "pull_request",
  status: "completed",
  head_sha: head,
  head_repository: { full_name: "contributor/fork" },
});
const pr = () => ({
  state: "open",
  base: { ref: "main", repo: { full_name: identity.repository } },
  head: { sha: head, repo: { full_name: "contributor/fork" } },
});

test("LCOV combines source line counts, not averages or summary-only guesses", () => {
  assert.deepEqual(
    parseLcov(lcov + "SF:src/b.ts\nDA:1,1,checksum\nDA:9,2\nend_of_record\n"),
    { found: 4, hit: 3 },
  );
  assert.equal(delta({ found: 4, hit: 3 }, { found: 2, hit: 1 }), 25);
  assert.equal(delta({ found: 10, hit: 2 }, { found: 2, hit: 1 }), -30);
  assert.equal(delta({ found: 2, hit: 1 }, { found: 4, hit: 2 }), 0);
});

test("LLVM instantiation summaries do not replace unique source-line counts", () => {
  assert.deepEqual(
    parseLcov(lcov.replace("LF:2", "LF:4").replace("LH:1", "LH:3")),
    { found: 2, hit: 1 },
  );
});

test("LCOV rejects malformed, empty, truncated and duplicate data", () => {
  for (const text of [
    "",
    "SF:a\nend_of_record",
    "LF:100\nLH:90",
    "DA:1,2",
    lcov.replace("DA:2,0", "DA:1,0"),
    lcov.replace("DA:2,0", "DA:2,-1"),
    lcov.replace("LF:2", "LF:-1"),
    lcov.replace("LH:1", "LH:3"),
    lcov.replace("end_of_record", ""),
    lcov + lcov,
    "SF:a\nDA:1,9007199254740992\nend_of_record",
    "garbage",
  ])
    assert.throws(() => parseLcov(text));
});

test("measurement reuses the central plan and distinguishes absent support, failures and missing output", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "coverage-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual(await measure(directory), { status: "unavailable" });
  execFileSync("git", ["init", "--quiet", directory]);
  for (const file of [
    "tools/test.mjs",
    "tools/example.test.mjs",
    "tools/example.integration.test.mjs",
    "client/scripts/example.test.mjs",
    "client/scripts/example.integration.test.mjs",
    "requirements/tests/example.test.js",
    "requirements/tests/example.integration.test.js",
  ]) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(
      join(directory, file),
      file === "tools/test.mjs" ? "--coverage" : "",
    );
  }
  const prepare = async (workspace) => {
    assert.equal(workspace, "client");
    return { release() {} };
  };
  const writeReports = () => {
    mkdirSync(join(directory, "client/target/coverage/vue"), {
      recursive: true,
    });
    writeFileSync(
      join(directory, "client/target/coverage/vue/lcov.info"),
      lcov,
    );
    writeFileSync(join(directory, "client/target/coverage/rust.lcov"), lcov);
  };
  let linuxExecutions = 0;
  let linuxPreparations = 0;
  assert.deepEqual(
    await measure(directory, {
      platform: "linux",
      prepare: async () => {
        linuxPreparations++;
        return { release() {} };
      },
      execute: async () => {
        linuxExecutions++;
        writeReports();
        return { status: "passed" };
      },
    }),
    { status: "unavailable" },
  );
  assert.equal(linuxExecutions, 0);
  assert.equal(linuxPreparations, 0);
  assert.deepEqual(
    await measure(directory, {
      platform: "darwin",
      prepare,
      execute: async () => ({ status: "failed" }),
    }),
    { status: "failed" },
  );
  assert.deepEqual(
    await measure(directory, {
      platform: "darwin",
      prepare,
      execute: async () => ({ status: "passed" }),
    }),
    { status: "failed" },
  );
  const calls = [];
  const result = await measure(directory, {
    platform: "darwin",
    prepare,
    execute: async (suite, options) => {
      calls.push(suite);
      assert.equal(options.directory, directory);
      writeReports();
      return { status: "passed" };
    },
  });
  assert.deepEqual(result, {
    status: "measured",
    vue: { found: 2, hit: 1 },
    rust: { found: 2, hit: 1 },
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].args.includes("--coverage.include=src/**/*.{ts,vue}"));
  assert.deepEqual(calls[1].args, [
    "llvm-cov",
    "--workspace",
    "--locked",
    "--lcov",
    "--output-path",
    "target/coverage/rust.lcov",
  ]);
});

test("CLI preserves unavailable main and failed current measurements without fake counts", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "coverage-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [side, preparation, expectedStatus, exit] of [
    ["main", "success", "unavailable", 0],
    ["head", "success", "unavailable", 1],
    ["head", "failure", "failed", 1],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./coverage.mjs", import.meta.url)), directory],
      {
        cwd: directory,
        env: {
          ...process.env,
          GITHUB_REPOSITORY: identity.repository,
          GITHUB_RUN_ID: "123",
          GITHUB_RUN_ATTEMPT: "1",
          PR_NUMBER: "42",
          HEAD_SHA: head,
          MAIN_SHA: main,
          SIDE: side,
          PREPARATION_STATUS: preparation,
        },
      },
    );
    assert.equal(result.status, exit, result.stderr.toString());
    const data = validateReport(
      readFileSync(join(directory, "report.json"), "utf8"),
      { ...identity, side },
    );
    assert.equal(data.status, expectedStatus);
    assert.equal(data.vue, undefined);
  }
});

test("untrusted reports accept only bounded counts and exact metadata", () => {
  assert.deepEqual(
    validateReport(JSON.stringify(report()), identity),
    report(),
  );
  for (const change of [
    { body: "@everyone" },
    { repository: "attacker/project" },
    { head: main },
    { run: 124 },
    { attempt: 2 },
    { pr: 43 },
    { side: "main" },
    { main: "x\n<script>" },
    { version: 2 },
    { status: "ok" },
    { vue: { found: 0, hit: 0 } },
    { rust: { found: 2, hit: 3 } },
    { vue: { found: 2, hit: -1 } },
    { vue: { found: 2.1, hit: 1 } },
    { vue: { found: 2, hit: 1, markdown: "evil" } },
    { status: "unavailable" },
  ]) {
    assert.throws(() =>
      validateReport(JSON.stringify({ ...report(), ...change }), identity),
    );
  }
  for (const text of ["", "null", "{}", "not json", " ".repeat(4097)])
    assert.throws(() => validateReport(text, identity));
  assert.equal(
    validateReport(
      JSON.stringify({ version: 1, ...identity, main, status: "unavailable" }),
      identity,
    ).status,
    "unavailable",
  );
});

test("fork runs are eligible only for their exact current open PR in this repository", () => {
  assert.equal(eligible(run(), pr(), identity.repository, 7), true);
  for (const change of [
    { event: "workflow_dispatch" },
    { workflow_id: 8 },
    { path: ".github/workflows/other.yml" },
    { status: "in_progress" },
    { head_sha: main },
    { repository: { full_name: "attacker/project" } },
    { head_repository: { full_name: "other/fork" } },
  ])
    assert.equal(
      eligible({ ...run(), ...change }, pr(), identity.repository, 7),
      false,
    );
  for (const change of [
    { state: "closed" },
    { head: { sha: main, repo: { full_name: "contributor/fork" } } },
    { base: { ref: "main", repo: { full_name: "other/project" } } },
  ])
    assert.equal(
      eligible(run(), { ...pr(), ...change }, identity.repository, 7),
      false,
    );
});

test("comments show signed percentage-point changes or explicit unavailable/failure", () => {
  const baseline = {
    ...report(),
    vue: { found: 2, hit: 1 },
    rust: { found: 2, hit: 1 },
  };
  const body = render(report(), baseline, "success");
  assert.match(body, /\+25\.00 pp/);
  assert.match(body, /-30\.00 pp/);
  assert.ok(body.includes(head) && body.includes(main));
  const unavailable = render(report(), { status: "unavailable" }, "success");
  assert.match(unavailable, /Main baseline unavailable/);
  assert.doesNotMatch(unavailable, /\| 0\.00%|[+-]\d+\.\d+ pp/);
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    const failed = render(report(), baseline, conclusion);
    assert.match(failed, /failed or did not complete/);
    assert.doesNotMatch(failed, /\| Vue/);
  }
  assert.equal(
    ownComment({
      user: { login: "github-actions[bot]", type: "Bot" },
      body: marker,
    }),
    true,
  );
  assert.equal(
    ownComment({ user: { login: "attacker", type: "User" }, body: marker }),
    false,
  );
  assert.equal(
    ownComment({ user: { login: "another[bot]", type: "Bot" }, body: marker }),
    false,
  );
});

test("artifact metadata rejects a different run, head, expired or oversized data", () => {
  const artifact = {
    expired: false,
    size_in_bytes: 200,
    workflow_run: {
      id: 123,
      head_sha: head,
      repository_id: 1,
      head_repository_id: 2,
    },
  };
  const current = {
    id: 123,
    head_sha: head,
    repository: { id: 1 },
    head_repository: { id: 2 },
  };
  assert.equal(validArtifact(artifact, current), true);
  for (const change of [
    { expired: true },
    { size_in_bytes: 16385 },
    { size_in_bytes: -1 },
    { size_in_bytes: "200" },
    { workflow_run: { ...artifact.workflow_run, id: 124 } },
    { workflow_run: { ...artifact.workflow_run, head_sha: main } },
    { workflow_run: { ...artifact.workflow_run, repository_id: 3 } },
    { workflow_run: { ...artifact.workflow_run, head_repository_id: 3 } },
    { workflow_run: null },
  ])
    assert.equal(validArtifact({ ...artifact, ...change }, current), false);
});

test("archives are bounded data, never extracted files or executable scripts", () => {
  const zip = (files) =>
    execFileSync(
      "python3",
      [
        "-c",
        "import sys,json,io,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:\n for name,content in json.load(sys.stdin).items(): z.writestr(name,content)\nsys.stdout.buffer.write(b.getvalue())",
      ],
      { input: JSON.stringify(files) },
    );
  assert.equal(readArchive(zip({ "report.json": "{}" })), "{}");
  for (const files of [
    { "../report.json": "{}" },
    { "report.json": "{}", "script.sh": "exit 0" },
    { "report.json": "x".repeat(4097) },
    {},
  ])
    assert.throws(() => readArchive(zip(files)));
  assert.throws(() => readArchive(Buffer.from("not zip")));
  assert.throws(() => readArchive(Buffer.alloc(16385)));
});

test("coverage dispatch invokes the shared runner only for trusted explicit diagnostics", async () => {
  const { main: actions } = await import("./actions-adapter.mjs");
  const environment = {
    GITHUB_REPOSITORY: "getsituate/situate",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    DIAGNOSTIC_SELECTION: "coverage",
    DIAGNOSTIC_TARGET: "native",
  };
  const calls = [];
  const execute = (command, args) => {
    calls.push([command, args]);
    return "";
  };
  await actions(["diagnostics"], environment, execute);
  assert.deepEqual(calls, [
    [
      process.execPath,
      [
        "tools/run-coordinated.mjs",
        "--",
        process.execPath,
        "tools/diagnostic-checks.mjs",
        "coverage",
        "native",
      ],
    ],
  ]);
  calls.length = 0;
  for (const overrides of [
    { GITHUB_REPOSITORY: "other/situate" },
    { GITHUB_REF: "refs/heads/topic" },
    { GITHUB_EVENT_NAME: "pull_request" },
  ])
    await assert.rejects(
      actions(["diagnostics"], { ...environment, ...overrides }, execute),
      /explicit trusted main dispatch/,
    );
  assert.deepEqual(calls, []);
});

test("coverage is a read-only explicit diagnostic, separate from required verification", () => {
  const diagnostics = readFileSync(
    new URL("../.github/workflows/diagnostics.yml", import.meta.url),
    "utf8",
  );
  assert.match(diagnostics, /workflow_dispatch:/);
  assert.match(diagnostics, /options: \[coverage, design, visual, provider\]/);
  assert.match(diagnostics, /github.repository == 'getsituate\/situate'/);
  assert.match(diagnostics, /github.ref == 'refs\/heads\/main'/);
  assert.match(diagnostics, /github.event_name == 'workflow_dispatch'/);
  assert.match(diagnostics, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(
    diagnostics,
    /pull_request|workflow_run|pull-requests: write/,
  );
  const portable = diagnostics
    .split("\n  portable:\n")[1]
    ?.split("\n  native:\n")[0];
  assert.match(portable, /runs-on: ubuntu-24.04/);
  assert.match(portable, /pipeline-container\.py actions diagnostics/);
  assert.doesNotMatch(portable, /secrets\.|pipeline-bootstrap|run: node /);
  const steps = diagnostics
    .split("\n  native:\n")[1]
    ?.split("\n  docker:\n")[0];
  assert.match(steps, /runs-on: macos-latest/);
  assert.match(steps, /run: node tools\/actions-adapter\.mjs diagnostics\n/);
  const coverageStep = steps
    .split("      - run: node tools/actions-adapter.mjs diagnostics\n")[1]
    ?.split("\n      - run:")[0];
  assert.ok(coverageStep);
  assert.match(coverageStep, /if: inputs.selection != 'provider'/);
  assert.match(
    coverageStep,
    /DIAGNOSTIC_SELECTION: \$\{\{ inputs.selection \}\}/,
  );
  assert.doesNotMatch(coverageStep, /secrets\.|TEST_OPENAI_API_KEY/);
  for (const name of ["verify", "release-macos"]) {
    const required = readFileSync(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(required, /--coverage|coverage\.mjs|coverage-comment/);
  }
  for (const action of diagnostics.matchAll(/uses: (.+)/g))
    assert.match(action[1], /^actions\/checkout@[a-f0-9]{40}$/);
  assert.match(diagnostics, /persist-credentials: false/);
});
