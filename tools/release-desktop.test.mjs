import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  let launched = false;
  let waits = 0;
  const values = {
    trusted: true,
    systemEvents: true,
    launchReady: true,
    readyAfter: 1,
    permission: 0,
    finder: true,
    role: "AXMenuBar",
    count: 7,
    ...changes,
  };
  const output = new Script(`${input}\nrun()`).runInNewContext({
    ObjC: {
      import(framework) {
        if (framework === values.throwImport)
          throw new Error("synthetic-private-import-error");
      },
    },
    $: {
      AXIsProcessTrusted() {
        calls.push("trust");
        if (values.throwTrust)
          throw new Error("synthetic-private-bridge-error");
        return values.trusted;
      },
      NSRunningApplication: {
        runningApplicationsWithBundleIdentifier(bundle) {
          calls.push(bundle);
          if (values.throwProcessQuery === bundle)
            throw new Error("synthetic-private-process-error");
          return {
            count: (
              bundle === "com.apple.systemevents"
                ? values.systemEvents ||
                  (launched && values.launchReady && waits >= values.readyAfter)
                : values.finder
            )
              ? 1
              : 0,
          };
        },
      },
      NSWorkspaceOpenConfiguration: { configuration: {} },
      NSURL: {
        fileURLWithPath(path) {
          assert.equal(path, "/System/Library/CoreServices/System Events.app");
          return "synthetic-system-events-url";
        },
      },
      NSWorkspace: {
        sharedWorkspace: {
          openApplicationAtURLConfigurationCompletionHandler(
            url,
            configuration,
            completion,
          ) {
            calls.push("launch");
            assert.equal(url, "synthetic-system-events-url");
            assert.deepEqual(configuration, {
              activates: false,
              hides: true,
              promptsUserIfNeeded: false,
              addsToRecentItems: false,
              allowsRunningApplicationSubstitution: false,
            });
            assert.equal(completion, null);
            if (values.throwLaunch)
              throw new Error("synthetic-private-launch-error");
            launched = true;
          },
        },
      },
      NSThread: {
        sleepForTimeInterval(seconds) {
          assert.equal(seconds, 0.1);
          calls.push("wait");
          waits++;
        },
      },
      NSAppleEventDescriptor: {
        descriptorWithBundleIdentifier(bundle) {
          assert.equal(bundle, "com.apple.systemevents");
          return {
            get aeDesc() {
              if (values.throwDescriptor)
                throw new Error("synthetic-private-descriptor-error");
              return "synthetic-descriptor";
            },
          };
        },
      },
      AEDeterminePermissionToAutomateTarget(target, eventClass, eventId, ask) {
        calls.push("permission");
        assert.equal(target, "synthetic-descriptor");
        assert.equal(eventClass, 0x2a2a2a2a);
        assert.equal(eventId, 0x2a2a2a2a);
        assert.equal(ask, false);
        if (values.throwPermission)
          throw new Error("synthetic-private-permission-error");
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
                        if (values.throwCount)
                          throw new Error("synthetic-private-count-error");
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

function atStage(stage, evidence = {}) {
  return (error) => {
    assert.equal(error.diagnostic.stage, stage);
    for (const [key, value] of Object.entries(evidence))
      assert.equal(error.diagnostic[key], value);
    assert.equal(
      error.message,
      `Release desktop preflight failed: ${JSON.stringify(error.diagnostic)}`,
    );
    assert.doesNotMatch(error.message, /synthetic-private/);
    return true;
  };
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

test("cold System Events starts in the background and must become observable before permission and Finder reads", () => {
  const { result, scriptCalls } = worker({
    systemEvents: false,
    readyAfter: 2,
  });
  assert.deepEqual(result, capabilities);
  assert.deepEqual(scriptCalls, [
    "trust",
    "com.apple.systemevents",
    "launch",
    "wait",
    "com.apple.systemevents",
    "wait",
    "com.apple.systemevents",
    "permission",
    "com.apple.finder",
    "read",
    "count",
  ]);
});

test("failed or unready System Events launches fail closed without exposing launch errors", () => {
  for (const changes of [
    { throwLaunch: true },
    { launchReady: false },
    { readyAfter: 51 },
  ])
    assert.throws(
      () => worker({ systemEvents: false, ...changes }),
      atStage("system-events-launch", {
        desktopUnlocked: true,
        accessibilityTrusted: true,
        systemEventsRunning: false,
      }),
    );
  assert.throws(
    () => worker({ systemEvents: false, permission: -1744 }),
    atStage("appleevents-consent-required", {
      systemEventsRunning: true,
      appleEventsAllowed: false,
    }),
  );
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
      atStage("platform"),
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
      atStage(
        desktop.stdout?.includes("Yes")
          ? "desktop-session-locked"
          : "desktop-session-unavailable",
        { desktopUnlocked: false },
      ),
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
    atStage("desktop-session-unavailable", { desktopUnlocked: false }),
  );
  assert.equal(calls, 1);
});

test("denied trust, AppleEvents consent, missing processes and unreadable menus fail closed", () => {
  for (const [changes, stage] of [
    [{ trusted: false }, "accessibilityTrusted"],
    [{ systemEvents: false, launchReady: false }, "system-events-launch"],
    [{ permission: -1744 }, "appleevents-consent-required"],
    [{ permission: -1743 }, "appleEventsAllowed"],
    [{ permission: -600 }, "appleEventsAllowed"],
    [{ finder: false }, "finderRunning"],
    [{ role: "AXWindow" }, "menuBar"],
    [{ count: 0 }, "menuBarElementCount"],
    [{ count: -1 }, "menuBarElementCount"],
    [{ count: 1.5 }, "menuBarElementCount"],
    [{ throwRead: true }, "menu-role-query"],
  ])
    assert.throws(
      () => worker(changes),
      atStage(stage, { desktopUnlocked: true }),
    );
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
  const coldFailure = jxa(script, { systemEvents: false, launchReady: false });
  assert.equal(coldFailure.calls.filter((call) => call === "launch").length, 1);
  assert.equal(coldFailure.calls.filter((call) => call === "wait").length, 50);
  assert.ok(!coldFailure.calls.includes("permission"));
  assert.ok(!coldFailure.calls.includes("read"));
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
  for (const [processResult, stage] of [
    [{ status: 1, stderr: "synthetic-private-menu-label" }, "jxa-process"],
    [
      { status: null, error: new Error("synthetic-private-menu-label") },
      "jxa-process",
    ],
    [
      {
        status: null,
        error: { code: "ETIMEDOUT", message: "synthetic-private-menu-label" },
      },
      "jxa-timeout",
    ],
    [{ status: 0, stdout: "synthetic-private-menu-label" }, "jxa-output"],
    [{ status: 0, stdout: "null" }, "accessibilityTrusted"],
    [{ status: 0, stdout: "{}" }, "accessibilityTrusted"],
  ])
    assert.throws(
      () => worker({ processResult }),
      atStage(stage, { desktopUnlocked: true }),
    );
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
    atStage("platform"),
  );
  assert.equal(fixture.spawned(), false);
});

test("worker deadline kills the entire process group and discards late output", async () => {
  const fixture = processFixture();
  const result = probeReleaseDesktop(fixture.options);
  fixture.timeout();
  fixture.child.stdout.emit("data", Buffer.from(JSON.stringify(capabilities)));
  fixture.child.emit("close", 0);
  await assert.rejects(result, atStage("worker-timeout"));
  assert.deepEqual(fixture.killed, [[-12345, "SIGKILL"]]);
  assert.equal(fixture.cleared(), true);
});

test("failed workers, invalid evidence and oversized output never become readiness", async () => {
  for (const [output, code, stage] of [
    [JSON.stringify(capabilities), 1, "worker-exit"],
    [JSON.stringify(capabilities), null, "worker-exit"],
    ["synthetic-private-menu-label", 0, "worker-output"],
    ["{}", 0, "desktopUnlocked"],
    [
      JSON.stringify({ ...capabilities, accessibilityTrusted: false }),
      0,
      "accessibilityTrusted",
    ],
    ["x".repeat(4097), 0, "worker-output"],
  ]) {
    const fixture = processFixture();
    const result = probeReleaseDesktop(fixture.options);
    fixture.child.stdout.emit("data", Buffer.from(output));
    fixture.child.emit("close", code);
    await assert.rejects(result, atStage(stage));
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
    await assert.rejects(
      result,
      atStage(stream === "process" ? "worker-start" : "worker-stream"),
    );
    assert.deepEqual(fixture.killed, [[-12345, "SIGKILL"]]);
  }
  await assert.rejects(
    probeReleaseDesktop({
      platform: "darwin",
      spawnProcess() {
        throw new Error("synthetic-private-value");
      },
    }),
    atStage("worker-start"),
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
    await assert.rejects(main(args, collaborators), atStage("arguments"));
  assert.equal(output.length, 2);
});

test("JXA distinguishes framework and bridge exceptions from denied capabilities", () => {
  for (const [changes, stage] of [
    [{ throwImport: "AppKit" }, "framework-appkit"],
    [
      {
        throwImport:
          "/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework",
      },
      "framework-accessibility",
    ],
    [
      {
        throwImport:
          "/System/Library/Frameworks/CoreServices.framework/Frameworks/AE.framework",
      },
      "framework-appleevents",
    ],
    [{ throwTrust: true }, "accessibility-query"],
    [{ throwProcessQuery: "com.apple.systemevents" }, "system-events-query"],
    [{ throwDescriptor: true }, "appleevents-target"],
    [{ throwPermission: true }, "appleevents-query"],
    [{ throwProcessQuery: "com.apple.finder" }, "finder-query"],
    [{ throwCount: true }, "menu-count-query"],
  ])
    assert.throws(
      () => worker(changes),
      atStage(stage, { desktopUnlocked: true }),
    );
});

test("worker failure diagnostics survive the CLI protocol without marking denied AX ready", async () => {
  const fixture = processFixture();
  const result = probeReleaseDesktop(fixture.options);
  let report;
  await assert.rejects(
    main(["--worker"], {
      worker() {
        return worker({ trusted: false });
      },
      output(value) {
        report = value;
      },
    }),
    atStage("accessibilityTrusted", { accessibilityTrusted: false }),
  );
  fixture.child.stdout.emit("data", Buffer.from(report));
  fixture.child.emit("close", 1);
  await assert.rejects(
    result,
    atStage("accessibilityTrusted", {
      desktopUnlocked: true,
      accessibilityTrusted: false,
    }),
  );
  assert.deepEqual(JSON.parse(report), {
    stage: "accessibilityTrusted",
    desktopUnlocked: true,
    accessibilityTrusted: false,
  });
});

test("missing capability evidence never becomes readiness", async () => {
  for (const key of Object.keys(capabilities)) {
    const incomplete = { ...capabilities };
    delete incomplete[key];
    const fixture = processFixture();
    const result = probeReleaseDesktop(fixture.options);
    fixture.child.stdout.emit("data", Buffer.from(JSON.stringify(incomplete)));
    fixture.child.emit("close", 0);
    await assert.rejects(result, atStage(key));
  }
});

test("untrusted error fields and protocol stages never escape into diagnostics", async () => {
  for (const stage of ["synthetic-private-stage", "appleevents-query"]) {
    let report;
    await assert.rejects(
      main(["--worker"], {
        worker() {
          throw Object.assign(new Error("synthetic-private-menu-label"), {
            diagnostic: {
              stage,
              accessibilityTrusted: false,
              menuBarElementCount: -1,
              finderRunning: "synthetic-private-value",
              menuLabels: ["synthetic-private-menu-label"],
            },
          });
        },
        output(value) {
          report = value;
        },
      }),
      atStage(stage === "appleevents-query" ? stage : "worker-exit"),
    );
    const expected = {
      stage: stage === "appleevents-query" ? stage : "worker-exit",
      accessibilityTrusted: false,
    };
    assert.deepEqual(JSON.parse(report), expected);
    const fixture = processFixture();
    const result = probeReleaseDesktop(fixture.options);
    fixture.child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          ...expected,
          stage,
          rawError: "synthetic-private-menu-label",
          menuBarElementCount: 0,
        }),
      ),
    );
    fixture.child.emit("close", 1);
    await assert.rejects(result, (error) => {
      atStage(expected.stage)(error);
      assert.deepEqual(error.diagnostic, {
        ...expected,
        menuBarElementCount: 0,
      });
      return true;
    });
  }
});

test("real CLI prints only a static diagnostic on failure", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./release-desktop.mjs", import.meta.url)),
      "--skip",
    ],
    { env: {}, encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    'Release desktop preflight failed: {"stage":"arguments"}\n',
  );
});
