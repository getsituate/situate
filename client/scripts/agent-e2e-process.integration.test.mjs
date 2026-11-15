import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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
    const rejected = assert.rejects(pending, (error) => {
      assert.equal(error.outcome, "cancel");
      assert.equal(error.code, "interrupted");
      assert.equal(error.build, undefined);
      return true;
    });
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

for (const [lastStage, output] of [
  [
    "unknown",
    "Blocking waiting for file lock /private/home sk-synthetic-secret --token=secret",
  ],
  ["dependency", "    Updating crates.io index /private/home"],
  ["frontend", "vite v8.3.5 building client environment for production..."],
  [
    "compilation",
    "\u001b[32m   Compiling\u001b[0m synthetic v1.0.0 (/private/home)",
  ],
  ["linking", "   Linking /private/home/synthetic"],
]) {
  test(
    `build deadline retains only the last observed stage: ${lastStage}`,
    { timeout: 10000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), "situate-build-deadline-"));
      const ready = join(root, "ready");
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const pending = runChild(
        process.execPath,
        [
          "--eval",
          `
const output = process.${lastStage === "frontend" ? "stdout" : "stderr"};
${lastStage === "unknown" ? "" : 'output.write("   Compiling earlier v1.0.0\\n");'}
output.write("synthetic-secret /private/home --token=secret\\n".repeat(10000));
output.write(${JSON.stringify(output.slice(0, 8))});
output.write(${JSON.stringify(output.slice(8) + "\n")});
output.write("unclassified stderr sk-synthetic-secret --token=secret\\n", () => {
  require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid));
});
setInterval(() => {}, 1000);
`,
        ],
        { env: {}, timeoutMs: 900000, buildDiagnostics: true },
      );
      const rejected = assert.rejects(pending, (error) => {
        assert.equal(error.outcome, "budget");
        assert.equal(error.code, "deadline-exceeded");
        assert.equal(error.cleanupUnsafe, undefined);
        assert.deepEqual(Object.keys(error.build).sort(), [
          "elapsedMs",
          "lastStage",
          "reason",
        ]);
        assert.equal(error.build.reason, "deadline-exceeded");
        assert.equal(error.build.lastStage, lastStage);
        assert.ok(Number.isInteger(error.build.elapsedMs));
        assert.ok(
          error.build.elapsedMs >= 0 && error.build.elapsedMs <= 2147483647,
        );
        assert.doesNotMatch(JSON.stringify(error), /synthetic|private|token/);
        return true;
      });
      try {
        const deadline = performance.now() + 5000;
        while (true) {
          try {
            await access(ready);
            break;
          } catch (error) {
            assert.equal(error.code, "ENOENT");
          }
          assert.ok(
            performance.now() < deadline,
            "Child did not produce output",
          );
          await new Promise(setImmediate);
        }
        await new Promise(setImmediate);
        t.mock.timers.tick(900000);
        t.mock.timers.tick(1000);
        await rejected;
        const pid = Number(await readFile(ready, "utf8"));
        const cleanupDeadline = performance.now() + 3000;
        while (true) {
          try {
            process.kill(pid, 0);
          } catch (error) {
            assert.equal(error.code, "ESRCH");
            break;
          }
          assert.ok(
            performance.now() < cleanupDeadline,
            "Child survived cleanup",
          );
          await new Promise(setImmediate);
        }
      } finally {
        t.mock.timers.tick(901000);
        try {
          await rejected;
        } finally {
          t.mock.timers.reset();
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  );
}

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
