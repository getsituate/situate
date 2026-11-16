import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function grant(path, token) {
  try {
    const info = lstatSync(path);
    assert(info.isFile() && info.nlink === 1 && info.uid === process.getuid() && (info.mode & 0o077) === 0 && info.size <= 256, "Invalid host build grant");
    return JSON.parse(readFileSync(path, "utf8")).token === token;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function withHostBuildAdmission(run, {
  environment = process.env,
  signal,
  onTiming = () => {},
} = {}) {
  signal?.throwIfAborted();
  const root = environment.SITUATE_HOST_ADMISSION;
  if (!root || environment.SITUATE_HOST_ADMITTED === "1") return run(environment);
  assert.equal(environment.SITUATE_TOOL_CONTAINER, "1", "Host admission requires a tool container");
  assert(isAbsolute(root), "Host admission path must be absolute");
  const info = lstatSync(root);
  assert(info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o077) === 0, "Host admission directory must be private and owned");
  const gate = join(root, "phase");
  const queued = performance.now();
  while (true) {
    signal?.throwIfAborted();
    try {
      mkdirSync(gate, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await delay(25, undefined, { signal });
    }
  }
  const token = randomUUID();
  const request = join(root, "request.json");
  const acknowledgement = join(root, "grant.json");
  let published = false;
  let acquired;
  const emit = (event) => { try { onTiming(event); } catch { /* Timing cannot change admission ownership. */ } };
  try {
    const temporary = join(gate, "request.json");
    writeFileSync(temporary, JSON.stringify({ token }), { flag: "wx", mode: 0o600 });
    renameSync(temporary, request);
    published = true;
    while (!grant(acknowledgement, token)) {
      await delay(25, undefined, { signal });
    }
    signal?.throwIfAborted();
    acquired = performance.now();
    emit({ phase: "acquired", resource: "build", waitMs: Math.round(acquired - queued) });
    return await run({ ...environment, SITUATE_HOST_ADMITTED: "1" });
  } finally {
    // Only a settled phase may withdraw its request; hard death leaves it for
    // the host's Docker owner to retain until container absence is verified.
    if (published) {
      const release = join(root, "release.json");
      const released = join(root, "released.json");
      const temporary = join(gate, "release.json");
      writeFileSync(temporary, JSON.stringify({ token }), { flag: "wx", mode: 0o600 });
      renameSync(temporary, release);
      while (!grant(released, token)) await delay(25);
      unlinkSync(request);
      unlinkSync(release);
      unlinkSync(released);
    }
    rmdirSync(gate);
    if (acquired !== undefined) emit({ phase: "released", resource: "build", waitMs: Math.round(acquired - queued), runMs: Math.round(performance.now() - acquired) });
  }
}
