import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { readImageLock } from "./ci-image.mjs";

export function browserInstallations(suites, manifest) {
  const browsers = new Map();
  const add = (project, names) => {
    const version = manifest[project]?.version;
    assert(/^\d+\.\d+\.\d+$/.test(version), "Missing pinned browser installer");
    const selected = browsers.get(version) ?? new Set();
    for (const name of names) selected.add(name);
    browsers.set(version, selected);
  };
  for (const suite of suites) {
    if (suite.browsers?.length) add(suite.npm, suite.browsers);
  }
  return [...browsers].map(([version, names]) => [
    `/opt/ci-tools/playwright-${version}/cli.js`,
    "install",
    ...names,
  ]);
}

export function prepareContainerLane(root, suites, execute = spawnSync) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "client/docker/ci-browsers.json"), "utf8"),
  );
  for (const args of browserInstallations(suites, manifest)) {
    const result = execute(process.execPath, args, { stdio: ["ignore", 2, 2] });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Browser dependency download failed");
  }
}

async function withCancellation(run) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  for (const name of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.once(name, cancel);
  try {
    return await run(controller.signal);
  } finally {
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.removeListener(name, cancel);
  }
}

export async function main(
  args = process.argv.slice(2),
  environment = process.env,
) {
  assert.equal(process.platform, "linux", "Portable checks require Linux");
  assert.equal(
    environment.SITUATE_TOOL_CONTAINER,
    "1",
    "Use the tool-container launcher",
  );
  assert.equal(
    environment.SITUATE_TOOL_BUILD_SLOTS,
    "1",
    "Expected one build slot per tool container",
  );
  const root = process.cwd();
  assert.equal(
    environment.SITUATE_CI_IMAGE,
    readImageLock(root).image,
    "Unexpected tool image",
  );
  const [mode, ...rest] = args;
  if (mode === "actions") {
    const { main: actions } = await import("./actions-adapter.mjs");
    return actions(rest, environment);
  }
  if (mode === "monitoring") {
    const { values } = parseArgs({
      args: rest,
      options: { "report-directory": { type: "string" } },
    });
    const reportDirectory = resolve(
      root,
      values["report-directory"] ?? "test-results/dependency-monitoring",
    );
    const path = relative(root, reportDirectory);
    assert(
      path && path !== ".." && !path.startsWith("../") && !isAbsolute(path),
      "Monitoring reports must remain inside the checkout",
    );
    const { monitor } = await import("./dependency-monitoring.mjs");
    return monitor({ directory: root, reportDirectory });
  }
  if (mode === "suites") {
    assert.equal(rest.length, 2, "Invalid suite-plan inputs");
    const [planFile, reportFile] = rest;
    const request = JSON.parse(readFileSync(planFile, "utf8"));
    assert(
      Array.isArray(request.suiteIds) &&
        request.suiteIds.length > 0 &&
        new Set(request.suiteIds).size === request.suiteIds.length,
      "Expected unique selected suites",
    );
    const { createPlan, runPlan } = await import("./test.mjs");
    const { suiteExecution } = await import("./test-scope.mjs");
    const plan = createPlan(
      {
        ...Object.fromEntries(
          ["unit", "feedback", "checks", "coverage"].map((profile) => [
            profile,
            request.profile === profile,
          ]),
        ),
        extended: request.scope === "extended",
        changed: request.changed === true,
        base: request.base,
        platform: "linux",
      },
      root,
    );
    const inventory = plan.suites;
    const suites = request.suiteIds.map((id) => {
      const suite = inventory.find((item) => item.id === id);
      assert(
        suite && suiteExecution(suite) === "container",
        "Suite requires another execution environment",
      );
      return suite;
    });
    const timeout = request.timeout ?? 600;
    assert(
      Number.isFinite(timeout) && timeout > 0 && timeout <= 86400,
      "Suite deadline must be positive and at most 86400 seconds",
    );
    assert(
      request.jobs === undefined ||
        (Number.isInteger(request.jobs) &&
          request.jobs >= 1 &&
          request.jobs <= 8),
      "Expected from 1 to 8 suite workers",
    );
    prepareContainerLane(root, suites);
    const report = await withCancellation((signal) =>
      runPlan(
        { ...plan, suites },
        {
          directory: root,
          signal,
          environment,
          timeout,
          jobs: request.jobs,
          output: process.stderr,
          onStart: (suite) =>
            console.log(
              JSON.stringify({
                type: "suite",
                id: suite.id,
                status: "running",
              }),
            ),
          onResult: (result) =>
            console.log(JSON.stringify({ type: "result", result })),
        },
      ),
    );
    writeFileSync(reportFile, JSON.stringify(report), { mode: 0o600 });
    if (report.status !== "passed") process.exitCode = 1;
    return report;
  }
  assert.equal(mode, "lane", "Unknown tool-container operation");
  const [workflow, planFile, lane, receipt] = rest;
  assert.equal(rest.length, 4, "Invalid lane inputs");
  const { main: pipeline } = await import("./pipeline.mjs");
  return withCancellation((signal) =>
    pipeline(
      [
        "run",
        workflow,
        "--plan",
        planFile,
        "--lane",
        lane,
        "--receipt",
        receipt,
      ],
      { root, signal },
    ),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((result) => {
      if (result && process.argv[2] !== "suites")
        console.log(JSON.stringify(result));
      if (["failed", "cancelled", "timed-out"].includes(result?.status))
        process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
