import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../app/src-tauri/tests/support/native-wait.js", import.meta.url),
  "utf8",
);
const layout = await readFile(
  new URL("../app/src-tauri/tests/support/layout-smoke.js", import.meta.url),
  "utf8",
);
const workspace = await readFile(
  new URL("../app/src-tauri/tests/support/workspace-smoke.js", import.meta.url),
  "utf8",
);
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function fixture(invoke = async () => true) {
  let time = 0;
  let next = 0;
  const timers = new Map();
  const window = { __TAURI_INTERNALS__: { invoke } };
  const context = {
    window,
    performance: { now: () => time },
    setTimeout(callback, delay) {
      const id = ++next;
      timers.set(id, { at: time + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  runInNewContext(source, context);
  return {
    window,
    context,
    timers,
    smoke: window.nativeSmokeWait,
    elapse(milliseconds) {
      time += milliseconds;
    },
    async advance(milliseconds) {
      await flush();
      const end = time + milliseconds;
      while (true) {
        const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry || entry[1].at > end) break;
        time = entry[1].at;
        timers.delete(entry[0]);
        entry[1].callback();
        await flush();
      }
      time = end;
      await flush();
    },
  };
}
const timeout = (message) => (error) => {
  assert.equal(error.name, "NativeSmokeTimeout");
  assert.match(error.message, message);
  return true;
};

test("successful probes and rejected IPC preserve values and clear timers", async () => {
  const error = new Error("native failure");
  const f = fixture(() => Promise.reject(error));
  const value = { ready: true };
  assert.equal(await f.smoke.wait(() => value, "transition"), value);
  await assert.rejects(
    f.smoke.invoke("snapshot"),
    (actual) => actual === error,
  );
  await assert.rejects(
    f.smoke.wait(() => {
      throw error;
    }, "transition"),
    (actual) => actual === error,
  );
  assert.equal(f.timers.size, 0);
});

test("a permanently pending probe reaches its transition deadline", async () => {
  const f = fixture();
  const rejected = assert.rejects(
    f.smoke.wait(() => new Promise(() => {}), "transition", { timeout: 100 }),
    timeout(/transition/),
  );
  await f.advance(100);
  await rejected;
  assert.equal(f.timers.size, 0);
});

test("late probe completion cannot replace a timeout or leave an unhandled rejection", async () => {
  for (const rejectLate of [false, true]) {
    const f = fixture();
    let finish;
    const probe = new Promise((resolve, reject) => {
      finish = rejectLate ? reject : resolve;
    });
    const rejected = assert.rejects(
      f.smoke.wait(() => probe, "transition", { timeout: 100 }),
      timeout(/transition/),
    );
    await f.advance(100);
    await rejected;
    finish(rejectLate ? new Error("late observation") : true);
    await flush();
    assert.equal(f.timers.size, 0);
  }
});

test("expired success and error are rejected even before timer delivery", async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    await assert.rejects(
      f.smoke.wait(
        () => {
          f.elapse(100);
          if (fail) throw new Error("late observation");
          return true;
        },
        "transition",
        { timeout: 100 },
      ),
      timeout(/transition/),
    );
    assert.equal(f.timers.size, 0);
  }
});

test("IPC has its own budget within a longer transition", async () => {
  const f = fixture(() => new Promise(() => {}));
  const rejected = assert.rejects(
    f.smoke.wait(({ invoke }) => invoke("snapshot"), "transition"),
    timeout(
      /Native IPC timed out: snapshot; the native operation may still complete/,
    ),
  );
  await f.advance(10000);
  await rejected;
  assert.equal(f.timers.size, 0);
});

test("a later IPC probe receives only the remaining transition time", async () => {
  let calls = 0;
  const f = fixture(() => (++calls === 1 ? false : new Promise(() => {})));
  const rejected = assert.rejects(
    f.smoke.wait(
      ({ invoke }) => invoke("snapshot", {}, { timeout: 300000 }),
      "transition",
      { timeout: 100, interval: 75 },
    ),
    timeout(/transition/),
  );
  await f.advance(75);
  assert.equal(calls, 2);
  assert.deepEqual(
    [...f.timers.values()].map((timer) => timer.at),
    [100, 100],
  );
  await f.advance(25);
  await rejected;
  assert.equal(f.timers.size, 0);
});

test("nested waits cannot extend their parent's deadline", async () => {
  const f = fixture();
  const rejected = assert.rejects(
    f.smoke.wait(
      (step) => step.wait(() => false, "inner", { timeout: 1000 }),
      "outer",
      { timeout: 100 },
    ),
    timeout(/outer/),
  );
  await f.advance(100);
  await rejected;
  assert.equal(f.timers.size, 0);
});

test("poll sleeps are clamped and no new probe starts after expiry", async () => {
  const f = fixture();
  let calls = 0;
  const rejected = assert.rejects(
    f.smoke.wait(
      () => {
        calls++;
        return false;
      },
      "transition",
      {
        timeout: 10,
        interval: 50,
      },
    ),
    timeout(/transition/),
  );
  await f.advance(10);
  await rejected;
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
});

test("separate transitions do not impose a short whole-journey deadline", async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) {
    const pending = f.smoke.wait(
      () =>
        new Promise((resolve) => {
          f.context.setTimeout(() => resolve(true), 9000);
        }),
      "transition",
      { timeout: 10000 },
    );
    await f.advance(9000);
    assert.equal(await pending, true);
  }
  assert.equal(f.timers.size, 0);
});

test("interactive IPC can use a longer budget", async () => {
  const f = fixture(
    () =>
      new Promise((resolve) => {
        f.context.setTimeout(() => resolve("selected"), 12000);
      }),
  );
  const selected = f.smoke.invoke("workspace_parent", {}, { timeout: 300000 });
  await f.advance(12000);
  assert.equal(await selected, "selected");
  assert.equal(f.timers.size, 0);
});

test("file-target polling rejects a stalled IPC at the remaining layout deadline", async () => {
  let calls = 0;
  const f = fixture(() => (++calls === 1 ? {} : new Promise(() => {})));
  f.context.document = { querySelector: () => null };
  runInNewContext(layout, f.context);
  const rejected = assert.rejects(
    f.window.waitSmokeFileTarget("workspace", "file.md"),
    timeout(/file target was not durably selected/),
  );
  await f.advance(10000);
  await rejected;
  assert.equal(calls, 2);
  assert.equal(f.timers.size, 0);
});

test("workspace startup reports a stalled IPC instead of waiting for the outer watchdog", async () => {
  const reports = [];
  const f = fixture(async (command, args) => {
    if (command === "workspace_snapshot") return new Promise(() => {});
    if (command === "finish_smoke_test") reports.push(args);
  });
  const journey = runInNewContext(workspace, f.context);
  await f.advance(10000);
  await journey;
  assert.equal(reports.length, 1);
  assert.match(reports[0].error, /Native IPC timed out: workspace_snapshot/);
  assert.equal(f.timers.size, 0);
});

test("native injection loads the wait helper before its consumers", async () => {
  const injection = await readFile(
    new URL("../app/src-tauri/tests/support/native_smoke.rs", import.meta.url),
    "utf8",
  );
  const helper = injection.indexOf('include_str!("native-wait.js")');
  assert.ok(helper >= 0);
  for (const name of ["layout-smoke.js", "workspace-smoke.js"]) {
    assert.ok(injection.indexOf(`include_str!("${name}")`) > helper);
  }
});
