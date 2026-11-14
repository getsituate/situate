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

function jxaStep(input, changes, operation, state) {
  const calls = [];
  const violations = [];
  let permissionBound = false;
  const bound = new Set();
  const nativeCalls = [];
  const phases = [];
  const address = Object.freeze({ opaqueDescriptor: true });
  const nullAddress = Object.freeze({ nullPointer: true });
  const values = {
    trusted: true,
    systemEvents: true,
    launchReady: true,
    readyAfter: 1,
    permission: 0,
    createStatus: 0,
    disposeStatus: 0,
    finder: true,
    role: "AXMenuBar",
    count: 7,
    ...changes,
  };
  const output = new Script(
    `${input}\nrun(${JSON.stringify([operation])})`,
  ).runInNewContext({
    Ref: {
      equals: (left, right) =>
        left === right || (left === nullAddress && right === null),
    },
    ObjC: {
      import(framework) {
        if (framework === values.throwImport)
          throw new Error("synthetic-private-import-error");
      },
      bindFunction(name, signature) {
        const signatures = {
          calloc: ["void *", ["unsigned long", "unsigned long"]],
          free: ["void", ["void *"]],
          AECreateDesc: ["short", ["unsigned int", "char *", "long", "void *"]],
          AEDisposeDesc: ["short", ["void *"]],
          AEDeterminePermissionToAutomateTarget: [
            "int",
            ["void *", "unsigned int", "unsigned int", "bool"],
          ],
        };
        assert.ok(Object.hasOwn(signatures, name));
        assert.deepEqual(
          JSON.parse(JSON.stringify(signature)),
          signatures[name],
        );
        if (name === "AEDeterminePermissionToAutomateTarget") {
          if (values.throwBinding)
            throw new Error("synthetic-private-binding-error");
          permissionBound = !values.ignoreBinding;
        }
        bound.add(name);
      },
    },
    $: {
      NSUTF8StringEncoding: 4,
      NSString: {
        stringWithString(value) {
          return {
            dataUsingEncoding(encoding) {
              assert.equal(encoding, 4);
              return value;
            },
          };
        },
      },
      NSFileHandle: {
        alloc: {
          initWithFileDescriptor(descriptor) {
            assert.equal(descriptor, 3);
            return {
              writeData(value) {
                phases.push(value);
              },
            };
          },
        },
      },
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
                  (state.launched &&
                    values.launchReady &&
                    state.waits >= values.readyAfter)
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
            if (operation !== "bootstrap")
              violations.push("launch-in-inspection");
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
            state.launched = true;
          },
        },
      },
      NSThread: {
        sleepForTimeInterval(seconds) {
          assert.equal(seconds, 0.1);
          calls.push("wait");
          state.waits++;
        },
      },
      get NSAppleEventDescriptor() {
        throw new Error("Unexpected descriptor bridge");
      },
      calloc(count, size) {
        assert.ok(bound.has("calloc"));
        assert.equal(count, 1);
        assert.equal(size, 12);
        nativeCalls.push("allocate");
        return values.allocationFails ? nullAddress : address;
      },
      AECreateDesc(type, bundle, length, target) {
        assert.ok(bound.has("AECreateDesc"));
        assert.equal(type, 0x62756e64);
        assert.equal(bundle, "com.apple.systemevents");
        assert.equal(
          length,
          Buffer.byteLength("com.apple.systemevents", "utf8"),
        );
        assert.equal(target, address);
        nativeCalls.push("create");
        if (values.throwCreate)
          throw new Error("synthetic-private-create-error");
        return values.createStatus;
      },
      AEDisposeDesc(target) {
        assert.ok(bound.has("AEDisposeDesc"));
        assert.equal(target, address);
        assert.equal(values.createStatus, 0);
        nativeCalls.push("dispose");
        if (values.throwDispose)
          throw new Error("synthetic-private-dispose-error");
        return values.disposeStatus;
      },
      free(target) {
        assert.ok(bound.has("free"));
        assert.equal(target, address);
        nativeCalls.push("free");
      },
      AEDeterminePermissionToAutomateTarget(target, eventClass, eventId, ask) {
        calls.push("permission");
        if (operation !== "inspect") violations.push("permission-in-bootstrap");
        nativeCalls.push("permission");
        if (!permissionBound) throw new Error("Ref has incompatible type");
        assert.equal(target, address);
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
      if (operation !== "inspect") violations.push("read-in-bootstrap");
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
  assert.deepEqual(violations, []);
  return { output, calls, phases: phases.join(""), nativeCalls };
}

function worker(changes = {}) {
  const calls = [];
  const scriptCalls = [];
  const nativeCalls = [];
  const state = { launched: false, waits: 0 };
  let script;
  let phases = "";
  let result;
  try {
    result = probeReleaseDesktopWorker({
      platform: "darwin",
      now: () => 0,
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
        assert.deepEqual(args.slice(0, 3), ["-l", "JavaScript", "-"]);
        assert.ok(["bootstrap", "inspect"].includes(args[3]));
        assert.equal(args.length, 4);
        assert.equal(options.timeout, 20000);
        assert.equal(options.killSignal, "SIGKILL");
        assert.equal(options.maxBuffer, 4096);
        assert.deepEqual(options.stdio, ["pipe", "pipe", "ignore", "pipe"]);
        if (
          changes.processResult &&
          (!changes.processOperation || changes.processOperation === args[3])
        )
          return changes.processResult;
        script = changes.scriptOverride ?? options.input;
        const simulated = jxaStep(script, changes, args[3], state);
        scriptCalls.push(...simulated.calls);
        nativeCalls.push(...simulated.nativeCalls);
        phases += simulated.phases;
        return {
          status: 0,
          stdout: simulated.output,
          output: [null, simulated.output, null, simulated.phases],
        };
      },
    });
  } catch (error) {
    if (!changes.captureFailure) throw error;
    result = error.diagnostic;
  }
  return { result, calls, scriptCalls, script, phases, nativeCalls };
}

