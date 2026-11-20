import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compilerCacheEnvironment } from "./compiler-cache.mjs";

const repository = "getsituate/situate";
const hash = (value) => createHash("sha256").update(value).digest("hex");

// Published asset digests and matching .sha256 files: https://github.com/mozilla/sccache/releases/tag/v0.19.0
export const sccacheRelease = Object.freeze({
  version: "0.19.0",
  checksums: Object.freeze({
    ARM64: "a35a0b7d622618774bc1bb8102d72562dfb21e619f88b153b370d7f89bc286af",
    X64: "2db7344bb96de350df79cd9f0124dd4e9baa47b3de2fac1e63e1346b66b20684",
  }),
});
const maximumDownloadBytes = 64 * 1024 * 1024;

export async function downloadReleaseTool(url, fetcher = fetch) {
  const signal = AbortSignal.timeout(60000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      target.port ||
      ![
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(target.hostname)
    )
      throw new Error("Unsupported release-tool download URL.");
    const response = await fetcher(target, {
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/octet-stream" },
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Missing release-tool redirect.");
      url = new URL(location, target).href;
      continue;
    }
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get("content-length")) > maximumDownloadBytes
    ) {
      await response.body?.cancel();
      throw new Error("Release-tool download unavailable or too large.");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > maximumDownloadBytes)
        throw new Error("Release-tool download too large.");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Too many release-tool redirects.");
}

function runnerTemporaryDirectory(env) {
  if (!isAbsolute(env.RUNNER_TEMP ?? "") || /[\r\n\0]/.test(env.RUNNER_TEMP))
    throw new Error("An owned runner temporary directory is required.");
  const stat = lstatSync(env.RUNNER_TEMP);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid()
  )
    throw new Error("An owned runner temporary directory is required.");
  return env.RUNNER_TEMP;
}

