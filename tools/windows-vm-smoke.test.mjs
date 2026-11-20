import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSmokeArtifact, reserveGuest } from "./windows-vm-smoke.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "situate-windows-vm-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("guest lease survives a waiting caller's abort and does not steal stale ownership", async (t) => {
  const lease = join(await fixture(t), "guest.lease");
  const release = await reserveGuest(
    lease,
    "first",
    new AbortController().signal,
  );
  const second = new AbortController();
  const waiting = reserveGuest(lease, "second", second.signal);
  second.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  await assert.rejects(
    reserveGuest(lease, "third", new AbortController().signal, 0),
    /still held/,
  );
  assert.equal(await readFile(join(lease, "first"), "utf8"), "");
  await release();
  const releaseThird = await reserveGuest(
    lease,
    "third",
    new AbortController().signal,
  );
  await releaseThird();
});

test("ordinary build artifacts and changed smoke bytes cannot start a VM test", async (t) => {
  const directory = await fixture(t);
  const file = join(directory, "manifest.json");
  const bytes = Buffer.from("synthetic artifact");
  await writeFile(join(directory, "situate-client.exe"), bytes);
  const manifest = {
    source: "a".repeat(40),
    target: "x86_64-pc-windows-msvc",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(loadSmokeArtifact(directory), /isolated smoke build/);
  manifest.kind = "situate-windows-smoke";
  manifest.profile = "profile";
  await writeFile(file, JSON.stringify(manifest));
  assert.deepEqual(await loadSmokeArtifact(directory), { bytes, manifest });
  await writeFile(join(directory, "situate-client.exe"), "changed artifact");
  await assert.rejects(loadSmokeArtifact(directory), /hash mismatch/);
});
