import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  classifyLaunchDialog,
  observeLaunchDialog,
  launchDialogQuery,
} from "./qualification-launch-observation.mjs";

const unavailable = "observation_unavailable";
const button = (text) => ({ role: "AXButton", text });
const dialog = (title = "Situate.app") => ({
  role: "AXWindow",
  title,
  elements: [button("Open"), button("Cancel")],
});
const snapshot = (...windows) => ({
  version: 1,
  process: "CoreServicesUIAgent",
  windows,
});

function query(
  windows,
  {
    present = true,
    onCollection = () => {},
    materialize = (items) => items,
    onRead = () => {},
    serialize = JSON.stringify,
  } = {},
) {
  const read = (point, value) => {
    onRead(point);
    return value;
  };
  const collection = (items, point) => () => {
    onCollection();
    onRead(point);
    return materialize(Object.freeze(items));
  };
  const element = (node, isWindow = false) =>
    Object.freeze({
      role: () => read(isWindow ? "window_role" : "element_role", node.role),
      name: () =>
        read(
          isWindow ? "window_name" : "element_name",
          node.text ?? node.title,
        ),
      value: () => read("element_value", node.text),
      uiElements: collection(
        (node.elements ?? []).map((node) => element(node)),
        "element_collection",
      ),
    });
  const agent = Object.freeze({
    exists: () => read("process_exists", present),
    windows: collection(
      windows.map((node) => element(node, true)),
      "window_collection",
    ),
  });
  const output = runInNewContext(launchDialogQuery, {
    JSON: { stringify: serialize },
    Application(name) {
      onRead("application");
      assert.equal(name, "System Events");
      return Object.freeze({
        applicationProcesses: Object.freeze({
          byName(processName) {
            onRead("process_lookup");
            assert.equal(processName, "CoreServicesUIAgent");
            return agent;
          },
        }),
      });
    },
  });
  assert.equal(typeof output, "string");
  return JSON.parse(output);
}

test("JXA resolves callable window and element collections before counting or indexing", () => {
  let collections = 0;
  assert.deepEqual(
    query([dialog()], { onCollection: () => collections++ }),
    snapshot(dialog()),
  );
  assert.equal(collections, 4);
  assert.deepEqual(query([dialog()], { materialize: () => ({ length: 0 }) }), {
    unavailable: "window_collection",
  });
});

test("only a specific Situate token and English Open/Cancel pair in the same window is positive", () => {
  assert.equal(
    classifyLaunchDialog(snapshot(dialog()), "Situate"),
    "dialog_observed",
  );
  const window = dialog("");
  window.elements.push({
    role: "AXStaticText",
    text: "“Situate” is an app downloaded from the Internet. Are you sure you want to open it?",
  });
  assert.equal(
    classifyLaunchDialog(snapshot(window), "Situate"),
    "dialog_observed",
  );
  assert.equal(
    classifyLaunchDialog(snapshot(dialog("Other.app")), "Situate"),
    "dialog_not_observed",
  );
  assert.equal(
    classifyLaunchDialog(snapshot(), "Situate"),
    "dialog_not_observed",
  );
  assert.equal(
    classifyLaunchDialog(snapshot(dialog("SituateHelper.app")), "Situate"),
    "dialog_not_observed",
  );
  assert.equal(
    classifyLaunchDialog(snapshot(dialog("NotSituate.app")), "Situate"),
    "dialog_not_observed",
  );
});

test("a single Situate-associated window with another layout is not a confirmed Open/Cancel dialog", () => {
  const windows = [
    { ...dialog(), elements: [] },
    { ...dialog(), elements: [button("Open")] },
    { ...dialog(), elements: [button("Öffnen"), button("Abbrechen")] },
    {
      ...dialog(),
      elements: [{ role: "AXStaticText", text: "Open" }, button("Cancel")],
    },
    {
      ...dialog(""),
      elements: [
        { role: "AXStaticText", text: "Situate cannot start." },
        button("OK"),
      ],
    },
  ];
  for (const window of windows)
    assert.equal(
      classifyLaunchDialog(snapshot(window), "Situate"),
      "associated_dialog_observed",
    );
  assert.equal(
    classifyLaunchDialog(
      snapshot(
        { ...dialog(), elements: [button("Open")] },
        { ...dialog("Other.app"), elements: [button("Cancel")] },
      ),
      "Situate",
    ),
    "associated_dialog_observed",
  );
  assert.equal(
    classifyLaunchDialog(
      snapshot({ ...dialog("Other.app"), elements: [button("OK")] }),
      "Situate",
    ),
    "dialog_not_observed",
  );
});

