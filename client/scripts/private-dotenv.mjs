import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { parseEnv } from "node:util";

const maximumBytes = 2 * 1024 * 1024;

function validateEnvFile(stat) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > maximumBytes ||
    (typeof process.getuid === "function" &&
      ((stat.mode & 0o7777) !== 0o600 || stat.uid !== process.getuid()))
  )
    throw new Error(
      "Repository-root .env must be an owned, private regular file (chmod 600), without links, no larger than 2 MiB.",
    );
}

export function readPrivateDotenv(path, selectedNames) {
  let handle;
  try {
    let before;
    try {
      before = lstatSync(path);
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
    validateEnvFile(before);
    handle = openSync(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(handle);
    validateEnvFile(opened);
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      throw new Error("Repository-root .env changed while opening it.");
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(
        handle,
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!count) break;
      length += count;
    }
    const after = fstatSync(handle);
    const current = lstatSync(path);
    validateEnvFile(after);
    validateEnvFile(current);
    if (
      length > maximumBytes ||
      length !== after.size ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      throw new Error("Repository-root .env changed while reading it.");
    const parsed = parseEnv(buffer.subarray(0, length).toString("utf8"));
    return Object.fromEntries(
      selectedNames
        .filter((key) => Object.hasOwn(parsed, key))
        .map((key) => [key, parsed[key]]),
    );
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}
