import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { AgentRunError } from "./agent-e2e-runtime.mjs";

const maximumBytes = 2 * 1024 * 1024;

export function validateCredentialFile(
  metadata,
  { platform = process.platform, uid = process.getuid?.() } = {},
) {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size > maximumBytes ||
    metadata.size < 0 ||
    (platform !== "win32" &&
      ((metadata.mode & 0o7777) !== 0o600 || metadata.uid !== uid))
  )
    throw new AgentRunError("blocked", "unsafe-agent-test-key-file");
}

export async function readAgentKeyFile(directory) {
  const path = join(directory, ".env");
  let handle, key, failure;
  try {
    const before = await lstat(path);
    validateCredentialFile(before);
    handle = await open(
      path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const opened = await handle.stat();
    validateCredentialFile(opened);
    if (opened.dev !== before.dev || opened.ino !== before.ino)
      throw new AgentRunError("blocked", "unsafe-agent-test-key-file");
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(path);
    validateCredentialFile(after);
    validateCredentialFile(current);
    if (
      length > maximumBytes ||
      after.size !== length ||
      opened.size !== after.size ||
      opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      throw new AgentRunError("blocked", "unsafe-agent-test-key-file");
    key = parseEnv(
      buffer.subarray(0, length).toString("utf8"),
    ).TEST_OPENAI_API_KEY;
  } catch (error) {
    if (handle || error.code !== "ENOENT")
      failure =
        error instanceof AgentRunError
          ? error
          : new AgentRunError("blocked", "agent-test-key-file-unavailable");
  } finally {
    try {
      await handle?.close();
    } catch {
      failure ??= new AgentRunError(
        "blocked",
        "agent-test-key-file-unavailable",
      );
    }
  }
  if (failure) throw failure;
  return key;
}

export async function loadAgentTestKey({
  environment,
  directory,
  readFile = readAgentKeyFile,
}) {
  let key;
  if (Object.hasOwn(environment, "TEST_OPENAI_API_KEY"))
    key = environment.TEST_OPENAI_API_KEY;
  else if (environment.CI !== "true") key = await readFile(directory);
  if (typeof key !== "string" || !key.trim())
    throw new AgentRunError("blocked", "missing-TEST_OPENAI_API_KEY");
  return key;
}
