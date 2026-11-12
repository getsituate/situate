import assert from "node:assert/strict";
import test from "node:test";
import { runCoordinatedNativeAgent } from "./coordinated-native-agent.mjs";

const options = {
  cwd: "/temporary/work tree",
  env: { PATH: "/usr/bin", TMPDIR: "/temporary/owned/tmp" },
  timeoutMs: 1000,
};

test("native agent queues only the executable with its private environment and suppresses raw output", async () => {
  let requested;
  await runCoordinatedNativeAgent(
    "/temporary/native app",
    [],
    options,
    async (value) => {
      requested = value;
      value.output.write("synthetic-private-native-output");
      return 0;
    },
  );
  assert.equal(requested.resource, "desktop");
  assert.equal(requested.command, "/temporary/native app");
  assert.equal(requested.directory, options.cwd);
  assert.equal(requested.environment, options.env);
  assert.equal(requested.environment.HOME, undefined);
});

test("uncertain supervisor cleanup retains recovery data without exposing diagnostics", async () => {
  for (const run of [
    async () => 2,
    async () => {
      throw new Error("synthetic-private-diagnostic");
    },
  ]) {
    await assert.rejects(
      runCoordinatedNativeAgent("/unused", [], options, run),
      {
        outcome: "blocked",
        code: "process-cleanup-failed",
        cleanupUnsafe: true,
      },
    );
  }
});

test("native agent preserves nonzero exit, deadline and interruption classifications", async () => {
  await assert.rejects(
    runCoordinatedNativeAgent("/unused", [], options, async () => 1),
    { outcome: "product", code: "child-failed" },
  );
  await assert.rejects(
    runCoordinatedNativeAgent(
      "/unused",
      [],
      { ...options, timeoutMs: 1 },
      async ({ signal }) => {
        await new Promise((resolve) => {
          const keepAlive = setInterval(() => {}, 1000);
          signal.addEventListener(
            "abort",
            () => {
              clearInterval(keepAlive);
              resolve();
            },
            { once: true },
          );
        });
        return 130;
      },
    ),
    { outcome: "budget", code: "deadline-exceeded" },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runCoordinatedNativeAgent(
      "/unused",
      [],
      { ...options, signal: controller.signal },
      () => assert.fail("queued after interruption"),
    ),
    { outcome: "cancel", code: "interrupted" },
  );
});
