import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { runCoordinatedNativeAgent } from "./coordinated-native-agent.mjs";
import { runCoordinated } from "../../tools/run-coordinated.mjs";

async function waitPid(path) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const value = await readFile(path, "utf8");
      if (/^[1-9][0-9]*$/.test(value)) return Number(value);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(20);
  }
  assert.fail("Fixture process did not become ready.");
}

test(
  "agent cancellation drains the queued native executable before returning",
  { timeout: 20000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "queued native agent "));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "tmp"));
    const marker = join(root, "pid");
    const controller = new AbortController();
    const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); console.log('synthetic-private-native-output'); setInterval(() => {}, 1000);`;
    const run = runCoordinatedNativeAgent(
      process.execPath,
      ["-e", source],
      {
        cwd: root,
        env: { PATH: process.env.PATH, HOME: root, TMPDIR: join(root, "tmp") },
        signal: controller.signal,
        timeoutMs: 15000,
      },
      // This Node fixture does not use the desktop.
      (options) => runCoordinated({ ...options, resource: "worktree" }),
    );
    const outcome = run.then(
      () => null,
      (error) => error,
    );
    t.after(async () => {
      controller.abort();
      await outcome;
    });
    const pid = await waitPid(marker);
    controller.abort();
    const error = await outcome;
    assert.equal(error.outcome, "cancel");
    assert.equal(error.code, "interrupted");
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  },
);