export async function prepareReleaseCacheTool({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  download = downloadReleaseTool,
  extract = execFileSync,
  checksums = sccacheRelease.checksums,
} = {}) {
  if (
    platform !== "darwin" ||
    !trustedReleaseCacheHost(env) ||
    { arm64: "ARM64", x64: "X64" }[arch] !== env.RUNNER_ARCH
  )
    throw new Error(
      "Release cache preparation requires a trusted macOS runner with a known architecture.",
    );
  const directory = mkdtempSync(
    join(runnerTemporaryDirectory(env), "situate-release-tool-"),
  );
  try {
    const target = arch === "arm64" ? "aarch64" : "x86_64";
    const stem = `sccache-v${sccacheRelease.version}-${target}-apple-darwin`;
    const member = `${stem}/sccache`;
    const url = `https://github.com/mozilla/sccache/releases/download/v${sccacheRelease.version}/${stem}.tar.gz`;
    const bytes = await download(url);
    if (
      !bytes.length ||
      bytes.length > maximumDownloadBytes ||
      hash(bytes) !== checksums[env.RUNNER_ARCH]
    )
      throw new Error("Release-tool checksum verification failed.");
    const archive = join(directory, "sccache.tar.gz");
    writeFileSync(archive, bytes, { mode: 0o600, flag: "wx" });
    const bin = join(directory, "bin");
    mkdirSync(bin, { mode: 0o700 });
    extract(
      "/usr/bin/tar",
      ["-xzf", archive, "-C", bin, "--strip-components", "1", member],
      {
        env: { PATH: "/usr/bin:/bin" },
        timeout: 10000,
        maxBuffer: 4096,
        stdio: "ignore",
      },
    );
    const executable = join(bin, "sccache");
    const stat = lstatSync(executable);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid() ||
      stat.size === 0 ||
      stat.size > 256 * 1024 * 1024
    )
      throw new Error("Invalid extracted release tool.");
    chmodSync(executable, 0o700);
    rmSync(archive);
    return {
      bin,
      version: sccacheRelease.version,
      sha256: checksums[env.RUNNER_ARCH],
      url,
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

const intelCompatibility = (env) =>
  env.SITUATE_RELEASE_CACHE_SCOPE === "intel-compatibility";

export function trustedReleaseCacheHost(env) {
  return (
    env.CI === "true" &&
    env.GITHUB_ACTIONS === "true" &&
    env.RUNNER_ENVIRONMENT === "github-hosted" &&
    env.RUNNER_OS === "macOS" &&
    ["ARM64", "X64"].includes(env.RUNNER_ARCH) &&
    (env.SITUATE_RELEASE_CACHE_SCOPE === undefined ||
      (intelCompatibility(env) && env.RUNNER_ARCH === "X64")) &&
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
  const root = join(
    env.HOME,
    "Library/Caches/situate",
    intelCompatibility(env) ? "intel-compatibility-v1" : "release-build-v1",
  );
  return {
    compiler: join(root, "sccache"),
    cargoHome: join(root, "cargo"),
    downloads: [
      join(root, "cargo/registry/cache/index.crates.io-1949cf8c6b5b557f"),
      join(root, "cargo/registry/index/index.crates.io-1949cf8c6b5b557f"),
    ],
  };
}

export function releaseCacheEndpoint(env) {
  if (
    !isAbsolute(env.RUNNER_TEMP ?? "") ||
    /[\r\n\0]/.test(env.RUNNER_TEMP) ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? "")
  )
    throw new Error("Missing release-cache endpoint identity.");
  const endpoint = join(
    env.RUNNER_TEMP,
    `situate-rc-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    "s",
  );
  if (Buffer.byteLength(endpoint) > 90)
    throw new Error("Release-cache socket path is too long.");
  return endpoint;
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
  if (configured.RUSTC_WRAPPER) {
    if (env.SITUATE_RELEASE_CACHE_SOCKET !== undefined) {
      if (env.SITUATE_RELEASE_CACHE_SOCKET !== releaseCacheEndpoint(env))
        throw new Error("Invalid release-cache endpoint.");
      delete configured.SCCACHE_SERVER_PORT;
      configured.SCCACHE_SERVER_UDS = env.SITUATE_RELEASE_CACHE_SOCKET;
    } else configured.SCCACHE_SERVER_PORT = "4228";
  }
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
      !/^sccache \d+\.\d+\.\d+$/.test(runtime[8]) ||
      (intelCompatibility(env) &&
        !/^host: x86_64-apple-darwin$/m.test(runtime[0]))
    )
      return disabled;
    const inputs = [
      "client/rust-toolchain.toml",
      "client/Cargo.lock",
      "client/Cargo.toml",
    ].map((path) => hash(read(join(root, path))));
    const toolDigest = sccacheRelease.checksums[env.RUNNER_ARCH];
    const scope = intelCompatibility(env)
      ? "intel-compatibility"
      : "universal-release";
    const prefix = `release-build-v1-main-macos-${env.RUNNER_ARCH}-${scope}-${hash(JSON.stringify({ runtime, inputs, toolDigest }))}-`;
    const paths = releaseCachePaths(env);
    return {
      enabled: true,
      key: `${prefix}${env.GITHUB_SHA}`,
      restoreKey: prefix,
      paths: intelCompatibility(env)
        ? [paths.compiler]
        : [paths.compiler, ...paths.downloads],
      environment: {
        SITUATE_RELEASE_BUILD_CACHE: "1",
        ...(!intelCompatibility(env) ? { CARGO_HOME: paths.cargoHome } : {}),
        SITUATE_RELEASE_CACHE_SOCKET: releaseCacheEndpoint(env),
      },
    };
  } catch {
    // Unidentified runtimes and unavailable optional tools start cold.
    return disabled;
  }
}

function measuredCounters(text) {
  const { stats } = JSON.parse(text);
  const total = (counts) => {
    if (!counts || typeof counts !== "object" || Array.isArray(counts))
      throw new Error("Unavailable compiler-cache statistics.");
    const values = Object.values(counts);
    if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
      throw new Error("Unavailable compiler-cache statistics.");
    return values.reduce((sum, value) => sum + value, 0);
  };
  const counters = {
    compileRequests: stats.compile_requests,
    hits: total(stats.cache_hits.counts),
    misses: total(stats.cache_misses.counts),
  };
  if (
    Object.values(counters).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  )
    throw new Error("Unavailable compiler-cache statistics.");
  return counters;
}

function socketIdentity(path) {
  try {
    const parent = lstatSync(dirname(path));
    const stat = lstatSync(path, { bigint: true });
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== process.getuid() ||
      (parent.mode & 0o077) !== 0 ||
      !stat.isSocket() ||
      stat.uid !== BigInt(process.getuid()) ||
      stat.ino <= 0n ||
      stat.birthtimeNs <= 0n
    )
      return null;
    return {
      dev: String(stat.dev),
      ino: String(stat.ino),
      born: String(stat.birthtimeNs),
    };
  } catch {
    return null;
  }
}

function sameSocket(a, b) {
  return (
    a &&
    b &&
    ["dev", "ino", "born"].every(
      (key) =>
        typeof a[key] === "string" &&
        /^[0-9]+$/.test(a[key]) &&
        a[key] === b[key],
    )
  );
}

export function releaseCacheMeasurement(
  command,
  {
    env = process.env,
    execute = probe,
    now = () => Math.floor(Number(process.hrtime.bigint()) / 1e6),
    compilerOptions,
    identify = socketIdentity,
    move = renameSync,
  } = {},
) {
  if (!["start", "report"].includes(command))
    throw new Error("Unknown measurement command.");
  if (!env.SITUATE_RELEASE_CACHE_SOCKET) return { enabled: false };
  const compiler = releaseCompilerCacheEnvironment(env, compilerOptions);
  if (!compiler.RUSTC_WRAPPER) return { enabled: false };
  const endpoint = releaseCacheEndpoint(env);
  const path = join(
    runnerTemporaryDirectory(env),
    `situate-release-cache-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}.json`,
  );
  const retired = `${path}.reported`;
  const options = { env: { PATH: env.PATH, HOME: env.HOME, ...compiler } };
  const sample = () => {
    try {
      return measuredCounters(
        execute(
          compiler.RUSTC_WRAPPER,
          ["--show-stats", "--stats-format=json"],
          options,
        ),
      );
    } catch {
      return null;
    }
  };
  if (command === "start") {
    // A retired claim must also prevent a second start for the same run.
    try {
      lstatSync(retired);
      throw new Error("Release-cache measurement has already been reported.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const file = openSync(path, "wx", 0o600);
    const baseline = {
      startedAt: now(),
      endpoint,
      generation: null,
      counters: null,
    };
    try {
      mkdirSync(dirname(endpoint), { mode: 0o700 });
      execute(compiler.RUSTC_WRAPPER, ["--start-server"], options);
      baseline.generation = identify(endpoint);
      if (baseline.generation) {
        baseline.counters = sample();
        if (!sameSocket(baseline.generation, identify(endpoint)))
          baseline.counters = null;
      }
    } catch {
      // An unresolved startup never authorizes later daemon shutdown or cache save.
    } finally {
      writeFileSync(file, JSON.stringify(baseline));
      closeSync(file);
    }
    return { enabled: true, statisticsAvailable: baseline.counters !== null };
  }
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0 ||
    stat.size > 4096
  )
    throw new Error("Invalid release-cache measurement file.");
  const baseline = JSON.parse(readFileSync(path, "utf8"));
  const elapsed = now() - baseline.startedAt;
  if (
    !Number.isSafeInteger(baseline.startedAt) ||
    !Number.isSafeInteger(elapsed) ||
    elapsed < 0
  )
    throw new Error("Invalid release-cache measurement interval.");

  // Exclusive hard-link creation consumes the claim even if reporting is interrupted.
  linkSync(path, retired);
  unlinkSync(path);
  const result = {
    enabled: true,
    elapsedSeconds: elapsed / 1000,
    statisticsAvailable: false,
    flushed: false,
  };
  if (
    baseline.endpoint !== endpoint ||
    !baseline.counters ||
    !sameSocket(baseline.generation, identify(endpoint))
  )
    return result;
  const counters = sample();
  if (!counters || !sameSocket(baseline.generation, identify(endpoint)))
    return result;
  const entries = Object.entries(counters).map(([key, value]) => [
    key,
    value - baseline.counters[key],
  ]);
  if (!entries.every(([, value]) => Number.isSafeInteger(value) && value >= 0))
    return result;
  Object.assign(result, Object.fromEntries(entries), {
    statisticsAvailable: true,
  });
  try {
    // Move the verified socket to an unshared shutdown address before contacting it.
    const shutdown = join(
      dirname(endpoint),
      `f-${randomBytes(6).toString("hex")}`,
    );
    move(endpoint, shutdown);
    if (!sameSocket(baseline.generation, identify(shutdown))) return result;
    execute(compiler.RUSTC_WRAPPER, ["--stop-server"], {
      env: { ...options.env, SCCACHE_SERVER_UDS: shutdown },
    });
    result.flushed = true;
  } catch {
    // A failed ownership check or shutdown cannot authorize persistence.
  }
  return result;
}

export function compatibilityCacheEnvironment(env) {
  if (
    !trustedReleaseCacheHost(env) ||
    !intelCompatibility(env) ||
    env.SITUATE_RELEASE_BUILD_CACHE !== "1" ||
    env.SITUATE_RELEASE_CACHE_SOCKET !== releaseCacheEndpoint(env)
  )
    return {};
  return {
    SITUATE_COMPILER_CACHE_SOCKET: env.SITUATE_RELEASE_CACHE_SOCKET,
    SCCACHE_DIR: releaseCachePaths(env).compiler,
    SCCACHE_CACHE_SIZE: "2G",
    CARGO_INCREMENTAL: "0",
  };
}

function emitPlan(plan) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `enabled=${plan.enabled}\n`);
    if (plan.enabled) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `key=${plan.key}\nrestore-key=${plan.restoreKey}\npaths<<SITUATE_CACHE_PATHS\n${plan.paths.map((path) => path.replace(`${process.env.HOME}/`, "~/")).join("\n")}\nSITUATE_CACHE_PATHS\n`,
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

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const command = process.argv[2] ?? "plan";
    if (command === "prepare") {
      const prepared = await prepareReleaseCacheTool();
      if (process.env.GITHUB_PATH)
        appendFileSync(process.env.GITHUB_PATH, `${prepared.bin}\n`);
      console.log(
        JSON.stringify({ version: prepared.version, sha256: prepared.sha256 }),
      );
    } else if (command === "plan") {
      emitPlan(releaseBuildCachePlan());
    } else if (["start", "report"].includes(command)) {
      const measurement = releaseCacheMeasurement(command);
      if (
        command === "start" &&
        intelCompatibility(process.env) &&
        measurement.statisticsAvailable === true &&
        process.env.GITHUB_ENV
      ) {
        appendFileSync(
          process.env.GITHUB_ENV,
          Object.entries(compatibilityCacheEnvironment(process.env))
            .map(([key, value]) => `${key}=${value}\n`)
            .join(""),
        );
        if (process.env.GITHUB_OUTPUT)
          appendFileSync(process.env.GITHUB_OUTPUT, "ready=true\n");
      }
      if (command === "report" && process.env.GITHUB_OUTPUT)
        appendFileSync(
          process.env.GITHUB_OUTPUT,
          `flushed=${measurement.flushed === true}\n`,
        );
      console.log(JSON.stringify(measurement));
    } else {
      throw new Error("Unknown release-cache command.");
    }
  } catch {
    console.error("Release cache command failed.");
    process.exitCode = 1;
  }
}
