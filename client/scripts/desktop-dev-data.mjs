import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

async function rejectSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Unsafe desktop development data symlink: ${path}`);
    if (entry.isDirectory()) await rejectSymlinks(path);
  }
}

export async function desktopDevDataRoot(appRoot) {
  const directory = join(dirname(await realpath(appRoot)), ".desktop-dev-data");
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Unsafe desktop development data directory: ${directory}`);
  await rejectSymlinks(directory);
  return directory;
}
