import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { main as nativeMain } from "./test-native.mjs";
import { main as agentMain, runAgent } from "./test-agent-e2e.mjs";
import { childEnvironment } from "./agent-e2e-runtime.mjs";
import { runNativeVm, verifyRuntimeDependencies } from "./native-vm-host.mjs";
import {
  stagePackage,
  readPackage,
  validateRun,
} from "./native-vm-package.mjs";
import { executePackage } from "./native-vm-guest.mjs";

const id = "12345678-1234-1234-1234-123456789abc";
const identity = { id, root: `/Users/admin/.situate-test-runs/${id}` };
const transport = (configured) => ({ nativeVmConfiguration: () => configured });

test("dedicated guest users have bounded run paths without traversal", () => {
  for (const user of ["admin", "native-runner", "tester_2", "_runner"]) {
    validateRun({ id, root: `/Users/${user}/.situate-test-runs/${id}` });
  }
  for (const root of [
    `/Users/../.situate-test-runs/${id}`,
    `/Users/admin/../other/.situate-test-runs/${id}`,
    `/tmp/.situate-test-runs/${id}`,
    `/Users/admin/.situate-test-runs/${id}/extra`,
  ])
    assert.throws(() => validateRun({ id, root }), /identity/);
  assert.throws(
    () =>
      validateRun({
        id: "../escape",
        root: "/Users/admin/.situate-test-runs/../escape",
      }),
    /identity/,
  );
});

test("host rejects non-system runtime libraries without executing the binary", () => {
  const executable = "/local/build with spaces/situate-client";
  const output = (library) =>
    `${executable}:\n\t${library} (compatibility version 1.0.0, current version 1.0.0)\n`;
  const inspect = (stdout) => (command, args, options) => {
    assert.equal(command, "/usr/bin/otool");
    assert.deepEqual(args, ["-L", executable]);
    assert.equal(options.env.HOME, undefined);
    return { status: 0, stdout };
  };
  for (const library of [
    "/usr/lib/libSystem.B.dylib",
    "/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit",
  ])
    verifyRuntimeDependencies(executable, inspect(output(library)));
  for (const library of [
    "/opt/homebrew/lib/libcustom.dylib",
    "@rpath/libcustom.dylib",
    "/usr/lib/../../private/libcustom.dylib",
  ])
    assert.throws(
      () => verifyRuntimeDependencies(executable, inspect(output(library))),
      /non-system/,
    );
  assert.throws(
    () => verifyRuntimeDependencies(executable, () => ({ status: 1 })),
    /inspect/,
  );
  assert.throws(
    () => verifyRuntimeDependencies(executable, inspect("unexpected output")),
    /inventory/,
  );
});

test("entrypoints route before desktop checks, preserving local routing", async () => {
  for (const main of [nativeMain, agentMain]) {
    const calls = [];
    assert.equal(
      await main([], {
        transport: transport({}),
        local: () => {
          throw new Error("host journey must not run");
        },
        remote: async (kind, args) => {
          calls.push([kind, args]);
          return 17;
        },
      }),
      17,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], []);
    let ran = false;
    assert.equal(
      await main([], {
        transport: transport(null),
        local: async () => {
          ran = true;
          return { outcome: "passed" };
        },
        remote: () => {
          throw new Error("unexpected remote journey");
        },
      }),
      0,
    );
    assert.equal(ran, true);
  }
});

test("agent VM orchestration failures remain finite structured results without fallback", async () => {
  const log = console.log;
  const reports = [];
  console.log = (line) => reports.push(JSON.parse(line));
  try {
    for (const stage of ["configuration", "execution", "cancel"]) {
      const code = await agentMain([], {
        transport: {
          nativeVmConfiguration: () => {
            if (stage === "configuration")
              throw new Error("private configuration detail");
            return {};
          },
        },
        local: () => {
          throw new Error("unexpected host fallback");
        },
        remote: () => {
          if (stage === "cancel") process.emit("SIGINT");
          throw new Error("private SSH detail");
        },
      });
      assert.equal(code, stage === "cancel" ? 130 : 2);
      assert.deepEqual(reports.at(-1), {
        version: 1,
        outcome: stage === "cancel" ? "cancel" : "blocked",
        code: stage === "cancel" ? "interrupted" : "native-vm-execution-failed",
      });
    }
  } finally {
    console.log = log;
  }
});

test("the agent CLI reaches the VM transport without a module initialization deadlock", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "situate-vm-cli-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const config = join(home, "vm.json");
  await writeFile(
    config,
    JSON.stringify({
      version: 1,
      vm: "synthetic",
      user: "admin",
      identityFile: join(home, "key"),
      knownHostsFile: join(home, "hosts"),
      node: "/Users/admin/.volta/bin/node",
    }),
  );
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./test-agent-e2e.mjs", import.meta.url))],
    {
      env: {
        HOME: home,
        PATH: "/usr/bin:/bin",
        SITUATE_NATIVE_EXECUTOR: "vm",
        SITUATE_NATIVE_VM_CONFIG: config,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    outcome: "blocked",
    code: "native-vm-execution-failed",
  });
  assert.doesNotMatch(result.stderr, /unsettled top-level await/);
});

