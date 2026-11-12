import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL(
    "../app/src-tauri/tests/support/creation-handoff-smoke.js",
    import.meta.url,
  ),
  "utf8",
);

async function journey({
  secondary = false,
  initialCurrent = false,
  replaceWindow = false,
  handoff = "create",
} = {}) {
  let focused = false;
  let screen = "entry";
  let current = initialCurrent ? { id: "unexpected" } : null;
  let waitingForChild = false;
  let childSteps = 0;
  let childReady = false;
  let childClosed = false;
  let ready = 0;
  let report;
  const activations = [];
  const accent = secondary ? "cobalt" : "tangerine";
  const background = secondary ? "rgb(48, 92, 244)" : "rgb(255, 135, 77)";
  const foreground = secondary ? "rgb(255, 254, 250)" : "rgb(48, 32, 62)";
  const label = secondary ? "workspace-1" : "main";
  const name = {
    value: "",
    disabled: false,
    isConnected: true,
    focus() {},
    dispatchEvent() {},
  };
  const element = { closest: () => null, dataset: {}, inert: false };
  const button = (text, click) => ({
    disabled: false,
    click,
    cloneNode: () => ({
      querySelectorAll: () => [],
      querySelector: () => null,
      textContent: text,
    }),
  });
  const create = button("Create a workspace", () => {
    screen = "create";
  });
  const confirm = button("Create workspace", () => {
    current = { id: "created" };
    screen = "access";
  });
  const state = () => ({
    label,
    process: 1,
    identity: replaceWindow && current ? "replaced" : "original",
    navigations: 1,
    size: { width: 768, height: 800 },
    windows: secondary ? ["main", "workspace-1"] : ["main"],
    visible: true,
    focused,
  });
  const invoke = async (command, args) => {
    switch (command) {
      case "workspace_snapshot":
        return {
          ready: true,
          current,
          open: current
            ? [
                current,
                ...(childReady && !childClosed ? [{ id: "second" }] : []),
              ]
            : [],
        };
      case "smoke_window_state":
        if (args?.focus) {
          assert.ok(
            handoff !== "reopen" || current,
            "reopened entry stole workspace foreground",
          );
          assert.equal(
            waitingForChild,
            false,
            "primary stole the child's foreground",
          );
          activations.push(screen);
          focused = true;
        }
        return state();
      case "smoke_phase":
        return { handoff, shellReady: childReady };
      case "smoke_progress":
        return;
      case "smoke_parent":
        return { id: "synthetic-parent" };
      case "smoke_failed_creation":
        assert.equal(
          focused,
          true,
          "entry was driven without native activation",
        );
        return;
      case "appearance_snapshot":
        return { accent, revision: "saved", writable: true };
      case "onboarding_load":
        return { record: { step: "access", entered: false } };
      case "files_request":
        assert.equal(args.request.operation, "create");
        return { status: "saved" };
      case "smoke_shell_ready":
        ready++;
        return;
      case "workspace_action":
        if (args.action === "entry") {
          waitingForChild = true;
          focused = false;
        }
        return;
      case "smoke_failure_cases":
        return;
      case "smoke_close_window":
        childClosed = true;
        return;
      case "verify_smoke_registry":
        assert.deepEqual(Array.from(args.known), ["created", "second"]);
        assert.deepEqual(Array.from(args.restore), ["created"]);
        return;
      case "smoke_checkpoint":
        assert.equal(args.restart, true);
        return;
      case "finish_smoke_test":
        report = args.error;
        return;
      default:
        throw new Error(`Unexpected command: ${command}`);
    }
  };
  await runInNewContext(source, {
    window: {
      nativeSmokeWait: {
        invoke,
        async wait(probe, message) {
          for (let attempt = 0; attempt < 5; attempt++) {
            const result = await probe();
            if (result) return result;
            if (waitingForChild && ++childSteps === 2) {
              childReady = true;
              waitingForChild = false;
            }
          }
          throw new Error(message);
        },
      },
    },
    document: {
      visibilityState: "visible",
      hasFocus: () => focused,
      documentElement: { dataset: { workspaceAccent: accent } },
      querySelectorAll: () =>
        screen === "entry" ? [create] : screen === "create" ? [confirm] : [],
      querySelector: (selector) => {
        if (selector === "#workspace-name")
          return screen === "create" ? name : null;
        if (selector === "#workspace-parent") return { value: "/synthetic" };
        if (selector.startsWith('input[type="radio"]')) return { click() {} };
        if (
          screen === "access" &&
          [
            ".setup-access-panel",
            ".setup-steps .active .badge-fill",
            ".setup-frame .situate-button--normal",
          ].includes(selector)
        )
          return element;
        return null;
      },
    },
    Event: class {},
    getComputedStyle: () => ({
      backgroundColor: background,
      color: foreground,
    }),
  });
  return { report, ready, activations, childReady };
}

test("primary creation activates its entry but yields foreground until the second window is ready", async () => {
  const result = await journey();
  assert.equal(result.report, null);
  assert.equal(result.ready, 1);
  assert.equal(result.childReady, true);
  assert.ok(result.activations.length > 0);
});

test("the reopened entry waits for registry readiness without taking workspace focus", async () => {
  const result = await journey({ handoff: "reopen" });
  assert.equal(result.report, undefined);
  assert.equal(result.ready, 0);
  assert.deepEqual(result.activations, []);
});

test("the secondary drives its own creation and reports readiness", async () => {
  const result = await journey({ secondary: true });
  assert.equal(result.report, undefined);
  assert.equal(result.ready, 1);
  assert.ok(result.activations.length > 0);
});

test("unexpected initial workspace ownership cannot silently skip creation", async () => {
  const result = await journey({ initialCurrent: true, secondary: true });
  assert.match(
    result.report,
    /Creation fixture started in an existing workspace/,
  );
  assert.equal(result.ready, 0);
});

test("rejects native window replacement during foreground activation", async () => {
  const result = await journey({ replaceWindow: true });
  assert.match(result.report, /Creation changed window state: identity/);
  assert.equal(result.ready, 0);
});
