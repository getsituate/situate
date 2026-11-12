import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runNativeVm } from "./native-vm-host.mjs";
import { executePackage } from "./native-vm-guest.mjs";

const id = "12345678-1234-1234-1234-123456789abc";

test("host only removes successful or safely unexecuted guest runs", async () => {
  for (const scenario of [
    "success",
    "failure",
    "uncertain",
    "build-failed",
    "stage-failed",
  ]) {
    let cleaned = false,
      released = false,
      isolatedCleaned = false;
    const run = {
      id,
      root: `/Users/admin/.situate-test-runs/${id}`,
      upload: async () => {},
      execute: async () => {
        if (scenario === "uncertain") throw new Error("connection lost");
        return scenario === "success" ? 0 : 1;
      },
      cleanup: async () => {
        cleaned = true;
      },
    };
    const invoke = () =>
      runNativeVm("agent", [], {
        transport: { createNativeVmRun: async () => run },
        verify: () => {},
        isolate: async () => ({
          root: "/local/build",
          owner: id,
          cleanup: async () => {
            isolatedCleaned = true;
          },
        }),
        build: async () => {
          if (scenario === "build-failed") throw new Error("build failed");
          return {
            executable: "/local/target/binary",
            release: async () => {
              released = true;
            },
          };
        },
        stage: async () => {
          if (scenario === "stage-failed") throw new Error("stage failed");
        },
      });
    if (["uncertain", "build-failed", "stage-failed"].includes(scenario))
      await assert.rejects(invoke());
    else assert.equal(await invoke(), scenario === "success" ? 0 : 1);
    assert.equal(
      cleaned,
      ["success", "build-failed", "stage-failed"].includes(scenario),
      scenario,
    );
    assert.equal(isolatedCleaned, true);
    assert.equal(released, scenario !== "build-failed");
  }
});

test("uncertain host build retains its isolation and existing build lock", async () => {
  let cleaned = false;
  await assert.rejects(
    runNativeVm("agent", [], {
      transport: {
        createNativeVmRun: async () => ({
          id,
          root: `/Users/admin/.situate-test-runs/${id}`,
          cleanup: async () => {},
        }),
      },
      isolate: async () => ({
        root: "/local/build",
        cleanup: async () => {
          cleaned = true;
        },
      }),
      build: async () => {
        throw Object.assign(new Error("unsafe"), { cleanupUnsafe: true });
      },
    }),
  );
  assert.equal(cleaned, false);
});

test("guest marks failed cleanup and uncertain teardown for retention without hiding reports", async () => {
  const original = { ...process.env };
  const directory = await mkdtemp(join(tmpdir(), "native-vm-retain-test-"));
  try {
    const manifest = {
      root: directory,
      kind: "agent",
      args: [],
      modes: {},
      executable: "/guest/binary",
    };
    const isolate = async () => ({ root: "/guest/isolation", env: {} });
    assert.equal(
      await executePackage(manifest, {
        isolate,
        agent: async () => ({
          outcome: "blocked",
          cleanup: "failed",
          code: "credential-cleanup-failed",
        }),
      }),
      2,
    );
    assert.equal(
      await readFile(join(directory, ".native-vm-retain"), "utf8"),
      "1\n",
    );
    await rm(join(directory, ".native-vm-retain"));
    await assert.rejects(
      executePackage(manifest, {
        isolate,
        agent: async () => {
          throw Object.assign(new Error("unsafe"), { cleanupUnsafe: true });
        },
      }),
      /unsafe/,
    );
    assert.equal(
      await readFile(join(directory, ".native-vm-retain"), "utf8"),
      "1\n",
    );
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
    await rm(directory, { recursive: true, force: true });
  }
});
