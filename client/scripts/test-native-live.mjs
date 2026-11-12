import { spawnSync } from "node:child_process";
import { nativeSmokeBuildEnvironment } from "../../tools/compiler-cache.mjs";
import { nativeVmConfiguration } from "../../tools/native-vm.mjs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { withSmokeRoot } from "./native-smoke-runtime.mjs";
import { requireNativeDesktop } from "./native-desktop-session.mjs";
import { runCoordinatedSmokePhase as runSmokePhase } from "./coordinated-native-smoke.mjs";

if (
  process.argv[2] !== "--live" ||
  process.argv.length > 4 ||
  (process.argv[3] !== undefined && process.argv[3] !== "--connection-only")
)
  throw new Error(
    "Usage: node client/scripts/test-native-live.mjs --live [--connection-only] (public GitHub GET requests, no authentication)",
  );
if (process.platform !== "darwin")
  throw new Error("Public repository qualification requires macOS.");
if (nativeVmConfiguration())
  throw new Error(
    "Public repository live qualification requires explicit local execution: set SITUATE_NATIVE_EXECUTOR=local.",
  );
requireNativeDesktop();
const root = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(root, "target/native-smoke");
const rustc = spawnSync("rustc", ["-vV"], { cwd: root, encoding: "utf8" });
const host = rustc.stdout?.match(/^host: (.+)$/m)?.[1].trim();
if (rustc.error || rustc.status !== 0 || !host)
  throw new Error("Could not determine the Rust host target.");
const controller = new AbortController();
const interrupt = () => controller.abort();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, interrupt);
const failures = [];
try {
  await withSmokeRoot(async (isolated) => {
    const build = spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
        "build",
        "--debug",
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
        target,
      ],
      {
        cwd: resolve(root, "app"),
        stdio: "inherit",
        env: {
          ...nativeSmokeBuildEnvironment(),
          CARGO_TARGET_DIR: target,
          VITE_NATIVE_SMOKE: "1",
        },
      },
    );
    if (build.error) throw build.error;
    if (build.status !== 0)
      throw new Error(
        `Native live build failed: ${build.status ?? build.signal}`,
      );
    await runSmokePhase(resolve(target, host, "debug/situate-client"), {
      cwd: root,
      signal: controller.signal,
      phase: "public repository live qualification",
      timeout: 195000,
      env: {
        ...isolated.env,
        SITUATE_PLUGIN_CHECKS_PHASE: "block",
        SITUATE_PUBLIC_REPOSITORY_ONLY: "1",
        SITUATE_PUBLIC_REPOSITORY_LIVE: "1",
      },
    });
  });
} catch (error) {
  failures.push(error);
} finally {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.off(signal, interrupt);
}
if (!controller.signal.aborted && process.argv[3] !== "--connection-only") {
  process.argv = process.argv.slice(0, 2);
  try {
    const { main } = await import("./test-native.mjs");
    const code = await main([]);
    if (code !== 0) throw new Error(`Native suite failed (exit ${code}).`);
  } catch (error) {
    failures.push(error);
  }
}
if (failures.length)
  throw new AggregateError(
    failures,
    "Native qualification did not complete successfully.",
  );
