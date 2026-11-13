import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readImageLock } from "./ci-image.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function prerequisites(lane) {
  const suites = new Set(lane.suites);
  return {
    image: lane.host === "linux",
    rust:
      lane.host === "macos" &&
      [...suites].some((id) =>
        /^(dev-tui|client-(agent-runtime|migrations|core|host|format|clippy|native|agent-e2e|onboarding-e2e|plugins-e2e|rust-coverage)|root-rust)/.test(
          id,
        ),
      ),
    cargoDeny: suites.has("root-rust"),
    gitleaks: lane.host === "macos" && suites.has("root-secrets"),
    coverage: suites.has("client-rust-coverage"),
    swiftTools: suites.has("root-swift"),
    swift: [...suites].some((id) => /swift|native|e2e/.test(id)),
    browsers: suites.has("client-browser"),
    native: [...suites].some((id) =>
      /client-(native|agent-e2e|onboarding-e2e|plugins-e2e)/.test(id),
    ),
  };
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Prerequisite failed: ${command}`);
  return result.stdout;
}
export async function prepareLane(
  lane,
  {
    directory = root,
    environment = process.env,
    execute = run,
    platform = process.platform,
  } = {},
) {
  const selected = prerequisites(lane);
  if (selected.image) {
    const lock = readImageLock(directory);
    execute("docker", ["pull", "--platform", "linux/amd64", lock.image]);
    return selected;
  }
  if (platform !== "darwin")
    throw new Error("Selected prerequisites require macOS.");
  const temporary = mkdtempSync(
    join(environment.RUNNER_TEMP ?? tmpdir(), "situate-tools-"),
  );
  const bin = join(temporary, "bin");
  mkdirSync(bin);
  const pins = JSON.parse(
    readFileSync(join(directory, "tools/toolchain.quality.json"), "utf8"),
  );
  const coordinated = (command, args, cwd = directory) =>
    execute(
      process.execPath,
      [join(directory, "tools/run-coordinated.mjs"), "--", command, ...args],
      { cwd },
    );
  if (selected.rust) {
    for (const packageDirectory of ["client", "tools/dev-tui"].filter((name) =>
      name === "client"
        ? lane.suites.some(
            (id) => id.startsWith("client-") || id === "root-rust",
          )
        : lane.suites.some((id) => id.startsWith("dev-tui")),
    )) {
      const toolchain = readFileSync(
        join(directory, packageDirectory, "rust-toolchain.toml"),
        "utf8",
      ).match(/channel\s*=\s*"([^"]+)"/)?.[1];
      if (!/^\d+\.\d+\.\d+$/.test(toolchain ?? ""))
        throw new Error("Missing pinned Rust toolchain.");
      coordinated("rustup", [
        "toolchain",
        "install",
        toolchain,
        "--profile",
        "minimal",
        "--component",
        "clippy",
        "--component",
        "rustfmt",
        ...(selected.coverage ? ["--component", "llvm-tools"] : []),
      ]);
      coordinated(
        "rustup",
        ["run", toolchain, "cargo", "fetch", "--locked"],
        join(directory, packageDirectory),
      );
    }
  }
  if (selected.coverage)
    coordinated(
      "cargo",
      [
        "install",
        "--locked",
        "--version",
        `=${pins["cargo-llvm-cov"].version}`,
        "--root",
        temporary,
        "cargo-llvm-cov",
      ],
      join(directory, "client"),
    );
  if (selected.cargoDeny)
    coordinated(
      "cargo",
      [
        "install",
        "--locked",
        "--version",
        `=${pins["cargo-deny"].version}`,
        "--root",
        temporary,
        "cargo-deny",
      ],
      join(directory, "client"),
    );
  if (selected.gitleaks) {
    if (pins.gitleaks.version !== "8.24.3")
      throw new Error(
        "Update reviewed macOS Gitleaks archive digests for the selected version.",
      );
    const hashes = {
      arm64: "b90f13bb8c90ab72083d9b0c842e39dafb82c0e5c3f872f407366b7a58909013",
      x64: "41c44ae8ad1d6eef57d4526ad0fd67d8129eee9a856f55c2b3b9395fd3d9ec0f",
    };
    const checksum = hashes[process.arch];
    if (!checksum) throw new Error("Unsupported macOS tool architecture.");
    const archive = join(temporary, "gitleaks.tar.gz");
    execute("curl", [
      "--fail",
      "--location",
      `https://github.com/gitleaks/gitleaks/releases/download/v${pins.gitleaks.version}/gitleaks_${pins.gitleaks.version}_darwin_${process.arch}.tar.gz`,
      "-o",
      archive,
    ]);
    if (
      createHash("sha256").update(readFileSync(archive)).digest("hex") !==
      checksum
    )
      throw new Error("Gitleaks archive digest mismatch.");
    execute("tar", ["-xzf", archive, "-C", bin, "gitleaks"]);
    rmSync(archive);
  }
  if (selected.swiftTools) {
    const source = join(temporary, "swift-format");
    execute("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      pins["swift-format"].version,
      "https://github.com/swiftlang/swift-format.git",
      source,
    ]);
    const revision = execute("git", ["-C", source, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (revision.trim() !== pins["swift-format"].revision)
      throw new Error("Swift formatter source revision mismatch.");
    coordinated("swift", [
      "build",
      "--package-path",
      source,
      "-c",
      "release",
      "--product",
      "swift-format",
    ]);
    copyFileSync(
      join(source, ".build/release/swift-format"),
      join(bin, "swift-format"),
    );
    const archive = join(temporary, "swiftlint.zip");
    execute("curl", [
      "--fail",
      "--location",
      `https://github.com/realm/SwiftLint/releases/download/${pins.swiftlint.version}/portable_swiftlint.zip`,
      "-o",
      archive,
    ]);
    if (
      createHash("sha256").update(readFileSync(archive)).digest("hex") !==
      pins.swiftlint.sha256
    )
      throw new Error("SwiftLint archive digest mismatch.");
    const extracted = join(temporary, "swiftlint");
    execute("unzip", ["-q", archive, "-d", extracted]);
    copyFileSync(join(extracted, "swiftlint"), join(bin, "swiftlint"));
    chmodSync(join(bin, "swiftlint"), 0o755);
    rmSync(archive);
  }
  if (selected.swift || selected.swiftTools || selected.native) {
    execute("xcodebuild", ["-version"]);
    execute("xcrun", ["--find", "swift"]);
    execute("swift", ["--version"]);
  }
  if (selected.browsers || selected.native) {
    execute(process.execPath, [join(directory, "tools/npm-ci.mjs"), "client"]);
    if (selected.browsers)
      coordinated(
        "npx",
        ["--no-install", "playwright", "install", "chromium", "webkit"],
        join(directory, "client"),
      );
  }
  if (selected.native) {
    execute("launchctl", ["print", `gui/${process.getuid()}`]);
    execute("xcrun", ["--find", "clang"]);
    execute("python3", ["--version"]);
  }
  if (environment.GITHUB_PATH)
    appendFileSync(environment.GITHUB_PATH, `${bin}\n`);
  return selected;
}
export function linuxLaneArguments(
  directory,
  stateDirectory,
  workflow,
  lane,
  image,
  uid = process.getuid(),
  gid = process.getgid(),
) {
  return [
    "run",
    "--rm",
    "--pull",
    "never",
    "--platform",
    "linux/amd64",
    "--user",
    `${uid}:${gid}`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--env",
    "HOME=/tmp/home",
    "--env",
    "CARGO_HOME=/tmp/cargo",
    "--env",
    "npm_config_cache=/tmp/npm",
    "--env",
    "CI=true",
    "--volume",
    `${directory}:/workspace`,
    "--volume",
    `${stateDirectory}:/pipeline-state`,
    "--workdir",
    "/workspace",
    image,
    "bash",
    "-c",
    'source /opt/ci-tools/ci-user.sh; exec /opt/volta/bin/node "$@"',
    "--",
    "tools/pipeline.mjs",
    "run",
    workflow,
    "--plan",
    "/pipeline-state/plan.json",
    "--lane",
    lane,
    "--receipt",
    "/pipeline-state/runner.json",
  ];
}
