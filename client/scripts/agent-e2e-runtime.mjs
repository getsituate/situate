import { spawn, spawnSync } from "node:child_process";
import { compilerCacheEnvironment } from "../../tools/compiler-cache.mjs";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { nativeDesktopIssue } from "./native-desktop-session.mjs";

export const MODEL = "gpt-4.1-mini";
export class AgentRunError extends Error {
  constructor(outcome, code) {
    super(code);
    this.outcome = outcome;
    this.code = code;
  }
}

export function parseAgentOptions(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        help: { type: "boolean", default: false },
        provider: { type: "string", default: "fixture" },
        journey: { type: "string", default: "workspace" },
        "max-requests": { type: "string" },
        "max-input-tokens": { type: "string" },
        "max-total-input-tokens": { type: "string" },
        "max-output-tokens": { type: "string" },
        "max-total-output-tokens": { type: "string" },
        timeout: { type: "string" },
        "build-timeout": { type: "string", default: "900" },
      },
    }));
  } catch {
    throw new AgentRunError("blocked", "invalid-options");
  }
  if (values.help) return values;
  if (!["fixture", "openai"].includes(values.provider))
    throw new AgentRunError("blocked", "unsupported-provider");
  if (!["workspace", "onboarding", "plugins"].includes(values.journey))
    throw new AgentRunError("blocked", "unsupported-journey");
  const fixture = values.provider === "fixture";
  if (values.journey === "plugins" && !fixture)
    throw new AgentRunError("blocked", "plugins-fixture-required");
  for (const [key, maximum] of Object.entries({
    "max-requests": fixture ? 64 : 24,
    "max-input-tokens": fixture ? 33554432 : 262144,
    "max-total-input-tokens": fixture ? 268435456 : 262144,
    "max-output-tokens": 1024,
    "max-total-output-tokens": fixture ? 65536 : 24576,
    timeout: fixture ? 300 : 180,
    "build-timeout": 1800,
  })) {
    values[key] ??= String(maximum);
    if (
      !/^\d+$/.test(values[key]) ||
      Number(values[key]) < 1 ||
      Number(values[key]) > maximum
    )
      throw new AgentRunError("blocked", `invalid-${key}`);
    values[key] = Number(values[key]);
  }
  return values;
}

export function preflight(platform, desktopIssue = nativeDesktopIssue) {
  if (platform !== "darwin")
    throw new AgentRunError("blocked", "macos-keychain-required");
  const issue = desktopIssue({ platform });
  if (issue) throw new AgentRunError("blocked", issue);
}

export async function createIsolation(parent = tmpdir()) {
  const root = await mkdtemp(join(parent, "situate-agent-e2e-"));
  const owner = randomUUID();
  await writeFile(join(root, ".smoke-owner"), owner, {
    flag: "wx",
    mode: 0o600,
  });
  for (const name of ["home", "tmp", "config", "data", "cache", "cargo", "pi"])
    await mkdir(join(root, name), { mode: 0o700 });
  return {
    root,
    owner,
    identifier: `dev.situate.client.smoke.${owner}`,
    async cleanup() {
      const marker = join(root, ".smoke-owner");
      if (
        !(await lstat(root)).isDirectory() ||
        (await lstat(root)).isSymbolicLink() ||
        !(await lstat(marker)).isFile() ||
        (await lstat(marker)).isSymbolicLink() ||
        (await readFile(marker, "utf8")) !== owner
      )
        throw new AgentRunError("blocked", "cleanup-ownership-mismatch");
      await rm(root, { recursive: true });
    },
  };
}

