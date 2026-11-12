import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const waitSource = readFileSync(
  new URL("../app/src-tauri/tests/support/native-wait.js", import.meta.url),
  "utf8",
);
const source = readFileSync(
  new URL("../app/src-tauri/tests/support/workspace-smoke.js", import.meta.url),
  "utf8",
);
const settle = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

function harness({ workspaceReady = true } = {}) {
  let now = 0;
  let shellReady = false;
  let shellError;
  let open = [{ id: "workspace-a" }];
  const known = [...open];
  const timers = new Map();
  let sequence = 0;
  const reports = [];
  const registries = [];
  let closed = false;
  let checkpoint;
  const completed = runInNewContext(`${waitSource}\n${source}`, {
    Date: { now: () => now },
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    document: {
      querySelector(selector) {
        assert.equal(selector, ".workspace-entry");
        return open.length === 0 ? {} : null;
      },
    },
    window: {
      __TAURI_INTERNALS__: {
        async invoke(command, args) {
          switch (command) {
            case "workspace_snapshot":
              return {
                ready: workspaceReady,
                mobile: false,
                open,
                known,
                failures: [],
              };
            case "smoke_phase":
              if (shellError) throw shellError;
              return {
                restart: true,
                picker: true,
                isolated: true,
                shellReady,
              };
            case "smoke_progress":
              return;
            case "verify_smoke_registry":
              registries.push(JSON.parse(JSON.stringify(args)));
              return;
            case "smoke_close_window":
              assert.equal(args.id, "workspace-a");
              open = [];
              closed = true;
              return;
            case "smoke_checkpoint":
              checkpoint = args.restart;
              return;
            case "finish_smoke_test":
              reports.push(args.error);
              return;
            default:
              assert.fail(`Unexpected IPC: ${command}`);
          }
        },
      },
    },
  });
  return {
    completed,
    reports,
    registries,
    get closed() {
      return closed;
    },
    get checkpoint() {
      return checkpoint;
    },
    completeShell() {
      shellReady = true;
    },
    failShellObservation(error) {
      shellError = error;
    },
    async tick(ms) {
      const end = now + ms;
      while (true) {
        const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry || entry[1].at > end) break;
        now = entry[1].at;
        timers.delete(entry[0]);
        entry[1].callback();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

test("the workspace coordinator waits for the complete child journey beyond a single transition deadline", async () => {
  const h = harness();
  await settle();
  await h.tick(16000);
  assert.deepEqual(h.reports, []);
  assert.equal(h.closed, false);
  h.completeShell();
  await h.tick(25);
  await h.completed;
  assert.deepEqual(h.reports, [null]);
  assert.equal(h.closed, true);
  assert.equal(h.checkpoint, false);
  assert.deepEqual(h.registries, [
    { known: ["workspace-a"], restore: ["workspace-a"] },
    { known: ["workspace-a"], restore: [] },
  ]);
});

test("a delayed shell observation error is not replaced by the coordinator transition timeout", async () => {
  const h = harness();
  await settle();
  await h.tick(16000);
  h.failShellObservation(new Error("Shell status unavailable"));
  await h.tick(25);
  await h.completed;
  assert.deepEqual(h.reports, ["Error: Shell status unavailable"]);
  assert.equal(h.closed, false);
  assert.equal(h.checkpoint, undefined);
});

test("an individual workspace transition still fails at its own deadline", async () => {
  const h = harness({ workspaceReady: false });
  await settle();
  await h.tick(16000);
  await h.completed;
  assert.deepEqual(h.reports, [
    "NativeSmokeTimeout: Timed out waiting for workspace state",
  ]);
  assert.equal(h.closed, false);
  assert.equal(h.checkpoint, undefined);
});
