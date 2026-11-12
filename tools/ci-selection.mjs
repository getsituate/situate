#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  activeLinuxSuite,
  linuxShards,
  partitionPlan,
  shards,
} from "./ci-shard.mjs";
import { isFeedbackSuite, root, sourceFiles, suiteInventory } from "./test.mjs";
import {
  hasSuiteInputRule,
  requiresFullSelection,
  suiteAffectedFiles,
} from "./test-inputs.mjs";

export function selectCi(
  { files = [], mode = "full", draft = false },
  inventory,
) {
  if (!["full", "changes", "quick"].includes(mode))
    throw new Error("--mode must be full, changes or quick.");
  if (
    typeof draft !== "boolean" ||
    !Array.isArray(files) ||
    files.some(
      (file) => typeof file !== "string" || !file || file.includes("\0"),
    )
  )
    throw new Error("Invalid CI selection inputs.");
  const partitions = partitionPlan({
    suites: inventory.filter(({ id }) => id !== "root-audit"),
  });
  const result = Object.fromEntries(shards.map((shard) => [shard, []]));
  Object.assign(result, { scope: "mvp", host: false, full: false });
  if (mode === "quick" || (draft && mode === "full")) {
    result.quick = partitions.quick.suites.map(({ id }) => id);
    return result;
  }

  const full =
    !draft &&
    (mode === "full" ||
      inventory.some((suite) => !hasSuiteInputRule(suite)) ||
      files.some(requiresFullSelection));
  for (const shard of shards)
    result[shard] = partitions[shard].suites
      .filter(
        (suite) =>
          activeLinuxSuite(suite) &&
          (!draft || shard === "quick" || isFeedbackSuite(suite)) &&
          (full ||
            suite.id === "root-secrets" ||
            suiteAffectedFiles(suite, files).length > 0),
      )
      .map(({ id }) => id);
  result.full = full;
  result.host =
    !draft &&
    (full ||
      ["client-browser", "dev-tui-unit"].some(
        (id) => suiteAffectedFiles(id, files).length > 0,
      ));
  return result;
}

export function changedFiles(base, directory = root) {
  if (typeof base !== "string" || !/^[a-f\d]{40}(?:[a-f\d]{24})?$/i.test(base))
    throw new Error("--base must be a full commit SHA.");
  const git = (args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const revision = git([
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${base}^{commit}`,
  ]).trim();
  const ancestor = git(["merge-base", "HEAD", revision]).trim();
  if (!ancestor) throw new Error("No merge base found.");
  return git([
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    ancestor,
    "HEAD",
    "--",
  ])
    .split("\0")
    .filter(Boolean)
    .sort();
}

export function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      mode: { type: "string", default: "full" },
      base: { type: "string" },
      draft: { type: "boolean", default: false },
      output: { type: "boolean", default: false },
    },
  });
  if (!["full", "changes", "quick"].includes(values.mode))
    throw new Error("--mode must be full, changes or quick.");
  if (values.mode === "changes" && !values.base)
    throw new Error("--mode changes requires --base.");
  if (values.mode === "full" && values.base)
    throw new Error("--base requires --mode changes or quick.");
  return values;
}

export function githubOutputs(selection) {
  const linux = linuxShards.filter((name) => selection[name].length > 0);
  return (
    `selection=${JSON.stringify(selection)}\nlinux=${JSON.stringify(linux)}\n` +
    ["docker", "host", "full", "quick"]
      .map(
        (key) =>
          `${key}=${Array.isArray(selection[key]) ? selection[key].length > 0 : selection[key]}\n`,
      )
      .join("")
  );
}

export function main(args = process.argv.slice(2), environment = process.env) {
  try {
    const options = parseOptions(args);
    if (options.output && !environment.GITHUB_OUTPUT)
      throw new Error("--output requires GITHUB_OUTPUT.");
    const files = options.base ? changedFiles(options.base) : [];
    const selection = selectCi(
      {
        ...options,
        ...(options.mode === "quick" && options.base
          ? { mode: "changes", draft: true }
          : {}),
        files,
      },
      suiteInventory(sourceFiles(root), "linux"),
    );
    if (options.output)
      appendFileSync(environment.GITHUB_OUTPUT, githubOutputs(selection));
    console.log(JSON.stringify(selection));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = main();
