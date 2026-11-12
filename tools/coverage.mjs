import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { createPlan, runPlan } from "./test.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseLcov(text) {
  let record = null;
  let summary = {};
  const files = new Set();
  let found = 0,
    hit = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      if (record || !line.slice(3) || files.has(line.slice(3)))
        throw new Error("Invalid LCOV source");
      files.add(line.slice(3));
      record = new Map();
      summary = {};
    } else if (line.startsWith("DA:")) {
      const match = /^DA:([1-9]\d*),(\d+)(?:,[^,]+)?$/.exec(line);
      if (
        !record ||
        !match ||
        record.has(match[1]) ||
        !Number.isSafeInteger(Number(match[2]))
      )
        throw new Error("Invalid LCOV line");
      record.set(match[1], Number(match[2]) > 0);
    } else if (line === "end_of_record") {
      if (
        !record ||
        (summary.LF !== undefined &&
          summary.LH !== undefined &&
          summary.LH > summary.LF)
      )
        throw new Error("Invalid LCOV record");
      found += record.size;
      hit += [...record.values()].filter(Boolean).length;
      record = null;
    } else if (/^(LF|LH):/.test(line)) {
      if (!record || !/^\w+:(0|[1-9]\d*)$/.test(line))
        throw new Error("Invalid LCOV summary");
      const key = line.slice(0, 2);
      const value = Number(line.slice(3));
      if (summary[key] !== undefined || !Number.isSafeInteger(value))
        throw new Error("Invalid LCOV summary");
      // LLVM summaries can count generic instantiations differently from DA lines.
      // Use unique source lines for both providers rather than mixing summaries.
      summary[key] = value;
    } else if (line && !/^(TN|FN|FNDA|FNF|FNH|BRDA|BRF|BRH|VER):/.test(line)) {
      throw new Error("Unknown LCOV field");
    }
  }
  if (record || !files.size || !found)
    throw new Error("Empty or incomplete LCOV");
  return { found, hit };
}

export function percentage({ found, hit }) {
  return (100 * hit) / found;
}
export function delta(head, main) {
  return percentage(head) - percentage(main);
}

export async function measure(directory, options = {}) {
  const runner = resolve(directory, "tools/test.mjs");
  if (
    !existsSync(runner) ||
    !readFileSync(runner, "utf8").includes("--coverage")
  )
    return { status: "unavailable" };
  rmSync(resolve(directory, "client/target/coverage"), {
    recursive: true,
    force: true,
  });
  try {
    const plan = createPlan({ coverage: true, extended: true }, directory);
    const vue = plan.suites.find((suite) => suite.id === "client-vue-coverage");
    // Source inclusion and report formats must match across both revisions.
    vue.args.push(
      "--coverage.provider=v8",
      "--coverage.include=src/**/*.{ts,vue}",
      "--coverage.exclude=src/**/*.test.ts",
      "--coverage.exclude=src/**/*.d.ts",
      "--coverage.reporter=lcov",
      "--coverage.reporter=html",
      "--coverage.reporter=text",
      "--coverage.reportsDirectory=../target/coverage/vue",
    );
    const result = await runPlan(plan, { ...options, directory });
    if (result.status !== "passed") return { status: "failed" };
    return {
      status: "measured",
      vue: parseLcov(
        readFileSync(
          resolve(directory, "client/target/coverage/vue/lcov.info"),
          "utf8",
        ),
      ),
      rust: parseLcov(
        readFileSync(
          resolve(directory, "client/target/coverage/rust.lcov"),
          "utf8",
        ),
      ),
    };
  } catch {
    return { status: "failed" };
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result =
    process.env.PREPARATION_STATUS === "failure" ||
    process.env.PREPARATION_STATUS === "cancelled"
      ? { status: "failed" }
      : await measure(process.argv[2]);
  const report = {
    version: 1,
    repository: process.env.GITHUB_REPOSITORY,
    run: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    pr: Number(process.env.PR_NUMBER),
    head: process.env.HEAD_SHA,
    main: process.env.MAIN_SHA,
    side: process.env.SIDE,
    ...result,
  };
  writeFileSync("report.json", JSON.stringify(report));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `## Coverage: ${report.side === "main" ? "main baseline" : "PR head / selected revision"}`,
      `Revision: \`${report.side === "main" ? report.main : report.head}\``,
      "",
      result.status === "unavailable"
        ? "Coverage unavailable: this revision does not support coverage."
        : result.status === "failed"
          ? "Coverage failed. No valid counts were produced."
          : "Line coverage:",
    ];
    if (result.status === "measured") {
      for (const [name, label] of [
        ["vue", "Vue"],
        ["rust", "Rust workspace"],
      ])
        lines.push(
          `- ${label}: ${percentage(result[name]).toFixed(2)}% (${result[name].hit}/${result[name].found})`,
        );
    }
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, {
      flag: "a",
    });
  }
  if (
    result.status === "failed" ||
    (report.side === "head" && result.status !== "measured")
  )
    process.exitCode = 1;
}
