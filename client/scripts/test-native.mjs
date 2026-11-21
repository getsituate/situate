import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { workerBudget } from "../../tools/test-budget.mjs";
import { nativeSmokeBuildEnvironment } from "../../tools/compiler-cache.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, join, resolve } from "node:path";
import { withSmokeRoot, parseSmokeOptions } from "./native-smoke-runtime.mjs";
import { requireNativeDesktop } from "./native-desktop-session.mjs";
import { runCoordinatedSmokePhase as runSmokePhase } from "./coordinated-native-smoke.mjs";
import { startDocumentSourceServer } from "./document-source-fixtures.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function rustHostTarget(environment = process.env, execute = spawnSync) {
  const name = process.platform === "win32" ? "rustup.exe" : "rustup";
  const cargoHome = environment.CARGO_HOME;
  if (cargoHome && !isAbsolute(cargoHome))
    throw new Error("CARGO_HOME must be absolute for native smoke tests.");
  const candidates = [
    ...(cargoHome ? [join(cargoHome, "bin", name)] : []),
    join(homedir(), ".cargo", "bin", name),
    ...(process.platform === "darwin"
      ? ["/opt/homebrew/bin/rustup", "/usr/local/bin/rustup"]
      : []),
  ];
  const rustup = candidates.find(existsSync);
  if (!rustup)
    throw new Error("Could not locate the installed rustup executable.");
  const options = {
    cwd: root,
    encoding: "utf8",
    env: { ...environment, RUSTUP_AUTO_INSTALL: "0" },
  };
  const compiler = execute(rustup, ["which", "rustc"], options);
  const rustc = compiler.stdout?.trim();
  if (compiler.error || compiler.status !== 0 || !rustc || !isAbsolute(rustc))
    throw new Error("Could not locate the project Rust compiler.");
  const version = execute(rustc, ["-vV"], options);
  const host = version.stdout?.match(
    /^host: ([A-Za-z0-9][A-Za-z0-9_-]*)\r?$/m,
  )?.[1];
  if (version.error || version.status !== 0 || !host)
    throw new Error("Could not determine the Rust host target.");
  return host;
}

export function buildNativeApp(
  isolated,
  { release },
  environment = process.env,
) {
  const cli = resolve(root, "node_modules/@tauri-apps/cli/tauri.js");
  const host = rustHostTarget(environment);
  const targetDirectory = resolve(root, "target/native-smoke");
  const build = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../tools/run-coordinated.mjs", import.meta.url),
      ),
      "--resource",
      "build",
      "--",
      process.execPath,
      cli,
      "build",
      ...(release ? [] : ["--debug"]),
      "--no-bundle",
      "--target",
      host,
      "--features",
      "native-smoke",
      "--config",
      "src-tauri/tests/smoke.conf.json",
      "--config",
      JSON.stringify({ app: { appDirectoriesOverride: isolated.root } }),
      "--",
      "--locked",
      "--target-dir",
      targetDirectory,
    ],
    {
      cwd: resolve(root, "app"),
      stdio: "inherit",
      env: {
        ...nativeSmokeBuildEnvironment(environment),
        CARGO_BUILD_JOBS:
          environment.CARGO_BUILD_JOBS ??
          String(workerBudget(availableParallelism())),
        CARGO_TARGET_DIR: targetDirectory,
        VITE_NATIVE_SMOKE: "1",
      },
    },
  );
  if (build.error) throw build.error;
  if (build.status !== 0)
    throw new Error(
      `Native smoke build failed: ${build.status ?? build.signal}`,
    );
  return resolve(
    targetDirectory,
    host,
    release ? "release" : "debug",
    process.platform === "win32" ? "situate-client.exe" : "situate-client",
  );
}

