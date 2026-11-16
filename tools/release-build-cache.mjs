import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compilerCacheEnvironment } from "./compiler-cache.mjs";

const repository = "getsituate/situate";
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function trustedReleaseCacheHost(env) {
  return (
    env.CI === "true" &&
    env.GITHUB_ACTIONS === "true" &&
    env.RUNNER_ENVIRONMENT === "github-hosted" &&
    env.RUNNER_OS === "macOS" &&
    ["ARM64", "X64"].includes(env.RUNNER_ARCH) &&
    env.GITHUB_REPOSITORY === repository &&
    env.GITHUB_REF === "refs/heads/main" &&
    env.GITHUB_REF_PROTECTED === "true" &&
    env.GITHUB_EVENT_NAME === "push" &&
    env.GITHUB_WORKFLOW_REF ===
      `${repository}/.github/workflows/release-macos.yml@refs/heads/main` &&
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
    isAbsolute(env.HOME ?? "") &&
    !/[\r\n]/.test(env.HOME)
  );
}

export function releaseCachePaths(env) {
  const root = join(env.HOME, "Library/Caches/situate/release-build-v1");
  return {
    compiler: join(root, "sccache"),
    cargoHome: join(root, "cargo"),
    downloads: [
      join(root, "cargo/registry/cache/index.crates.io-1949cf8c6b5b557f"),
      join(root, "cargo/registry/index/index.crates.io-1949cf8c6b5b557f"),
    ],
  };
}

export function releaseCompilerCacheEnvironment(env, options = {}) {
  if (env.SITUATE_RELEASE_BUILD_CACHE !== "1" || !trustedReleaseCacheHost(env))
    return {};
  const paths = releaseCachePaths(env);
  const configured = compilerCacheEnvironment(
    { PATH: env.PATH },
    {
      ...options,
      platform: "darwin",
      configuration: {
        HOME: env.HOME,
        SCCACHE_DIR: paths.compiler,
        SCCACHE_CACHE_SIZE: "2G",
      },
    },
  );
  delete configured.PATH;
  if (configured.RUSTC_WRAPPER) configured.SCCACHE_SERVER_PORT = "4228";
  return configured;
}

const probe = (command, args, options) =>
  execFileSync(command, args, {
    ...options,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 16384,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

export function releaseBuildCachePlan({
  env = process.env,
  root = resolve(fileURLToPath(new URL("..", import.meta.url))),
  execute = probe,
  read = readFileSync,
  platform = process.platform,
  compilerOptions,
} = {}) {
  const disabled = { enabled: false };
  if (platform !== "darwin" || !trustedReleaseCacheHost(env)) return disabled;
  try {
    const compiler = releaseCompilerCacheEnvironment(
      { ...env, SITUATE_RELEASE_BUILD_CACHE: "1" },
      compilerOptions,
    );
    if (!compiler.RUSTC_WRAPPER) return disabled;
    // Probes and cache keys never consume the signing-stage environment.
    const options = {
      cwd: join(root, "client"),
      env: Object.fromEntries(
        ["PATH", "HOME", "RUSTUP_HOME", "DEVELOPER_DIR", "TMPDIR"]
          .filter((name) => env[name] !== undefined)
          .map((name) => [name, env[name]]),
      ),
    };
    const rustc = execute("rustup", ["which", "rustc"], options);
    const cargo = execute("rustup", ["which", "cargo"], options);
    if (
      !isAbsolute(rustc) ||
      basename(rustc) !== "rustc" ||
      !isAbsolute(cargo) ||
      basename(cargo) !== "cargo"
    )
      return disabled;
    const runtime = [
      execute(rustc, ["-vV"], options),
      execute(cargo, ["--version"], options),
      execute("xcodebuild", ["-version"], options),
      execute("xcrun", ["--sdk", "macosx", "--show-sdk-version"], options),
      execute(
        "xcrun",
        ["--sdk", "macosx", "--show-sdk-build-version"],
        options,
      ),
      execute("xcrun", ["--sdk", "macosx", "clang", "--version"], options),
      execute("sw_vers", ["-productVersion"], options),
      execute("sw_vers", ["-buildVersion"], options),
      execute(compiler.RUSTC_WRAPPER, ["--version"], options),
      env.ImageOS,
      env.ImageVersion,
    ];
    if (
      runtime.some((value) => typeof value !== "string" || !value.trim()) ||
      !/^rustc \d+\.\d+\.\d+ /m.test(runtime[0]) ||
      !/^commit-hash: [a-f0-9]{40}$/m.test(runtime[0]) ||
      !/^host: (aarch64|x86_64)-apple-darwin$/m.test(runtime[0]) ||
      !/^cargo \d+\.\d+\.\d+ /.test(runtime[1]) ||
      !/^Xcode \d+(\.\d+)*\nBuild version [A-Za-z0-9]+$/.test(runtime[2]) ||
      !/^\d+(\.\d+)+$/.test(runtime[3]) ||
      !/^[A-Za-z0-9]+$/.test(runtime[4]) ||
      !/^Apple clang version \d+\./.test(runtime[5]) ||
      !/^\d+(\.\d+)+$/.test(runtime[6]) ||
      !/^[A-Za-z0-9]+$/.test(runtime[7]) ||
      !/^sccache \d+\.\d+\.\d+$/.test(runtime[8])
    )
      return disabled;
    const inputs = [
      "client/rust-toolchain.toml",
      "client/Cargo.lock",
      "client/Cargo.toml",
    ].map((path) => hash(read(join(root, path))));
    const prefix = `release-build-v1-main-macos-${env.RUNNER_ARCH}-universal-release-${hash(JSON.stringify({ runtime, inputs }))}-`;
    const paths = releaseCachePaths(env);
    return {
      enabled: true,
      key: `${prefix}${env.GITHUB_SHA}`,
      restoreKey: prefix,
      paths: [paths.compiler, ...paths.downloads],
      environment: {
        SITUATE_RELEASE_BUILD_CACHE: "1",
        CARGO_HOME: paths.cargoHome,
      },
    };
  } catch {
    // Unidentified runtimes and unavailable optional tools start cold.
    return disabled;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const plan = releaseBuildCachePlan();
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `enabled=${plan.enabled}\n`);
    if (plan.enabled) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `key=${plan.key}\nrestore-key=${plan.restoreKey}\npaths<<SITUATE_CACHE_PATHS\n${plan.paths.join("\n")}\nSITUATE_CACHE_PATHS\n`,
      );
      appendFileSync(
        process.env.GITHUB_ENV,
        Object.entries(plan.environment)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(""),
      );
    }
  } else {
    console.log(JSON.stringify(plan));
  }
}
