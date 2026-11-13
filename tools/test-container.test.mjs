import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { Writable } from "node:stream";
import { createPlan, executeSuite } from "./test.mjs";
import { selectContainerSuites, runContainerPlan } from "./test-container.mjs";

const command = (id, project = "runner", kind = "unit") => ({
  id,
  project,
  kind,
  cwd: ".",
  command: "fixture",
  args: [],
});
const success = (id) => ({ id, status: "passed", exitCode: 0, durationMs: 1 });
const passed = { status: "passed", exitCode: 0, durationMs: 1 };
const silent = () =>
  new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
const emit = (options, event) =>
  options.stdout.write(`${JSON.stringify(event)}\n`);
const save = (suite, results, status = "passed") =>
  writeFileSync(
    suite.args[3],
    JSON.stringify({ status, results, setupDurationMs: 7 }),
  );

test("canonical execution types separate portable suites from host work", () => {
  const plan = createPlan({
    suite: [
      "root-format",
      "client-browser",
      "client-executor-integration",
      "client-core",
      "client-native",
      "client-docker-context",
      "design-website-hosting",
    ],
    platform: "darwin",
  });
  assert.deepEqual(
    selectContainerSuites(plan).map((suite) => suite.id),
    [
      "root-format",
      "client-executor-integration",
      "client-core",
      "client-browser",
    ],
  );
  assert.deepEqual(selectContainerSuites({ suites: [] }), []);
  assert.deepEqual(
    selectContainerSuites({ profile: "quick", suites: plan.suites }),
    [],
  );
  assert.deepEqual(
    selectContainerSuites(
      createPlan({ coverage: true, platform: "darwin" }),
    ).map((suite) => suite.id),
    ["client-vue-coverage"],
  );
});

test("one container batch forwards safe inputs, then runs host suites and restores report order", async () => {
  const host = command("host", "client", "native");
  const portable = [command("first"), command("second")];
  const calls = [];
  const starts = [];
  const completions = [];
  let temporary;
  const report = await runContainerPlan(
    { profile: "feedback", suites: [host, ...portable] },
    {
      portable,
      timeout: 17,
      jobs: 2,
      successCacheDirectory: "/private/host-cache",
      environment: {
        PATH: process.env.PATH,
        HOME: "/fixture/home",
        TEST_OPENAI_API_KEY: "synthetic-secret",
        GITHUB_TOKEN: "synthetic-token",
        SITUATE_DOCKER_LEASE: "owned-lease",
      },
      output: silent(),
      onStart: (suite) => starts.push(suite.id),
      onResult: (result) => completions.push(result.id),
      execute: async (suite, options) => {
        calls.push("container");
        temporary = suite.args[2];
        assert.equal(suite.command, "python3");
        assert.deepEqual(suite.args.slice(0, 2), [
          "tools/pipeline-container.py",
          "suites",
        ]);
        assert.deepEqual(JSON.parse(readFileSync(suite.args[2], "utf8")), {
          profile: "feedback",
          scope: "supported",
          changed: false,
          base: null,
          suiteIds: ["first", "second"],
          timeout: 17,
          jobs: 2,
        });
        assert.equal(statSync(suite.args[2]).mode & 0o777, 0o600);
        assert.deepEqual(options.environment, {
          PATH: process.env.PATH,
          HOME: "/fixture/home",
          SITUATE_DOCKER_LEASE: "owned-lease",
        });
        assert.ok(options.timeout > 2 * 17);
        for (const entry of portable) {
          emit(options, { type: "suite", id: entry.id, status: "running" });
          emit(options, { type: "result", result: success(entry.id) });
        }
        save(
          suite,
          portable.map((entry) => success(entry.id)),
        );
        return passed;
      },
      runHost: async (plan, options) => {
        calls.push("host");
        assert.deepEqual(plan.suites, [host]);
        options.onStart(host);
        const result = {
          ...success(host.id),
          project: host.project,
          kind: host.kind,
        };
        options.onResult(result);
        return { status: "passed", results: [result], setupDurationMs: 3 };
      },
    },
  );
  assert.equal(report.status, "passed");
  assert.deepEqual(calls, ["container", "host"]);
  assert.deepEqual(starts, ["first", "second", "host"]);
  assert.deepEqual(completions, ["first", "second", "host"]);
  assert.deepEqual(
    report.results.map((result) => result.id),
    ["host", "first", "second"],
  );
  assert.ok(report.results.every((result) => !result.reused));
  assert.equal(report.setupDurationMs, 10);
  assert.equal(existsSync(temporary), false);
});

test("failed child execution preserves its complete per-suite failure report", async () => {
  const portable = [command("first"), command("second")];
  const completions = [];
  const report = await runContainerPlan(
    { suites: portable },
    {
      portable,
      output: silent(),
      onResult: (result) => completions.push(result.id),
      execute: async (suite, options) => {
        const results = [
          { ...success("first"), status: "failed", exitCode: 7 },
          success("second"),
        ];
        for (const result of results) emit(options, { type: "result", result });
        save(suite, results, "failed");
        return { status: "failed", exitCode: 1, durationMs: 2 };
      },
      runHost: () => assert.fail("No host suites selected"),
    },
  );
  assert.equal(report.status, "failed");
  assert.deepEqual(
    report.results.map((result) => [result.status, result.exitCode]),
    [
      ["failed", 7],
      ["passed", 0],
    ],
  );
  assert.deepEqual(completions, ["first", "second"]);
});