export async function runNative(
  args = [],
  {
    environment = process.env,
    signal,
    isolate = withSmokeRoot,
    build = buildNativeApp,
    desktop = requireNativeDesktop,
    phase = runSmokePhase,
    sourceServer = startDocumentSourceServer,
  } = {},
) {
  const { diagnosticsOnly, documentSourcesOnly, profile, release } =
    parseSmokeOptions(args);
  const handoffOnly = environment.SITUATE_ONBOARDING_HANDOFF_ONLY === "1";
  const processOnly = environment.SITUATE_PROCESS_CONNECTION_ONLY === "1";
  if (
    documentSourcesOnly &&
    (process.platform !== "darwin" || processOnly || handoffOnly)
  )
    throw new Error(
      "Document source checks require macOS without another selected journey.",
    );
  if (processOnly && (process.platform !== "darwin" || diagnosticsOnly))
    throw new Error(
      "Offline process qualification requires macOS without diagnostics mode.",
    );
  desktop();
  await isolate(async (isolated) => {
    const executable = await build(isolated, { release }, environment);
    const options = {
      cwd: root,
      env: {
        ...isolated.env,
        ...(diagnosticsOnly ? { SITUATE_DIAGNOSTICS_SMOKE: "1" } : {}),
        SITUATE_DIAGNOSTICS_PROFILE: profile,
        SITUATE_PLUGIN_CHECKS_PHASE: undefined,
        SITUATE_PROCESS_CONNECTION_ONLY: undefined,
        SITUATE_DOCUMENT_SOURCE_ONLY: undefined,
        SITUATE_DOCUMENT_SOURCE_URL: undefined,
        SITUATE_PUBLIC_REPOSITORY_ONLY: undefined,
        SITUATE_PUBLIC_REPOSITORY_LIVE: undefined,
        SITUATE_ONBOARDING_HANDOFF_PHASE: undefined,
      },
      signal: signal,
      timeout: profile ? 120000 : 105000,
    };
    const processPhase = (mode) =>
      phase(executable, {
        ...options,
        phase: "offline process connection",
        timeout: 195000,
        env: {
          ...options.env,
          SITUATE_PLUGIN_CHECKS_PHASE: mode,
          SITUATE_PROCESS_CONNECTION_ONLY: "1",
        },
      });
    const documentSourcePhase = async (mode) => {
      const server = await sourceServer();
      try {
        await phase(executable, {
          ...options,
          phase: "direct document sources",
          timeout: 195000,
          env: {
            ...options.env,
            SITUATE_PLUGIN_CHECKS_PHASE: mode,
            SITUATE_DOCUMENT_SOURCE_ONLY: "1",
            SITUATE_DOCUMENT_SOURCE_URL: server.url,
          },
        });
        const report = server.report();
        if (
          !report.requests.length ||
          report.mutations !== 0 ||
          !report.requests.some((request) => request.authorized)
        )
          throw new Error(
            "Document source HTTP fixture did not observe authorized read-only access.",
          );
      } finally {
        await server.close();
      }
    };
    if (
      process.platform === "darwin" &&
      !processOnly &&
      !documentSourcesOnly &&
      !diagnosticsOnly
    ) {
      for (const handoff of ["create", "reopen"]) {
        await phase(executable, {
          ...options,
          phase: `onboarding handoff ${handoff}`,
          env: { ...options.env, SITUATE_ONBOARDING_HANDOFF_PHASE: handoff },
        });
      }
      if (handoffOnly) return;
    }
    if (documentSourcesOnly) {
      await documentSourcePhase("block");
    } else if (processOnly) {
      await processPhase("block");
    } else if (diagnosticsOnly) {
      await phase(executable, { ...options, phase: "diagnostics" });
    } else {
      await phase(executable, {
        ...options,
        env: { ...options.env, SITUATE_ENTRY_CLOSE_ONLY: "1" },
        phase: "entry window closure",
      });
      await phase(executable, {
        ...options,
        args: ["--recovery"],
        recovery: true,
      });
      await phase(executable, options);
      await phase(executable, {
        ...options,
        env: { ...options.env, SITUATE_PLUGIN_CHECKS_PHASE: "block" },
        phase: "blocking plugin view",
        timeout: 195000,
        expectedBlockingStage: "plugin-check-block-armed",
      });
      await phase(executable, {
        ...options,
        args: ["--recovery"],
        env: { ...options.env, SITUATE_PLUGIN_CHECKS_PHASE: "repair" },
        phase: "plugin repair in recovery",
      });
      await phase(executable, {
        ...options,
        env: { ...options.env, SITUATE_PLUGIN_CHECKS_PHASE: "repaired" },
        phase: "repaired plugin restart",
      });
      if (process.platform === "darwin") {
        await documentSourcePhase("repaired");
        await processPhase("repaired");
      }
    }
  });
}

export async function main(
  args = process.argv.slice(2),
  { environment = process.env, transport, local = runNative, remote } = {},
) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(signal, interrupt);
  try {
    parseSmokeOptions(args);
    transport ??= await import("../../tools/native-vm.mjs");
    if (transport.nativeVmConfiguration(environment)) {
      remote ??= (await import("./native-vm-host.mjs")).runNativeVm;
      return await remote("native", args, {
        environment,
        signal: controller.signal,
        transport,
      });
    }
    await local(args, { environment, signal: controller.signal });
    return 0;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.off(signal, interrupt);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main();