test("generic, ambiguous, missing and unsupported observations are unavailable", () => {
  const cases = [
    null,
    {},
    { version: 1, process: "CoreServicesUIAgent" },
    { ...snapshot(), process: "OtherProcess" },
    { ...snapshot(dialog()), privateText: "must not escape" },
    snapshot(dialog("")),
    snapshot(dialog("Confirmation")),
    snapshot(dialog(), dialog()),
    snapshot({
      ...dialog(),
      elements: [button("Open"), button("Cancel"), button("Open")],
    }),
    snapshot({
      ...dialog(),
      elements: [
        button("Open"),
        button("Cancel"),
        { role: "AXUnknown", text: "" },
      ],
    }),
    snapshot(dialog("Situate.app and Other.app")),
    snapshot(dialog("Other.app and Another.app")),
    snapshot({
      ...dialog(""),
      elements: [button("Öffnen"), button("Abbrechen")],
    }),
    snapshot({ ...dialog(), elements: [button("OK")] }, dialog()),
  ];
  for (const value of cases)
    assert.equal(classifyLaunchDialog(value, "Situate"), unavailable);
  for (const name of [
    undefined,
    "Other",
    "Situate.app",
    "SituateHelper",
    "situate",
  ])
    assert.equal(classifyLaunchDialog(snapshot(dialog()), name), unavailable);
});

test("classification rejects caps and oversized output instead of clipping to absence", () => {
  assert.equal(
    classifyLaunchDialog(
      snapshot(...Array.from({ length: 5 }, () => dialog("Other.app"))),
      "Situate",
    ),
    unavailable,
  );
  assert.equal(
    classifyLaunchDialog(snapshot(dialog("x".repeat(129))), "Situate"),
    unavailable,
  );
  const tooMany = dialog();
  tooMany.elements.push(
    ...Array.from({ length: 63 }, () => ({ role: "AXGroup", text: "" })),
  );
  assert.equal(classifyLaunchDialog(snapshot(tooMany), "Situate"), unavailable);
  const oversized = Array.from({ length: 4 }, (_, index) => {
    const window = dialog(index === 0 ? "Situate.app" : "Other.app");
    window.elements.push(
      ...Array.from({ length: 62 }, () => ({
        role: "AXStaticText",
        text: "界".repeat(128),
      })),
    );
    return window;
  });
  assert.equal(
    classifyLaunchDialog(snapshot(...oversized), "Situate"),
    unavailable,
  );
});

test("JXA query is process-scoped and read-only and returns locally classified bounded snapshots", () => {
  assert.equal(
    classifyLaunchDialog(query([dialog()]), "Situate"),
    "dialog_observed",
  );
  assert.deepEqual(query([], { present: false }), snapshot());
  const nested = dialog("");
  nested.elements.push({
    role: "AXGroup",
    elements: [{ role: "AXStaticText", text: "Open “Situate”?" }],
  });
  assert.equal(
    classifyLaunchDialog(query([nested]), "Situate"),
    "dialog_observed",
  );
  assert.doesNotMatch(
    launchDialogQuery,
    /activate|frontmost|click|press|keystroke|AXRaise|AXPress|setValue|setAttribute|\.\w+\s*=/i,
  );
  assert.match(launchDialogQuery, /Application\("System Events"\)/);
  assert.match(launchDialogQuery, /byName\("CoreServicesUIAgent"\)/);
});

