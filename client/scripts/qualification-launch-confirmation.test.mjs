import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { queryLaunchConsent } from "./qualification-launch-confirmation.mjs";

function fixture({
  changed,
  windows = 1,
  trusted = true,
  failPress = false,
  expired = false,
} = {}) {
  let pressed = 0;
  const press = { name: () => "AXPress" };
  const leaf = (role, name) => ({
    role: () => role,
    name: () => name,
    uiElements: () => [],
  });
  const button = (name) => ({
    ...leaf("AXButton", name),
    enabled: () => true,
    actions: { byName: () => press },
  });
  const elements = [
    leaf("AXImage", null),
    leaf(
      "AXStaticText",
      "“Situate” is an app created by the app Fixture. Are you sure you want to open it?",
    ),
    leaf(
      "AXStaticText",
      "Fixture created this file on November 18. Apple checked it for malicious software and none was detected.",
    ),
    button(null),
    button("Cancel"),
    button("Open"),
  ];
  changed?.(elements, button);
  const view = { ...leaf("AXWindow", null), uiElements: () => elements };
  const application = {
    applicationProcesses: {
      byName(name) {
        assert.equal(name, "CoreServicesUIAgent");
        return {
          exists: () => true,
          unixId: () => 42,
          windows: () => Array(windows).fill(view),
        };
      },
    },
    perform(action) {
      assert.equal(action, press);
      pressed++;
      if (failPress) throw new Error("private AppleEvent error");
    },
  };
  return {
    pressed: () => pressed,
    execute: async (command, args, { env }) => {
      assert.equal(command, "/usr/bin/osascript");
      assert.deepEqual(env, { LANG: "en_US.UTF-8" });
      return runInNewContext(args[3], {
        Application(name) {
          assert.equal(name, "System Events");
          return application;
        },
        ObjC: { import: () => {}, unwrap: (value) => value },
        $: {
          NSRunningApplication: {
            runningApplicationWithProcessIdentifier(pid) {
              assert.equal(pid, 42);
              return {
                bundleIdentifier: "com.apple.coreservices.uiagent",
                bundleURL: {
                  path: trusted
                    ? "/System/Library/CoreServices/CoreServicesUIAgent.app"
                    : "/synthetic/other.app",
                },
              };
            },
          },
        },
        ...(expired ? { Date: { now: () => Infinity } } : {}),
      });
    },
  };
}

const query = (mode, f) =>
  queryLaunchConsent(mode, {
    ...f,
    environment: { LANG: "en_US.UTF-8", GH_TOKEN: "not forwarded" },
  });

test("only the known notarized first-launch dialog can press its single enabled Open button", async () => {
  const f = fixture();
  assert.equal(await query("baseline", f), "unexpected");
  assert.equal(f.pressed(), 0);
  assert.equal(await query("confirm", f), "confirmed");
  assert.equal(f.pressed(), 1);
  const empty = fixture({ windows: 0 });
  assert.equal(await query("baseline", empty), "absent");
  assert.equal(await query("confirm", empty), "absent");
  assert.equal(empty.pressed(), 0);
});

test("ambiguous, foreign, blocking and expired dialogs never press", async () => {
  for (const f of [
    fixture({ windows: 2 }),
    fixture({ trusted: false }),
    fixture({ expired: true }),
    fixture({
      changed: (e) => {
        e[1].name = () =>
          "“Different” is an app created by the app Fixture. Are you sure you want to open it?";
      },
    }),
    fixture({
      changed: (e) => {
        e[2].name = () =>
          "Fixture created this file on November 18. Apple could not check it for malicious software.";
      },
    }),
    fixture({
      changed: (e, button) => {
        e[3] = button("Open");
      },
    }),
    fixture({
      changed: (e) => {
        e[5].enabled = () => false;
      },
    }),
  ]) {
    assert.ok(
      ["unavailable", "unexpected"].includes(await query("confirm", f)),
    );
    assert.equal(f.pressed(), 0);
  }
});

test("baseline distinguishes a query failure, expired sample and caller cancellation", async (t) => {
  const clock = t.mock.method(
    AbortSignal,
    "timeout",
    () => new AbortController().signal,
  );
  assert.equal(
    await query("baseline", {
      execute: async () => {
        throw new Error("private system error");
      },
    }),
    "query_failed",
  );
  assert.equal(
    await query("baseline", { execute: async () => "private native output" }),
    "query_failed",
  );
  const deadline = new AbortController();
  clock.mock.mockImplementation((ms) => {
    assert.equal(ms, 1500);
    return deadline.signal;
  });
  assert.equal(
    await query("baseline", {
      execute: async () => {
        deadline.abort();
        return "absent";
      },
    }),
    "query_timeout",
  );
  assert.equal(
    await query("baseline", {
      signal: AbortSignal.abort(),
      execute: () => assert.fail("Queried after cancellation"),
    }),
    "query_cancelled",
  );
});

test("a press with uncertain outcome is never retried or reported confirmed", async () => {
  const f = fixture({ failPress: true });
  assert.equal(await query("confirm", f), "press-unknown");
  assert.equal(f.pressed(), 1);
  assert.equal(
    await queryLaunchConsent("confirm", {
      signal: AbortSignal.abort(),
      execute: () => assert.fail("Started after cancellation"),
    }),
    "unavailable",
  );
});
