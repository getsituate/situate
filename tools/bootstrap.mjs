#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { readImageLock } from "./ci-image.mjs";
import { createPlan } from "./test.mjs";
import { suiteExecution } from "./test-scope.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function prerequisites(
  directory = root,
  {
    coverage = false,
    extended = false,
    quick = false,
    suite = [],
    platform = process.platform,
    suites = createPlan(
      { coverage, extended, quick, suite, platform },
      directory,
    ).suites,
    readLock = readImageLock,
  } = {},
) {
  const checks = [];
  const add = (name, command, args, extra = {}) => {
    if (
      !checks.some(
        (check) =>
          check.command === command &&
          JSON.stringify(check.args) === JSON.stringify(args),
      )
    )
      checks.push({ name, command, args, ...extra });
  };
  add("Volta", "volta", ["--version"]);
  add("Git", "git", ["--version"]);
  if (quick) return checks;
  const execution = suiteExecution;
  const portable = suites.some((entry) => execution(entry) === "container");
  const docker = suites.some((entry) => execution(entry) === "host-docker");
  if (portable || docker) {
    add("Docker CLI", "docker", ["--version"]);
    add("Docker engine", "docker", ["info"]);
  }
  if (portable) {
    const lock = readLock(directory);
    add(
      "Pinned portable-check image",
      "docker",
      ["image", "inspect", lock.image, "--format", "{{.Os}}/{{.Architecture}}"],
      { expected: lock.platform },
    );
  }
  if (
    suites.some(
      (entry) =>
        execution(entry) === "host-docker" &&
        entry.id === "client-docker-context",
    )
  )
    add("Docker Buildx", "docker", ["buildx", "version"]);
  const native = suites.filter((entry) => execution(entry) === "native");
  if (native.length && platform !== "darwin") {
    checks.push({
      name: "Native macOS suites",
      problem: "Selected native suites require macOS.",
    });
    return checks;
  }
  for (const entry of native) {
    const args = entry.args ?? [];
    const rust = entry.command === "cargo" || entry.kind === "native";
    if (rust) {
      add("Rust toolchain", "cargo", ["--version"]);
      add("Rust compiler", "rustc", ["--version"]);
    }
    if (entry.command === "cargo" && args[0] === "clippy")
      add("Rust Clippy component", "cargo", ["clippy", "--version"]);
    if (entry.command === "cargo" && args[0] === "fmt")
      add("Rust formatting component", "cargo", ["fmt", "--version"]);
    if (entry.id === "client-rust-coverage") {
      add("Rust LLVM coverage tool", "cargo", ["llvm-cov", "--version"]);
      add(
        "Rust LLVM tools component",
        "rustup",
        ["component", "list", "--installed"],
        { pattern: /^llvm-tools(?:-|\s|$)/m },
      );
    }
    const swift =
      entry.command === "swift" ||
      entry.kind === "native" ||
      args.some((arg) => arg.endsWith("test-workspace-access-swift.mjs")) ||
      (entry.command === "cargo" &&
        entry.project === "client" &&
        args.includes("--workspace"));
    if (swift || (entry.command === "cargo" && entry.project === "client")) {
      add("Xcode", "xcodebuild", ["-version"]);
      add("Apple compiler", "xcrun", ["--find", "clang"]);
    }
    if (swift) add("Apple Swift", "swift", ["--version"]);
    if (entry.kind === "native") {
      add("Python for native qualification", "python3", ["--version"]);
    }
  }
  return checks;
}

export function toolchainProblems(pins, node, npm) {
  return Object.entries({ node, npm })
    .filter(([tool, version]) => version !== pins[tool])
    .map(
      ([tool, version]) =>
        `${tool} ${pins[tool]} (running ${version || "unavailable"}); use Volta with its shims first on PATH`,
    );
}

export function main(
  args = process.argv.slice(2),
  {
    directory = root,
    platform = process.platform,
    environment = process.env,
    nodeVersion = process.versions.node,
    execute = spawnSync,
    readLock = readImageLock,
    selectSuites = (options, location) => createPlan(options, location).suites,
    log = console.log,
    error = console.error,
  } = {},
) {
  const { values } = parseArgs({
    args,
    options: {
      coverage: { type: "boolean" },
      extended: { type: "boolean" },
      quick: { type: "boolean" },
      suite: { type: "string", multiple: true },
    },
  });
  const env = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USER",
      "TMPDIR",
      "TMP",
      "TEMP",
      "VOLTA_HOME",
      "RUSTUP_HOME",
      "CARGO_HOME",
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "DOCKER_CONFIG",
      "DOCKER_TLS_VERIFY",
      "DOCKER_CERT_PATH",
      "DOCKER_API_VERSION",
      "SSH_AUTH_SOCK",
      "DEVELOPER_DIR",
    ]
      .filter((key) => Object.hasOwn(environment, key))
      .map((key) => [key, environment[key]]),
  );
  const run = (command, arguments_) =>
    execute(command, arguments_, {
      cwd: directory,
      encoding: "utf8",
      timeout: 15000,
      stdio: "pipe",
      env,
    });
  const missing = [];
  try {
    const { volta } = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    );
    const npm = run("npm", ["--version"]);
    missing.push(
      ...toolchainProblems(
        volta,
        nodeVersion,
        npm.status === 0 ? npm.stdout?.trim() : undefined,
      ),
    );
    const suites = selectSuites({ ...values, platform }, directory);
    for (const check of prerequisites(directory, {
      ...values,
      platform,
      readLock,
      suites,
    })) {
      if (check.problem) {
        missing.push(check.problem);
        continue;
      }
      const result = run(check.command, check.args);
      if (
        result.status !== 0 ||
        (check.expected && result.stdout?.trim() !== check.expected) ||
        (check.pattern && !check.pattern.test(result.stdout ?? ""))
      )
        missing.push(
          `${check.name}: ${[check.command, ...check.args].join(" ")}`,
        );
    }
  } catch (cause) {
    missing.push(cause.message);
  }
  for (const item of missing) error(`Missing prerequisite: ${item}`);
  if (!missing.length)
    log(
      "Selected test prerequisites found. Runtime dependencies, permissions and device access still require execution.",
    );
  return missing.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = main();
