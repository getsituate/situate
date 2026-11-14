import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { release } from "node:os";
import test from "node:test";
import { Script } from "node:vm";
import {
  main,
  probeReleaseDesktop,
  probeReleaseDesktopWorker,
} from "./release-desktop.mjs";

const capabilities = {
  desktopUnlocked: true,
  accessibilityTrusted: true,
  systemEventsRunning: true,
  appleEventsAllowed: true,
  finderRunning: true,
  menuBar: true,
  menuBarElementCount: 7,
};

function jxa(input, changes = {}) {
  const calls = [];
  const values = {
    trusted: true,
    systemEvents: true,
    permission: 0,
    finder: true,
    role: "AXMenuBar",
    count: 7,
    ...changes,
  };
  const output = new Script(`${input}\nrun()`).runInNewContext({
    ObjC: {
      import() {},
    },
    $: {
      AXIsProcessTrusted() {
        calls.push("trust");
        return values.trusted;
      },
      NSRunningApplication: {
        runningApplicationsWithBundleIdentifier(bundle) {
          calls.push(bundle);
          return {
            count: (
              bundle === "com.apple.systemevents"
                ? values.systemEvents
                : values.finder
            )
              ? 1
              : 0,
          };
        },
      },
      NSAppleEventDescriptor: {
        descriptorWithBundleIdentifier(bundle) {
          assert.equal(bundle, "com.apple.systemevents");
          return { aeDesc: "synthetic-descriptor" };
        },
      },
      AEDeterminePermissionToAutomateTarget(target, eventClass, eventId, ask) {
        calls.push("permission");
        assert.equal(target, "synthetic-descriptor");
        assert.equal(eventClass, 0x2a2a2a2a);
        assert.equal(eventId, 0x2a2a2a2a);
        assert.equal(ask, false);
        return values.permission;
      },
    },
    Application(bundle) {
      calls.push("read");
      assert.equal(bundle, "com.apple.systemevents");
      assert.equal(values.permission, 0);
      return {
        applicationProcesses: {
          byName(name) {
            assert.equal(name, "Finder");
            return {
              menuBars: {
                at(index) {
                  assert.equal(index, 0);
                  if (values.throwRead)
                    throw new Error("synthetic-private-menu-label");
                  return {
                    role() {
                      return values.role;
                    },
                    uiElements: {
                      get length() {
                        calls.push("count");
                        return values.count;
                      },
                    },
                  };
                },
              },
            };
          },
        },
      };
    },
  });
  return { output, calls };
}

function worker(changes = {}) {
  const calls = [];
  let scriptCalls;
  const result = probeReleaseDesktopWorker({
    platform: "darwin",
    probe(command, args, options) {
      calls.push(command);
      assert.deepEqual(options.env, {});
      assert.equal(options.encoding, "utf8");
      if (command === "/usr/sbin/ioreg") {
        assert.deepEqual(args, ["-l", "-n", "Root", "-d", "1"]);
        assert.equal(options.timeout, 2000);
        return (
          changes.desktop ?? { status: 0, stdout: '"IOConsoleLocked" = No\n' }
        );
      }
      assert.equal(command, "/usr/bin/osascript");
      assert.deepEqual(args, ["-l", "JavaScript", "-"]);
      assert.equal(options.timeout, 20000);
      assert.equal(options.killSignal, "SIGKILL");
      assert.equal(options.maxBuffer, 4096);
      assert.deepEqual(options.stdio, ["pipe", "pipe", "ignore"]);
      if (changes.processResult) return changes.processResult;
      const simulated = jxa(options.input, changes);
      scriptCalls = simulated.calls;
      return { status: 0, stdout: simulated.output };
    },
  });
  return { result, calls, scriptCalls };
}

test("worker checks the unlocked desktop before non-prompting trust and a count-only Finder read", () => {
  const { result, calls, scriptCalls } = worker();
  assert.deepEqual(result, capabilities);
  assert.deepEqual(calls, ["/usr/sbin/ioreg", "/usr/bin/osascript"]);
  assert.deepEqual(scriptCalls, [
    "trust",
    "com.apple.systemevents",
    "permission",
    "com.apple.finder",
    "read",
    "count",
  ]);
});

test("worker rejects unsupported platforms without starting a process", () => {
  for (const platform of ["linux", "win32"])
    assert.throws(
      () =>
        probeReleaseDesktopWorker({
          platform,
          probe() {
            assert.fail("unexpected process");
          },
        }),
      /requires macOS/,
    );
});

