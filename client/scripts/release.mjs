import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  openSync,
  closeSync,
  lstatSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { acquireIosProject } from "./ios-project-lock.mjs";

const desktops = { darwin: "macos", win32: "windows", linux: "linux" };
const platforms = ["macos", "windows", "linux", "android", "ios"];

export function selectPlatforms(
  selection = "host",
  host = process.platform,
  windowsCross = false,
) {
  if (windowsCross && (host !== "linux" || selection !== "windows")) {
    throw new Error(
      "Windows cross-compilation requires a Linux host and --platform windows.",
    );
  }
  const desktop = desktops[host];
  if (!desktop) throw new Error(`Unsupported build host: ${host}`);
  const available = [
    desktop,
    "android",
    ...(host === "darwin" ? ["ios"] : []),
    ...(windowsCross ? ["windows"] : []),
  ];
  const selected =
    selection === "host"
      ? [desktop]
      : selection === "all"
        ? available
        : [...new Set(selection.split(","))];
  for (const platform of selected) {
    if (!platforms.includes(platform))
      throw new Error(`Unknown platform: ${platform}`);
    if (!available.includes(platform))
      throw new Error(
        `${platform} requires its native build host; current host is ${desktop}.`,
      );
  }
  return selected;
}

export function buildSteps(platform, arch, triple, windowsCross = false) {
  if (platform === "android") {
    return [
      ["android", "init", "--ci", "--skip-targets-install"],
      ["android", "build", "--ci", "--target", "aarch64", "x86_64", "--apk"],
    ];
  }
  if (platform === "ios") {
    if (!["arm64", "x64"].includes(arch))
      throw new Error(`Unsupported iOS Simulator host architecture: ${arch}`);
    return [
      ["ios", "init", "--ci", "--skip-targets-install"],
      [
        "ios",
        "build",
        "--ci",
        "--target",
        arch === "arm64" ? "aarch64-sim" : "x86_64",
        "--no-sign",
      ],
    ];
  }
  const bundles = { macos: "app,dmg", windows: "nsis", linux: "deb,appimage" }[
    platform
  ];
  if (!bundles) throw new Error(`Unknown platform: ${platform}`);
  const signing =
    platform === "macos"
      ? [
          "--config",
          JSON.stringify({ bundle: { macOS: { signingIdentity: "-" } } }),
        ]
      : ["--no-sign"];
  return [
    [
      "build",
      "--ci",
      "--target",
      triple,
      "--bundles",
      bundles,
      ...signing,
      ...(windowsCross ? ["--runner", "cargo-xwin"] : []),
      "--no-binary-patching",
      "--",
      "--locked",
    ],
  ];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error)
    throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `${command} failed (exit ${result.status ?? result.signal}).${result.stderr ? `\n${result.stderr}` : ""}`,
    );
  return result.stdout ?? "";
}

export function collectArtifacts(directory, extensions) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (
      extensions.some(
        (extension) =>
          entry.name.endsWith(extension) &&
          (extension === ".app" ? entry.isDirectory() : entry.isFile()),
      )
    )
      return [path];
    return entry.isDirectory() ? collectArtifacts(path, extensions) : [];
  });
}

export function assertLocalPath(root, path) {
  const parts = relative(root, path).split(/[\\/]/);
  if (parts.includes("..") || resolve(root, ...parts) !== resolve(path))
    throw new Error("Build output must remain inside the client directory.");
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error(
        `Build output must not traverse a symbolic link: ${current}`,
      );
  }
}