test("JXA traversal and attribute limits return unavailable without partial snapshots", () => {
  assert.deepEqual(
    query(Array.from({ length: 5 }, () => dialog("Other.app"))),
    { unavailable: "limit" },
  );
  assert.deepEqual(query([dialog("x".repeat(129))]), { unavailable: "limit" });
  assert.deepEqual(
    query([
      {
        ...dialog(),
        elements: [
          button("Open"),
          button("Cancel"),
          { role: "AXStaticText", text: "x".repeat(129) },
        ],
      },
    ]),
    { unavailable: "limit" },
  );
  const atLimit = dialog();
  atLimit.elements.push(
    ...Array.from({ length: 62 }, () => ({ role: "AXGroup", elements: [] })),
  );
  assert.equal(
    classifyLaunchDialog(query([atLimit]), "Situate"),
    "dialog_observed",
  );
  atLimit.elements.push({ role: "AXGroup" });
  assert.deepEqual(query([atLimit]), { unavailable: "limit" });
  const nested = dialog();
  nested.elements.push({
    role: "AXGroup",
    elements: Array.from({ length: 62 }, () => ({ role: "AXGroup" })),
  });
  assert.deepEqual(query([nested]), { unavailable: "limit" });
  assert.deepEqual(query([], { present: "unknown" }), {
    unavailable: "process",
  });
  assert.deepEqual(query([], { present: null }), { unavailable: "process" });
  const oversized = Array.from({ length: 4 }, () => ({
    ...dialog("Other.app"),
    elements: [
      button("Open"),
      button("Cancel"),
      ...Array.from({ length: 62 }, () => ({
        role: "AXStaticText",
        text: "界".repeat(128),
      })),
    ],
  }));
  assert.deepEqual(query(oversized), { unavailable: "limit" });
  assert.equal(
    runInNewContext(launchDialogQuery, {
      Application() {
        throw new Error("private API error");
      },
    }),
    '{"unavailable":"process"}',
  );
});

test("query getter failures expose only the fixed stage at the failed operation", async () => {
  const window = {
    ...dialog(),
    elements: [...dialog().elements, { role: "AXStaticText", text: "Situate" }],
  };
  const points = [
    ["application", "process"],
    ["process_lookup", "process"],
    ["process_exists", "process"],
    ["window_collection", "window_collection"],
    ["window_role", "window_attributes"],
    ["window_name", "window_attributes"],
    ["element_collection", "element_collection"],
    ["element_role", "element_attributes"],
    ["element_name", "element_attributes"],
    ["element_value", "element_attributes"],
  ];
  for (const [point, stage] of points) {
    const result = query([window], {
      onRead(current) {
        if (current === point) throw new Error("private UI/path/error details");
      },
    });
    assert.deepEqual(result, { unavailable: stage });
    assert.equal(
      await observeLaunchDialog({
        applicationName: "Situate",
        execute: async () => JSON.stringify(result),
      }),
      `query_${stage}_unavailable`,
    );
  }
  assert.deepEqual(query([{ ...dialog(), title: null }]), {
    unavailable: "window_attributes",
  });
  assert.deepEqual(
    query([{ ...dialog(), elements: [{ role: "AXStaticText", text: null }] }]),
    { unavailable: "element_attributes" },
  );
  const serialization = query([window], {
    serialize() {
      throw new Error("private serialization failure");
    },
  });
  assert.deepEqual(serialization, { unavailable: "serialization" });
});

test("Node accepts only exact allowlisted query failure envelopes", async () => {
  for (const stage of [
    "process",
    "window_collection",
    "window_attributes",
    "element_collection",
    "element_attributes",
    "limit",
    "serialization",
  ])
    assert.equal(
      await observeLaunchDialog({
        applicationName: "Situate",
        execute: async () => JSON.stringify({ unavailable: stage }),
      }),
      `query_${stage}_unavailable`,
    );
  for (const value of [
    { unavailable: "private error" },
    { unavailable: 4 },
    { unavailable: null },
    { unavailable: "query_process_unavailable" },
    { unavailable: "process", message: "private UI text" },
    { unavailable: "process", count: 1 },
  ])
    assert.equal(
      await observeLaunchDialog({
        applicationName: "Situate",
        execute: async () => JSON.stringify(value),
      }),
      "query_execution_unavailable",
    );
});