test("missing, locked and timed-out desktops never reach osascript", () => {
  for (const desktop of [
    { status: 0, stdout: '"IOConsoleLocked" = Yes\n' },
    { status: 0, stdout: "" },
    { status: 1, stdout: '"IOConsoleLocked" = No\n' },
    { status: null, error: new Error("synthetic timeout") },
  ]) {
    let calls = 0;
    assert.throws(
      () =>
        probeReleaseDesktopWorker({
          platform: "darwin",
          probe(command) {
            calls++;
            assert.equal(command, "/usr/sbin/ioreg");
            return desktop;
          },
        }),
      /unlocked desktop/,
    );
    assert.equal(calls, 1);
  }
});

test("desktop process exceptions never leak diagnostics or reach JXA", () => {
  let calls = 0;
  assert.throws(
    () =>
      probeReleaseDesktopWorker({
        platform: "darwin",
        probe(command) {
          calls++;
          assert.equal(command, "/usr/sbin/ioreg");
          throw new Error("synthetic-private-value");
        },
      }),
    { message: "Release desktop preflight requires an unlocked desktop." },
  );
  assert.equal(calls, 1);
});

test("denied trust, AppleEvents consent, missing processes and unreadable menus fail closed", () => {
  for (const changes of [
    { trusted: false },
    { systemEvents: false },
    { permission: -1744 },
    { permission: -1743 },
    { permission: -600 },
    { finder: false },
    { role: "AXWindow" },
    { count: 0 },
    { count: -1 },
    { count: 1.5 },
    { throwRead: true },
  ])
    assert.throws(() => worker(changes), {
      message: "Release desktop capability is unavailable.",
    });
});

test("JXA performs no scripting reads until trust and existing AppleEvents authorization pass", () => {
  let script;
  probeReleaseDesktopWorker({
    platform: "darwin",
    probe(command, _args, options) {
      if (command === "/usr/sbin/ioreg")
        return { status: 0, stdout: '"IOConsoleLocked" = No' };
      script = options.input;
      return { status: 0, stdout: JSON.stringify(capabilities) };
    },
  });
  assert.deepEqual(jxa(script, { trusted: false }).calls, ["trust"]);
  assert.deepEqual(jxa(script, { systemEvents: false }).calls, [
    "trust",
    "com.apple.systemevents",
  ]);
  assert.deepEqual(jxa(script, { permission: -1744 }).calls, [
    "trust",
    "com.apple.systemevents",
    "permission",
  ]);
  assert.deepEqual(jxa(script, { finder: false }).calls, [
    "trust",
    "com.apple.systemevents",
    "permission",
    "com.apple.finder",
  ]);
});

test("failed, timed-out and malformed JXA output cannot expose subprocess diagnostics", () => {
  for (const processResult of [
    { status: 1, stderr: "synthetic-private-menu-label" },
    { status: null, error: new Error("synthetic-private-menu-label") },
    { status: 0, stdout: "synthetic-private-menu-label" },
    { status: 0, stdout: "null" },
    { status: 0, stdout: "{}" },
  ])
    assert.throws(() => worker({ processResult }), {
      message: "Release desktop capability is unavailable.",
    });
});

function processFixture() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = new EventEmitter();
  const killed = [];
  let timeout;
  let cleared = false;
  let spawned = false;
  const options = {
    platform: "darwin",
    environment: {
      ImageOS: "macos26",
      ImageVersion: "20261001.1",
      GH_TOKEN: "synthetic-secret",
      NODE_OPTIONS: "--require=/synthetic/private.cjs",
      APPLE_API_PRIVATE_KEY: "synthetic-secret",
      SSH_AUTH_SOCK: "/synthetic/agent",
    },
    spawnProcess(command, args, settings) {
      spawned = true;
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [
        new URL("./release-desktop.mjs", import.meta.url).pathname,
        "--worker",
      ]);
      assert.deepEqual(settings, {
        env: {},
        detached: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return child;
    },
    killProcess(pid, signal) {
      killed.push([pid, signal]);
    },
    setTimer(callback, milliseconds) {
      assert.equal(milliseconds, 28000);
      timeout = callback;
      return 42;
    },
    clearTimer(timer) {
      assert.equal(timer, 42);
      cleared = true;
    },
  };
  return {
    child,
    killed,
    options,
    timeout: () => timeout(),
    cleared: () => cleared,
    spawned: () => spawned,
  };
}