for (const [name, report, error] of [
  ["missing", undefined, /Missing container report/],
  ["malformed", "not JSON", /JSON/],
  ["incomplete", { status: "passed", results: [] }, /Incomplete/],
  [
    "duplicate",
    { status: "passed", results: [success("first"), success("first")] },
    /Duplicate/,
  ],
  [
    "unknown",
    { status: "passed", results: [success("first"), success("unknown")] },
    /Invalid container suite result/,
  ],
  [
    "false success",
    {
      status: "passed",
      results: [
        { ...success("first"), status: "not-run", exitCode: null },
        success("second"),
      ],
    },
    /claims success/,
  ],
]) {
  test(`${name} container reports cannot produce a passing run`, async () => {
    const portable = [command("first"), command("second")];
    const result = await runContainerPlan(
      { suites: portable },
      {
        portable,
        output: silent(),
        execute: async (suite) => {
          if (report !== undefined)
            writeFileSync(
              suite.args[3],
              typeof report === "string" ? report : JSON.stringify(report),
            );
          return passed;
        },
        runHost: () => assert.fail("No host suites selected"),
      },
    );
    assert.equal(result.status, "failed");
    assert.match(result.error, error);
    assert.equal(result.results.length, portable.length);
  });
}

test("a failed launcher cannot be hidden by a report claiming all suites passed", async () => {
  const portable = [command("first")];
  const result = await runContainerPlan(
    { suites: portable },
    {
      portable,
      output: silent(),
      execute: async (suite) => {
        save(suite, [success("first")]);
        return { ...passed, status: "failed", exitCode: 1 };
      },
      runHost: () => assert.fail("No host suites selected"),
    },
  );
  assert.equal(result.status, "failed");
  assert.match(result.error, /launcher failed/);
});

test("stream/report disagreements remain visible", async () => {
  const portable = [command("first")];
  const report = await runContainerPlan(
    { suites: portable },
    {
      portable,
      output: silent(),
      execute: async (suite, options) => {
        emit(options, { type: "result", result: success("first") });
        save(
          suite,
          [{ ...success("first"), status: "failed", exitCode: 1 }],
          "failed",
        );
        return passed;
      },
      runHost: () => assert.fail("No host suites selected"),
    },
  );
  assert.equal(report.status, "failed");
  assert.match(report.error, /differs/);
});

test("uncertain cleanup prevents host work and retains diagnostic inputs", async (t) => {
  const portable = [command("first")];
  const host = command("host");
  const report = await runContainerPlan(
    { suites: [...portable, host] },
    {
      portable,
      output: silent(),
      execute: async (suite) => {
        save(suite, [success("first")]);
        return { ...passed, cleanupIncomplete: true };
      },
      runHost: () =>
        assert.fail("Host work must not overlap uncertain container cleanup"),
    },
  );
  t.after(() =>
    rmSync(report.retainedDirectory, { recursive: true, force: true }),
  );
  assert.equal(report.status, "failed");
  assert.equal(report.cleanupIncomplete, true);
  assert.equal(report.results[1].status, "not-run");
  assert.ok(existsSync(report.retainedDirectory));
});

test("malformed progress cannot be hidden by a passing final report", async () => {
  const portable = [command("first")];
  const report = await runContainerPlan(
    { suites: portable },
    {
      portable,
      output: silent(),
      execute: async (suite, options) => {
        options.stdout.write(`${"x".repeat(1024 * 1024 + 1)}\n`);
        save(suite, [success("first")]);
        return passed;
      },
      runHost: () => assert.fail("No host suites selected"),
    },
  );
  assert.equal(report.status, "failed");
  assert.match(report.error, /progress/);
});

test("a real subprocess separates event stdout from raw stderr and handles split lines", async () => {
  const portable = [command("first")];
  let logs = "";
  const output = new Writable({
    write(chunk, _encoding, done) {
      logs += chunk;
      done();
    },
  });
  const report = await runContainerPlan(
    { suites: portable },
    {
      portable,
      output,
      execute: (suite, options) =>
        executeSuite(
          {
            ...suite,
            command: process.execPath,
            args: [
              "-e",
              `
      const fs = require('node:fs');
      console.error('fixture log');
      process.stdout.write('{"type":"suite",');
      process.stdout.write('"id":"first","status":"running"}\\n');
      const result = {id:'first',status:'passed',exitCode:0,durationMs:1};
      console.log(JSON.stringify({type:'result',result}));
      fs.writeFileSync(process.argv[1], JSON.stringify({status:'passed',results:[result]}));
    `,
              suite.args[3],
            ],
          },
          options,
        ),
      runHost: () => assert.fail("No host suites selected"),
    },
  );
  assert.equal(report.status, "passed");
  assert.match(logs, /fixture log/);
  assert.doesNotMatch(logs, /"type"/);
});

test("cancellation stops the real launcher and marks active versus queued suites", async () => {
  const portable = [command("first"), command("second")];
  const controller = new AbortController();
  const report = await runContainerPlan(
    { suites: portable },
    {
      portable,
      output: silent(),
      signal: controller.signal,
      onStart: () => controller.abort(),
      execute: (suite, options) =>
        executeSuite(
          {
            ...suite,
            command: process.execPath,
            args: [
              "-e",
              `
      console.log(JSON.stringify({type:'suite',id:'first',status:'running'}));
      setInterval(() => {}, 1000);
    `,
            ],
          },
          { ...options, terminationGraceMs: 20 },
        ),
      runHost: () => assert.fail("No host suites selected"),
    },
  );
  assert.equal(report.status, "cancelled");
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["cancelled", "not-run"],
  );
});
