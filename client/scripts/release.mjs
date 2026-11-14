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
  openSync,
  closeSync,
  lstatSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export function selectPlatforms(selection = "host", host = process.platform) {
  if (host !== "darwin")
    throw new Error("Local packages require a macOS build host.");
  if (!["host", "macos"].includes(selection))
    throw new Error("Local packages support --platform host or macos only.");
  return ["macos"];
}

export function buildSteps(platform, arch, triple) {
  if (platform !== "macos")
    throw new Error("Local packages support macOS only.");
  if (
    !["arm64", "x64"].includes(arch) ||
    !["aarch64-apple-darwin", "x86_64-apple-darwin"].includes(triple)
  )
    throw new Error("Unsupported macOS Rust host target.");
  return [
    [
      "build",
      "--ci",
      "--target",
      triple,
      "--bundles",
      "app,dmg",
      "--config",
      JSON.stringify({ bundle: { macOS: { signingIdentity: "-" } } }),
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

export function buildRelease({
  root,
  selected,
  host = process.platform,
  execute = run,
  environment = process.env,
}) {
  selectPlatforms(selected.join(","), host);
  const app = join(root, "app");
  const config = JSON.parse(
    readFileSync(join(app, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const rustInfo = execute("rustc", ["-vV"], { cwd: root, capture: true });
  const triple = rustInfo.match(/^host: (.+)$/m)?.[1].trim();
  const arch = {
    "aarch64-apple-darwin": "arm64",
    "x86_64-apple-darwin": "x64",
  }[triple];
  if (!arch) throw new Error("Unsupported macOS Rust host target.");
  const commands = buildSteps("macos", arch, triple);
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
  try {
    writeFileSync(
      handle,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    assertLocalPath(root, join(root, "artifacts"));
    mkdirSync(join(root, "artifacts"), { recursive: true });
    output = mkdtempSync(join(root, "artifacts", "release-"));
    report = {
      version: config.version,
      host,
      hostRustTarget: triple,
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
    for (const key of Object.keys(env))
      if (
        /^(APPLE_|TAURI_SIGNING_|ANDROID_KEY|ANDROID_SIGNING_|CSC_)/.test(
          key,
        ) ||
        key === "TAURI_CONFIG"
      )
        delete env[key];
    console.log(`Building macOS (${arch})…`);
    const source = join(target, triple, "release/bundle");
    // Only current build output may enter a release directory.
    assertLocalPath(root, source);
    rmSync(source, { recursive: true, force: true });
    for (const args of commands)
      execute(process.execPath, [cli, ...args], { cwd: app, env });
    const artifacts = collectArtifacts(source, [".app", ".dmg"]);
    for (const extension of [".app", ".dmg"])
      if (!artifacts.some((path) => path.endsWith(extension)))
        throw new Error(`Missing macOS artifact: ${extension}`);
    const directory = join(output, `macos-${arch}`);
    mkdirSync(directory);
    for (const artifact of artifacts) {
      const destination = join(directory, artifact.split(/[\\/]/).at(-1));
      cpSync(artifact, destination, {
        recursive: true,
        verbatimSymlinks: true,
      });
      report.artifacts.push(
        relative(output, destination).replaceAll("\\", "/"),
      );
    }
    report.completed.push("macos");
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
      },
    });
    if (values.help)
      console.log(`Usage: npm run release -- [--platform host|macos]

Builds an ad-hoc-signed macOS app and DMG for local testing on the host architecture.
These packages are not distribution-signed, notarized or published.
Prerequisites and toolchain setup: client/README.md.`);
    else
      buildRelease({
        root: fileURLToPath(new URL("../", import.meta.url)),
        selected: selectPlatforms(values.platform),
      });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
