#!/usr/bin/env node
import { copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AgentRunError,
  MODEL,
  childEnvironment,
  createIsolation,
  parseAgentOptions,
  preflight,
  safeNativeStage,
  safeNativeObservation,
  safeProviderReport,
} from "./agent-e2e-runtime.mjs";

import { buildApp } from "./native-vm-build.mjs";
import { loadAgentTestKey } from "./agent-e2e-credentials.mjs";
import { runCoordinatedNativeAgent } from "./coordinated-native-agent.mjs";

const client = fileURLToPath(new URL("../", import.meta.url));
const help = `Usage: npm run test:agent [-- <options>]
       npm run test:agent:live

macOS native agent journey. Default fixture makes no paid calls.
--provider openai explicitly permits paid calls and requires TEST_OPENAI_API_KEY.
Live only: an absent environment key may load the repository-root .env.
An existing environment value (even empty) wins; CI=true never reads that file.
The optional file must be private, owned, mode 0600, and is never shell-evaluated.
--journey workspace (default) checks ordinary chat, files and restart.
--journey onboarding checks method proposal, source conversion and continuation.
--journey plugins checks native publication and request-local capabilities (fixture only).
Fixed model: gpt-4.1-mini. No shell execution or automatic retries.

Option                     Fixture default/max  Live default/max
--max-requests             64                   24
--max-input-tokens         33554432             262144
--max-total-input-tokens   268435456            262144
--max-output-tokens        1024                 1024
--max-total-output-tokens  65536                24576
--timeout (seconds)        300                  180
--build-timeout (seconds)  900 (max 1800)       900 (max 1800)

Limits span both native launches; flags can lower limits, not raise them.
Input reservations use conservative UTF-8 bytes plus image reservations.
Each provider request has a 60-second timeout, within the shared deadline.
--help prints this JSON help without building or contacting a provider.
See docs/development/testing.md for prerequisites, isolation and CI approval.`;
const startProvider = async (options) => {
  const { startAgentProvider } = await import("./agent-e2e-provider.mjs");
  return startAgentProvider(options);
};

async function readNativeReport(path, phase) {
  try {
    if ((await stat(path)).size > 65536) throw new Error();
    const report = JSON.parse(await readFile(path, "utf8"));
    if (
      report.phase !== phase ||
      typeof report.passed !== "boolean" ||
      !["passed", "assertion", "blocked", "cleanup"].includes(report.category)
    )
      throw new AgentRunError("product", "native-report-missing-or-invalid");
    const stage = safeNativeStage(report.stage);
    const observation = safeNativeObservation(report.observation);
    if (observation) stage.observation = observation;
    if (!report.passed || report.category !== "passed") {
      const error = new AgentRunError(
        report.category === "blocked" || report.category === "cleanup"
          ? "blocked"
          : "product",
        "native-journey-failed",
      );
      error.stage = stage;
      throw error;
    }
    return stage;
  } catch (error) {
    if (error instanceof AgentRunError) throw error;
    throw new AgentRunError("product", "native-report-missing-or-invalid");
  }
}

function cleanupFailure(report, code) {
  report.beforeCleanup ??= {
    outcome: report.outcome,
    code: report.code,
    ...(report.phase ? { phase: report.phase } : {}),
    ...(report.stage ? { stage: report.stage } : {}),
    ...(report.stageDigest ? { stageDigest: report.stageDigest } : {}),
  };
  report.outcome = "blocked";
  report.code = code;
}

