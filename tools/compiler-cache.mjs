import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

function findSccache(path) {
  for (const directory of (path ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const executable = join(directory, "sccache");
    try {
      accessSync(executable, constants.X_OK);
      if (statSync(executable).isFile()) return executable;
    } catch {
      // An unavailable optional compiler cache must not prevent a build.
    }
  }
}

function sccacheVersion(executable) {
  const result = spawnSync(executable, ["--version"], {
    env: { SCCACHE_CONF: "/dev/null" },
    encoding: "utf8",
    timeout: 1000,
    maxBuffer: 4096,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

export function compilerCacheEnvironment(
  environment,
  {
    configuration = environment,
    find = findSccache,
    version = sccacheVersion,
    platform = process.platform,
  } = {},
) {
  const env = { ...environment };
  if (
    configuration.SITUATE_SCCACHE === "0" ||
    Object.hasOwn(env, "RUSTC_WRAPPER") ||
    Object.hasOwn(env, "RUSTC_WORKSPACE_WRAPPER") ||
    !["darwin", "linux"].includes(platform)
  )
    return env;
  const executable = find(env.PATH);
  if (!executable) return env;
  const release = /^sccache (\d+)\.(\d+)\.(\d+)$/.exec(version(executable));
  if (!release || (Number(release[1]) === 0 && Number(release[2]) < 19))
    return env;
  const home = configuration.HOME;
  const directory =
    configuration.SCCACHE_DIR ??
    (home &&
      join(
        home,
        platform === "darwin" ? "Library/Caches" : ".cache",
        "situate/sccache",
      ));
  if (!directory || !isAbsolute(directory))
    throw new Error("SCCACHE_DIR must be an absolute path.");
  const size = configuration.SCCACHE_CACHE_SIZE ?? "50G";
  if (!/^[1-9][0-9]*[KMGT]?$/.test(size))
    throw new Error("SCCACHE_CACHE_SIZE must be a positive size such as 50G.");

  // Keep the shared local server independent of remote-cache settings and homes.
  for (const name of Object.keys(env))
    if (name.startsWith("SCCACHE_")) delete env[name];
  return {
    ...env,
    RUSTC_WRAPPER: executable,
    SCCACHE_DIR: directory,
    SCCACHE_CACHE_SIZE: size,
    SCCACHE_CONF: "/dev/null",
    // Compiler temporaries must belong to the client, not a daemon outliving it.
    SCCACHE_CLIENT_SIDE: "1",
    SCCACHE_SERVER_PORT: "4227",
    SCCACHE_IGNORE_SERVER_IO_ERROR: "1",
  };
}

export function nativeSmokeBuildEnvironment(environment = process.env) {
  return compilerCacheEnvironment({
    ...environment,
    CARGO_PROFILE_DEV_DEBUG:
      environment.CARGO_PROFILE_DEV_DEBUG ?? "line-tables-only",
  });
}
