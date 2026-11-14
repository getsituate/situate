import { appendFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readImageLock } from "./ci-image.mjs";
import { suiteHost } from "./test-scope.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function prerequisites(lane) {
  const suites = new Set(lane.suites);
  return {
    image: lane.host === "linux" && lane.execution !== "host-docker",
    docker: lane.execution === "host-docker",
    rust:
      lane.host === "macos" &&
      [...suites].some((id) => /^(dev-tui|client-)/.test(id)),
    coverage: suites.has("client-rust-coverage"),
    swift:
      lane.host === "macos" &&
      [...suites].some((id) => /swift|native|e2e|host|core-macos/.test(id)),
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
  if (selected.docker) {
    execute("docker", ["info"]);
    execute("docker", ["buildx", "version"]);
    return selected;
  }
  if (selected.image) {
    if (
      environment.SITUATE_TOOL_CONTAINER !== "1" ||
      environment.SITUATE_CI_IMAGE !== readImageLock(directory).image
    )
      throw new Error(
        "Use the pinned tool-container launcher for portable checks.",
      );
    return selected;
  }
  if (platform !== "darwin")
    throw new Error("Selected prerequisites require macOS.");
  if (lane.suites.some((id) => suiteHost({ id }) !== "macos"))
    throw new Error(
      "Portable suites must use the tool image, not macOS setup.",
    );
  const temporary = mkdtempSync(
    join(environment.RUNNER_TEMP ?? tmpdir(), "situate-tools-"),
  );
  const bin = join(temporary, "bin");
  mkdirSync(bin);
  const coordinated = (command, args, cwd = directory) =>
    execute(
      process.execPath,
      [join(directory, "tools/run-coordinated.mjs"), "--", command, ...args],
      { cwd },
    );
  if (selected.rust) {
    for (const packageDirectory of ["client", "tools/dev-tui"].filter((name) =>
      name === "client"
        ? lane.suites.some((id) => id.startsWith("client-"))
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
  if (selected.coverage) {
    const pins = JSON.parse(
      readFileSync(join(directory, "tools/toolchain.quality.json"), "utf8"),
    );
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
  }
  if (selected.swift || selected.native || selected.coverage) {
    execute("xcodebuild", ["-version"]);
    execute("xcrun", ["--find", "swift"]);
    execute("swift", ["--version"]);
  }
  if (selected.native) {
    execute(process.execPath, [join(directory, "tools/npm-ci.mjs"), "client"]);
    execute("launchctl", ["print", `gui/${process.getuid()}`]);
    execute("xcrun", ["--find", "clang"]);
    execute("python3", ["--version"]);
  }
  if (environment.GITHUB_PATH)
    appendFileSync(environment.GITHUB_PATH, `${bin}\n`);
  return selected;
}