test("configured VM blocks paid provider without host fallback", async () => {
  assert.equal(
    await agentMain(["--provider", "openai"], {
      transport: transport({}),
      local: () => {
        throw new Error("host fallback");
      },
      remote: () => {
        throw new Error("paid VM journey");
      },
    }),
    2,
  );
});

test("injected runAgent remains local and does not consult VM configuration", async () => {
  const report = await runAgent(["--help"], {
    environment: { SITUATE_NATIVE_EXECUTOR: "vm" },
    build: () => {
      throw new Error("help built an app");
    },
  });
  assert.equal(report.outcome, "help");
});

test("host builds against guest app directory, stages before unlocking, forwards explicit modes", async () => {
  const events = [];
  const run = {
    ...identity,
    upload: async (directory) => {
      events.push("upload");
      assert.match(directory, /situate-native-vm-package-/);
    },
    execute: async (options) => {
      events.push("execute");
      assert.equal(options.entrypoint, "client/scripts/native-vm-guest.mjs");
      assert.deepEqual(options.args, []);
      return 9;
    },
    cleanup: async () => events.push("remote-cleanup"),
  };
  const environment = {
    HOME: "/host/home",
    SECRET: "do-not-transfer",
    SITUATE_PROCESS_CONNECTION_ONLY: "1",
  };
  const result = await runNativeVm("native", ["--release", "--diagnostics"], {
    environment,
    verify: (executable) => {
      assert.equal(executable, "/local/target/situate-client");
      events.push("verify");
    },
    transport: {
      createNativeVmRun: async () => {
        events.push("allocate");
        return run;
      },
    },
    isolate: async () => ({
      root: "/local/build-home",
      owner: id,
      cleanup: async () => events.push("local-cleanup"),
    }),
    build: async (isolated, options, env) => {
      events.push("build");
      assert.equal(isolated.root, identity.root + "/isolation");
      assert.equal(isolated.buildRoot, "/local/build-home");
      assert.equal(isolated.identifier, "dev.situate.client.smoke");
      assert.equal(options.release, true);
      assert.equal(env, environment);
      return {
        executable: "/local/target/situate-client",
        release: async () => events.push("release"),
      };
    },
    stage: async (_, options) => {
      events.push("stage");
      assert.deepEqual(options.modes, { handoff: false, process: true });
      assert.deepEqual(options.args, ["--release", "--diagnostics"]);
      assert.equal(Object.hasOwn(options, "environment"), false);
    },
  });
  assert.equal(result, 9);
  assert.deepEqual(events, [
    "allocate",
    "build",
    "verify",
    "stage",
    "release",
    "local-cleanup",
    "upload",
    "execute",
  ]);
});

test("VM native builds preserve native profile overrides without changing agent builds", () => {
  const isolated = {
    root: "/guest/isolation",
    buildRoot: "/local/build",
    owner: id,
  };
  const environment = {
    HOME: "/local/home",
    PATH: "/usr/bin",
    CARGO_INCREMENTAL: "1",
    CARGO_PROFILE_DEV_DEBUG: "full",
  };
  const native = childEnvironment(isolated, environment, {
    build: true,
    nativeSmoke: true,
  });
  assert.equal(native.CARGO_INCREMENTAL, "1");
  assert.equal(native.CARGO_PROFILE_DEV_DEBUG, "full");
  assert.equal(
    childEnvironment(
      isolated,
      { HOME: "/local/home", PATH: "/usr/bin" },
      { build: true, nativeSmoke: true },
    ).CARGO_INCREMENTAL,
    undefined,
  );
  const agent = childEnvironment(isolated, environment, { build: true });
  assert.equal(agent.CARGO_INCREMENTAL, "0");
  assert.equal(agent.CARGO_PROFILE_DEV_DEBUG, "line-tables-only");
});

