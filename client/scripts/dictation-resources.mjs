import { readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

// Parakeet ASR needs no FluidAudio resource bundle; new bundle contents need review.
const unqualifiedResource =
  /^(?:fluidaudio.*\.bundle$|luxtts(?:[_.-]|$)|g2p(?:[_.-]|$))/i;

/** Read-only check of an unpacked macOS or iOS .app; throws on unqualified resources or unreadable paths. */
export async function assertNoDictationTtsResources(appPath) {
  const root = await realpath(resolve(appPath));
  if (!root.endsWith(".app") || !(await stat(root)).isDirectory()) {
    throw new Error(
      "Dictation resource check requires an unpacked .app directory",
    );
  }
  const entries = await readdir(root);
  const infoPath = entries.includes("Contents")
    ? join(root, "Contents", "Info.plist")
    : join(root, "Info.plist");
  const visited = new Set();
  async function inspect(path) {
    const target = await realpath(path);
    const targetRelative = relative(root, target);
    if (
      targetRelative.startsWith("../") ||
      targetRelative === ".." ||
      isAbsolute(targetRelative)
    ) {
      throw new Error(`App resource escapes package: ${relative(root, path)}`);
    }
    if (
      unqualifiedResource.test(basename(path)) ||
      unqualifiedResource.test(basename(target))
    ) {
      throw new Error(
        `Unqualified dictation resource: ${relative(root, path)}`,
      );
    }
    if (visited.has(target)) return;
    visited.add(target);
    if ((await stat(target)).isDirectory()) {
      for (const entry of await readdir(target))
        await inspect(join(target, entry));
    }
  }
  await inspect(root);
  if (!(await stat(infoPath)).isFile()) {
    throw new Error("Dictation resource check requires an app Info.plist");
  }
}
