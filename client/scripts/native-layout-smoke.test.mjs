import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../app/src-tauri/tests/support/layout-smoke.js", import.meta.url),
  "utf8",
);
const waitSource = await readFile(
  new URL("../app/src-tauri/tests/support/native-wait.js", import.meta.url),
  "utf8",
);
function binding(invoke, document) {
  const window = { __TAURI_INTERNALS__: { invoke } };
  const context = {
    window,
    document,
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() },
  };
  runInNewContext(waitSource, context);
  runInNewContext(source, context);
  return window;
}

test("layout smoke IPC preserves replies and rejects a permanently pending request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const { invokeLayoutSmoke: invoke } = binding(async (command, args) => {
    assert.equal(command, "layout_load");
    assert.deepEqual(args, { workspaceId: "fixture" });
    return { revision: "first" };
  });
  assert.deepEqual(await invoke("layout_load", { workspaceId: "fixture" }), {
    revision: "first",
  });
  const { invokeLayoutSmoke: stalled } = binding(() => new Promise(() => {}));
  const rejected = assert.rejects(
    stalled("layout_load", {}),
    /Native IPC timed out: layout_load/,
  );
  t.mock.timers.tick(10000);
  await rejected;
});

test("durable navigation failure diagnostics omit content identities and presentation", async () => {
  const invoke = async () => ({
    data: {
      layout: {
        activeTabId: "tab",
        tabs: [
          {
            id: "tab",
            activePaneId: "pane",
            panes: [
              {
                id: "pane",
                navigation: {
                  cursor: 0,
                  entries: [
                    {
                      target: {
                        kind: "conversation",
                        conversationId: "PRIVATE_CONVERSATION",
                      },
                      presentation: { draft: "PRIVATE_DRAFT" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  });
  const smoke = binding(invoke, { querySelector: () => ({}) });
  const timeout = new Error("Fixture timeout");
  smoke.nativeSmokeWait.wait = async (probe, _message, options) => {
    assert.equal(options.timeout, 10000);
    assert.equal(await probe({ invoke }), false);
    throw timeout;
  };
  await assert.rejects(smoke.waitSmokeFileTarget("fixture"), (error) => {
    assert.equal(error.cause, timeout);
    assert.equal(error.message.includes("PRIVATE_"), false);
    assert.deepEqual(JSON.parse(error.message.split("; layout=")[1]), {
      hasLayout: true,
      targetKind: "conversation",
      isFiles: false,
      contentMatches: true,
      hasLayoutNotice: true,
    });
    return true;
  });
});