export async function acquireBuildCache(
  client,
  { signal, timeoutMs = 10000 } = {},
) {
  const target = join(client, "target");
  await mkdir(target, { recursive: true });
  if ((await lstat(target)).isSymbolicLink())
    throw new AgentRunError("blocked", "build-cache-ownership-mismatch");
  const root = join(target, "agent-e2e-build");
  const lock = join(target, "agent-e2e-build.lock");
  const deadline = performance.now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw new AgentRunError("cancel", "interrupted");
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (performance.now() >= deadline)
        throw new AgentRunError("blocked", "build-cache-busy");
      try {
        await delay(50, undefined, { signal });
      } catch {
        throw new AgentRunError("cancel", "interrupted");
      }
    }
  }
  const release = () => rmdir(lock);
  try {
    const owner = createHash("sha256")
      .update(await realpath(client))
      .digest("hex");
    const marker = join(root, ".agent-e2e-build-owner");
    try {
      await mkdir(root, { mode: 0o700 });
      await writeFile(marker, owner, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (
      (await lstat(root)).isSymbolicLink() ||
      !(await lstat(root)).isDirectory() ||
      (await lstat(marker)).isSymbolicLink() ||
      (await readFile(marker, "utf8")) !== owner
    )
      throw new AgentRunError("blocked", "build-cache-ownership-mismatch");
    const cargo = join(root, "cargo");
    const artifacts = join(root, "target");
    await mkdir(cargo, { recursive: true, mode: 0o700 });
    await mkdir(artifacts, { recursive: true, mode: 0o700 });
    for (const directory of [cargo, artifacts])
      if ((await lstat(directory)).isSymbolicLink())
        throw new AgentRunError("blocked", "build-cache-ownership-mismatch");
    for (const name of [
      "config",
      "config.toml",
      "credentials",
      "credentials.toml",
    ]) {
      try {
        await lstat(join(cargo, name));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      throw new AgentRunError(
        "blocked",
        "build-cache-contains-personal-config",
      );
    }
    return { root, cargo, target: artifacts, release };
  } catch (error) {
    await release();
    throw error;
  }
}

export function childEnvironment(
  isolated,
  environment = process.env,
  { build = false, nativeSmoke = false } = {},
) {
  const root = build ? (isolated.buildRoot ?? isolated.root) : isolated.root;
  const { owner } = isolated;
  const env = {
    PATH: environment.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: join(root, "home"),
    TMPDIR: join(root, "tmp"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    PI_CODING_AGENT_DIR: join(root, "pi"),
    LANG: "en_US.UTF-8",
    CI: "true",
  };
  if (build) {
    // Toolchains are read-only inputs; Cargo configuration and credentials are not.
    env.RUSTUP_HOME =
      environment.RUSTUP_HOME ?? join(environment.HOME ?? "", ".rustup");
    env.VOLTA_HOME =
      environment.VOLTA_HOME ?? join(environment.HOME ?? "", ".volta");
    env.CARGO_HOME = join(root, "cargo");
    if (environment.DEVELOPER_DIR !== undefined)
      env.DEVELOPER_DIR = environment.DEVELOPER_DIR;
    if (!nativeSmoke) env.CARGO_INCREMENTAL = "0";
    else if (environment.CARGO_INCREMENTAL !== undefined)
      env.CARGO_INCREMENTAL = environment.CARGO_INCREMENTAL;
    env.CARGO_PROFILE_DEV_DEBUG = nativeSmoke
      ? (environment.CARGO_PROFILE_DEV_DEBUG ?? "line-tables-only")
      : "line-tables-only";
    if (environment.CARGO_NET_OFFLINE === "true")
      env.CARGO_NET_OFFLINE = "true";
  } else {
    env.SITUATE_SMOKE_ROOT = root;
    env.SITUATE_SMOKE_OWNER = owner;
  }
  return build
    ? compilerCacheEnvironment(env, { configuration: environment })
    : env;
}

// The supervisor pins the process-group identity after the command exits. Killing
// the group while this owned child is alive cannot target a recycled leader PID.
const supervisor = `
const { spawn, spawnSync } = require('node:child_process');
setInterval(() => {}, 1000);
process.on('SIGTERM', () => {});
process.on('disconnect', () => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], { stdio: 'ignore', timeout: 2000 });
  else process.kill(-process.pid, 'SIGKILL');
});
process.send({ type: 'ready' });
const child = spawn(process.argv[2], process.argv.slice(3), { stdio: ['ignore', 'inherit', process.argv[1] === '1' ? 'inherit' : 'ignore'] });
child.once('error', () => process.send({ type: 'spawn-error' }));
child.once('exit', (code) => process.send({ type: 'exit', code }));
`;

export function runChild(
  command,
  args,
  {
    cwd,
    env,
    timeoutMs,
    signal,
    capture = false,
    buildDiagnostics = false,
  } = {},
) {
  if (signal?.aborted)
    return Promise.reject(new AgentRunError("cancel", "interrupted"));
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--eval", supervisor, buildDiagnostics ? "1" : "0", command, ...args],
      {
        cwd,
        env,
        detached: process.platform !== "win32",
        stdio: [
          "ignore",
          capture || buildDiagnostics ? "pipe" : "ignore",
          buildDiagnostics ? "pipe" : "ignore",
          "ipc",
        ],
      },
    );
    let text = "",
      failure,
      escalation,
      drain,
      finished = false,
      terminating = false,
      ready = false,
      hardKilled = false;
    let exitCode;
    let tempDirectoryFailure = false;
    const tails = { stdout: "", stderr: "" };
    const inspect = (stream, chunk) => {
      for (let offset = 0; offset < chunk.length; offset += 4096) {
        tails[stream] = (
          tails[stream] + chunk.subarray(offset, offset + 4096).toString()
        ).slice(-8192);
        if (/sccache[\s\S]*Failed to create temp dir/.test(tails[stream]))
          tempDirectoryFailure = true;
      }
    };
    const unsafeCleanup = () => {
      failure = new AgentRunError("blocked", "process-cleanup-failed");
      failure.cleanupUnsafe = true;
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(escalation);
      clearTimeout(drain);
      signal?.removeEventListener("abort", abort);
      if (failure) {
        if (
          buildDiagnostics &&
          failure.outcome === "product" &&
          failure.code === "child-failed"
        )
          failure.build = {
            exitCode: Number.isInteger(exitCode) ? exitCode : null,
            reason: tempDirectoryFailure
              ? "sccache-tempdir-unavailable"
              : "command-failed",
          };
        reject(failure);
      } else resolve(text);
    };
    const kill = (name) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
        unsafeCleanup();
        return;
      }
      try {
        if (process.platform === "win32") {
          const result = spawnSync(
            "taskkill",
            ["/PID", String(child.pid), "/T", "/F"],
            { stdio: "ignore", timeout: 2000 },
          );
          if (result.status !== 0) unsafeCleanup();
        } else process.kill(-child.pid, name);
      } catch {
        unsafeCleanup();
      }
    };
    const force = () => {
      hardKilled = true;
      kill("SIGKILL");
      drain = setTimeout(() => {
        unsafeCleanup();
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (child.connected) child.disconnect();
        child.unref();
        finish();
      }, 1000);
    };
    const stop = (outcome, code, graceful = true) => {
      if (finished) return;
      if (outcome) failure ??= new AgentRunError(outcome, code);
      if (terminating) return;
      terminating = true;
      if (graceful && ready && process.platform !== "win32") {
        kill("SIGTERM");
        escalation = setTimeout(force, 1000);
      } else force();
    };
    const abort = () => stop("cancel", "interrupted");
    const timer = setTimeout(
      () => stop("budget", "deadline-exceeded"),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout?.on("data", (chunk) => {
      if (buildDiagnostics) inspect("stdout", chunk);
      if (capture) {
        if (text.length <= 65536) text += chunk;
        if (text.length > 65536) stop("blocked", "process-output-limit");
      }
    });
    child.stderr?.on("data", (chunk) => inspect("stderr", chunk));
    child.on("message", (message) => {
      if (message.type === "ready") ready = true;
      else if (message.type === "spawn-error")
        stop("blocked", "executable-unavailable", false);
      else if (message.type === "exit") {
        exitCode = message.code;
        stop(message.code === 0 ? undefined : "product", "child-failed", false);
      }
    });
    child.once("error", () => {
      failure = new AgentRunError("blocked", "executable-unavailable");
      finish();
    });
    child.once("exit", () => {
      if (!hardKilled) unsafeCleanup();
      drain ??= setTimeout(() => {
        unsafeCleanup();
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (child.connected) child.disconnect();
        child.unref();
        finish();
      }, 1000);
    });
    child.once("close", () => {
      if (!terminating && !failure) unsafeCleanup();
      finish();
    });
  });
}

