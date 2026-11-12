import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

class HookSetupError extends Error {}

export async function installWorktreeEnvHook(cwd = process.cwd()) {
  if (process.platform === "win32")
    throw new HookSetupError(
      "The worktree environment hook requires a POSIX host.",
    );
  const git = (args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).replace(/\n$/, "");
  let configured;
  try {
    configured = git(["config", "--get", "core.hooksPath"]);
  } catch (error) {
    if (error.status !== 1)
      throw new HookSetupError(
        "Could not inspect the repository hook configuration.",
      );
  }
  if (configured !== undefined)
    throw new HookSetupError(
      "core.hooksPath is already configured. Integrate tools/hooks/post-checkout with the existing hooks instead.",
    );
  let common;
  try {
    common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  } catch {
    throw new HookSetupError("Run this command inside a Git repository.");
  }
  const hooks = join(common, "hooks");
  await mkdir(hooks, { recursive: true });
  const directory = await lstat(hooks);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new HookSetupError(
      "The Git hooks directory must be a regular directory.",
    );
  const content = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), "hooks/post-checkout"),
  );
  const target = join(hooks, "post-checkout");
  let existing;
  try {
    existing = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new HookSetupError(
        "The existing post-checkout hook was not changed.",
      );
  }
  if (existing) {
    try {
      const metadata = await existing.stat();
      if (
        !metadata.isFile() ||
        metadata.size !== content.length ||
        !(await existing.readFile()).equals(content) ||
        !(metadata.mode & 0o100)
      )
        throw new HookSetupError(
          "A different or non-executable post-checkout hook already exists. It was not changed.",
        );
      return "already-installed";
    } finally {
      await existing.close();
    }
  }
  const temporary = join(hooks, `.post-checkout-${randomUUID()}`);
  const file = await open(temporary, "wx", 0o700);
  try {
    try {
      await file.chmod(0o700);
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await link(temporary, target);
  } finally {
    await unlink(temporary);
  }
  return "installed";
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const result = await installWorktreeEnvHook();
    console.log(
      result === "installed"
        ? "Worktree environment hook installed."
        : "Worktree environment hook is already installed.",
    );
  } catch (error) {
    console.error(
      error instanceof HookSetupError
        ? error.message
        : "Could not install the worktree environment hook.",
    );
    process.exitCode = 1;
  }
}