test("observer takes one credential-free bounded sample and returns no raw attributes", async () => {
  let calls = 0;
  const result = await observeLaunchDialog({
    applicationName: "Situate",
    environment: {
      PATH: "/public/bin",
      HOME: "/synthetic/home",
      TMPDIR: "/synthetic/tmp",
      GH_TOKEN: "private",
      APPLE_KEY: "private",
      SITUATE_CONFIG: "private",
    },
    execute: async (command, args, options) => {
      calls++;
      assert.equal(command, "/usr/bin/osascript");
      assert.deepEqual(args, ["-l", "JavaScript", "-e", launchDialogQuery]);
      assert.deepEqual(options.env, {
        PATH: "/public/bin",
        HOME: "/synthetic/home",
        TMPDIR: "/synthetic/tmp",
      });
      assert.equal(options.capture, true);
      assert.equal(options.terminationGraceMs, 2000);
      assert.equal(options.signal.aborted, false);
      return JSON.stringify(snapshot(dialog()));
    },
  });
  assert.equal(result, "dialog_observed");
  assert.equal(calls, 1);
  assert.equal(
    await observeLaunchDialog({
      applicationName: "Other",
      execute: () => assert.fail("No arbitrary application scope"),
    }),
    unavailable,
  );
});

test("omitted environment forwards only public worker environment keys", async () => {
  const allowed = new Set([
    "PATH",
    "HOME",
    "TMPDIR",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
  ]);
  assert.equal(
    await observeLaunchDialog({
      applicationName: "Situate",
      execute: async (_command, _args, { env }) => {
        assert(Object.keys(env).every((name) => allowed.has(name)));
        assert.equal(typeof env.PATH, "string");
        return JSON.stringify(snapshot());
      },
    }),
    "dialog_not_observed",
  );
});

test("query failures and unknown snapshots have distinct fixed codes without returning private errors", async () => {
  const cases = [
    [
      async () => {
        throw new Error("private stderr/UI/account path");
      },
      "query_execution_unavailable",
    ],
    [async () => "private UI text", "query_execution_unavailable"],
    [async () => "null", "query_execution_unavailable"],
    [async () => "{}", unavailable],
    [async () => "x".repeat(65537), "query_limit_unavailable"],
    [
      async () => JSON.stringify({ ...snapshot(dialog()), stderr: "private" }),
      unavailable,
    ],
    [
      async () =>
        JSON.stringify(snapshot({ ...dialog(), elements: [button("OK")] })),
      "associated_dialog_observed",
    ],
  ];
  for (const [execute, expected] of cases)
    assert.equal(
      await observeLaunchDialog({ applicationName: "Situate", execute }),
      expected,
    );
});

test("pre-abort does not execute and cancellation cannot return a successful sample", async () => {
  const abort = new AbortController();
  abort.abort(new Error("private cancellation"));
  assert.equal(
    await observeLaunchDialog({
      applicationName: "Situate",
      signal: abort.signal,
      execute: () => assert.fail("Already cancelled"),
    }),
    unavailable,
  );
  const active = new AbortController();
  assert.equal(
    await observeLaunchDialog({
      applicationName: "Situate",
      signal: active.signal,
      execute: async (_command, _args, { signal }) => {
        active.abort(new Error("private cancellation"));
        assert.equal(signal.aborted, true);
        return JSON.stringify(snapshot(dialog()));
      },
    }),
    unavailable,
  );
});

test("one-second timeout waits for the executor's owned drain before returning unavailable", async () => {
  let drained = false;
  let calls = 0;
  const result = await observeLaunchDialog({
    applicationName: "Situate",
    execute: async (_command, _args, { signal, terminationGraceMs }) => {
      calls++;
      assert.equal(terminationGraceMs, 2000);
      await new Promise((resolve, reject) => {
        const watchdog = setTimeout(
          () => reject(new Error("Probe did not expire")),
          2000,
        );
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(watchdog);
            assert.equal(signal.reason.name, "TimeoutError");
            resolve();
          },
          { once: true },
        );
      });
      await new Promise(setImmediate);
      drained = true;
      throw signal.reason;
    },
  });
  assert.equal(result, unavailable);
  assert.equal(drained, true);
  assert.equal(calls, 1);
});