export async function runAgent(
  args = [],
  {
    environment = process.env,
    platform = process.platform,
    desktopIssue,
    signal,
    isolate = createIsolation,
    build = buildApp,
    provider = startProvider,
    loadKey = loadAgentTestKey,
    launch = runCoordinatedNativeAgent,
    copyJourney = (root) =>
      copyFile(
        join(client, "app/src-tauri/tests/support/agent-e2e.js"),
        join(root, "agent-e2e.js"),
      ),
  } = {},
) {
  const report = {
    version: 1,
    outcome: "blocked",
    code: "not-started",
    model: MODEL,
    phasesPassed: 0,
    cleanup: "not-needed",
  };
  let isolated,
    broker,
    executable,
    env,
    configPath,
    options,
    built,
    unsafeProcesses = false;
  try {
    options = parseAgentOptions(args);
    if (options.help)
      return { ...report, outcome: "help", code: "usage", help };
    report.provider = options.provider;
    report.journey = options.journey;
    preflight(platform, desktopIssue);
    if (signal?.aborted) throw new AgentRunError("cancel", "interrupted");
    const apiKey =
      options.provider === "openai"
        ? await loadKey({ environment, directory: resolve(client, "..") })
        : undefined;
    isolated = await isolate();
    report.runId = isolated.owner;
    try {
      await copyJourney(isolated.root);
    } catch {
      throw new AgentRunError("blocked", "native-journey-script-unavailable");
    }
    built = await build(isolated, options, environment, signal);
    executable = built.executable;
    preflight(platform, desktopIssue);
    broker = await provider({
      mode: options.provider,
      model: MODEL,
      allowLive: options.provider === "openai",
      apiKey,
      signal,
      limits: {
        maxRequests: options["max-requests"],
        maxInputTokens: options["max-input-tokens"],
        maxTotalInputTokens: options["max-total-input-tokens"],
        maxOutputTokens: options["max-output-tokens"],
        maxTotalOutputTokens: options["max-total-output-tokens"],
        maxBodyBytes: options.provider === "fixture" ? 33554432 : 1048576,
        maxResponseBytes: options.provider === "fixture" ? 33554432 : 4194304,
        maxConcurrency: options.provider === "fixture" ? 3 : 2,
        deadlineMs: options.timeout * 1000,
        timeoutMs: Math.min(60000, options.timeout * 1000),
      },
    });
    env = childEnvironment(isolated, environment);
    configPath = join(isolated.root, "agent-config.json");
    env.SITUATE_AGENT_E2E_CONFIG = configPath;
    const deadline = performance.now() + options.timeout * 1000;
    for (const phase of ["exercise", "reopen"]) {
      report.phase = phase;
      preflight(platform, desktopIssue);
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw new AgentRunError("budget", "deadline-exceeded");
      const reportPath = join(isolated.root, `report-${phase}.json`);
      await writeFile(
        configPath,
        JSON.stringify({
          workspaceRoot: isolated.root,
          providerBaseUrl: broker.url,
          providerToken: broker.token,
          model: MODEL,
          mode: options.provider === "openai" ? "live" : "fixture",
          journey: options.journey,
          reportPath,
          phase,
          maxOutputTokens: options["max-output-tokens"],
          timeoutMs: Math.ceil(remaining),
        }),
        { mode: 0o600 },
      );
      report.cleanup = "pending";
      let launchError;
      try {
        await launch(executable, [], {
          cwd: isolated.root,
          env,
          signal,
          timeoutMs: remaining,
        });
      } catch (error) {
        launchError = error;
      }
      if (
        launchError?.cleanupUnsafe ||
        launchError?.outcome === "budget" ||
        launchError?.outcome === "cancel"
      )
        throw launchError;
      Object.assign(report, await readNativeReport(reportPath, phase));
      if (launchError) throw launchError;
      if (options.journey === "plugins") {
        const summary = broker.report();
        if (
          summary.pluginEffects?.POST !== 1 ||
          summary.pluginEffects?.DELETE !== 1
        )
          throw new AgentRunError("product", "plugins-http-effect-count");
        if (
          summary.requests !== 7 ||
          summary.records?.length !== 7 ||
          summary.records.some(
            (record, index) =>
              record.kind !== "main" ||
              record.scenario !== (index < 4 ? "plugins" : "source-chat") ||
              record.outcome !== "completed",
          )
        )
          throw new AgentRunError(
            "product",
            phase === "reopen"
              ? "plugins-redispatched-on-reopen"
              : "plugins-request-count",
          );
      }
      report.phasesPassed++;
    }
    report.outcome = "passed";
    report.code = "journey-complete";
  } catch (error) {
    if (error.cleanupUnsafe) {
      unsafeProcesses = true;
      report.cleanup = "failed";
    }
    report.outcome = signal?.aborted
      ? "cancel"
      : error instanceof AgentRunError
        ? error.outcome
        : "blocked";
    report.code =
      error instanceof AgentRunError
        ? error.code
        : "prerequisite-or-harness-failed";
    if (error instanceof AgentRunError && error.stage)
      Object.assign(report, error.stage);
    if (
      error instanceof AgentRunError &&
      ["sccache-tempdir-unavailable", "command-failed"].includes(
        error.build?.reason,
      )
    )
      report.build = {
        reason: error.build.reason,
        exitCode:
          Number.isInteger(error.build.exitCode) &&
          error.build.exitCode >= 0 &&
          error.build.exitCode <= 255
            ? error.build.exitCode
            : null,
      };
  } finally {
    if (broker) {
      try {
        await broker.close();
        const summary = broker.report();
        report.usage = safeProviderReport(summary);
        if (summary.budgetDenials > 0 && report.outcome !== "cancel") {
          report.outcome = "budget";
          report.code = "provider-budget-exhausted";
        } else if (
          report.outcome === "product" &&
          options.provider === "openai" &&
          Array.isArray(summary.records) &&
          summary.records.some((record) =>
            [
              "upstream_failure",
              "upstream_status",
              "upstream_content_type",
              "incomplete_response",
            ].includes(record.outcome),
          )
        ) {
          report.outcome = "provider";
          report.code = "provider-boundary-failed";
        }
      } catch {
        cleanupFailure(report, "provider-cleanup-failed");
      }
    }
    if (report.cleanup === "pending") {
      try {
        await launch(executable, [], {
          cwd: isolated.root,
          env: { ...env, SITUATE_AGENT_E2E_CLEANUP: "1" },
          timeoutMs: 10000,
        });
        report.cleanup = "passed";
      } catch (error) {
        unsafeProcesses ||= error.cleanupUnsafe === true;
        report.cleanup = "failed";
        cleanupFailure(report, "credential-cleanup-failed");
      }
    }
    if (isolated && report.cleanup !== "failed") {
      try {
        await isolated.cleanup();
      } catch {
        report.cleanup = "failed";
        cleanupFailure(report, "owned-directory-cleanup-failed");
      }
    }
    if (built && !unsafeProcesses) {
      try {
        await built.release();
      } catch {
        report.cleanup = "failed";
        cleanupFailure(report, "build-cache-release-failed");
      }
    }
  }
  return report;
}