test("build environment keeps HOME and compiler cache host-side", async () => {
  const env = childEnvironment(
    {
      root: identity.root + "/isolation",
      buildRoot: "/local/build",
      owner: id,
    },
    {
      HOME: "/host/home",
      PATH: "/usr/bin:/bin",
      SITUATE_SCCACHE: "0",
      SCCACHE_DIR: "/host/cache",
      SECRET: "private",
    },
    { build: true },
  );
  assert.equal(env.HOME, "/local/build/home");
  assert.equal(env.TMPDIR, "/local/build/tmp");
  assert.equal(env.RUSTUP_HOME, "/host/home/.rustup");
  assert.equal(env.SECRET, undefined);
  assert.equal(env.RUSTC_WRAPPER, undefined);
  const directory = await mkdtemp(join(tmpdir(), "native-vm-cache-test-"));
  try {
    await writeFile(
      join(directory, "sccache"),
      "#!/bin/sh\nprintf 'sccache 0.19.0\\n'\n",
      {
        mode: 0o700,
      },
    );
    const cached = childEnvironment(
      {
        root: identity.root + "/isolation",
        buildRoot: "/local/build",
        owner: id,
      },
      {
        HOME: "/host/home",
        PATH: directory,
        SCCACHE_DIR: "/host/shared cache",
        SCCACHE_CACHE_SIZE: "12G",
        SCCACHE_ENDPOINT: "must-not-transfer",
        RUSTC_WRAPPER: "/personal/wrapper",
      },
      { build: true },
    );
    assert.equal(cached.RUSTC_WRAPPER, join(directory, "sccache"));
    assert.equal(cached.SCCACHE_DIR, "/host/shared cache");
    assert.equal(cached.SCCACHE_CACHE_SIZE, "12G");
    assert.equal(cached.SCCACHE_ENDPOINT, undefined);
    assert.equal(cached.HOME, "/local/build/home");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("package contains only explicit same-revision runtime inputs and rejects mutations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native vm test "));
  try {
    const executable = join(directory, "binary with spaces");
    await writeFile(executable, "synthetic binary", { mode: 0o700 });
    const staging = join(directory, "package with spaces");
    const manifest = await stagePackage(staging, {
      run: identity,
      kind: "agent",
      args: [],
      modes: { handoff: false, process: false },
      executable,
    });
    const loaded = await readPackage(staging);
    const pins = JSON.parse(
      await readFile(join(staging, "package.json"), "utf8"),
    ).volta;
    assert.match(pins.node, /^\d+\.\d+\.\d+$/);
    assert.ok(manifest.files["package.json"]);
    assert.ok(manifest.files["tools/test-budget.mjs"]);
    for (const name of [
      "native-vm-guest",
      "native-vm-host",
      "test-native",
      "test-agent-e2e",
      "agent-e2e-provider",
    ]) {
      await import(
        pathToFileURL(join(staging, `client/scripts/${name}.mjs`)).href
      );
    }
    assert.equal(loaded.isolation.root, identity.root + "/isolation");
    assert.equal(loaded.executable, join(staging, "runtime/situate-client"));
    assert.equal(
      Object.keys(manifest.files).some((name) =>
        /node_modules|\.env|target\//.test(name),
      ),
      false,
    );
    assert.equal(
      await readFile(
        join(staging, "client/scripts/agent-e2e-runtime.mjs"),
        "utf8",
      ),
      await readFile(
        new URL("./agent-e2e-runtime.mjs", import.meta.url),
        "utf8",
      ),
    );
    await writeFile(join(staging, "unexpected"), "not permitted");
    await assert.rejects(readPackage(staging), /Unexpected/);
    await rm(join(staging, "unexpected"));
    await chmod(loaded.executable, 0o700);
    await writeFile(loaded.executable, "mutated");
    await chmod(loaded.executable, 0o500);
    await assert.rejects(readPackage(staging), /checksum/);
    await rm(loaded.executable);
    await symlink(executable, loaded.executable);
    await assert.rejects(readPackage(staging), /checksum/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("guest reuses prebuilt executable for both flows without exposing ambient secrets", async () => {
  const original = { ...process.env };
  try {
    for (const kind of ["native", "agent"]) {
      process.env.HOST_SECRET = "private";
      process.env.RUSTC_WRAPPER = "/host/sccache";
      const manifest = {
        ...identity,
        kind,
        args: [],
        modes: { handoff: true, process: false },
        executable: "/guest/runtime/situate-client",
      };
      let cleaned = false;
      const isolated = {
        root: "/guest/isolation",
        owner: id,
        env: { HOME: "/guest/isolation/home", CI: "true" },
        cleanup: async () => {
          cleaned = true;
        },
      };
      const result = await executePackage(manifest, {
        isolate: async () => isolated,
        native: async (args, options) => {
          assert.equal(await options.build(), manifest.executable);
          assert.equal(
            options.environment.SITUATE_ONBOARDING_HANDOFF_ONLY,
            "1",
          );
          await options.isolate(async (actual) =>
            assert.equal(actual, isolated),
          );
        },
        agent: async (args, options) => {
          const built = await options.build();
          assert.equal(built.executable, manifest.executable);
          assert.equal(await options.isolate(), isolated);
          await isolated.cleanup();
          return { outcome: "passed" };
        },
      });
      assert.equal(result, 0);
      assert.equal(cleaned, true);
      assert.equal(process.env.HOST_SECRET, undefined);
      assert.equal(process.env.RUSTC_WRAPPER, undefined);
      assert.equal(process.env.SITUATE_NATIVE_EXECUTOR, "local");
    }
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
