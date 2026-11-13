import {
  mkdtempSync,
  readFileSync,
  rmSync,
  lstatSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { hostContainerEnvironment } from "./pipeline-container.mjs";
import { suiteExecution, supportedSuiteEnabled } from "./test-scope.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const statuses = new Set([
  "passed",
  "failed",
  "timed-out",
  "cancelled",
  "not-run",
]);

export function selectContainerSuites(plan) {
  if (plan.profile === "quick") return [];
  return plan.suites.filter((suite) => suiteExecution(suite) === "container");
}

function suiteResult(result, suites) {
  const suite = suites.find((entry) => entry.id === result?.id);
  if (
    !suite ||
    !statuses.has(result.status) ||
    !Number.isFinite(result.durationMs) ||
    result.durationMs < 0 ||
    !(result.exitCode === null || Number.isInteger(result.exitCode)) ||
    (result.status === "passed" && result.exitCode !== 0)
  )
    throw new Error("Invalid container suite result.");
  return { ...result, id: suite.id, project: suite.project, kind: suite.kind };
}

export async function runContainerPlan(
  plan,
  {
    portable,
    runHost,
    execute,
    directory = root,
    environment = process.env,
    signal,
    output = process.stderr,
    onStart = () => {},
    onResult = () => {},
    ...options
  },
) {
  if (typeof execute !== "function")
    throw new Error("A container launcher is required.");
  if (new Set(portable.map((suite) => suite.id)).size !== portable.length)
    throw new Error("Duplicate container suite IDs.");
  const started = performance.now();
  const temporary = mkdtempSync(join(tmpdir(), "situate-test-container-"));
  const requestFile = join(temporary, "plan.json");
  const reportFile = join(temporary, "report.json");
  const request = {
    profile: plan.profile ?? "supported",
    scope:
      plan.scope === "extended" ||
      portable.some((suite) => !supportedSuiteEnabled(suite))
        ? "extended"
        : "supported",
    changed: plan.changed ?? false,
    base: plan.base ?? null,
    suiteIds: portable.map((suite) => suite.id),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
  };
  const observed = new Map();
  const running = new Set();
  let protocolError;
  const failProtocol = (error) => {
    protocolError ??= error.message;
  };
  const consume = (line) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.type === "suite" && event.status === "running") {
        const suite = portable.find((entry) => entry.id === event.id);
        if (!suite || running.has(event.id) || observed.has(event.id))
          throw new Error("Invalid container suite progress.");
        running.add(event.id);
        onStart(suite);
      } else if (event.type === "result") {
        const result = suiteResult(event.result, portable);
        if (observed.has(result.id))
          throw new Error("Duplicate container suite result event.");
        observed.set(result.id, result);
        onResult(result);
      } else if (!Array.isArray(event.results)) {
        throw new Error("Unexpected container progress event.");
      }
    } catch (error) {
      failProtocol(
        error instanceof SyntaxError
          ? new Error("Invalid container progress JSON.")
          : error,
      );
    }
  };
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      pending += decoder.write(chunk);
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
      if (pending.length > 1024 * 1024) {
        failProtocol(
          new Error("Container progress line exceeds its size limit."),
        );
        pending = "";
      }
      done();
    },
  });
  let execution;
  let container;
  try {
    writeFileSync(requestFile, JSON.stringify(request), { mode: 0o600 });
    if (options.successCacheDirectory)
      output.write("Container checks do not reuse the local success cache.\n");
    const allowed = hostContainerEnvironment(environment);
    try {
      execution = await execute(
        {
          id: "tool-container",
          project: "runner",
          kind: "container",
          cwd: ".",
          command: "python3",
          args: [
            "tools/pipeline-container.py",
            "suites",
            requestFile,
            reportFile,
          ],
        },
        {
          directory,
          environment: allowed,
          signal,
          output,
          stdout,
          buildLease: false,
          // The entry enforces suite deadlines; setup also needs time before the first suite.
          timeout: Math.min(
            2_147_483,
            (options.timeout ?? 600) * (portable.length + 1) + 600,
          ),
        },
      );
    } catch (error) {
      execution = {
        status: signal?.aborted ? "cancelled" : "failed",
        exitCode: null,
        durationMs: 0,
        error: error.message,
      };
    }
    pending += decoder.end();
    if (pending) consume(pending);
    try {
      const information = lstatSync(reportFile);
      if (!information.isFile() || information.isSymbolicLink())
        throw new Error("Container report must be a regular file.");
      if (information.size > 16 * 1024 * 1024)
        throw new Error("Container report exceeds its size limit.");
      const report = JSON.parse(readFileSync(reportFile, "utf8"));
      if (
        !["passed", "failed", "cancelled"].includes(report?.status) ||
        !Array.isArray(report.results) ||
        report.results.length !== portable.length
      )
        throw new Error("Incomplete container report.");
      if (report.profile !== undefined && report.profile !== request.profile)
        throw new Error("Container report profile differs from its request.");
      if (
        report.setupDurationMs !== undefined &&
        (!Number.isFinite(report.setupDurationMs) || report.setupDurationMs < 0)
      )
        throw new Error("Invalid container report timing.");
      const results = report.results.map((result) =>
        suiteResult(result, portable),
      );
      if (new Set(results.map((result) => result.id)).size !== portable.length)
        throw new Error("Duplicate container report results.");
      for (const result of results) {
        const previous = observed.get(result.id);
        if (
          previous &&
          (previous.status !== result.status ||
            previous.exitCode !== result.exitCode)
        )
          throw new Error("Container report differs from its result events.");
        if (!previous) onResult(result);
      }
      container = { ...report, results };
      if (
        report.status === "passed" &&
        results.some((result) => result.status !== "passed")
      )
        throw new Error(
          "Container report claims success for incomplete suites.",
        );
    } catch (error) {
      failProtocol(
        error.code === "ENOENT"
          ? new Error("Missing container report.")
          : error,
      );
    }
    if (!container) {
      let firstMissing = true;
      container = {
        status:
          signal?.aborted || execution.status === "cancelled"
            ? "cancelled"
            : "failed",
        results: portable.map((suite) => {
          if (observed.has(suite.id)) return observed.get(suite.id);
          const status =
            signal?.aborted || execution.status === "cancelled"
              ? running.has(suite.id)
                ? "cancelled"
                : "not-run"
              : firstMissing
                ? execution.status === "timed-out"
                  ? "timed-out"
                  : "failed"
                : "not-run";
          firstMissing = false;
          const result = {
            id: suite.id,
            project: suite.project,
            kind: suite.kind,
            status,
            exitCode: null,
            durationMs: 0,
          };
          onResult(result);
          return result;
        }),
      };
    }
    const hostSuites = plan.suites.filter(
      (suite) => !portable.some((entry) => entry.id === suite.id),
    );
    let host = { results: [], setupDurationMs: 0, status: "no-tests" };
    if (execution.cleanupIncomplete) {
      host = {
        status: "failed",
        setupDurationMs: 0,
        results: hostSuites.map((suite) => {
          const result = {
            id: suite.id,
            project: suite.project,
            kind: suite.kind,
            status: "not-run",
            exitCode: null,
            durationMs: 0,
          };
          onResult(result);
          return result;
        }),
      };
    } else if (hostSuites.length) {
      host = await runHost(
        { ...plan, suites: hostSuites },
        {
          ...options,
          directory,
          environment,
          signal,
          output,
          onStart,
          onResult,
        },
      );
    }
    const byId = new Map(
      [...container.results, ...host.results].map((result) => [
        result.id,
        result,
      ]),
    );
    const results = plan.suites.map((suite) => byId.get(suite.id));
    const cancelled =
      signal?.aborted ||
      execution.status === "cancelled" ||
      container.status === "cancelled" ||
      host.status === "cancelled";
    const error =
      protocolError ??
      container.error ??
      (execution.cleanupIncomplete
        ? "Container cleanup could not be confirmed."
        : execution.status !== "passed"
          ? (execution.error ?? `Container launcher ${execution.status}.`)
          : undefined);
    return {
      ...plan,
      status: cancelled
        ? "cancelled"
        : error ||
            container.status !== "passed" ||
            host.status === "failed" ||
            results.some((result) => result.status !== "passed")
          ? "failed"
          : "passed",
      ...(error ? { error } : {}),
      ...(execution.cleanupIncomplete
        ? { cleanupIncomplete: true, retainedDirectory: temporary }
        : {}),
      results,
      durationMs: Math.round(performance.now() - started),
      setupDurationMs:
        (container.setupDurationMs ?? 0) + (host.setupDurationMs ?? 0),
    };
  } finally {
    stdout.destroy();
    if (!execution?.cleanupIncomplete)
      rmSync(temporary, { recursive: true, force: true });
  }
}