export async function main(
  args = process.argv.slice(2),
  { environment = process.env, transport, local = runAgent, remote } = {},
) {
  const controller = new AbortController();
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => {
    const handler = () => controller.abort();
    process.on(name, handler);
    return [name, handler];
  });
  try {
    const options = parseAgentOptions(args);
    if (!options.help) {
      transport ??= await import("../../tools/native-vm.mjs");
      if (transport.nativeVmConfiguration(environment)) {
        if (options.provider !== "fixture") {
          console.log(
            JSON.stringify({
              version: 1,
              outcome: "blocked",
              code: "vm-fixture-provider-required",
            }),
          );
          return 2;
        }
        remote ??= (await import("./native-vm-host.mjs")).runNativeVm;
        return await remote("agent", args, {
          environment,
          signal: controller.signal,
          transport,
        });
      }
    }
    const report = await local(args, {
      environment,
      signal: controller.signal,
    });
    console.log(JSON.stringify(report));
    return ["passed", "help"].includes(report.outcome)
      ? 0
      : report.outcome === "cancel"
        ? 130
        : report.outcome === "blocked"
          ? 2
          : 1;
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const known = error instanceof AgentRunError;
    const outcome = cancelled ? "cancel" : known ? error.outcome : "blocked";
    const code = cancelled
      ? "interrupted"
      : known
        ? error.code
        : "native-vm-execution-failed";
    console.log(JSON.stringify({ version: 1, outcome, code }));
    return outcome === "cancel" ? 130 : outcome === "blocked" ? 2 : 1;
  } finally {
    for (const [name, handler] of handlers) process.off(name, handler);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main();
