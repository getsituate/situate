import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { runCoordinated } from "../../tools/run-coordinated.mjs";
import { withSmokeRoot } from "./native-smoke-runtime.mjs";
import { requireNativeDesktop } from "./native-desktop-session.mjs";

const client = fileURLToPath(new URL("../", import.meta.url));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed: ${result.stderr ?? result.status}`);
  return result.stdout;
}

export function buildScreenshotApp(root, isolated, execute = run) {
  const host = execute("rustc", ["-vV"], { cwd: root })
    .match(/^host: (.+)$/mu)?.[1]
    .trim();
  if (!host) throw new Error("Could not determine the Rust host target.");
  const target = resolve(root, "target/native-visual");
  execute(
    process.execPath,
    [
      resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
      "build",
      "--debug",
      "--no-bundle",
      "--target",
      host,
      "--config",
      "src-tauri/tests/visual.conf.json",
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
      env: { ...process.env, CARGO_TARGET_DIR: target },
    },
  );
  return resolve(target, host, "debug/situate-client");
}

export async function captureScreenshot({
  root,
  output,
  pid,
  executable,
  signal,
}) {
  signal?.throwIfAborted();
  requireNativeDesktop();
  let owned;
  let scratch;
  try {
    if (executable) {
      owned = spawn(executable, [], { cwd: root, stdio: "inherit" });
      await new Promise((resolve, reject) => {
        owned.once("spawn", resolve);
        owned.once("error", reject);
      });
      pid = String(owned.pid);
    }
    const deadline = Date.now() + 20000;
    let windows = [];
    while (Date.now() < deadline && !windows.length) {
      signal?.throwIfAborted();
      windows = JSON.parse(
        run("swift", [resolve(root, "scripts/window-info.swift"), pid]),
      );
      if (!windows.length) await delay(250, undefined, { signal });
    }
    if (!windows.length)
      throw new Error("No visible application window found for this process.");
    if (windows.length > 1)
      throw new Error(
        "More than one window is visible. Hide the other windows before capturing.",
      );
    // Window visibility precedes the first WebView paint on a cold launch.
    if (owned) await delay(1000, undefined, { signal });
    signal?.throwIfAborted();
    scratch = await mkdtemp(resolve(dirname(output), ".situate-capture-"));
    const captured = resolve(scratch, "window.png");
    run("/usr/sbin/screencapture", [
      "-x",
      "-o",
      "-l",
      String(windows[0].id),
      captured,
    ]);
    if ((await stat(captured)).size === 0)
      throw new Error(
        "No image was captured. Check macOS Screen Recording permission for the terminal.",
      );
    await copyFile(captured, output, constants.COPYFILE_EXCL);
    console.log(output);
  } finally {
    try {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    } finally {
      if (owned && owned.exitCode === null && owned.signalCode === null) {
        const exited = new Promise((resolve) => {
          owned.once("exit", resolve);
        });
        owned.kill("SIGTERM");
        await Promise.race([exited, delay(2000, undefined, { ref: false })]);
        if (owned.exitCode === null && owned.signalCode === null) {
          owned.kill("SIGKILL");
          await exited;
        }
      }
    }
  }
}

export async function screenshotNative(
  args = process.argv.slice(2),
  {
    root = client,
    platform = process.platform,
    build = buildScreenshotApp,
    coordinate = runCoordinated,
    signal,
  } = {},
) {
  const { values } = parseArgs({
    args,
    options: {
      pid: { type: "string" },
      output: { type: "string" },
      launch: { type: "boolean" },
    },
  });
  if (platform !== "darwin")
    throw new Error(
      "Native window capture currently requires macOS. Use screenshots:workspaces for portable browser captures.",
    );
  if (Boolean(values.pid) === Boolean(values.launch))
    throw new Error(
      "Choose --pid <native app process ID> or --launch (isolated visual application).",
    );
  if (values.pid && !/^[1-9][0-9]*$/u.test(values.pid))
    throw new Error("The process ID must be a positive integer.");
  signal?.throwIfAborted();
  const output = resolve(
    values.output ?? resolve(root, "test-results/native-workspace.png"),
  );
  await mkdir(dirname(output), { recursive: true });
  try {
    await lstat(output);
    throw new Error("The screenshot already exists. Choose a new output path.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const capture = async (isolated) => {
    const executable = isolated ? await build(root, isolated) : undefined;
    signal?.throwIfAborted();
    const code = await coordinate({
      directory: root,
      resource: "desktop",
      command: process.execPath,
      args: [
        fileURLToPath(
          new URL("./screenshot-native-phase.mjs", import.meta.url),
        ),
        JSON.stringify({ root, output, pid: values.pid, executable }),
      ],
      environment: { ...process.env, ...isolated?.env },
      signal,
    });
    if (code !== 0)
      throw new Error(`Native window capture failed: exit ${code}`);
  };
  if (values.launch) await withSmokeRoot(capture);
  else await capture();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, interrupt);
  try {
    await screenshotNative(process.argv.slice(2), {
      signal: controller.signal,
    });
  } finally {
    for (const signal of signals) process.off(signal, interrupt);
  }
}
