import assert from "node:assert/strict";
import test from "node:test";
import { runCoordinatedSmokePhase } from "./coordinated-native-smoke.mjs";

test("only the GUI phase is queued with its isolated environment and cancellation signal", async () => {
  const controller = new AbortController();
  let requested;
  await runCoordinatedSmokePhase(
    "/temporary/build with spaces/app",
    {
      cwd: "/temporary/work tree/client",
      args: ["--recovery"],
      recovery: true,
      timeout: 120000,
      env: {
        SITUATE_SMOKE_ROOT: "/temporary/owned data",
        SITUATE_SMOKE_OWNER: "test-owner",
        SITUATE_PUBLIC_REPOSITORY_LIVE: undefined,
      },
      signal: controller.signal,
    },
    async (options) => {
      requested = options;
      return 0;
    },
  );
  assert.equal(requested.resource, "desktop");
  assert.equal(requested.directory, "/temporary/work tree/client");
  assert.equal(requested.command, process.execPath);
  assert.match(requested.args[0], /native-smoke-phase\.mjs$/);
  assert.deepEqual(JSON.parse(requested.args[1]), {
    executable: "/temporary/build with spaces/app",
    args: ["--recovery"],
    recovery: true,
    timeout: 120000,
  });
  assert.equal(
    requested.environment.SITUATE_SMOKE_ROOT,
    "/temporary/owned data",
  );
  assert.equal(requested.environment.SITUATE_SMOKE_OWNER, "test-owner");
  assert.equal(requested.environment.SITUATE_PUBLIC_REPOSITORY_LIVE, undefined);
  assert.equal(requested.signal, controller.signal);
});

test("queue failure and cancellation cannot appear as successful qualification", async () => {
  await assert.rejects(
    runCoordinatedSmokePhase(
      "/unused",
      { cwd: "/temporary", phase: "diagnostics" },
      async () => 17,
    ),
    /diagnostics.*exit 17/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runCoordinatedSmokePhase(
      "/unused",
      { cwd: "/temporary", signal: controller.signal },
      () => assert.fail("queued after cancellation"),
    ),
    { name: "AbortError" },
  );
});
