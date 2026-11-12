import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  lstatSync,
  readdirSync,
  realpathSync,
  readlinkSync,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
} from "node:fs";
import {
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";
import { isPlainDocumentation } from "./test-inputs.mjs";
import {
  CacheConfigurationError,
  CachePolicyUnavailableError,
  suiteConfigurationFiles,
  validateSuiteConfiguration,
} from "./suite-cache-config.mjs";

const exec = promisify(execFile);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const shapes = {
  "client-vue": [
    "client/app",
    ["../node_modules/vitest/vitest.mjs", "run", "--allowOnly=false"],
  ],
  "client-types": [
    "client/app",
    ["../node_modules/vue-tsc/bin/vue-tsc.js", "--noEmit"],
  ],
  "workshop-vue": [
    "client/workshop",
    ["../node_modules/vitest/vitest.mjs", "run", "--allowOnly=false"],
  ],
  "workshop-types": [
    "client/workshop",
    ["../node_modules/vue-tsc/bin/vue-tsc.js", "--noEmit"],
  ],
  "client-core": ["client", ["test", "-p", "situate-core", "--locked"]],
};
const inside = (root, path) => {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith("../") && !isAbsolute(local);
};
const identity = (info) =>
  [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs].map(
    String,
  );

async function snapshot(root, suite, options, affectedFiles) {
  const environment = options.environment ?? process.env;
  const cwd = resolve(root, suite.cwd);
  const signal = AbortSignal.any([
    AbortSignal.timeout(5000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const key = createHash("sha256");
  const guard = createHash("sha256");
  const add = (value) => key.update(JSON.stringify(value)).update("\0");
  const deadline = performance.now() + 5000;
  let entries = 0;
  let bytes = 0;
  const budget = () => {
    signal.throwIfAborted();
    if (performance.now() >= deadline)
      throw new Error("Snapshot time budget exceeded");
    if (++entries > 100000 || bytes > 128 * 1024 * 1024)
      throw new Error("Snapshot budget exceeded");
  };
  const run = async (command, args) => {
    budget();
    return (
      await exec(command, args, {
        cwd,
        env: environment,
        signal,
        timeout: 3000,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout.trimEnd();
  };
  const inventory = async () => {
    const output = await run("git", [
      "-C",
      root,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ]);
    if (output.includes("\ufffd")) throw new Error("Unsupported filename");
    return [...new Set(output.split("\0").filter(Boolean))].sort();
  };
  const configurations = suiteConfigurationFiles(suite);
  if (suite.id === "client-core") {
    try {
      await lstat(join(root, "client/crates/situate-core/build.rs"));
      throw new CacheConfigurationError("client/crates/situate-core/build.rs");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } else if (suite.id.endsWith("-vue")) {
    for (const name of await readdir(cwd))
      if (
        /^(?:vitest|vite)\.config\./.test(name) &&
        !["vitest.config.ts", "vite.config.ts"].includes(name)
      )
        throw new CacheConfigurationError(`${suite.cwd}/${name}`);
  }
  const files = await inventory();
  const knownFiles = new Set(files);
  const selected = await affectedFiles(suite, files);
  if (
    !Array.isArray(selected) ||
    selected.some((file) => !knownFiles.has(file))
  )
    throw new Error("Invalid selection");
  const sources = new Set([...selected, ...configurations]);
  const visited = new Set();
  const workspaceRoots = new Set(
    files
      .filter(
        (file) => file.endsWith("/package.json") || file === "package.json",
      )
      .map((file) => resolve(root, dirname(file))),
  );

  const inspect = async (
    path,
    content = false,
    ancestors = new Set(),
    configuration,
  ) => {
    budget();
    add(path);
    let before;
    try {
      before = lstatSync(path, { bigint: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (configuration) throw new CacheConfigurationError(configuration);
      add("missing");
      guard.update(JSON.stringify([path, "missing"]));
      return;
    }
    if (configuration && !inside(root, await realpath(path)))
      throw new CacheConfigurationError(configuration);
    const stamp = identity(before);
    guard.update(
      JSON.stringify([path, before.isDirectory() ? stamp.slice(0, 3) : stamp]),
    );
    if (before.isSymbolicLink()) {
      const target = realpathSync(path);
      add(readlinkSync(path));
      if (ancestors.has(target)) throw new Error("Cyclic link");
      if (content && !inside(root, target))
        throw new Error("External source link");
      const next = new Set([...ancestors, target]);
      if (!content && workspaceRoots.has(target)) {
        // Workspace links use versioned inputs, not generated build trees.
        add(target);
        for (const file of files)
          if (
            inside(target, resolve(root, file)) &&
            !isPlainDocumentation(file)
          )
            sources.add(file);
        await inspect(join(target, "node_modules"), false, next);
      } else await inspect(target, content, next, configuration);
    } else if (before.isDirectory()) {
      if (content) throw new Error("Source directory or submodule");
      if (visited.has(path)) return;
      visited.add(path);
      const names = readdirSync(path).sort();
      for (const name of names) {
        if (
          name === ".git" ||
          (path.endsWith("/node_modules") &&
            [".cache", ".vite", ".vite-temp"].includes(name))
        )
          continue;
        await inspect(join(path, name), false, ancestors);
      }
      // Directory timestamps change for excluded generated cache entries.
    } else if (before.isFile()) {
      if (content) {
        bytes += Number(before.size);
        budget();
        const handle = openSync(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          if (
            JSON.stringify(identity(fstatSync(handle, { bigint: true }))) !==
            JSON.stringify(stamp)
          )
            throw new Error("Replaced source");
          const data = readFileSync(handle);
          if (configuration) {
            const required = validateSuiteConfiguration(
              configuration,
              data,
              suite,
            );
            for (const file of required)
              if (
                !knownFiles.has(file) ||
                !sources.has(file) ||
                !inside(root, await realpath(join(root, file)))
              )
                throw new CacheConfigurationError(configuration);
          }
          add([String(before.mode), data.length]);
          key.update(data);
        } finally {
          closeSync(handle);
        }
      } else {
        add(stamp);
        return;
      }
    } else throw new Error("Unsupported file type");
    if (before.isDirectory()) return;
    const after = lstatSync(path, { bigint: true });
    if (
      JSON.stringify(
        before.isDirectory() ? identity(after).slice(0, 3) : identity(after),
      ) !== JSON.stringify(before.isDirectory() ? stamp.slice(0, 3) : stamp)
    )
      throw new Error("Input changed during inspection");
  };

  add([
    "suite-cache-v2",
    root,
    {
      id: suite.id,
      cwd: suite.cwd,
      command: suite.command,
      args: suite.args,
      environment: suite.environment,
    },
    process.versions,
    process.platform,
    process.arch,
    options.timeout,
  ]);
  add(Object.entries(environment).sort(([a], [b]) => a.localeCompare(b)));
  if (options.directory && resolve(options.directory) !== root)
    throw new Error("Different execution root");
  if (!inside(root, cwd)) throw new Error("External working directory");
  for (const name of [
    "NODE_OPTIONS",
    "NODE_PATH",
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "RUSTC",
    "RUSTDOC",
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
  ]) {
    if (environment[name]) throw new Error("External execution configuration");
  }
  const tool = async (name) => {
    for (const entry of (environment.PATH ?? "").split(delimiter)) {
      if (!entry || !isAbsolute(entry))
        throw new Error("Relative executable path");
      const path = join(entry, name);
      try {
        await lstat(path);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      await inspect(path);
      return path;
    }
    throw new Error("Tool not found");
  };
  await inspect(process.execPath);
  if (suite.id === "client-core") {
    if (
      Object.keys(environment).some(
        (name) =>
          /^(?:CC|CXX|AR|LD|CFLAGS|CXXFLAGS|SDKROOT|DEVELOPER_DIR|MACOSX_DEPLOYMENT_TARGET|PKG_CONFIG.*|CARGO_TARGET_.*|CARGO_BUILD_(?!JOBS$).*)$/.test(
            name,
          ) && environment[name],
      )
    )
      throw new Error("Custom native build configuration");
    for (const name of ["CPPFLAGS", "LDFLAGS"]) {
      const flags = environment[name]?.trim();
      if (!flags) continue;
      for (const flag of flags.split(/\s+/)) {
        if (!/^-[IL]\//.test(flag))
          throw new Error("Unsupported native search flags");
        const path = flag.slice(2);
        if (!isAbsolute(path)) throw new Error("Relative native search path");
        await inspect(path);
      }
    }
    for (const name of ["cc", "c++", "ar", "ld"]) await tool(name);
    if (process.platform === "darwin") {
      const xcrun = await tool("xcrun");
      for (const name of ["clang", "clang++", "ld", "ar"]) {
        const path = await run(xcrun, ["--find", name]);
        if (!isAbsolute(path)) throw new Error("Unresolved native toolchain");
        await inspect(path);
      }
      const sdk = await run(xcrun, ["--show-sdk-path"]);
      if (!isAbsolute(sdk)) throw new Error("Unresolved SDK");
      await inspect(join(sdk, "SDKSettings.json"), true);
      await inspect(join(sdk, "SDKSettings.plist"), true);
      await inspect(
        join(sdk, "System/Library/CoreServices/SystemVersion.plist"),
        true,
      );
    } else throw new Error("Unqualified native toolchain");
    const rustup = await tool("rustup");
    await tool("cargo");
    for (const name of ["cargo", "rustc", "rustfmt"]) {
      const path = await run(rustup, ["which", name]);
      if (!isAbsolute(path)) throw new Error("Unresolved Rust toolchain");
      await inspect(path);
      const receipts = join(dirname(dirname(path)), "lib/rustlib");
      for (const receipt of [
        "components",
        "multirust-channel-manifest.toml",
        "multirust-config.toml",
      ])
        await inspect(join(receipts, receipt), true);
    }
    const cargoHome =
      environment.CARGO_HOME ?? join(environment.HOME ?? homedir(), ".cargo");
    const rustupHome =
      environment.RUSTUP_HOME ?? join(environment.HOME ?? homedir(), ".rustup");
    await inspect(join(rustupHome, "settings.toml"), true);
    for (let path = cwd; ; path = dirname(path)) {
      for (const name of ["config", "config.toml"]) {
        const config = join(path, ".cargo", name);
        await inspect(config, true);
        try {
          await lstat(config);
          throw new Error("Custom Cargo configuration");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      if (path === dirname(path)) break;
    }
    for (const name of ["config", "config.toml"]) {
      const config = join(cargoHome, name);
      await inspect(config, true);
      try {
        await lstat(config);
        throw new Error("Custom Cargo configuration");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    // The resolved graph exposes transitive path/Git overrides hidden by --no-deps.
    const metadata = JSON.parse(
      await run("cargo", [
        "metadata",
        "--format-version",
        "1",
        "--locked",
        "--offline",
      ]),
    );
    const manifest = join(root, "client/crates/situate-core/Cargo.toml");
    const packages = metadata.packages.filter(
      (pkg) => pkg.manifest_path === manifest,
    );
    if (
      metadata.version !== 1 ||
      metadata.workspace_root !== cwd ||
      packages.length !== 1
    )
      throw new Error("Unresolved Cargo package");
    const pkg = packages[0];
    if (
      pkg.name !== "situate-core" ||
      pkg.source !== null ||
      !metadata.workspace_members.includes(pkg.id) ||
      !Array.isArray(pkg.dependencies) ||
      pkg.dependencies.some(
        (dependency) =>
          dependency.source !==
            "registry+https://github.com/rust-lang/crates.io-index" ||
          dependency.path != null ||
          dependency.registry != null,
      ) ||
      !Array.isArray(pkg.targets) ||
      pkg.targets.length === 0 ||
      pkg.targets.some(
        (target) =>
          !Array.isArray(target.kind) ||
          target.kind.includes("custom-build") ||
          typeof target.src_path !== "string" ||
          !isAbsolute(target.src_path) ||
          !inside(dirname(manifest), target.src_path),
      )
    )
      throw new Error("External Cargo inputs");
    const graph = new Map(
      metadata.resolve.nodes.map((node) => [node.id, node]),
    );
    const resolved = new Map(
      metadata.packages.map((entry) => [entry.id, entry]),
    );
    const pending = [pkg.id];
    const reachable = new Set();
    while (pending.length) {
      budget();
      const id = pending.pop();
      if (reachable.has(id)) continue;
      reachable.add(id);
      const entry = resolved.get(id);
      const node = graph.get(id);
      if (
        !entry ||
        !node ||
        !Array.isArray(node.dependencies) ||
        (id !== pkg.id &&
          entry.source !==
            "registry+https://github.com/rust-lang/crates.io-index")
      )
        throw new Error("External Cargo dependency");
      pending.push(...node.dependencies);
    }
    add(metadata);
    const dependencies = new Set(
      [...reachable]
        .filter((id) => id !== pkg.id)
        .map((id) => {
          const entry = resolved.get(id);
          if (
            typeof entry.name !== "string" ||
            typeof entry.version !== "string"
          )
            throw new Error("Incomplete Cargo dependency identity");
          return entry.name + "@" + entry.version;
        }),
    );
    const lock = await readFile(join(root, "client/Cargo.lock"), "utf8");
    const registries = await readdir(join(cargoHome, "registry/src"));
    for (const block of lock.split("[[package]]").slice(1)) {
      const name = /^name = "([^"]+)"/m.exec(block)?.[1];
      const version = /^version = "([^"]+)"/m.exec(block)?.[1];
      const source = /^source = "([^"]+)"/m.exec(block)?.[1];
      if (!source || !dependencies.has(name + "@" + version)) continue;
      if (
        source !== "registry+https://github.com/rust-lang/crates.io-index" ||
        !/^[\w.-]+$/.test(name) ||
        !/^[\w.+-]+$/.test(version)
      )
        throw new Error("External Cargo dependency");
      for (const registry of registries)
        await inspect(
          join(cargoHome, "registry/src", registry, `${name}-${version}`),
        );
    }
  } else {
    const volta = await tool("volta");
    for (const name of ["node", "npm", "npx"]) {
      await tool(name);
      const path = await run(volta, ["which", name]);
      if (!isAbsolute(path)) throw new Error("Unresolved Node toolchain");
      await inspect(path);
      if (name !== "node")
        await inspect(dirname(dirname(await realpath(path))));
    }
    const dependencyRoots = new Set([join(root, "client/node_modules")]);
    for (const file of sources) {
      for (let path = dirname(resolve(root, file)); ; path = dirname(path)) {
        dependencyRoots.add(join(path, "node_modules"));
        if (path === dirname(path)) break;
      }
    }
    for (const path of [...dependencyRoots].sort()) await inspect(path);
  }
  for (const file of [
    "package.json",
    "package-lock.json",
    "client/package.json",
    "client/package-lock.json",
    "client/Cargo.lock",
    "client/Cargo.toml",
    "rust-toolchain.toml",
    "client/rust-toolchain.toml",
  ])
    sources.add(file);
  for (const file of [...sources].sort()) {
    const path = resolve(root, file);
    if (!inside(root, path)) throw new Error("External source");
    await inspect(
      path,
      true,
      new Set(),
      configurations.includes(file) ? file : undefined,
    );
  }
  if (JSON.stringify(files) !== JSON.stringify(await inventory()))
    throw new Error("Inventory changed");
  signal.throwIfAborted();
  return { key: key.digest("hex"), guard: guard.digest("hex") };
}

const reasonMessages = {
  "unchanged-inputs": "unchanged inputs",
  "no-success": "no previous successful result",
  "inputs-changed": "inputs changed",
  "unsupported-suite": "suite or command is not eligible for result reuse",
  "unsupported-configuration":
    "configuration is outside the supported cache policy",
  "policy-unavailable": "executable hook policy is unavailable",
  "unsupported-environment":
    "execution environment is outside the supported cache policy",
  "native-configuration":
    "native build configuration is outside the supported cache policy",
  "unsupported-platform": "native toolchain is not qualified for result reuse",
  "inspection-budget-exceeded": "input inspection exceeded its size budget",
  "inspection-timeout": "input inspection timed out",
  "inspection-unavailable": "inputs could not be fully inspected",
  "unsafe-cache-directory": "cache directory is not private",
  "invalid-record": "previous success record is invalid or unreadable",
  "cache-disabled": "cache storage is unavailable",
  "cache-write-failed": "successful result could not be stored",
  "execution-not-passed": "execution did not pass",
  "execution-cancelled": "execution was cancelled",
  "execution-not-fresh": "underlying executor did not run the suite",
  "execution-cleanup-incomplete": "execution cleanup was incomplete",
};

function inspectionFailure(error) {
  if (error instanceof CachePolicyUnavailableError)
    return { reason: "policy-unavailable" };
  if (error instanceof CacheConfigurationError) {
    const file = error.file;
    return {
      reason: "unsupported-configuration",
      ...(typeof file === "string" &&
      /^client\/[\w./-]{1,180}$/.test(file) &&
      file.split("/").every((part) => part && part !== "." && part !== "..")
        ? { configuration: file }
        : {}),
    };
  }
  const reason = new Map([
    ["Snapshot budget exceeded", "inspection-budget-exceeded"],
    ["Snapshot time budget exceeded", "inspection-timeout"],
    ["Cache directory is not private", "unsafe-cache-directory"],
    ["External execution configuration", "unsupported-environment"],
    ["Custom native build configuration", "native-configuration"],
    ["Unsupported native search flags", "native-configuration"],
    ["Relative native search path", "native-configuration"],
    ["Custom Cargo configuration", "unsupported-configuration"],
    ["External Cargo dependency", "unsupported-configuration"],
    ["External Cargo inputs", "unsupported-configuration"],
    ["Unresolved Cargo package", "unsupported-configuration"],
    ["Unqualified native toolchain", "unsupported-platform"],
  ]).get(error?.message);
  return {
    reason:
      reason ??
      (error?.name === "TimeoutError"
        ? "inspection-timeout"
        : "inspection-unavailable"),
  };
}

export function describeSuiteCacheResult(result) {
  if (!result.cache || result.reused) return "";
  const describe = ({ reason, configuration }) =>
    `${reasonMessages[reason] ?? reasonMessages["inspection-unavailable"]}${configuration ? ` (${configuration})` : ""}`;
  return ` [cache not used: ${describe(result.cache)}${
    result.cache.recordingReason
      ? `; result not stored: ${describe(result.cache.recordingReason)}`
      : ""
  }]`;
}

/**
 * Optional session-only reuse. Call after dependency preparation, under the
 * runner's leases, with a private existing cache directory and central selector.
 * Full verification must always execute its selected suites.
 */
export function createSuiteCacheExecutor({
  directory,
  cacheDirectory,
  execute,
  affectedFiles,
}) {
  const root = resolve(directory);
  const cache = resolve(cacheDirectory);
  const disabled = new Set();
  return async (suite, executionOptions = {}) => {
    const shape = shapes[suite.id];
    const eligible =
      shape &&
      suite.cwd === shape[0] &&
      JSON.stringify(suite.args) === JSON.stringify(shape[1]) &&
      suite.command ===
        (suite.id === "client-core" ? "cargo" : process.execPath);
    const slot = join(
      cache,
      `${digest(JSON.stringify([root, suite.id]))}.json`,
    );
    const privateDirectory = async () => {
      const info = await lstat(cache);
      if (
        !info.isDirectory() ||
        (info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid()) ||
        (await realpath(cache)) !== cache
      )
        throw new Error("Cache directory is not private");
    };
    const discard = async () => {
      try {
        await privateDirectory();
        await unlink(slot);
      } catch (error) {
        if (error.code !== "ENOENT") disabled.add(suite.id);
      }
    };
    let inspectionDurationMs = 0;
    let inspectionProblem;
    const inspect = async () => {
      const started = performance.now();
      try {
        await privateDirectory();
        return await snapshot(root, suite, executionOptions, affectedFiles);
      } catch (error) {
        inspectionProblem = inspectionFailure(error);
        return undefined;
      } finally {
        inspectionDurationMs += Math.round(performance.now() - started);
      }
    };
    let before;
    let cacheInfo = {
      reason: eligible ? "cache-disabled" : "unsupported-suite",
    };
    if (eligible && !disabled.has(suite.id)) {
      before = await inspect();
      cacheInfo = before ? { reason: "no-success" } : inspectionProblem;
    }
    if (before && !executionOptions.signal?.aborted) {
      try {
        const handle = await open(
          slot,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        let record;
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > 1024 || (info.mode & 0o077) !== 0)
            throw new Error("Invalid cache record");
          record = JSON.parse(await handle.readFile("utf8"));
          if (
            !record ||
            Object.keys(record).length !== 1 ||
            typeof record.key !== "string" ||
            !/^[a-f0-9]{64}$/.test(record.key)
          )
            throw new Error("Invalid cache record");
        } finally {
          await handle.close();
        }
        if (record.key === before.key) {
          const after = await inspect();
          if (
            after?.key === before.key &&
            after.guard === before.guard &&
            !executionOptions.signal?.aborted
          )
            return {
              status: "passed",
              exitCode: 0,
              durationMs: 0,
              reused: true,
              cache: {
                status: "hit",
                reason: "unchanged-inputs",
                inspectionDurationMs,
              },
            };
          cacheInfo = after ? { reason: "inputs-changed" } : inspectionProblem;
          before = undefined;
        } else cacheInfo = { reason: "inputs-changed" };
      } catch (error) {
        cacheInfo = {
          reason: error.code === "ENOENT" ? "no-success" : "invalid-record",
        };
      }
    }
    await discard();
    let result;
    try {
      result = await execute(suite, executionOptions);
    } catch (error) {
      await discard();
      throw error;
    }
    cacheInfo = { ...cacheInfo, recorded: false };
    if (executionOptions.signal?.aborted)
      cacheInfo.recordingReason = { reason: "execution-cancelled" };
    else if (result.status !== "passed")
      cacheInfo.recordingReason = { reason: "execution-not-passed" };
    else if (result.cleanupIncomplete)
      cacheInfo.recordingReason = { reason: "execution-cleanup-incomplete" };
    else if (result.reused)
      cacheInfo.recordingReason = { reason: "execution-not-fresh" };
    else if (before) {
      if (disabled.has(suite.id))
        cacheInfo.recordingReason = { reason: "cache-disabled" };
      else {
        const after = await inspect();
        if (after?.key === before.key && after.guard === before.guard) {
          const temporary = join(cache, `${randomUUID()}.tmp`);
          try {
            await privateDirectory();
            const handle = await open(temporary, "wx", 0o600);
            try {
              await handle.writeFile(JSON.stringify({ key: after.key }));
            } finally {
              await handle.close();
            }
            await rename(temporary, slot);
            cacheInfo.recorded = true;
          } catch {
            cacheInfo.recordingReason = { reason: "cache-write-failed" };
            await discard();
          } finally {
            try {
              await unlink(temporary);
            } catch {
              /* Optional cache cleanup. */
            }
          }
        } else
          cacheInfo.recordingReason = after
            ? { reason: "inputs-changed" }
            : inspectionProblem;
      }
    }
    return {
      ...result,
      reused: false,
      cache: {
        ...cacheInfo,
        status: !eligible
          ? "ineligible"
          : inspectionProblem || disabled.has(suite.id)
            ? "unavailable"
            : "miss",
        inspectionDurationMs,
      },
    };
  };
}
