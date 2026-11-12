import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL(
    "../app/src-tauri/tests/support/diagnostics-smoke.js",
    import.meta.url,
  ),
  "utf8",
);

function profileHarness(hideDuringIdle = false) {
  const measurements = [];
  const commands = [];
  const uncaughtErrors = [];
  const listeners = new Set();
  let now = 0;
  const document = {
    visibilityState: "visible",
    body: { textContent: "PRIVATE_DIAGNOSTIC_CONTENT_SENTINEL" },
    querySelector: () => null,
    querySelectorAll: (selector) =>
      selector === "button.nav-destination"
        ? [{ textContent: "Files", click() {} }]
        : [
            {
              getAttribute: (name) =>
                name === "aria-description" ? "diagnostic-smoke.md" : null,
              click() {},
            },
          ],
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const window = {
    __TAURI_INTERNALS__: {
      async invoke(command, payload) {
        commands.push(command);
        if (command === "workspace_snapshot")
          return { current: { id: "workspace" } };
        if (command === "diagnostics_register") return null;
        if (command === "diagnostics_emit") throw new Error("Oversized batch");
        if (command === "files_request")
          return {
            status: "ok",
            document: { version: { text: "# Fixture\n" } },
          };
        if (command === "smoke_phase") return { diagnosticsProfile: "healthy" };
        if (command === "smoke_measure_diagnostics") measurements.push(payload);
      },
    },
  };
  vm.runInNewContext(source, {
    window,
    document,
    Uint8Array,
    performance: { now: () => now++ },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout(callback, milliseconds) {
      now += milliseconds;
      if (hideDuringIdle && milliseconds === 10000) {
        for (const visibility of ["hidden", "visible"]) {
          document.visibilityState = visibility;
          for (const listener of listeners) listener();
        }
      }
      try {
        callback();
      } catch (error) {
        // A browser reports timer errors separately from the surrounding promise.
        if (
          milliseconds !== 0 ||
          error.message !== "PRIVATE_DIAGNOSTIC_CONTENT_SENTINEL"
        )
          throw error;
        uncaughtErrors.push(error.message);
      }
    },
  });
  return {
    run: window.runDiagnosticsSmoke,
    measurements,
    commands,
    listeners,
    uncaughtErrors,
  };
}

test("visible diagnostic profiles report every phase and verify the healthy collector", async () => {
  const harness = profileHarness();
  await harness.run();
  assert.deepEqual(harness.uncaughtErrors, [
    "PRIVATE_DIAGNOSTIC_CONTENT_SENTINEL",
  ]);
  assert.deepEqual(
    harness.measurements.map(({ phase }) => phase),
    ["ready", "idle", "burst"],
  );
  assert.equal(harness.measurements[2].ui.requests, 1000);
  assert.equal(harness.measurements[2].ui.visible, true);
  assert.equal(
    harness.commands.filter((command) => command === "smoke_verify_diagnostics")
      .length,
    1,
  );
  assert.equal(harness.listeners.size, 0);
});

test("a briefly hidden phase preserves its observation but fails before the burst", async () => {
  const harness = profileHarness(true);
  await assert.rejects(harness.run(), /measurement window was hidden/);
  assert.deepEqual(harness.uncaughtErrors, [
    "PRIVATE_DIAGNOSTIC_CONTENT_SENTINEL",
  ]);
  assert.deepEqual(
    harness.measurements.map(({ phase }) => phase),
    ["ready", "idle"],
  );
  assert.equal(harness.measurements[1].ui.visible, false);
  assert.equal(harness.commands.includes("smoke_verify_diagnostics"), false);
  assert.equal(harness.listeners.size, 0);
});