function signAndroid(source, destination, root, env, execute, host) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!sdk || !env.JAVA_HOME)
    throw new Error("Android packaging requires ANDROID_HOME and JAVA_HOME.");
  const tools = join(sdk, "build-tools", "36.0.0");
  const executable = (name) => `${name}${host === "win32" ? ".exe" : ""}`;
  const java = join(env.JAVA_HOME, "bin", executable("java"));
  const keytool = join(env.JAVA_HOME, "bin", executable("keytool"));
  const keystore = join(
    root,
    "target",
    "local-release",
    "android-test.keystore",
  );
  const aligned = join(root, "target", "local-release", "android-aligned.apk");
  if (!existsSync(keystore)) {
    execute(
      keytool,
      [
        "-genkeypair",
        "-noprompt",
        "-keystore",
        keystore,
        "-storepass",
        "android",
        "-keypass",
        "android",
        "-alias",
        "androiddebugkey",
        "-dname",
        "CN=Situate Local Testing",
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "10000",
      ],
      { env },
    );
    chmodSync(keystore, 0o600);
  }
  execute(
    join(tools, executable("zipalign")),
    ["-f", "-P", "16", "4", source, aligned],
    { env },
  );
  execute(
    java,
    [
      "-jar",
      join(tools, "lib", "apksigner.jar"),
      "sign",
      "--ks",
      keystore,
      "--ks-key-alias",
      "androiddebugkey",
      "--ks-pass",
      "pass:android",
      "--key-pass",
      "pass:android",
      "--out",
      destination,
      aligned,
    ],
    { env },
  );
  execute(
    java,
    ["-jar", join(tools, "lib", "apksigner.jar"), "verify", destination],
    { env },
  );
  rmSync(aligned, { force: true });
}

