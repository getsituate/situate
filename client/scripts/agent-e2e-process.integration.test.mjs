import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runChild } from "./agent-e2e-runtime.mjs";

test("CLI help exits successfully with structured usage and no credentials", async () => {
  const output = await runChild(
    process.execPath,
    [fileURLToPath(new URL("./test-agent-e2e.mjs", import.meta.url)), "--help"],
    {
      env: {},
      timeoutMs: 10000,
      capture: true,
    },
  );
  const report = JSON.parse(output);
  assert.equal(report.outcome, "help");
  assert.match(report.help, /gpt-4.1-mini/);
});

test("child execution bounds hanging processes and does not export secret output", async () => {
  await assert.rejects(
    runChild(
      process.execPath,
      ["-e", "console.error('synthetic-secret'); setInterval(() => {}, 1000)"],
      {
        env: {},
        timeoutMs: 100,
      },
    ),
    (error) =>
      error.outcome === "budget" && !error.message.includes("synthetic-secret"),
  );
});

for (const mode of [
  { capture: false },
  { capture: true },
  { buildDiagnostics: true },
]) {
  test(
    `early command exit terminates TERM-ignoring descendants (${JSON.stringify(mode)})`,
    { timeout: 10000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "situate-process-tree-"));
      const late = join(root, "late");
      const descendant = `process.on('SIGTERM', () => {}); process.send('ready'); setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(late)}, 'unexpected'); process.exit(0); }, 1500);`;
      const parent = `const child = require('node:child_process').spawn(process.execPath, ['--eval', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }); child.once('message', () => process.exit(0));`;
      try {
        const start = performance.now();
        const result = await runChild(process.execPath, ["--eval", parent], {
          env: {},
          timeoutMs: 5000,
          ...mode,
        });
        assert.equal(result, "");
        assert.ok(
          performance.now() - start < 1200,
          "Waited for an orphaned output pipe",
        );
        await delay(1600);
        await assert.rejects(access(late));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}

test(
  "cancellation escalates across a live TERM-ignoring process tree",
  { timeout: 10000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "situate-process-cancel-"));
    const ready = join(root, "ready");
    const late = join(root, "late");
    const controller = new AbortController();
    const descendant = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(late)}, 'unexpected'); process.exit(0); }, 1700);`;
    const parent = `require('node:child_process').spawn(process.execPath, ['--eval', ${JSON.stringify(descendant)}], { stdio: 'inherit' }); setInterval(() => {}, 1000);`;
    const pending = runChild(process.execPath, ["--eval", parent], {
      env: {},
      timeoutMs: 5000,
      capture: true,
      signal: controller.signal,
      buildDiagnostics: true,
    });
    const rejected = assert.rejects(
      pending,
      (error) => error.outcome === "cancel",
    );
    try {
      const deadline = performance.now() + 3000;
      while (true) {
        try {
          await access(ready);
          break;
        } catch (error) {
          assert.equal(error.code, "ENOENT");
        }
        assert.ok(performance.now() < deadline, "Descendant did not start");
        await delay(10);
      }
      controller.abort();
      await rejected;
      await delay(900);
      await assert.rejects(access(late));
    } finally {
      controller.abort();
      await rejected;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("build failures report only bounded classifications and exit status", async () => {
  for (const stream of ["stdout", "stderr"]) {
    await assert.rejects(
      runChild(
        process.execPath,
        [
          "--eval",
          `
const output = process.${stream};
output.write("synthetic-secret /private/home\\n".repeat(10000));
output.write("scca");
output.write("che: caused by: Failed to create temp dir: /private/home\\n", () => process.exit(23));
`,
        ],
        { env: {}, timeoutMs: 10000, buildDiagnostics: true },
      ),
      (error) => {
        assert.equal(error.outcome, "product");
        assert.equal(error.code, "child-failed");
        assert.deepEqual(error.build, {
          reason: "sccache-tempdir-unavailable",
          exitCode: 23,
        });
        assert.doesNotMatch(JSON.stringify(error), /synthetic-secret|private/);
        return true;
      },
    );
  }
  await assert.rejects(
    runChild(
      process.execPath,
      ["--eval", "console.error('synthetic-secret'); process.exit(1)"],
      {
        env: {},
        timeoutMs: 10000,
        buildDiagnostics: true,
      },
    ),
    (error) => {
      assert.deepEqual(error.build, { reason: "command-failed", exitCode: 1 });
      assert.doesNotMatch(JSON.stringify(error), /synthetic-secret/);
      return true;
    },
  );
  assert.equal(
    await runChild(
      process.execPath,
      [
        "--eval",
        "console.error('synthetic-secret'); console.log('private-output')",
      ],
      {
        env: {},
        timeoutMs: 10000,
        buildDiagnostics: true,
      },
    ),
    "",
  );
});

test("child cancellation and spawn failures return sanitized typed outcomes", async () => {
  const controller = new AbortController();
  const pending = runChild(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      env: {},
      timeoutMs: 10000,
      signal: controller.signal,
    },
  );
  controller.abort();
  await assert.rejects(pending, (error) => error.outcome === "cancel");
  await assert.rejects(
    runChild("/nonexistent/synthetic-secret", [], {
      env: {},
      timeoutMs: 10000,
    }),
    (error) =>
      error.code === "executable-unavailable" &&
      !error.message.includes("synthetic-secret"),
  );
});
