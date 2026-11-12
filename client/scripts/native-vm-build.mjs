import { stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { workerBudget } from "../../tools/test-budget.mjs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentRunError,
  acquireBuildCache,
  childEnvironment,
  runChild,
} from "./agent-e2e-runtime.mjs";

const client = fileURLToPath(new URL("../", import.meta.url));

export async function buildApp(isolated, options, environment, signal) {
  const env = childEnvironment(isolated, environment, {
    build: true,
    nativeSmoke: options.nativeSmoke,
  });
  env.CARGO_BUILD_JOBS =
    environment.CARGO_BUILD_JOBS ??
    String(workerBudget(availableParallelism()));
  if (options.nativeSmoke) env.VITE_NATIVE_SMOKE = "1";
  const cli = join(client, "node_modules/@tauri-apps/cli/tauri.js");
  try {
    await stat(cli);
  } catch {
    throw new AgentRunError("blocked", "run-npm-ci-in-client");
  }
  const info = await runChild("rustc", ["-vV"], {
    cwd: client,
    env,
    signal,
    timeoutMs: 10000,
    capture: true,
  });
  const host = info.match(/^host: ([a-zA-Z0-9_-]+)$/m)?.[1];
  if (!host) throw new AgentRunError("blocked", "rust-host-unavailable");
  const cache = await acquireBuildCache(client, {
    signal,
    timeoutMs: options["build-timeout"] * 1000,
  });
  env.CARGO_HOME = cache.cargo;
  const target = cache.target;
  const args = [
    cli,
    "build",
    ...(options.release ? [] : ["--debug"]),
    "--no-bundle",
    "--target",
    host,
    "--features",
    "native-smoke",
    "--config",
    "src-tauri/tests/smoke.conf.json",
    "--config",
    JSON.stringify({
      identifier: isolated.identifier,
      app: { appDirectoriesOverride: isolated.root },
    }),
    "--",
    "--locked",
    "--target-dir",
    target,
  ];
  try {
    await runChild(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../tools/run-coordinated.mjs", import.meta.url),
        ),
        "--resource",
        "build",
        "--",
        process.execPath,
        ...args,
      ],
      {
        cwd: join(client, "app"),
        env,
        signal,
        timeoutMs: options["build-timeout"] * 1000,
        buildDiagnostics: true,
      },
    );
    return {
      executable: join(
        target,
        host,
        options.release ? "release" : "debug",
        "situate-client",
      ),
      release: cache.release,
    };
  } catch (error) {
    if (!error.cleanupUnsafe) await cache.release();
    throw error;
  }
}
