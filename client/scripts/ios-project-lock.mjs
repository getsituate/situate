import {
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

export function assertLocalPath(root, path) {
  const parts = relative(root, path).split(/[\\/]/);
  if (parts.includes("..") || resolve(root, ...parts) !== resolve(path))
    throw new Error(`Output must stay inside ${root}.`);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error(
          `Generated output must not use a symbolic link: ${current}`,
        );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

export function acquireIosProject(
  root,
  kind = "xcode",
  releaseLogger = console.error,
) {
  const output = join(root, "target/ios-xcode");
  assertLocalPath(root, output);
  mkdirSync(output, { recursive: true });
  const lock = join(output, "session.lock");
  const build = join(output, "build.lock");
  const checkBuild = () => {
    if (existsSync(build))
      throw new Error(
        `An Xcode build lock exists: ${build}. Stop the build before removing a stale lock.`,
      );
  };
  checkBuild();
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      `An iOS session lock exists: ${lock}. Stop its session and Xcode builds before removing a stale lock.`,
      { cause: error },
    );
  }
  try {
    checkBuild();
    writeFileSync(
      join(lock, "owner.json"),
      JSON.stringify({
        kind,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    rmSync(lock, { recursive: true });
    throw error;
  }
  return () => {
    if (existsSync(build)) {
      releaseLogger(
        `Xcode is still building. The iOS session lock remains at ${lock}. After the build stops, check its processes before removing the lock.`,
      );
    } else rmSync(lock, { recursive: true, force: true });
  };
}
