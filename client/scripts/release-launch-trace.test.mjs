import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  createLaunchTraceAdapters,
  writePrivateLaunchTrace,
} from "./release-launch-trace.mjs";

function fixture(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-launch-trace-test-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, "launch-trace.json");
}

test("raw launch observations remain in private storage and cannot become product qualification", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const path = fixture(t),
    progress = [];
  let finish;
  const native = new Promise((resolve) => {
    finish = resolve;
  });
  const adapters = createLaunchTraceAdapters(path, {
    execute: async (command, args, options) => {
      if (command === "open") {
        const output = await native;
        options.onExit?.({ code: 0, signal: null });
        return output;
      }
      assert.equal(options.capture, true);
      assert.equal(options.env.GH_TOKEN, undefined);
      if (command === "/usr/bin/osascript") {
        assert.doesNotMatch(
          args[3],
          /\.click\(|\.press\(|\.activate\(|keystroke/,
        );
        const text = {
          role: () => "AXStaticText",
          name: () => {
            throw new Error("Synthetic missing name attribute");
          },
          value: () => "synthetic dialog text",
          description: () => "Synthetic description",
          uiElements: () => [],
        };
        const window = {
          role: () => "AXWindow",
          name: () => "Situate",
          uiElements: () => [text],
        };
        return runInNewContext(args[3], {
          Application: (name) => {
            assert.equal(name, "System Events");
            return {
              applicationProcesses: {
                byName: (name) => ({
                  exists: () => name === "CoreServicesUIAgent",
                  windows: () => [window],
                }),
              },
            };
          },
        });
      }
      assert.equal(command, "/bin/ps");
      return "123 1 S /synthetic/private-app";
    },
    createHost: () => ({
      cleanup: async () => {},
      journeys: async () => assert.fail("Product journeys must not run"),
    }),
  });
  const execute = adapters.createProcess({
    deadline: () => new AbortController().signal,
    progress: (...event) => progress.push(event),
  });
  const pending = execute("open", ["-n", "/synthetic/Situate.app"], {
    env: { PATH: "/synthetic" },
    confirmFirstLaunch: true,
  });
  t.mock.timers.tick(4000);
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  finish("");
  await pending;
  const host = adapters.createHost({}, {});
  await assert.rejects(host.journeys(), /stops before product qualification/);
  await host.cleanup();
  const trace = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(trace.qualification, false);
  assert.equal(trace.kind, "macos-launch-diagnostic");
  assert.match(JSON.stringify(trace.sample), /synthetic dialog text/);
  assert.match(
    JSON.stringify(trace.sample),
    /Synthetic missing name attribute/,
  );
  assert.equal(trace.launch.exits[0].code, 0);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(progress), /synthetic dialog|private-app/);
});

test("cleanup failures remain primary when trace retention also fails", async (t) => {
  const path = fixture(t);
  writeFileSync(path, "retained", { mode: 0o600 });
  const primary = new Error("Synthetic cleanup failure");
  const adapters = createLaunchTraceAdapters(path, {
    execute: async () => "",
    createHost: () => ({
      cleanup: async () => {
        throw primary;
      },
    }),
  });
  await adapters.createProcess({})("open", ["-n", "/synthetic/Situate.app"]);
  await assert.rejects(
    adapters.createHost({}, {}).cleanup(),
    (error) =>
      error instanceof AggregateError &&
      error.cause === primary &&
      error.errors.includes(primary),
  );
  assert.equal(readFileSync(path, "utf8"), "retained");
});

test("trace storage is exclusive, bounded and requires its owned private parent", (t) => {
  const path = fixture(t);
  writePrivateLaunchTrace(path, { kind: "synthetic" });
  assert.throws(() => writePrivateLaunchTrace(path, {}));
  assert.throws(() =>
    writePrivateLaunchTrace(join(path, "..", "another.json"), {}),
  );
  const oversized = fixture(t);
  assert.throws(
    () => writePrivateLaunchTrace(oversized, { raw: "x".repeat(256 * 1024) }),
    /bound/,
  );
});
