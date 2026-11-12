import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireNativeDesktop } from "./native-desktop-session.mjs";

export function parseSmokeOptions(input) {
  const usage =
    "Usage: test-native.mjs [--release] [--document-sources | --diagnostics | --diagnostics-profile disabled|healthy|slow|blocked]";
  if (input.filter((arg) => arg === "--release").length > 1)
    throw new Error(usage);
  const release = input.includes("--release");
  const args = input.filter((arg) => arg !== "--release");
  if (args.length === 0)
    return { diagnosticsOnly: false, profile: undefined, release };
  if (args.length === 1 && args[0] === "--document-sources")
    return {
      diagnosticsOnly: false,
      documentSourcesOnly: true,
      profile: undefined,
      release,
    };
  if (args.length === 1 && args[0] === "--diagnostics")
    return { diagnosticsOnly: true, profile: undefined, release };
  if (
    args.length === 2 &&
    args[0] === "--diagnostics-profile" &&
    ["disabled", "healthy", "slow", "blocked"].includes(args[1])
  )
    return { diagnosticsOnly: true, profile: args[1], release };
  throw new Error(usage);
}

export async function withSmokeRoot(run, parent = tmpdir()) {
  const root = await realpath(
    await mkdtemp(join(parent, "situate-native-smoke-")),
  );
  const token = randomUUID();
  const marker = join(root, ".smoke-owner");
  await writeFile(marker, token, { flag: "wx" });
  async function cleanup() {
    if (
      !(await lstat(root)).isDirectory() ||
      (await lstat(marker)).isSymbolicLink() ||
      (await readFile(marker, "utf8")) !== token
    ) {
      throw new Error("Refusing to remove an unowned native smoke directory.");
    }
    await rm(root, { recursive: true, force: true });
  }
  return Promise.resolve()
    .then(() =>
      run({
        root,
        env: { SITUATE_SMOKE_ROOT: root, SITUATE_SMOKE_OWNER: token },
      }),
    )
    .then(
      async (value) => {
        await cleanup();
        return value;
      },
      async (error) => {
        try {
          await cleanup();
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Native smoke execution and owned cleanup both failed.",
            { cause: cleanupError },
          );
        }
        throw error;
      },
    );
}

export async function runSmokePhase(
  executable,
  {
    args = [],
    cwd,
    env,
    recovery = false,
    phase = recovery ? "recovery staging" : "restart verification",
    timeout = 60000,
    output = process.stdout,
    desktopIssue,
    signal,
    expectedBlockingStage,
  } = {},
) {
  if (
    expectedBlockingStage !== undefined &&
    (expectedBlockingStage !== "plugin-check-block-armed" || recovery)
  )
    throw new Error("Invalid blocking smoke phase configuration.");
  signal?.throwIfAborted();
  requireNativeDesktop(desktopIssue);
  output.write(`SITUATE_SMOKE_PHASE ${phase}\n`);
  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let pending = "";
  let report;
  let failure;
  let blockingTimer;
  let ownedBlockingKill = false;
  const progress = [];
  const diagnosticError = (message) =>
    new Error(
      `${message} (${phase})${progress.length ? `\nRecent smoke progress:\n${progress.join("\n")}` : "\nNo smoke progress received."}`,
    );
  const stop = () => child.kill("SIGKILL");
  const abort = () => {
    failure = diagnosticError("Native smoke test interrupted.");
    stop();
  };
  const timer = setTimeout(() => {
    failure = diagnosticError("Native smoke test timed out.");
    stop();
  }, timeout);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  child.stdout.on("data", (chunk) => {
    output.write(chunk);
    pending += chunk;
    let end;
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (line.startsWith("SITUATE_SMOKE_PROGRESS ")) {
        progress.push(line.slice("SITUATE_SMOKE_PROGRESS ".length, 2048));
        if (progress.length > 16) progress.shift();
        if (expectedBlockingStage && !blockingTimer && !failure) {
          let stage;
          try {
            stage = JSON.parse(
              line.slice("SITUATE_SMOKE_PROGRESS ".length),
            ).stage;
          } catch {
            // Unstructured diagnostic output cannot arm the blocking check.
          }
          if (stage === expectedBlockingStage) {
            blockingTimer = setTimeout(() => {
              if (failure || report !== undefined) return;
              if (child.exitCode !== null || child.signalCode !== null) return;
              ownedBlockingKill = child.kill("SIGKILL");
              if (!ownedBlockingKill)
                failure = diagnosticError(
                  "Could not stop the owned blocking smoke process.",
                );
            }, 2000);
          }
        }
        continue;
      }
      if (!line.startsWith("SITUATE_NATIVE_SMOKE ")) continue;
      if (expectedBlockingStage) {
        failure = diagnosticError(
          "Blocking smoke phase completed unexpectedly.",
        );
        stop();
        continue;
      }
      try {
        report = JSON.parse(line.slice("SITUATE_NATIVE_SMOKE ".length));
        if (
          recovery &&
          report.passed === true &&
          report.recoveryStaged === true
        )
          stop();
      } catch (error) {
        failure = error;
        stop();
      }
    }
  });
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, exitSignal) => {
        if (failure) return reject(failure);
        if (expectedBlockingStage) {
          if (pending.startsWith("SITUATE_NATIVE_SMOKE "))
            return reject(
              diagnosticError(
                "Blocking smoke phase emitted an incomplete report.",
              ),
            );
          if (
            ownedBlockingKill &&
            exitSignal === "SIGKILL" &&
            report === undefined
          )
            return resolve();
          return reject(
            diagnosticError(
              `Blocking smoke process exited before the owned stop: ${code ?? exitSignal}`,
            ),
          );
        }
        const ended = recovery
          ? exitSignal === "SIGKILL" && report?.recoveryStaged === true
          : code === 0;
        if (ended && report?.passed === true) resolve();
        else
          reject(
            diagnosticError(
              `Native smoke test failed: ${report?.error ?? `exit ${code ?? exitSignal}`}`,
            ),
          );
      });
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(blockingTimer);
    signal?.removeEventListener("abort", abort);
  }
}