function jxa(input, changes = {}) {
  const simulation = worker({
    ...changes,
    scriptOverride: input,
    captureFailure: true,
  });
  return {
    output: JSON.stringify(simulation.result),
    calls: simulation.scriptCalls,
    phases: simulation.phases,
    nativeCalls: simulation.nativeCalls,
  };
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
  assert.deepEqual(calls, [
    "/usr/sbin/ioreg",
    "/usr/bin/osascript",
    "/usr/bin/osascript",
  ]);
  assert.deepEqual(scriptCalls, [
    "trust",
    "com.apple.systemevents",
    "trust",
    "com.apple.systemevents",
    "permission",
    "com.apple.finder",
    "read",
    "count",
  ]);
});

test("permission queries bind the opaque descriptor address before using the C bridge", () => {
  const { result, script } = worker();
  assert.deepEqual(result, capabilities);
  const unbound = jxa(script, { ignoreBinding: true });
  assert.equal(JSON.parse(unbound.output).stage, "appleevents-query");
  assert.equal(JSON.parse(unbound.output).appleEventsAllowed, undefined);
  assert.ok(!unbound.calls.includes("read"));
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
    "trust",
    "com.apple.systemevents",
    "permission",
    "com.apple.finder",
    "read",
    "count",
  ]);
});

test("bootstrap may launch System Events but inspection never opens NSWorkspace or queries a missing service", () => {
  const { script } = worker();
  const bootstrap = jxaStep(script, { systemEvents: false }, "bootstrap", {
    launched: false,
    waits: 0,
  });
  assert.ok(bootstrap.calls.includes("launch"));
  assert.ok(!bootstrap.calls.includes("permission"));
  assert.ok(!bootstrap.calls.includes("read"));
  assert.deepEqual(bootstrap.nativeCalls, []);
  const missing = jxaStep(script, { systemEvents: false }, "inspect", {
    launched: false,
    waits: 0,
  });
  assert.equal(JSON.parse(missing.output).stage, "systemEventsRunning");
  assert.deepEqual(missing.calls, ["trust", "com.apple.systemevents"]);
  assert.deepEqual(missing.nativeCalls, []);
  const ready = jxaStep(script, {}, "inspect", { launched: false, waits: 0 });
  assert.ok(!ready.calls.includes("launch"));
  assert.ok(ready.calls.includes("permission"));
  assert.ok(ready.calls.includes("read"));
});

test("bootstrap and inspection share the twenty-second JXA budget", () => {
  for (const bootstrapTime of [15000, 20000]) {
    let clock = 0;
    const operations = [];
    const probe = (command, args, options) => {
      if (command === "/usr/sbin/ioreg")
        return { status: 0, stdout: '"IOConsoleLocked" = No' };
      assert.equal(command, "/usr/bin/osascript");
      assert.deepEqual(options.env, {});
      operations.push(args[3]);
      if (args[3] === "bootstrap") {
        assert.equal(options.timeout, 20000);
        clock = bootstrapTime;
        return {
          status: 0,
          stdout: JSON.stringify({
            accessibilityTrusted: true,
            systemEventsRunning: true,
          }),
        };
      }
      assert.equal(args[3], "inspect");
      assert.equal(options.timeout, 5000);
      return { status: 0, stdout: JSON.stringify(capabilities) };
    };
    const run = () =>
      probeReleaseDesktopWorker({
        platform: "darwin",
        probe,
        now: () => clock,
      });
    if (bootstrapTime === 20000) {
      assert.throws(
        run,
        atStage("jxa-timeout", {
          accessibilityTrusted: true,
          systemEventsRunning: true,
        }),
      );
      assert.deepEqual(operations, ["bootstrap"]);
    } else {
      assert.deepEqual(run(), capabilities);
      assert.deepEqual(operations, ["bootstrap", "inspect"]);
    }
  }
});