export function buildRelease({
  root,
  selected,
  host = process.platform,
  arch = process.arch,
  execute = run,
  environment = process.env,
  windowsCross = false,
  acceptWindowsSdkLicense = false,
}) {
  selectPlatforms(selected.join(","), host, windowsCross);
  if (windowsCross && !acceptWindowsSdkLicense) {
    throw new Error(
      "cargo-xwin downloads Microsoft SDK/CRT components and treats use as license acceptance. Review the terms linked in client/docker/README.md, then pass --accept-windows-sdk-license.",
    );
  }
  const app = join(root, "app");
  const native = join(app, "src-tauri");
  const config = JSON.parse(
    readFileSync(join(native, "tauri.conf.json"), "utf8"),
  );
  const rustInfo = execute("rustc", ["-vV"], { cwd: root, capture: true });
  const hostTriple = rustInfo.match(/^host: (.+)$/m)?.[1].trim();
  if (!hostTriple) throw new Error("Could not determine the Rust host target.");
  const triple = windowsCross ? "x86_64-pc-windows-msvc" : hostTriple;
  arch = { aarch64: "arm64", x86_64: "x64" }[triple.split("-")[0]];
  if (!arch) throw new Error(`Unsupported Rust host target: ${triple}`);
  const steps = selected.map((platform) => ({
    platform,
    steps: buildSteps(platform, arch, triple, windowsCross),
  }));
  if (
    selected.includes("android") &&
    (!(environment.ANDROID_HOME || environment.ANDROID_SDK_ROOT) ||
      !environment.JAVA_HOME)
  ) {
    throw new Error("Android packaging requires ANDROID_HOME and JAVA_HOME.");
  }

  const target = join(root, "target", "local-release");
  assertLocalPath(root, target);
  mkdirSync(target, { recursive: true });
  const cacheTag = join(target, "CACHEDIR.TAG");
  if (!existsSync(cacheTag))
    writeFileSync(cacheTag, "Signature: 8a477f597d28d172789f06886806bc55\n");
  const lock = join(target, "build.lock");
  let handle;
  try {
    handle = openSync(lock, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      `A release lock already exists: ${lock}. Check its owner and any remaining native build processes before removing it.`,
      { cause: error },
    );
  }
  let output;
  let report;
  let unlockIos;
  try {
    writeFileSync(
      handle,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    if (selected.includes("ios"))
      unlockIos = acquireIosProject(root, "release");
    assertLocalPath(root, join(root, "artifacts"));
    mkdirSync(join(root, "artifacts"), { recursive: true });
    output = mkdtempSync(join(root, "artifacts", "release-"));
    report = {
      version: config.version,
      host,
      hostRustTarget: hostTriple,
      architecture: arch,
      rustTarget: triple,
      requested: selected,
      status: "building",
      completed: [],
      artifacts: [],
    };
    const saveReport = () =>
      writeFileSync(
        join(output, "manifest.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    saveReport();
    const cli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
    // Local test packages must not inherit release-signing or notarization credentials.
    const env = { ...environment, CARGO_TARGET_DIR: target };
    for (const key of Object.keys(env)) {
      if (
        /^(APPLE_|TAURI_SIGNING_|ANDROID_KEY|ANDROID_SIGNING_|CSC_)/.test(
          key,
        ) ||
        key === "TAURI_CONFIG"
      )
        delete env[key];
    }
    for (const { platform, steps: commands } of steps) {
      console.log(
        `Building ${platform} (${platform === "android" ? "ARM64 + x86_64" : arch})…`,
      );
      const source =
        platform === "android"
          ? join(native, "gen/android/app/build/outputs/apk/universal/release")
          : platform === "ios"
            ? join(
                native,
                "gen/apple/build",
                arch === "arm64" ? "arm64-sim" : "x86_64",
              )
            : join(target, triple, "release/bundle");
      // Only current build output may enter a release directory.
      assertLocalPath(root, source);
      rmSync(source, { recursive: true, force: true });
      for (const args of commands)
        execute(process.execPath, [cli, ...args], { cwd: app, env });
      const extensions = {
        macos: [".app", ".dmg"],
        windows: [".exe"],
        linux: [".deb", ".AppImage"],
        android: [".apk"],
        ios: [".app"],
      }[platform];
      const artifacts = collectArtifacts(source, extensions);
      for (const extension of extensions) {
        if (!artifacts.some((path) => path.endsWith(extension)))
          throw new Error(`Missing ${platform} artifact: ${extension}`);
      }
      const directory = join(
        output,
        platform === "ios"
          ? `ios-simulator-${arch}`
          : platform === "android"
            ? "android-arm64-x86_64"
            : `${platform}-${arch}`,
      );
      mkdirSync(directory);
      for (const artifact of artifacts) {
        const destination = join(
          directory,
          artifact
            .split(/[\\/]/)
            .at(-1)
            .replace("-unsigned.apk", "-local-test.apk"),
        );
        if (platform === "android")
          signAndroid(artifact, destination, root, env, execute, host);
        else
          cpSync(artifact, destination, {
            recursive: true,
            verbatimSymlinks: true,
          });
        report.artifacts.push(
          relative(output, destination).replaceAll("\\", "/"),
        );
      }
      report.completed.push(platform);
      saveReport();
    }
    report.status = "complete";
    saveReport();
    console.log(`Local test artifacts: ${output}`);
    return output;
  } catch (error) {
    if (report) {
      report.status = "failed";
      writeFileSync(
        join(output, "manifest.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      console.error(`Incomplete build: ${output}`);
    }
    throw error;
  } finally {
    unlockIos?.();
    closeSync(handle);
    rmSync(lock);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { values } = parseArgs({
      options: {
        platform: { type: "string", default: "host" },
        help: { type: "boolean" },
        "windows-cross": { type: "boolean" },
        "accept-windows-sdk-license": { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(`Usage: npm run release -- [--platform host|all|macos,windows,linux,android,ios]

Default: the current desktop platform. A comma-separated list selects multiple targets.
"all" builds the current desktop platform, Android, and iOS Simulator on macOS.
Other desktop platforms normally require their own native host or VM.
Linux hosts can opt into Windows NSIS cross-builds with --windows-cross --accept-windows-sdk-license.
Container setup and Microsoft license information: client/docker/README.md.
Android APKs use a local test key; macOS uses ad-hoc signing. No packages are distribution-signed.
Prerequisites and toolchain setup: client/README.md. No uploads or publishing are performed.`);
    } else {
      const selected = selectPlatforms(
        values.platform,
        process.platform,
        values["windows-cross"],
      );
      console.log(
        `Selected: ${selected.join(", ")}. Other platforms are not built by this invocation.`,
      );
      buildRelease({
        root: fileURLToPath(new URL("../", import.meta.url)),
        selected,
        windowsCross: values["windows-cross"],
        acceptWindowsSdkLicense: values["accept-windows-sdk-license"],
      });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
