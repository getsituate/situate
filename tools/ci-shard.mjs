#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  createPlan,
  parseOptions as parseRunnerOptions,
  root,
  runPlan,
} from "./test.mjs";

import { supportedSuiteEnabled, suiteAvailable } from "./test-scope.mjs";

export function activeHostSuite(suite, platform = "linux") {
  return supportedSuiteEnabled(suite) && suiteAvailable(suite, platform);
}

export const browserShards = Object.freeze([
  "browser",
  "workshop-chromium",
  "workshop-webkit",
]);
export const linuxShards = Object.freeze([
  "checks",
  ...browserShards,
  "native",
]);
export const shards = Object.freeze(["quick", ...linuxShards, "docker"]);
export const quickSuiteIds = Object.freeze([
  "runner-unit",
  "client-vue",
  "workshop-vue",
  "client-scripts-unit",
  "root-audit",
  "root-lint",
  "root-format",
  "root-secrets",
  "client-types",
  "workshop-types",
]);

export function partitionPlan(plan) {
  if (!plan.suites.length)
    throw new Error("No suites selected for CI partitioning.");
  const partitions = Object.fromEntries(shards.map((name) => [name, []]));
  const ids = new Set();
  for (const suite of plan.suites) {
    if (ids.has(suite.id)) throw new Error(`Duplicate suite: ${suite.id}.`);
    ids.add(suite.id);
    let shard;
    if (quickSuiteIds.includes(suite.id)) shard = "quick";
    else if (
      ["client-docker-context", "design-website-hosting"].includes(suite.id)
    )
      shard = "docker";
    else if (["unit", "integration", "check"].includes(suite.kind))
      shard = "checks";
    else if (suite.kind === "browser")
      shard = browserShards.includes(suite.id) ? suite.id : "browser";
    else if (suite.kind === "native") shard = "native";
    else throw new Error(`Unclassified CI suite: ${suite.id} (${suite.kind}).`);
    partitions[shard].push(suite);
  }
  return Object.fromEntries(
    shards.map((shard) => [
      shard,
      { ...plan, shard, suites: partitions[shard] },
    ]),
  );
}

export function filterPartitions(partitions, selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection))
    throw new Error("CI selection must be an object.");
  const seen = new Set();
  for (const shard of shards) {
    if (!Array.isArray(selection[shard]))
      throw new Error(`CI selection must contain an array for ${shard}.`);
    const registered = new Set(partitions[shard].suites.map(({ id }) => id));
    for (const id of selection[shard]) {
      if (seen.has(id)) throw new Error(`Duplicate selected suite: ${id}.`);
      seen.add(id);
      if (!registered.has(id))
        throw new Error(`Invalid suite for CI shard ${shard}: ${id}.`);
    }
  }
  return Object.fromEntries(
    shards.map((shard) => [
      shard,
      {
        ...partitions[shard],
        suites: partitions[shard].suites.filter(({ id }) =>
          selection[shard].includes(id),
        ),
      },
    ]),
  );
}

export function createShardPlan(
  shard,
  directory = root,
  selection,
  { extended = false, platform = "linux" } = {},
) {
  if (!shards.includes(shard))
    throw new Error(`--shard must be one of: ${shards.join(", ")}.`);
  if (!["linux", "darwin"].includes(platform))
    throw new Error("CI shard platform must be linux or darwin.");
  const plan = createPlan({ extended: true, platform }, directory);
  const active = (suite) => activeHostSuite(suite, platform);
  const partitions = partitionPlan(plan);
  const selected =
    selection === undefined
      ? partitions[shard]
      : filterPartitions(partitions, selection)[shard];
  selected.deferredSuiteIds = extended
    ? []
    : partitions[shard].suites
        .filter((suite) => !active(suite))
        .map(({ id }) => id);
  if (!extended) {
    if (selection && selected.suites.some((suite) => !active(suite)))
      throw new Error("CI selection contains deferred suites.");
    selected.suites = selected.suites.filter(active);
  }
  selected.scope = extended ? "extended" : "supported";
  selected.profile = extended ? "all" : "supported";
  if (!selected.suites.length)
    throw new Error(`No suites selected for CI shard: ${shard}.`);
  return selected;
}

export function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      shard: { type: "string" },
      json: { type: "boolean" },
      list: { type: "boolean" },
      extended: { type: "boolean", default: false },
      timeout: { type: "string", default: "1800" },
    },
  });
  if (!shards.includes(values.shard))
    throw new Error(`--shard must be one of: ${shards.join(", ")}.`);
  const { timeout } = parseRunnerOptions(["--timeout", values.timeout]);
  return { ...values, timeout };
}

export async function main(args = process.argv.slice(2)) {
  const json = args.includes("--json");
  const controller = new AbortController();
  let exitCode;
  const handlers = Object.entries({
    SIGINT: 130,
    SIGTERM: 143,
    SIGHUP: 129,
  }).map(([name, code]) => {
    const handler = () => {
      exitCode = code;
      controller.abort();
    };
    return [name, handler];
  });
  try {
    const options = parseOptions(args);
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new Error("Use Node 24 or newer; see client/.node-version.");
    if (!options.list && process.platform !== "linux")
      throw new Error(
        "CI shards can only execute on Linux. Use --list to inspect a plan.",
      );
    const rawSelection = process.env.SITUATE_CI_SELECTION;
    const plan = createShardPlan(
      options.shard,
      root,
      rawSelection === undefined ? undefined : JSON.parse(rawSelection),
      { extended: options.extended },
    );
    if (options.list) {
      if (json)
        console.log(JSON.stringify({ ...plan, status: "planned" }, null, 2));
      else
        for (const suite of plan.suites)
          console.log(
            `${suite.id} [${suite.kind}] (${suite.cwd}): ${JSON.stringify([suite.command, ...suite.args])}`,
          );
      return 0;
    }
    for (const [name, handler] of handlers) process.on(name, handler);
    const report = await runPlan(plan, {
      signal: controller.signal,
      timeout: options.timeout,
      onStart: (suite) =>
        console.error(`\nRunning ${suite.id} [${suite.kind}]`),
      onResult: (result) =>
        console.error(
          `${result.id}: ${result.status}${result.error ? ` — ${result.error}` : ""}`,
        ),
    });
    if (json) console.log(JSON.stringify(report, null, 2));
    else
      console.log(
        `${report.status}: ${report.results.filter((result) => result.status === "passed").length}/${report.results.length} suites passed (${plan.shard}).`,
      );
    return exitCode ?? (report.status === "passed" ? 0 : 1);
  } catch (error) {
    if (json)
      console.log(JSON.stringify({ status: "error", error: error.message }));
    else console.error(error.message);
    return 2;
  } finally {
    for (const [name, handler] of handlers)
      process.removeListener(name, handler);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main();