test("an inspection crash preserves only bootstrap observations and filtered exit metadata", () => {
  assert.throws(
    () =>
      worker({
        processOperation: "inspect",
        processResult: {
          status: null,
          signal: "SIGABRT",
          output: [null, null, null, "appleevents-query\n"],
          stderr: "synthetic-private-error",
        },
      }),
    (error) => {
      assert.deepEqual(error.diagnostic, {
        stage: "jxa-process",
        desktopUnlocked: true,
        accessibilityTrusted: true,
        systemEventsRunning: true,
        jxaSignal: "SIGABRT",
        jxaPhase: "appleevents-query",
      });
      assert.doesNotMatch(error.message, /synthetic-private/);
      return true;
    },
  );
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

test("unreviewed descriptor architectures fail before native allocation", () => {
  for (const architecture of ["ia32", "ppc64"])
    assert.throws(
      () =>
        probeReleaseDesktopWorker({
          platform: "darwin",
          architecture,
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
    "trust",
    "com.apple.systemevents",
    "permission",
  ]);
  assert.deepEqual(jxa(script, { finder: false }).calls, [
    "trust",
    "com.apple.systemevents",
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

test("JXA process failures expose only bounded exit metadata and the last fixed phase", () => {
  for (const [processResult, metadata] of [
    [
      {
        status: null,
        signal: "SIGABRT",
        output: [null, null, null, "framework-appkit\nsystem-events-launch\n"],
      },
      { jxaSignal: "SIGABRT", jxaPhase: "system-events-launch" },
    ],
    [
      {
        status: 1,
        signal: null,
        output: [null, null, null, "appleevents-query\n"],
      },
      { jxaStatus: 1, jxaPhase: "appleevents-query" },
    ],
    [
      {
        status: 1.5,
        signal: "synthetic-private-signal",
        output: [null, null, null, "synthetic-private-phase\n"],
      },
      {},
    ],
    [
      { status: -1, signal: {}, output: [null, null, null, "worker-start\n"] },
      {},
    ],
    [
      {
        status: 256,
        output: [null, null, null, "x".repeat(4097) + "\nframework-appkit\n"],
      },
      {},
    ],
    [
      {
        status: null,
        error: { code: "ETIMEDOUT" },
        signal: "SIGKILL",
        output: [null, null, null, "menu-count-query\n"],
      },
      { jxaSignal: "SIGKILL", jxaPhase: "menu-count-query" },
    ],
  ]) {
    assert.throws(
      () =>
        worker({
          processResult: {
            ...processResult,
            stdout: "synthetic-private-stdout",
            stderr: "synthetic-private-stderr",
            args: ["synthetic-private-argument"],
            privateProperty: "synthetic-private-value",
          },
        }),
      (error) => {
        const stage =
          processResult.error?.code === "ETIMEDOUT"
            ? "jxa-timeout"
            : "jxa-process";
        atStage(stage)(error);
        assert.deepEqual(error.diagnostic, {
          stage,
          desktopUnlocked: true,
          ...metadata,
        });
        return true;
      },
    );
  }
});

test("phase sidechannel emits static markers without capabilities or UI contents", () => {
  const { script } = worker();
  const warm = jxa(script);
  assert.equal(
    warm.phases,
    [
      "framework-foundation",
      "framework-appkit",
      "framework-accessibility",
      "accessibility-query",
      "system-events-query",
      "complete",
      "framework-foundation",
      "framework-appkit",
      "framework-accessibility",
      "accessibility-query",
      "system-events-query",
      "framework-appleevents",
      "appleevents-target",
      "appleevents-address",
      "appleevents-create",
      "appleevents-query",
      "appleevents-dispose",
      "appleevents-query",
      "finder-query",
      "menu-role-query",
      "menu-count-query",
      "complete",
      "",
    ].join("\n"),
  );
  const cold = jxa(script, { systemEvents: false, throwLaunch: true });
  assert.equal(
    cold.phases.trimEnd().split("\n").at(-1),
    "system-events-launch",
  );
  assert.ok(Buffer.byteLength(warm.phases) < 4096);
  assert.ok(Buffer.byteLength(cold.phases) < 4096);
});

test("C descriptors are disposed and freed after permission queries without using the Objective-C descriptor bridge", () => {
  const { script } = worker();
  assert.deepEqual(jxa(script).nativeCalls, [
    "allocate",
    "create",
    "permission",
    "dispose",
    "free",
  ]);
  for (const [changes, stage, nativeCalls] of [
    [{ allocationFails: true }, "appleevents-address", ["allocate"]],
    [
      { createStatus: -50 },
      "appleevents-create",
      ["allocate", "create", "free"],
    ],
    [
      { throwCreate: true },
      "appleevents-create",
      ["allocate", "create", "free"],
    ],
    [
      { throwPermission: true },
      "appleevents-query",
      ["allocate", "create", "permission", "dispose", "free"],
    ],
    [
      { permission: -1744 },
      "appleevents-consent-required",
      ["allocate", "create", "permission", "dispose", "free"],
    ],
    [
      { disposeStatus: -50 },
      "appleevents-dispose",
      ["allocate", "create", "permission", "dispose", "free"],
    ],
    [
      { throwDispose: true },
      "appleevents-dispose",
      ["allocate", "create", "permission", "dispose", "free"],
    ],
  ]) {
    const result = jxa(script, changes);
    assert.equal(JSON.parse(result.output).stage, stage);
    assert.equal(result.phases.trimEnd().split("\n").at(-1), stage);
    assert.deepEqual(result.nativeCalls, nativeCalls);
    assert.ok(!result.calls.includes("read"));
    assert.throws(() => worker(changes), atStage(stage));
    assert.doesNotMatch(result.output + result.phases, /synthetic-private/);
  }
});

test(
  "AEDesc storage matches the SDK's packed arm64 and x86_64 ABI",
  { skip: process.platform !== "darwin" },
  () => {
    const source = `
#include <ApplicationServices/ApplicationServices.h>
#include <stddef.h>
_Static_assert(sizeof(void *) == 8, "64-bit pointer");
_Static_assert(sizeof(size_t) == 8 && sizeof(unsigned long) == 8, "64-bit allocation sizes");
_Static_assert(sizeof(DescType) == 4 && ((DescType)-1 > 0), "unsigned 32-bit descriptor type");
_Static_assert(sizeof(AEDesc) == 12, "AEDesc size");
_Static_assert(_Alignof(AEDesc) == 2, "AEDesc alignment");
_Static_assert(offsetof(AEDesc, dataHandle) == 4, "AEDesc handle offset");
_Static_assert(sizeof(Size) == 8 && ((Size)-1 < 0), "signed 64-bit Size");
_Static_assert(sizeof(OSErr) == 2 && ((OSErr)-1 < 0), "signed 16-bit OSErr");
_Static_assert(sizeof(OSStatus) == 4 && ((OSStatus)-1 < 0), "signed 32-bit OSStatus");
_Static_assert(typeApplicationBundleID == 0x62756e64, "bund descriptor type");
_Static_assert(typeWildCard == 0x2a2a2a2a, "wildcard event type");
`;
    for (const architecture of ["arm64", "x86_64"]) {
      const result = spawnSync(
        "/usr/bin/clang",
        [
          "-target",
          `${architecture}-apple-macos13`,
          "-fsyntax-only",
          "-x",
          "c",
          "-",
        ],
        {
          env: {},
          input: source,
          encoding: "utf8",
          timeout: 10000,
          killSignal: "SIGKILL",
          maxBuffer: 4096,
        },
      );
      assert.equal(
        result.status,
        0,
        `SDK ABI check failed for ${architecture}`,
      );
    }
  },
);

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
    [{ throwCreate: true }, "appleevents-create"],
    [{ throwDispose: true }, "appleevents-dispose"],
    [{ throwBinding: true }, "appleevents-query"],
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

test("JXA crash metadata survives the worker protocol but is excluded from capability denials", async () => {
  let report;
  await assert.rejects(
    main(["--worker"], {
      worker() {
        return worker({
          processResult: {
            status: null,
            signal: "SIGSEGV",
            output: [null, null, null, "appleevents-query\n"],
            stderr: "synthetic-private-stderr",
          },
        });
      },
      output(value) {
        report = value;
      },
    }),
    atStage("jxa-process"),
  );
  const expected = {
    stage: "jxa-process",
    desktopUnlocked: true,
    jxaSignal: "SIGSEGV",
    jxaPhase: "appleevents-query",
  };
  assert.deepEqual(JSON.parse(report), expected);
  const fixture = processFixture();
  const result = probeReleaseDesktop(fixture.options);
  fixture.child.stdout.emit("data", Buffer.from(report));
  fixture.child.emit("close", 1);
  await assert.rejects(result, (error) => {
    assert.deepEqual(error.diagnostic, expected);
    return true;
  });
  let deniedReport;
  await assert.rejects(
    main(["--worker"], {
      worker() {
        throw Object.assign(new Error("synthetic-private-error"), {
          diagnostic: {
            ...expected,
            stage: "accessibilityTrusted",
            accessibilityTrusted: false,
            jxaStatus: 1,
          },
        });
      },
      output(value) {
        deniedReport = value;
      },
    }),
    atStage("accessibilityTrusted"),
  );
  assert.deepEqual(JSON.parse(deniedReport), {
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
