import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { nativeSmokeBuildEnvironment } from "../../tools/compiler-cache.mjs";
import { workerBudget } from "../../tools/test-budget.mjs";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { rustHostTarget } from "./test-native.mjs";

const source = await readFile(
  new URL("./test-native.mjs", import.meta.url),
  "utf8",
);
async function controller({
  processOnly = false,
  documentSourcesOnly = false,
  sourceFailure = false,
  handoffOnly = false,
  diagnosticsOnly = false,
  profile,
} = {}) {
  const phases = [];
  const builds = [];
  const listeners = new Set();
  let sourceClosed = false;
  const environment = {
    ...(processOnly ? { SITUATE_PROCESS_CONNECTION_ONLY: "1" } : {}),
    ...(handoffOnly ? { SITUATE_ONBOARDING_HANDOFF_ONLY: "1" } : {}),
    SITUATE_ONBOARDING_HANDOFF_PHASE: "inherited",
    SITUATE_PUBLIC_REPOSITORY_ONLY: "1",
    SITUATE_PUBLIC_REPOSITORY_LIVE: "1",
  };
  const body = source
    .split("if (\n  process.argv[1] &&")[0]
    .replace(/^export /gm, "")
    .replace(/^import[\s\S]*?from "[^"]+";\n/gm, "")
    .replaceAll(
      "import.meta.url",
      '"file:///fixture/client/scripts/test-native.mjs"',
    );
  await vm.runInNewContext(
    `(async () => {${body}\nawait main([], {transport: {nativeVmConfiguration: () => null}});})()`,
    {
      process: {
        argv: ["node", "test-native.mjs"],
        platform: "darwin",
        execPath: "/volta/node",
        env: environment,
        on: (signal) => listeners.add(signal),
        off: (signal) => listeners.delete(signal),
      },
      AbortController,
      requireNativeDesktop() {},
      nativeSmokeBuildEnvironment: () =>
        nativeSmokeBuildEnvironment(environment),
      parseSmokeOptions: () => ({
        diagnosticsOnly,
        documentSourcesOnly,
        profile,
        release: false,
      }),
      startDocumentSourceServer: async () => ({
        url: "http://127.0.0.1:12345",
        report: () => ({ requests: [{ authorized: true }], mutations: 0 }),
        close: async () => {
          sourceClosed = true;
        },
      }),
      fileURLToPath,
      availableParallelism: () => 18,
      workerBudget,
      URL,
      resolve: (...parts) => parts.join("/"),
      join: posix.join,
      isAbsolute: posix.isAbsolute,
      homedir: () => "/fixture/home",
      existsSync: (path) => path === "/fixture/home/.cargo/bin/rustup",
      spawnSync(command, args, options) {
        if (command === "/fixture/home/.cargo/bin/rustup")
          return { status: 0, stdout: "/fixture/toolchain/bin/rustc\n" };
        if (command === "/fixture/toolchain/bin/rustc")
          return { status: 0, stdout: "host: aarch64-apple-darwin\n" };
        builds.push({ command, args, options });
        return { status: 0 };
      },
      withSmokeRoot: (run) =>
        run({
          root: "/owned",
          env: { SITUATE_SMOKE_ROOT: "/owned", SITUATE_SMOKE_OWNER: "owner" },
        }),
      runSmokePhase: async (executable, options) => {
        phases.push({ executable, ...options });
        if (sourceFailure && options.phase === "direct document sources")
          throw new Error("source phase failed");
      },
    },
  );
  assert.equal(listeners.size, 0);
  return { phases, builds, sourceClosed };
}

test("native host detection uses installed Rust tools without searching PATH", async (t) => {
  const cargoHome = await mkdtemp(join(tmpdir(), "situate-rust-home-"));
  t.after(() => rm(cargoHome, { recursive: true, force: true }));
  const extension = process.platform === "win32" ? ".exe" : "";
  const rustup = join(cargoHome, "bin", `rustup${extension}`);
  const rustc = join(cargoHome, "toolchain", `rustc${extension}`);
  await mkdir(join(cargoHome, "bin"));
  await writeFile(rustup, "fixture");
  const environment = { CARGO_HOME: cargoHome };
  const calls = [];
  assert.equal(
    rustHostTarget(environment, (path, args, options) => {
      calls.push([path, args]);
      assert.equal(options.env.RUSTUP_AUTO_INSTALL, "0");
      return {
        status: 0,
        stdout: path === rustup ? `${rustc}\n` : "host: aarch64-apple-darwin\n",
      };
    }),
    "aarch64-apple-darwin",
  );
  assert.deepEqual(calls, [
    [rustup, ["which", "rustc"]],
    [rustc, ["-vV"]],
  ]);
  assert.throws(
    () => rustHostTarget({ CARGO_HOME: "fixture" }, assert.fail),
    /must be absolute/,
  );
  assert.throws(
    () => rustHostTarget(environment, () => ({ status: 0, stdout: "rustc" })),
    /project Rust compiler/,
  );
  assert.throws(
    () =>
      rustHostTarget(environment, (path) => ({
        status: 0,
        stdout: path === rustup ? rustc : "host: invalid target",
      })),
    /Rust host target/,
  );
});