test("entrypoint isolates the Node worker and returns only image, OS, architecture and capability evidence", async () => {
  const fixture = processFixture();
  const result = probeReleaseDesktop(fixture.options);
  fixture.child.stdout.emit(
    "data",
    Buffer.from(
      JSON.stringify({
        ...capabilities,
        menuLabels: ["synthetic-private-menu-label"],
      }),
    ),
  );
  fixture.child.emit("close", 0);
  assert.deepEqual(await result, {
    image: { os: "macos26", version: "20261001.1" },
    os: { platform: "darwin", release: release() },
    arch: process.arch,
    ...capabilities,
  });
  assert.equal(fixture.cleared(), true);
  assert.deepEqual(fixture.killed, []);
});

test("missing or malformed image metadata does not expose other environment values", async () => {
  const fixture = processFixture();
  const result = probeReleaseDesktop({
    ...fixture.options,
    environment: {
      ImageOS: "synthetic image\nprivate-value",
      UNRELATED: "synthetic-private-value",
    },
  });
  fixture.child.stdout.emit("data", Buffer.from(JSON.stringify(capabilities)));
  fixture.child.emit("close", 0);
  assert.deepEqual((await result).image, { os: null, version: null });
});

test("entrypoint rejects unsupported hosts before launching a worker, including CI", async () => {
  const fixture = processFixture();
  await assert.rejects(
    probeReleaseDesktop({
      ...fixture.options,
      platform: "linux",
      environment: { CI: "true" },
    }),
    /requires macOS/,
  );
  assert.equal(fixture.spawned(), false);
});

test("worker deadline kills the entire process group and discards late output", async () => {
  const fixture = processFixture();
  const result = probeReleaseDesktop(fixture.options);
  fixture.timeout();
  fixture.child.stdout.emit("data", Buffer.from(JSON.stringify(capabilities)));
  fixture.child.emit("close", 0);
  await assert.rejects(result, {
    message: "Release desktop preflight failed.",
  });
  assert.deepEqual(fixture.killed, [[-12345, "SIGKILL"]]);
  assert.equal(fixture.cleared(), true);
});

test("failed workers, invalid evidence and oversized output never become readiness", async () => {
  for (const [output, code] of [
    [JSON.stringify(capabilities), 1],
    [JSON.stringify(capabilities), null],
    ["synthetic-private-menu-label", 0],
    ["{}", 0],
    [JSON.stringify({ ...capabilities, accessibilityTrusted: false }), 0],
    ["x".repeat(4097), 0],
  ]) {
    const fixture = processFixture();
    const result = probeReleaseDesktop(fixture.options);
    fixture.child.stdout.emit("data", Buffer.from(output));
    fixture.child.emit("close", code);
    await assert.rejects(result, {
      message: "Release desktop preflight failed.",
    });
    assert.deepEqual(fixture.killed, [[-12345, "SIGKILL"]]);
  }
});

test("spawn and stream errors remain sanitized and terminate the worker", async () => {
  for (const stream of ["process", "stdout"]) {
    const fixture = processFixture();
    const result = probeReleaseDesktop(fixture.options);
    (stream === "process" ? fixture.child : fixture.child.stdout).emit(
      "error",
      new Error("synthetic-private-value"),
    );
    await assert.rejects(result, {
      message: "Release desktop preflight failed.",
    });
    assert.deepEqual(fixture.killed, [[-12345, "SIGKILL"]]);
  }
  await assert.rejects(
    probeReleaseDesktop({
      platform: "darwin",
      spawnProcess() {
        throw new Error("synthetic-private-value");
      },
    }),
    { message: "Release desktop preflight failed." },
  );
});

test("CLI selects the parent probe or worker without accepting bypass arguments", async () => {
  const output = [];
  let probes = 0;
  let workers = 0;
  const collaborators = {
    probe() {
      probes++;
      return { ...capabilities, image: null, os: "synthetic", arch: "arm64" };
    },
    worker() {
      workers++;
      return capabilities;
    },
    output(value) {
      output.push(JSON.parse(value));
    },
  };
  await main([], collaborators);
  await main(["--worker"], collaborators);
  assert.equal(probes, 1);
  assert.equal(workers, 1);
  assert.equal(output.length, 2);
  for (const args of [["--skip"], ["--worker", "--skip"], ["--ci"]])
    await assert.rejects(main(args, collaborators), /accepts no options/);
  assert.equal(output.length, 2);
});
