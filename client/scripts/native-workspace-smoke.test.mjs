import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../app/src-tauri/tests/support/workspace-smoke.js", import.meta.url),
  "utf8",
);

const waitSource = await readFile(
  new URL("../app/src-tauri/tests/support/native-wait.js", import.meta.url),
  "utf8",
);

for (const failure of [false, true]) {
  test(`mobile diagnostics smoke runs its dedicated assertions and ${failure ? "propagates failures" : "reports success only afterward"}`, async () => {
    const calls = [];
    let open = [];
    let report;
    const invoke = async (command, args) => {
      if (command === "workspace_snapshot")
        return { ready: true, mobile: true, aiSetup: false, open };
      if (command === "smoke_phase")
        return { diagnostics: true, restart: false, picker: false };
      if (command === "smoke_parent") return { id: "parent" };
      if (command === "workspace_action") {
        assert.equal(args.action, "create");
        open = [{ id: "workspace" }];
        return;
      }
      if (command === "finish_smoke_test") {
        report = args;
        calls.push("finished");
        return;
      }
      if (command === "smoke_shell_ready") {
        calls.push("ready");
        return;
      }
      assert.ok(
        [
          "smoke_progress",
          "workspace_preflight",
          "save_text",
          "verify_smoke_text",
        ].includes(command),
        command,
      );
    };
    const window = {
      __TAURI_INTERNALS__: { invoke },
      prepareLocalizationSmoke: async () => {},
      runEditorSmoke: async () => {
        calls.push("editor");
      },
      runDiagnosticsSmoke: async () => {
        calls.push("diagnostics");
        if (failure) throw new Error("Diagnostic assertion failed");
      },
    };
    const element = {
      readOnly: false,
      disabled: true,
      getAttribute: () => "true",
    };
    const context = {
      window,
      document: {
        querySelector: (selector) =>
          selector === ".workspace-notice" ? null : element,
      },
      setTimeout,
      clearTimeout,
      performance: { now: () => Date.now() },
      console: { error() {} },
    };
    runInNewContext(waitSource, context);
    await runInNewContext(source, context);
    assert.deepEqual(
      calls,
      failure
        ? ["diagnostics", "finished"]
        : ["diagnostics", "ready", "finished"],
    );
    assert.equal(
      report.error,
      failure ? "Error: Diagnostic assertion failed" : null,
    );
  });
}