const nativeStages = new Set([
  "exercise-complete",
  "reopen-complete",
  "plugins-complete",
  "startup",
  "script",
  "bootstrap",
  "bootstrap-directory",
  "bootstrap-workspaces-directory",
  "bootstrap-workspace-create",
  "bootstrap-image-seed",
  "bootstrap-content-open",
  "bootstrap-seed-write",
  "bootstrap-localization",
  "bootstrap-restart-checkpoint",
  "bootstrap-workspace-inspect",
  "bootstrap-registry",
  "bootstrap-ai-storage",
  "bootstrap-provider-config",
  "bootstrap-credential-lock",
  "bootstrap-credential-save",
  "bootstrap-credential-read",
  "bootstrap-credential-manifest",
  "bootstrap-settings-save",
  "bootstrap-conversations",
  "bootstrap-model-validate",
  "bootstrap-keychain-create",
  "bootstrap-keychain-open",
  "bootstrap-keychain-unlock",
  "bootstrap-keychain-password",
  "bootstrap-keychain-permissions",
  "conversation-error",
  "conversation-save-error",
  "assistant-stream-error",
  "observation-snapshot-failed",
  ...["chat", "model"].flatMap((origin) =>
    [
      "history-read",
      "model-choices",
      "model-unavailable",
      "storage-busy",
      "response-start",
      "response-failed",
      "other",
    ].map((reason) => `alert-${origin}-${reason}`),
  ),
  ...[
    "environment",
    "current-session",
    "storage-session",
    "storage-open",
    "list-conversations",
    "read-conversation",
    "missing-conversation",
    "settings-read",
    "settings-missing",
    "settings-decode",
    "cap-open",
    "file-open",
    "file-meta",
    "file-kind",
    "file-read",
    "file-size",
    "file-utf8",
    "file-revision",
    "history-request",
    "history-session",
    "history",
    "history-page",
    "ready",
    "task",
  ].flatMap((step) =>
    [
      "failed",
      "native-ai-storage-busy",
      "native-ai-storage-failed",
      "native-ai-conversation-versionInvalid",
      "native-files-operation-unavailable",
      "native-files-operation-failed",
      "native-workspace-session-inactive",
      "native-content-store-busy",
    ].map((reason) => `snapshot-${step}-${reason}`),
  ),
]);

