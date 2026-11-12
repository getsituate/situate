import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertLocalPath,
  run,
  sessionPaths,
  syncAppIcons,
} from "./ios-xcode.mjs";

export async function buildFromXcode(
  paths,
  args,
  {
    environment = process.env,
    signal,
    execute = run,
    schemeBuild = false,
  } = {},
) {
  const lock = join(paths.output, "build.lock");
  assertLocalPath(paths.root, lock);
  if (!existsSync(paths.output))
    throw new Error(
      "Start npm run ios:xcode in this checkout before building.",
    );
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      `Another Xcode build may be active. Check its processes before removing ${lock}.`,
      { cause: error },
    );
  }
  let keepLock = false;
  try {
    const session = join(paths.output, "session.lock/owner.json");
    if (!existsSync(session))
      throw new Error(
        "Start npm run ios:xcode, or regenerate with tauri ios init before using other Tauri iOS commands.",
      );
    const owner = JSON.parse(readFileSync(session, "utf8"));
    if (owner.kind !== "xcode")
      throw new Error(
        "Wait for the iOS release build to finish, then start npm run ios:xcode.",
      );
    const device = owner.mode === "device";
    if (
      environment.PLATFORM_NAME !== (device ? "iphoneos" : "iphonesimulator")
    ) {
      throw new Error(
        device
          ? "Select a physical iPhone destination in Xcode, or restart npm run ios:xcode without --device for Simulator hot reload."
          : "Select an iOS Simulator destination in Xcode, or restart npm run ios:xcode -- --device to install on an iPhone.",
      );
    }
    if (!Number.isInteger(owner.pid) || owner.pid <= 0)
      throw new Error("Invalid iOS session owner. Restart npm run ios:xcode.");
    try {
      process.kill(owner.pid, 0);
    } catch {
      throw new Error(
        "The iOS development session has ended. Restart npm run ios:xcode.",
      );
    }
    writeFileSync(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, sessionPid: owner.pid }),
    );
    keepLock = schemeBuild;
    const env = {
      ...environment,
      PATH: [dirname(process.execPath), environment.PATH]
        .filter(Boolean)
        .join(":"),
    };
    // Without npm markers, Tauri resolves src-tauri two levels above gen/apple.
    for (const key of [
      "npm_lifecycle_event",
      "npm_config_user_agent",
      "PNPM_PACKAGE_NAME",
      "RUSTUP_TOOLCHAIN",
      "TAURI_CONFIG",
    ])
      delete env[key];
    syncAppIcons(paths);
    // Xcode can rebuild repeatedly during one Tauri session; refresh assets before
    // Rust embeds them rather than relying on the session's beforeBuildCommand.
    if (device)
      await execute("npm", ["run", "build"], { cwd: paths.root, env, signal });
    await execute(
      process.execPath,
      [paths.cli, "ios", "xcode-script", ...args],
      { cwd: paths.apple, env, signal },
    );
  } finally {
    if (!keepLock) rmSync(lock, { recursive: true, force: true });
  }
}

export function finishBuild(paths, sessionPid) {
  const lock = join(paths.output, "build.lock");
  assertLocalPath(paths.root, lock);
  if (!existsSync(join(lock, "owner.json"))) return;
  const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
  if (owner.sessionPid !== sessionPid)
    throw new Error("The Xcode build belongs to a different iOS session.");
  rmSync(lock, { recursive: true });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Xcode build cancelled."));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("SIGHUP", stop);
  try {
    const paths = sessionPaths(fileURLToPath(new URL("../", import.meta.url)));
    const args = process.argv.slice(2);
    if (args[0] === "--finish-build") finishBuild(paths, Number(args[1]));
    else {
      const schemeBuild = args[0] === "--scheme-build";
      await buildFromXcode(paths, schemeBuild ? args.slice(1) : args, {
        signal: controller.signal,
        schemeBuild,
      });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
  }
}
