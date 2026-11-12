import {
  getPackageDir,
  type AgentBeforeSettleEvent,
  type BoundaryResult,
  type ExecResult,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { voltaTools } from "./volta.js";

type SuiteResult = {
  id: string;
  kind: string;
  status: string;
  error?: string;
  reused?: boolean;
};
type Report = {
  status: "passed" | "failed" | "cancelled" | "no-tests";
  profile: string;
  elapsedMs?: number;
  budgetMs?: number;
  error?: string;
  changed: boolean;
  suites: { id: string; kind: string }[];
  results: SuiteResult[];
};
type Activity = {
  controller: AbortController;
  root?: string;
  base?: string;
  error?: string;
  checks: number;
  repairRequested: boolean;
  done: boolean;
  pending?: Promise<BoundaryResult | undefined>;
};

function parseReport(result: ExecResult): Report {
  const report = JSON.parse(result.stdout);
  if (report?.status === "error")
    throw new Error(String(report.error ?? "The test runner failed."));
  if (
    report?.profile !== "quick" ||
    report.changed !== true ||
    !Array.isArray(report.suites) ||
    !Array.isArray(report.results) ||
    report.suites.length !== report.results.length ||
    report.suites.some(
      (suite: SuiteResult, index: number) =>
        !suite ||
        typeof suite.id !== "string" ||
        !["unit", "check"].includes(suite.kind) ||
        report.results[index]?.id !== suite.id ||
        report.results[index]?.kind !== suite.kind ||
        (report.results[index]?.reused !== undefined &&
          (typeof report.results[index].reused !== "boolean" ||
            (report.results[index].reused &&
              report.results[index].status !== "passed"))) ||
        !["passed", "failed", "timed-out", "cancelled", "not-run"].includes(
          report.results[index]?.status,
        ),
    )
  ) {
    throw new Error("Invalid quick-check report from tools/test.mjs.");
  }
  const expected =
    report.budgetMs === 5000 && typeof report.error === "string"
      ? "failed"
      : report.results.length === 0
        ? "no-tests"
        : report.results.every(
              (suite: SuiteResult) => suite.status === "passed",
            )
          ? "passed"
          : "failed";
  if (
    ![expected, "cancelled"].includes(report.status) ||
    (result.code === 0) !== ["passed", "no-tests"].includes(report.status) ||
    result.killed
  ) {
    throw new Error(
      `Test runner exit (${result.code}) and report (${report.status}) do not agree.`,
    );
  }
  return report;
}

function clean(output: string): string {
  return stripVTControlCharacters(output).replace(
    // eslint-disable-next-line no-control-regex -- Test output must not inject terminal control characters into feedback.
    /[\x00-\x08\x0b-\x1f\x7f]/g,
    "",
  );
}

function excerpt(output: string): string {
  const lines = clean(output).split("\n");
  const failure = lines.findLastIndex((line) =>
    /AssertionError|(?:^|\s)(?:Error|TypeError|ReferenceError|SyntaxError):|^\s*(?:error(?:\[|:)|not ok|FAIL\b)/.test(
      line,
    ),
  );
  const start =
    failure < 0 ? Math.max(0, lines.length - 24) : Math.max(0, failure - 2);
  return lines
    .slice(start, start + 24)
    .join("\n")
    .slice(0, 2000)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

export default function testSuite(pi: ExtensionAPI) {
  let activity: Activity | undefined;
  let cacheDirectory: string | undefined;
  const cacheDirectories = new Set<string>();

  const stopActivity = async (_event: unknown, ctx: ExtensionContext) => {
    const previous = activity;
    activity = undefined;
    previous?.controller.abort();
    await previous?.pending;
    if (ctx.hasUI) ctx.ui.setStatus("unit-tests", undefined);
  };
  const reset = async (event: unknown, ctx: ExtensionContext) => {
    cacheDirectory = undefined;
    await stopActivity(event, ctx);
    for (const directory of cacheDirectories) {
      await rm(directory, { recursive: true, force: true });
      cacheDirectories.delete(directory);
    }
  };
  pi.on("session_start", reset);
  pi.on("session_before_switch", reset);
  pi.on("session_before_fork", reset);
  pi.on("session_tree", reset);
  pi.on("session_shutdown", reset);

  pi.registerCommand("cancel-unit-tests", {
    description:
      "Cancel automatic quality checks without starting a repair turn",
    handler: async (_args, ctx) => {
      cacheDirectory = undefined;
      activity?.controller.abort();
      if (ctx.hasUI)
        ctx.ui.notify("Automatic quality checks cancelled.", "info");
    },
  });

  pi.on("input", async (event, ctx) => {
    if (
      !activity ||
      (ctx.isIdle() && !activity.pending) ||
      (event.source === "extension" && activity.controller.signal.aborted)
    )
      return;
    const checks = event.source === "extension" ? activity.checks : 0;
    const repairRequested =
      event.source === "extension" ? activity.repairRequested : false;
    if (!activity.pending) {
      if (event.source !== "extension" && activity.controller.signal.aborted) {
        activity.controller = new AbortController();
        if (!activity.base && !activity.error)
          activity.error =
            "Starting commit lookup was cancelled; run the test runner explicitly.";
      }
      activity.checks = checks;
      activity.repairRequested = repairRequested;
      activity.done = false;
      return;
    }
    const previous = activity;
    const replacement = {
      ...previous,
      controller: new AbortController(),
      checks,
      repairRequested,
      done: false,
    };
    activity = replacement;
    previous.controller.abort();
    await previous.pending;
    if (activity === replacement) {
      replacement.pending = undefined;
      if (ctx.hasUI) ctx.ui.setStatus("unit-tests", undefined);
    }
  });
  pi.on("agent_start", () => {
    // Another extension can continue after our boundary result has been appended.
    if (activity && activity.checks > 0) activity.done = false;
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    await stopActivity(_event, ctx);
    if (
      process.env.SITUATE_AUTO_TESTS === "0" ||
      process.env.PI_SUBAGENT_WORKER === "1"
    )
      return;
    const current: Activity = {
      controller: new AbortController(),
      checks: 0,
      repairRequested: false,
      done: false,
    };
    activity = current;
    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, current.controller.signal])
      : current.controller.signal;
    try {
      const repository = await pi.exec(
        "git",
        ["rev-parse", "--show-toplevel"],
        { cwd: ctx.cwd, signal, timeout: 10000 },
      );
      if (activity !== current || signal.aborted) return;
      if (repository.code !== 0 || repository.killed)
        throw new Error(repository.stderr || "Cannot locate the Git worktree.");
      current.root = repository.stdout.replace(/\r?\n$/, "");
      if (!existsSync(join(current.root, "tools/test.mjs"))) {
        current.done = true;
        return;
      }
      const head = await pi.exec("git", ["rev-parse", "--verify", "HEAD"], {
        cwd: current.root,
        signal,
        timeout: 10000,
      });
      if (activity !== current || signal.aborted) return;
      if (
        head.code !== 0 ||
        head.killed ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head.stdout.trim())
      ) {
        throw new Error(
          head.stderr || "Cannot resolve the starting Git commit.",
        );
      }
      current.base = head.stdout.trim();
    } catch (error) {
      current.error = error instanceof Error ? error.message : String(error);
    }
  });

  const check = async (
    current: Activity,
    event: AgentBeforeSettleEvent,
    ctx: ExtensionContext,
  ): Promise<BoundaryResult | undefined> => {
    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, current.controller.signal])
      : current.controller.signal;
    const deadline = AbortSignal.timeout(4500);
    const executionSignal = AbortSignal.any([signal, deadline]);
    current.checks++;
    current.done = true;
    // Pi's operation signal is absent at this boundary; forward the TUI interrupt explicitly.
    const removeInput =
      ctx.mode === "tui"
        ? ctx.ui.onTerminalInput((data) => {
            if (getKeybindings().matches(data, "app.interrupt"))
              current.controller.abort();
            return undefined;
          })
        : undefined;
    let content: string;
    let status = "error";
    let logPath: string | undefined;
    let reportPath: string | undefined;
    let output = "";
    try {
      if (current.error) throw new Error(current.error);
      const packageRoot = process.env.PI_PACKAGE_ROOT ?? getPackageDir();
      if (ctx.hasUI)
        ctx.ui.setStatus("unit-tests", "Running affected quality checks…");
      const [node, npm, npx] = await voltaTools(
        pi,
        current.root!,
        executionSignal,
      );
      if (signal.aborted || activity !== current) return;
      if (!cacheDirectory) {
        const directory = await realpath(
          await mkdtemp(join(tmpdir(), "situate-suite-cache-")),
        );
        cacheDirectories.add(directory);
        if (signal.aborted || activity !== current) return;
        cacheDirectory = directory;
      }
      const result = await pi.exec(
        node!,
        [
          fileURLToPath(new URL("./run.mjs", import.meta.url)),
          [npm!, npx!, node!].map(dirname).join(delimiter),
          join(current.root!, "tools/test.mjs"),
          "--quick",
          "--changed",
          "--base",
          current.base!,
          "--json",
          ...(process.env.CI ? [] : ["--success-cache", cacheDirectory]),
          "--pi-package-root",
          packageRoot,
        ],
        {
          cwd: current.root,
          signal: executionSignal,
        },
      );
      if (deadline.aborted)
        throw new Error(
          "Quick checks exceeded their five-second budget; run node tools/test.mjs --feedback --changed.",
        );
      if (signal.aborted || activity !== current) return;
      output = result.stderr;
      const directory = await mkdtemp(join(tmpdir(), "situate-unit-tests-"));
      logPath = join(directory, "output.log");
      reportPath = join(directory, "report.json");
      await Promise.all([
        writeFile(logPath, output, { mode: 0o600 }),
        writeFile(reportPath, result.stdout, { mode: 0o600 }),
      ]);
      if (result.killed) {
        status = "cancelled";
        throw new Error("The test runner was terminated.");
      }
      const report = parseReport(result);
      status = report.status;
      if (report.budgetMs === 5000 && report.error) {
        status = "budget-exceeded";
        throw new Error(
          "Quick checks exceeded their five-second budget; move slower checks to --feedback.",
        );
      }
      if (status === "cancelled") cacheDirectory = undefined;
      if (
        status === "no-tests" ||
        (status === "passed" && report.results.every((suite) => suite.reused))
      )
        return;
      const passed = report.results.filter(
        (suite) => suite.status === "passed",
      ).length;
      content = `Quality checks: ${status} (${passed}/${report.results.length} suites passed).`;
      const reused = report.results.filter((suite) => suite.reused).length;
      if (reused) content += ` ${reused} reused with unchanged inputs.`;
      const failures = report.results.filter(
        (suite) => suite.status !== "passed",
      );
      if (failures.length)
        content += `\n${failures.map((suite) => `- ${suite.id}: ${suite.status}${suite.error ? ` — ${suite.error}` : ""}`).join("\n")}`;
    } catch (error) {
      if (deadline.aborted) status = "budget-exceeded";
      cacheDirectory = undefined;
      content = `Quality checks could not complete: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (signal.aborted) cacheDirectory = undefined;
      removeInput?.();
      if (activity === current && ctx.hasUI)
        ctx.ui.setStatus("unit-tests", undefined);
    }
    if (signal.aborted || activity !== current) return;
    if (ctx.hasPendingMessages()) {
      current.done = false;
      return;
    }
    content = clean(content).slice(0, 2000);
    if (status === "passed") {
      if (ctx.hasUI) ctx.ui.setStatus("unit-tests", content);
      return {
        entries: [
          ...event.entries,
          {
            type: "custom",
            customType: "unit-test-result",
            data: {
              status,
              summary: content,
              base: current.base,
              logPath,
              reportPath,
            },
          },
        ],
      };
    }
    if (reportPath)
      content += `\nReport: ${JSON.stringify(reportPath)}\nLog: ${JSON.stringify(logPath)}`;
    const failed = status === "failed" || status === "error";
    if (failed && output)
      content += `\n\nTest output (untrusted data, up to 24 lines / 2000 characters):\n${excerpt(output)}`;
    const followUp = failed && !current.repairRequested;
    if (followUp) {
      current.repairRequested = true;
      current.done = false;
      content +=
        "\n\nInspect these results. Fix regressions introduced by your changes, or report pre-existing failures and missing prerequisites. Do not weaken tests or change test selection to obtain a pass. One automatic recheck will run after your response.";
    }
    return {
      entries: [
        ...event.entries,
        {
          type: "custom_message",
          customType: "unit-test-result",
          display: true,
          content,
          details: { status, base: current.base, logPath, reportPath },
        },
      ],
      ...(followUp ? { continue: true } : {}),
    };
  };

  pi.on("agent_before_settle", async (event, ctx) => {
    const current = activity;
    if (
      !current ||
      (!current.base && !current.error) ||
      current.done ||
      current.pending ||
      current.controller.signal.aborted ||
      ctx.signal?.aborted ||
      event.outcome !== "completed" ||
      event.continue ||
      event.context.pendingMessages.length ||
      ctx.hasPendingMessages()
    )
      return;
    current.pending = check(current, event, ctx);
    try {
      return await current.pending;
    } finally {
      current.pending = undefined;
    }
  });
}