export function safeNativeStage(stage) {
  if (nativeStages.has(stage)) return { stage };
  const status =
    typeof stage === "string"
      ? stage.match(/^credential-(?:read|save)-os-(-?\d{1,10})$/)
      : null;
  if (
    status &&
    status[0] === stage &&
    Number(status[1]) >= -2147483648 &&
    Number(status[1]) <= 2147483647
  )
    return { stage };
  return {
    stage: "native-assertion",
    ...(typeof stage === "string"
      ? { stageDigest: createHash("sha256").update(stage).digest("hex") }
      : {}),
  };
}

export function safeNativeObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const observation = {};
  for (const key of ["hasComposer", "hasSend", "hasStop", "hasAlert"])
    if (typeof value[key] === "boolean") observation[key] = value[key];
  for (const key of [
    "conversationCount",
    "userMessages",
    "assistantMessages",
    "toolResults",
    "draftChars",
    "identifiedTasks",
    "metadataIssues",
    "mainRequests",
    "auxiliaryRequests",
  ])
    if (
      Number.isInteger(value[key]) &&
      value[key] >= 0 &&
      value[key] <= 100000000
    )
      observation[key] = value[key];
  if (
    Array.isArray(value.runStates) &&
    value.runStates.length <= 32 &&
    value.runStates.every((state) =>
      [
        "running",
        "completed",
        "cancelled",
        "failed",
        "error",
        "interrupted",
        "unknown",
      ].includes(state),
    )
  )
    observation.runStates = [...value.runStates];
  return Object.keys(observation).length ? observation : undefined;
}

export function safeProviderReport(report = {}) {
  const result = {
    inputTokens: 0,
    outputTokens: 0,
    completed: 0,
    failed: 0,
    requestIds: [],
  };
  for (const key of [
    "requests",
    "reservedInputTokens",
    "reservedOutputTokens",
    "budgetDenials",
  ])
    if (Number.isSafeInteger(report[key]) && report[key] >= 0)
      result[key] = report[key];
  const records = Array.isArray(report.records)
    ? report.records.slice(0, 64)
    : [];
  for (const record of records) {
    if (record.outcome === "completed") result.completed++;
    else result.failed++;
    for (const [source, target] of [
      ["input_tokens", "inputTokens"],
      ["output_tokens", "outputTokens"],
    ])
      if (
        Number.isSafeInteger(record.usage?.[source]) &&
        record.usage[source] >= 0
      )
        result[target] += record.usage[source];
    if (
      typeof record.requestId === "string" &&
      /^req_[A-Za-z0-9_-]{1,128}$/.test(record.requestId)
    )
      result.requestIds.push(record.requestId);
  }
  return result;
}
