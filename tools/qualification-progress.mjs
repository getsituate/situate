import assert from "node:assert/strict";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readSync,
  writeSync,
} from "node:fs";

const maxBytes = 1024 * 1024;
const maxEvents = 4096;
const phases = new Set([
  "desktop",
  "candidate_payload",
  "prepare",
  "install",
  "journeys",
  "update",
  "inspect",
  "cleanup",
]);
const commands = new Set([
  "none",
  "accessibility",
  "process",
  "route",
  "mount",
  "detach",
  "gatekeeper",
  "stapler",
  "codesign",
  "copy",
  "archive",
  "identity",
  "architecture",
  "quarantine",
  "launch",
  "terminate",
]);
const statuses = new Set([
  "started",
  "completed",
  "queued",
  "acquired",
  "released",
  "timeout",
  "cancelled",
  "nonzero",
  "failed",
]);

export function validateQualificationProgress(event) {
  assert(
    event &&
      Object.keys(event).sort().join() === "command,elapsedMs,phase,status",
    "Invalid qualification progress",
  );
  assert(
    phases.has(event.phase) &&
      commands.has(event.command) &&
      statuses.has(event.status) &&
      Number.isSafeInteger(event.elapsedMs) &&
      event.elapsedMs >= 0 &&
      event.elapsedMs <= 24 * 60 * 60 * 1000,
    "Invalid qualification progress",
  );
  assert(
    event.phase === "desktop"
      ? event.command === "none" &&
          ["queued", "acquired", "released"].includes(event.status)
      : !["queued", "acquired", "released"].includes(event.status),
    "Invalid qualification progress",
  );
  return event;
}

function checkedFile(path, flags) {
  const fd = openSync(path, flags | constants.O_NOFOLLOW, 0o600);
  try {
    checkFile(fd, path);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
function checkFile(fd, path) {
  const stat = fstatSync(fd);
  const entry = lstatSync(path);
  assert(
    stat.isFile() &&
      stat.nlink === 1 &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o777) === 0o600 &&
      stat.size <= maxBytes &&
      !entry.isSymbolicLink() &&
      entry.dev === stat.dev &&
      entry.ino === stat.ino,
    "Unsafe qualification progress file",
  );
  return stat;
}

export function createQualificationProgressFile(path) {
  const fd = checkedFile(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
  );
  closeSync(fd);
}

export function qualificationProgressWriter(path) {
  const started = performance.now();
  let count = 0;
  return (
    phase,
    status,
    command = "none",
    elapsedMs = Math.round(performance.now() - started),
  ) => {
    const event = validateQualificationProgress({
      phase,
      status,
      command,
      elapsedMs,
    });
    const line = `${JSON.stringify(event)}\n`;
    assert(++count <= maxEvents, "Qualification progress event limit exceeded");
    const fd = checkedFile(path, constants.O_WRONLY | constants.O_APPEND);
    try {
      assert(
        fstatSync(fd).size + Buffer.byteLength(line) <= maxBytes,
        "Qualification progress byte limit exceeded",
      );
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
  };
}

export function observeQualificationProgress(
  path,
  { output = process.stderr, intervalMs = 100 } = {},
) {
  const fd = checkedFile(path, constants.O_RDONLY);
  const started = performance.now();
  let offset = 0;
  let pending = "";
  let count = 0;
  let last;
  let lastPhase;
  let lastCommand;
  let failure;
  let invalid = false;
  const poll = () => {
    if (invalid) return;
    try {
      const stat = checkFile(fd, path);
      assert(stat.size >= offset, "Qualification progress was truncated");
      const buffer = Buffer.alloc(stat.size - offset);
      offset += readSync(fd, buffer, 0, buffer.length, offset);
      pending += buffer.toString("utf8");
      assert(pending.length <= maxBytes, "Qualification progress overflow");
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        assert(
          ++count <= maxEvents && line.length <= 256,
          "Qualification progress overflow",
        );
        const event = validateQualificationProgress(JSON.parse(line));
        last = event;
        if (event.phase !== "desktop" && event.command === "none")
          lastPhase = event;
        if (event.command !== "none") lastCommand = event;
        if (
          ["timeout", "cancelled", "nonzero", "failed"].includes(
            event.status,
          ) &&
          (!failure || (failure.command === "none" && event.command !== "none"))
        )
          failure = event;
        output.write(`Qualification progress ${JSON.stringify(event)}\n`);
      }
    } catch {
      invalid = true;
      output.write("Qualification progress protocol invalid\n");
    }
  };
  const timer = setInterval(poll, intervalMs);
  timer.unref();
  return {
    poll,
    summary(status) {
      assert(
        ["timeout", "cancelled", "failed"].includes(status),
        "Invalid qualification failure status",
      );
      poll();
      const summary = {
        status,
        elapsedMs: Math.round(performance.now() - started),
        last: last ?? null,
        phase: lastPhase ?? null,
        command: lastCommand ?? null,
        failure: failure ?? null,
        invalid,
      };
      output.write(`Qualification failure ${JSON.stringify(summary)}\n`);
      return summary;
    },
    close() {
      clearInterval(timer);
      poll();
      closeSync(fd);
      assert(
        !invalid && pending === "",
        "Invalid qualification progress protocol",
      );
    },
  };
}

export async function qualificationPhase(progress, phase, action, signal) {
  progress(phase, "started");
  try {
    signal?.throwIfAborted();
    const result = await action();
    signal?.throwIfAborted();
    progress(phase, "completed");
    return result;
  } catch (error) {
    progress(phase, signal?.aborted ? "cancelled" : "failed");
    throw error;
  }
}
