import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { runTauriDev, tauriDevCommand } from "./tauri-dev.mjs";

test("launch uses the requested root, environment and running server URL", () => {
  const command = tauriDevCommand(
    "/worktrees/navigation design/client/workshop",
    "http://127.0.0.1:49152",
    ["--no-watch"],
    { SITUATE_WORKSHOP_WORKTREE: "navigation design" },
  );
  assert.equal(command.env.SITUATE_WORKSHOP_WORKTREE, "navigation design");
  assert.equal(command.cwd, "/worktrees/navigation design/client/workshop");
  assert.deepEqual(JSON.parse(command.args[2]), {
    build: { beforeDevCommand: "", devUrl: "http://127.0.0.1:49152" },
  });
  assert.deepEqual(command.args.slice(3), ["--no-watch"]);
});

for (const outcome of ["exit", "error", "signal"]) {
  test(`server is closed after child ${outcome}`, async () => {
    let closed = false;
    const initialHandlers = process.listenerCount("SIGTERM");
    const run = runTauriDev({
      root: "/worktrees/client/app",
      start: async () => ({
        url: "http://127.0.0.1:49152",
        close: async () => {
          closed = true;
        },
      }),
      launch: () => {
        const child = new EventEmitter();
        child.kill = (signal) => {
          assert.equal(signal, "SIGTERM");
          child.emit("exit", null, signal);
        };
        queueMicrotask(() => {
          if (outcome === "error")
            child.emit("error", new Error("spawn failed"));
          else if (outcome === "signal") process.emit("SIGTERM");
          else child.emit("exit", 7, null);
        });
        return child;
      },
    });
    if (outcome === "error") await assert.rejects(run, /spawn failed/);
    else assert.equal(await run, outcome === "exit" ? 7 : 1);
    assert.equal(closed, true);
    assert.equal(process.listenerCount("SIGTERM"), initialHandlers);
  });
}

test("cancellation during startup closes the server without launching Tauri", async () => {
  let closed = false;
  await runTauriDev({
    root: "/worktrees/client/app",
    start: async () => {
      process.emit("SIGTERM");
      return {
        close: async () => {
          closed = true;
        },
      };
    },
    launch: () => assert.fail("unexpected launch"),
  });
  assert.equal(closed, true);
});