test("default native controller builds once for creation, reopen, entry closure and ordinary native phases", async () => {
  const { phases, builds } = await controller();
  assert.equal(builds.length, 1);
  assert.deepEqual(
    [...builds[0].args.slice(0, 5)],
    [
      "/fixture/tools/run-coordinated.mjs",
      "--resource",
      "build",
      "--",
      "/volta/node",
    ],
  );
  assert.equal(builds[0].options.env.CARGO_BUILD_JOBS, "4");
  assert.equal(
    builds[0].options.env.CARGO_PROFILE_DEV_DEBUG,
    "line-tables-only",
  );
  assert.equal(builds[0].options.env.CARGO_INCREMENTAL, undefined);
  assert.equal(phases.length, 10);
  assert.deepEqual(
    phases.map((phase) => phase.env.SITUATE_ONBOARDING_HANDOFF_PHASE),
    [
      "create",
      "reopen",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ],
  );
  assert.deepEqual(
    phases.map((phase) => phase.timeout),
    [
      105000, 105000, 105000, 105000, 105000, 195000, 105000, 105000, 195000,
      195000,
    ],
  );
  assert.deepEqual(
    phases.map((phase) => phase.env.SITUATE_PLUGIN_CHECKS_PHASE),
    [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "block",
      "repair",
      "repaired",
      "repaired",
      "repaired",
    ],
  );
  assert.equal(phases[5].expectedBlockingStage, "plugin-check-block-armed");
  assert.equal(phases[3].recovery, true);
  assert.equal(phases[2].phase, "entry window closure");
  assert.equal(phases[8].phase, "direct document sources");
  assert.equal(phases[9].phase, "offline process connection");
  assert.deepEqual(
    phases.map((phase) => phase.env.SITUATE_ENTRY_CLOSE_ONLY),
    [
      undefined,
      undefined,
      "1",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ],
  );
  for (const [index, phase] of phases.entries()) {
    assert.equal(phase.env.SITUATE_SMOKE_OWNER, "owner");
    assert.equal(
      phase.env.SITUATE_PROCESS_CONNECTION_ONLY,
      index === 9 ? "1" : undefined,
    );
    assert.equal(
      phase.env.SITUATE_DOCUMENT_SOURCE_ONLY,
      index === 8 ? "1" : undefined,
    );
    assert.equal(
      phase.env.SITUATE_DOCUMENT_SOURCE_URL,
      index === 8 ? "http://127.0.0.1:12345" : undefined,
    );
    assert.equal(phase.env.SITUATE_PUBLIC_REPOSITORY_LIVE, undefined);
    assert.equal(phase.env.SITUATE_PUBLIC_REPOSITORY_ONLY, undefined);
    assert.equal(phase.executable, phases[0].executable);
  }
});

test("handoff-only controller creates and legitimately reopens without running shell fixtures", async () => {
  const { phases, builds } = await controller({ handoffOnly: true });
  assert.equal(builds.length, 1);
  assert.equal(phases.length, 2);
  assert.deepEqual(
    phases.map((phase) => phase.env.SITUATE_ONBOARDING_HANDOFF_PHASE),
    ["create", "reopen"],
  );
  assert.equal(
    phases[0].env.SITUATE_SMOKE_ROOT,
    phases[1].env.SITUATE_SMOKE_ROOT,
  );
});

test("process-only controller uses a fresh block workspace, never the blocking-view expectation", async () => {
  const { phases, builds } = await controller({ processOnly: true });
  assert.equal(builds.length, 1);
  assert.equal(phases.length, 1);
  assert.equal(phases[0].env.SITUATE_PLUGIN_CHECKS_PHASE, "block");
  assert.equal(phases[0].env.SITUATE_PROCESS_CONNECTION_ONLY, "1");
  assert.equal(phases[0].timeout, 195000);
  assert.equal(phases[0].expectedBlockingStage, undefined);
});

test("document-source selection runs one owned read-only fixture phase and closes its server", async () => {
  const { phases, sourceClosed } = await controller({
    documentSourcesOnly: true,
  });
  assert.equal(phases.length, 1);
  assert.equal(phases[0].phase, "direct document sources");
  assert.equal(phases[0].env.SITUATE_PLUGIN_CHECKS_PHASE, "block");
  assert.equal(phases[0].env.SITUATE_DOCUMENT_SOURCE_ONLY, "1");
  assert.equal(sourceClosed, true);
  await assert.rejects(
    controller({ documentSourcesOnly: true, processOnly: true }),
    /without another selected journey/,
  );
  await assert.rejects(
    controller({ documentSourcesOnly: true, sourceFailure: true }),
    /source phase failed/,
  );
});

test("diagnostics and ordinary profile phases keep their deadlines", async () => {
  assert.deepEqual(
    (await controller({ profile: "healthy" })).phases.map(
      (phase) => phase.timeout,
    ),
    [
      120000, 120000, 120000, 120000, 120000, 195000, 120000, 120000, 195000,
      195000,
    ],
  );
  const { phases } = await controller({ diagnosticsOnly: true });
  assert.equal(phases.length, 1);
  assert.equal(phases[0].phase, "diagnostics");
  assert.equal(phases[0].timeout, 105000);
  await assert.rejects(
    controller({ processOnly: true, diagnosticsOnly: true }),
    /without diagnostics/,
  );
});

test("dedicated entry point accepts no options and delegates only after selecting the offline phase", async () => {
  const entry = (
    await readFile(
      new URL("./test-native-process.mjs", import.meta.url),
      "utf8",
    )
  ).replace('await import("./test-native.mjs")', "({main: run})");
  let called = 0;
  const process = {
    argv: ["node", "test-native-process.mjs"],
    platform: "darwin",
    env: {},
  };
  const evaluate = () =>
    vm.runInNewContext(`(async () => {${entry}})()`, {
      process,
      run: async () => {
        assert.equal(process.env.SITUATE_PROCESS_CONNECTION_ONLY, "1");
        called++;
        return 7;
      },
    });
  await evaluate();
  assert.equal(called, 1);
  assert.equal(process.exitCode, 7);
  process.argv.push("--live");
  await assert.rejects(evaluate(), /Usage:/);
  process.argv.pop();
  process.platform = "linux";
  await assert.rejects(evaluate(), /requires macOS/);
  assert.equal(called, 1);
});
