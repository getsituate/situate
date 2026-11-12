import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import {
  BUNDLE,
  AppleTools,
  appleFailureDiagnostic,
  sanitizeAppleDiagnostic,
  isolatedEnvironment,
  buildSmokeApp,
  assertOwned,
  checkDefaults,
  claimContainer,
  coordinationStep,
  inspectContainers,
  launchPhase,
  nativeFailureStage,
  nativeCleanupError,
  regularBytes,
  releaseSmokeSession,
  smokeInitArgs,
  smokeFrontendBuildArgs,
  smokeSessionArgs,
  smokeProjectSpec,
  requireSimulator,
  startProvider,
  toolData,
  validateSimulator,
} from "./test-native-ios.mjs";

test("the native frontend build enables only the smoke IPC trace configuration", (t) => {
  const root = directory(t);
  assert.deepEqual(smokeFrontendBuildArgs({ root }), [
    "run",
    "build",
    "--workspace",
    "@situate/client",
    "--",
    "--config",
    join(root, "scripts/native-ios-trace-vite.config.mjs"),
  ]);
});

function directory(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-ios-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function metadata(root, kind, id, name = randomUUID()) {
  const path = join(root, kind, "Application", name);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, ".com.apple.mobile_container_manager.metadata.plist"),
    `<?xml version="1.0"?><plist version="1.0"><dict><key>MCMMetadataIdentifier</key><string>${id}</string></dict></plist>`,
  );
  return path;
}

test("coordination acquires the worktree before one build lease without recursive queuing", (t) => {
  const root = directory(t);
  const paths = { root, id: "fixture" };
  assert.equal(coordinationStep(paths, {}), "worktree");
  assert.equal(
    coordinationStep(paths, { SITUATE_NATIVE_IOS_BUILD_HELD: "fixture" }),
    "worktree",
  );
  const held = { SITUATE_COORDINATED_WORKTREE: root };
  assert.equal(coordinationStep(paths, held), "build");
  assert.equal(
    coordinationStep(paths, {
      ...held,
      SITUATE_NATIVE_IOS_BUILD_HELD: "another",
    }),
    "build",
  );
  assert.equal(
    coordinationStep(paths, {
      ...held,
      SITUATE_NATIVE_IOS_BUILD_HELD: "fixture",
    }),
    null,
  );
});

test("initial generation and existing project regeneration bind the smoke identity", () => {
  const paths = { cli: "/synthetic/tauri.js", root: "/synthetic/client" };
  const args = smokeInitArgs(paths);
  assert.deepEqual(args.slice(0, 5), [
    paths.cli,
    "ios",
    "init",
    "--ci",
    "--skip-targets-install",
  ]);
  assert.equal(args[5], "--config");
  assert.deepEqual(JSON.parse(args[6]), {
    identifier: BUNDLE,
    productName: "Situate Smoke",
  });
  const source = `name: situate-client
options:
  bundleIdPrefix: dev.situate.client
settingGroups:
  app:
    base:
      PRODUCT_NAME: Situate
      PRODUCT_BUNDLE_IDENTIFIER: dev.situate.client
      DEVELOPMENT_TEAM: ABC1234567
      CODE_SIGN_STYLE: Automatic
      "CODE_SIGN_IDENTITY[sdk=iphoneos*]": "iPhone Developer"
targets:
  situate-client_iOS:
    sources:
      - path: Externals
    dependencies:
      - framework: libapp.a
    preBuildScripts:
      - script: |
          npm run -- tauri ios xcode-script -v
        name: Build Rust Code
`;
  const prepared = smokeProjectSpec(source, paths);
  assert.ok(prepared.includes('bundleIdPrefix: "' + BUNDLE + '"'));
  assert.ok(prepared.includes('PRODUCT_BUNDLE_IDENTIFIER: "' + BUNDLE + '"'));
  assert.ok(prepared.includes("libiconv.tbd"));
  assert.ok(prepared.includes("scripts/ios-xcode-build.mjs"));
  assert.ok(
    prepared.includes('"CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": YES'),
  );
  for (const value of ["NO", "YES"]) {
    const existing = smokeProjectSpec(
      source.replace(
        "      PRODUCT_NAME:",
        `      "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": ${value}\n      PRODUCT_NAME:`,
      ),
      paths,
    );
    assert.equal(
      (
        existing.match(/^ +"CODE_SIGNING_ALLOWED\[sdk=iphonesimulator\*\]/gm) ??
        []
      ).length,
      1,
    );
    assert.ok(
      existing.includes('"CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": YES'),
    );
    assert.ok(existing.includes("      DEVELOPMENT_TEAM: ABC1234567"));
    assert.ok(existing.includes("      CODE_SIGN_STYLE: Automatic"));
    assert.ok(
      existing.includes(
        '"CODE_SIGN_IDENTITY[sdk=iphoneos*]": "iPhone Developer"',
      ),
    );
  }
  for (const changed of [
    source.replace("PRODUCT_NAME:", "UNKNOWN:"),
    source.replace(
      "      PRODUCT_NAME:",
      '      "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": NO\n      "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": NO\n      PRODUCT_NAME:',
    ),
  ])
    assert.throws(
      () => smokeProjectSpec(changed, paths),
      /Unexpected generated iOS (?:project format|simulator signing settings)/,
    );
  assert.throws(
    () =>
      smokeProjectSpec(
        source.replace("PRODUCT_BUNDLE_IDENTIFIER:", "UNKNOWN:"),
        paths,
      ),
    /bundle settings/,
  );
});

test("the guarded smoke session serves bundled assets rather than proxying a development URL", () => {
  const args = smokeSessionArgs({ cli: "/synthetic/tauri.js" });
  assert.equal(
    args[args.indexOf("--features") + 1],
    "native-smoke,custom-protocol",
  );
  assert.ok(args.includes("--no-dev-server"));
  const config = JSON.parse(args[args.indexOf("--config") + 1]);
  assert.equal(config.identifier, BUNDLE);
  assert.deepEqual(config.build, {
    beforeDevCommand: "",
    devUrl: null,
    beforeBuildCommand: "",
  });
});

test("a shutdown simulator boots before compile while a booted simulator builds directly", async () => {
  const simulatorId = randomUUID().toUpperCase();
  const listing = (state) => ({
    structuredContent: {
      result: {
        simulators: [
          { simulatorId, state, runtime: "iOS 26.5", isAvailable: true },
        ],
      },
    },
  });
  for (const state of ["Shutdown", "Booted"]) {
    const calls = [];
    await buildSmokeApp(
      {
        async call(name, args) {
          calls.push([name, args]);
          if (name === "list_sims") return listing(state);
        },
      },
      simulatorId,
    );
    assert.deepEqual(
      calls.map(([name]) => name),
      state === "Shutdown"
        ? ["list_sims", "boot_sim", "build_sim"]
        : ["list_sims", "build_sim"],
    );
    assert.deepEqual(calls[0][1], { enabled: true });
    if (state === "Shutdown") assert.deepEqual(calls[1][1], { simulatorId });
    assert.deepEqual(calls.at(-1)[1].extraArgs, [
      "CODE_SIGNING_ALLOWED=YES",
      "CODE_SIGNING_REQUIRED=YES",
      "CODE_SIGN_IDENTITY=-",
      "AD_HOC_CODE_SIGNING_ALLOWED=YES",
      "CODE_SIGN_STYLE=Manual",
      "DEVELOPMENT_TEAM=",
    ]);
  }
  const refused = [];
  await assert.rejects(
    buildSmokeApp(
      {
        async call(name) {
          refused.push(name);
          if (name === "list_sims") return listing("Shutdown");
          throw new Error("boot-refused");
        },
      },
      simulatorId,
    ),
    /boot-refused/,
  );
  assert.deepEqual(refused, ["list_sims", "boot_sim"]);
  for (const state of ["Booting", "Shutting Down", "Creating"]) {
    const calls = [];
    await assert.rejects(
      buildSmokeApp(
        {
          async call(name) {
            calls.push(name);
            return listing(state);
          },
        },
        simulatorId,
      ),
      /unavailable or busy/,
    );
    assert.deepEqual(calls, ["list_sims"]);
  }
});

test("project session is released even when unverified cleanup retains the simulator reservation", (t) => {
  const root = directory(t);
  const reservation = join(root, "simulator.lock");
  mkdirSync(reservation);
  let released = 0;
  const runId = randomUUID();
  const simulatorId = randomUUID();
  assert.throws(
    () =>
      releaseSmokeSession({
        cleanupFailed: true,
        reserved: true,
        reservation,
        unlock: () => released++,
        runId,
        simulatorId,
      }),
    (error) => {
      assert.equal(error.code, "ios-cleanup-unverified");
      assert.equal(error.runId, runId);
      assert.equal(error.simulatorId, simulatorId);
      return true;
    },
  );
  assert.equal(released, 1);
  assert.ok(existsSync(reservation));
  releaseSmokeSession({
    cleanupFailed: false,
    reserved: true,
    reservation,
    unlock: () => released++,
  });
  assert.equal(released, 2);
  assert.equal(existsSync(reservation), false);
});

test("build children inherit only explicit queue markers and validated Cargo jobs", () => {
  const original = {
    PATH: "/synthetic/bin",
    HOME: "/synthetic/home",
    SITUATE_COORDINATED_WORKTREE: "/synthetic/worktree",
    SITUATE_COORDINATED_DESKTOP: "1",
    SITUATE_WORKTREE_WAIT_MS: "17",
    SITUATE_NATIVE_IOS_BUILD_HELD: "abcdef012345",
    CARGO_BUILD_JOBS: "4",
    OPENAI_API_KEY: "PRIVATE_KEY",
    AWS_SECRET_ACCESS_KEY: "PRIVATE_SECRET",
    SIMCTL_CHILD_HOME: "/private/other",
    HTTP_PROXY: "https://private.invalid",
  };
  const clean = isolatedEnvironment(original);
  for (const key of [
    "SITUATE_COORDINATED_WORKTREE",
    "SITUATE_COORDINATED_DESKTOP",
    "SITUATE_WORKTREE_WAIT_MS",
    "SITUATE_NATIVE_IOS_BUILD_HELD",
    "CARGO_BUILD_JOBS",
  ])
    assert.equal(clean[key], original[key]);
  for (const key of [
    "OPENAI_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "SIMCTL_CHILD_HOME",
    "HTTP_PROXY",
  ])
    assert.equal(Object.hasOwn(clean, key), false);
  for (const jobs of ["0", "-1", "4;command", "secret"])
    assert.throws(
      () => isolatedEnvironment({ CARGO_BUILD_JOBS: jobs }),
      /parallelism/,
    );
});

test("Apple failure evidence distinguishes exit, signal and the unchanged RPC size limit without private values", () => {
  const raw =
    "\\u001b[31mFATAL ERROR: heap allocation failed\\u001b[0m\nsource /Users/PRIVATE_PERSON/Private Project/source.swift\nendpoint https://private.invalid/path?token=PRIVATE_QUERY\nAuthorization: Bearer PRIVATE_TOKEN\nOPENAI_API_KEY=PRIVATE_KEY\n" +
    "a".repeat(64);
  const diagnostic = appleFailureDiagnostic(
    { reason: "server-exit", tool: "build_sim", code: 137, signal: "SIGKILL" },
    raw,
  );
  assert.equal(diagnostic.exitCode, 137);
  assert.equal(diagnostic.signal, "SIGKILL");
  assert.equal(diagnostic.tool, "build_sim");
  assert.ok(diagnostic.stderr.includes("heap allocation failed"));
  assert.ok(!JSON.stringify(diagnostic).includes("PRIVATE"));
  assert.ok(!diagnostic.stderr.includes("a".repeat(64)));
  const limit = appleFailureDiagnostic(
    {
      reason: "rpc-output-limit",
      tool: "build_sim",
      bufferedCharacters: 16 * 1024 * 1024 + 1,
    },
    "",
  );
  assert.equal(limit.reason, "rpc-output-limit");
  assert.ok(limit.bufferedCharacters > 16 * 1024 * 1024);
  assert.equal(
    sanitizeAppleDiagnostic("partial-private-data\nsafe error", true),
    "safe error",
  );
  assert.ok(sanitizeAppleDiagnostic("x".repeat(20000)).length <= 2048);
});

async function fakeApple(t, body) {
  const root = directory(t);
  writeFileSync(
    join(root, "xcodebuildmcp"),
    "#!" + process.execPath + "\n" + body,
    { mode: 0o700 },
  );
  const apple = new AppleTools(
    { PATH: root + delimiter + process.env.PATH },
    AbortSignal.timeout(10000),
  );
  t.after(() => apple.close());
  return apple;
}

test("stdio supervisor preserves a sanitized SDK exit code and stderr instead of a generic ended error", async (t) => {
  const apple = await fakeApple(
    t,
    'process.stderr.write("FATAL ERROR: synthetic SDK failure\\nsource /Users/PRIVATE_PERSON/private.swift\\n"); process.exit(23);',
  );
  let failure;
  await assert.rejects(apple.initialize(), (error) => {
    failure = error;
    return error.code === "apple-server-exit";
  });
  await apple.close();
  assert.equal(failure.diagnostic.exitCode, 23);
  assert.equal(failure.diagnostic.signal, null);
  assert.ok(failure.diagnostic.stderr.includes("synthetic SDK failure"));
  assert.ok(!failure.diagnostic.stderr.includes("PRIVATE_PERSON"));
});

test("RPC output overflow is reported distinctly without increasing the buffer limit", async (t) => {
  const apple = await fakeApple(
    t,
    'process.stdout.write("x".repeat(16 * 1024 * 1024 + 65536)); setInterval(()=>{},1000);',
  );
  let failure;
  await assert.rejects(apple.initialize(), (error) => {
    failure = error;
    return error.code === "apple-rpc-output-limit";
  });
  await apple.close();
  assert.equal(failure.diagnostic.reason, "rpc-output-limit");
  assert.ok(failure.diagnostic.bufferedCharacters > 16 * 1024 * 1024);
});

test("simulator selection requires a UUID and never accepts a shell or implicit destination", () => {
  assert.equal(
    validateSimulator("123e4567-e89b-42d3-a456-426614174000"),
    "123E4567-E89B-42D3-A456-426614174000",
  );
  for (const value of [
    undefined,
    "booted",
    "iPhone",
    "--help",
    "id;erase",
    "../device",
  ])
    assert.throws(() => validateSimulator(value));
});

test("container inspection returns only exact smoke metadata and never opens app contents", async (t) => {
  const root = directory(t);
  const other = metadata(root, "Data", "private.application");
  writeFileSync(join(other, "private.txt"), "PRIVATE_BYTES");
  const data = metadata(root, "Data", BUNDLE);
  const bundle = metadata(root, "Bundle", BUNDLE);
  assert.deepEqual(await inspectContainers(root), {
    data: [data],
    bundle: [bundle],
  });
  assert.equal(
    readFileSync(join(other, "private.txt"), "utf8"),
    "PRIVATE_BYTES",
  );
});

test("container metadata is bounded and symlinks are rejected without modifying targets", async (t) => {
  const root = directory(t);
  const data = metadata(root, "Data", BUNDLE);
  const target = join(root, "target");
  writeFileSync(target, "PRIVATE_TARGET");
  const path = join(data, ".com.apple.mobile_container_manager.metadata.plist");
  rmSync(path);
  symlinkSync(target, path);
  await assert.rejects(inspectContainers(root), /safely inspect/);
  assert.equal(readFileSync(target, "utf8"), "PRIVATE_TARGET");
  rmSync(path);
  writeFileSync(path, "x".repeat(1048577));
  await assert.rejects(inspectContainers(root), /safely inspect/);
});

test("a broken metadata link cannot masquerade as an absent container", async (t) => {
  const root = directory(t);
  const data = metadata(root, "Data", BUNDLE);
  const path = join(data, ".com.apple.mobile_container_manager.metadata.plist");
  rmSync(path);
  symlinkSync(join(root, "missing"), path);
  await assert.rejects(inspectContainers(root), /safely inspect/);
});

test("inspection refuses excessive inventories and duplicate smoke containers", async (t) => {
  const duplicate = directory(t);
  metadata(duplicate, "Data", BUNDLE);
  metadata(duplicate, "Data", BUNDLE);
  await assert.rejects(inspectContainers(duplicate), /safely inspect/);
  const large = directory(t);
  for (let index = 0; index < 513; index++)
    mkdirSync(join(large, "Data/Application", String(index)), {
      recursive: true,
    });
  await assert.rejects(inspectContainers(large), /safely inspect/);
});

test("an ownership claim is exclusive, run-bound and rejects aliased markers", (t) => {
  const root = directory(t);
  const id = randomUUID();
  claimContainer(root, id);
  assertOwned(root, id);
  assert.throws(() => claimContainer(root, id));
  assert.throws(() => assertOwned(root, randomUUID()));
  const marker = join(root, ".native-ios-smoke-owner");
  rmSync(marker);
  const target = join(root, "target");
  writeFileSync(target, JSON.stringify({ version: 1, runId: id }));
  symlinkSync(target, marker);
  assert.throws(() => assertOwned(root, id));
  assert.throws(() => regularBytes(target, 1));
});

test("simulator discovery rejects unavailable, busy and non-iOS destinations", () => {
  const simulatorId = randomUUID().toUpperCase();
  const result = (device) => ({
    structuredContent: {
      result: {
        simulators: [
          {
            simulatorId,
            runtime: "iOS 18.6",
            state: "Shutdown",
            isAvailable: true,
            ...device,
          },
        ],
      },
    },
  });
  requireSimulator(result({}), simulatorId);
  for (const device of [
    { isAvailable: false },
    { runtime: "watchOS 11" },
    { state: "Creating" },
    { simulatorId: randomUUID() },
  ])
    assert.throws(() => requireSimulator(result(device), simulatorId));
});

test("Apple defaults and artifact queries must resolve the exact explicit session", () => {
  const expected = {
    projectPath: "/synthetic/project.xcodeproj",
    scheme: "synthetic",
    simulatorId: randomUUID(),
    derivedDataPath: "/synthetic/output",
    bundleId: BUNDLE,
  };
  const output = {
    structuredContent: {
      data: { currentProfile: "test", profiles: { test: expected } },
    },
  };
  checkDefaults(output, expected);
  assert.throws(() =>
    checkDefaults(output, { ...expected, bundleId: "private.application" }),
  );
  const appPath =
    "/synthetic/output/Build/Products/debug-iphonesimulator/Situate Smoke.app";
  const built = {
    structuredContent: {
      schema: "xcodebuildmcp.output.app-path",
      schemaVersion: "2",
      didError: false,
      error: null,
      data: {
        request: { platform: "iOS Simulator" },
        summary: { status: "SUCCEEDED", target: "simulator" },
        artifacts: { appPath },
      },
    },
  };
  const bundle = {
    structuredContent: {
      schema: "xcodebuildmcp.output.bundle-id",
      schemaVersion: "2",
      didError: false,
      error: null,
      data: { artifacts: { appPath, bundleId: BUNDLE } },
    },
  };
  assert.equal(toolData(built).appPath, appPath);
  assert.equal(toolData(bundle).bundleId, BUNDLE);
  assert.deepEqual(toolData(bundle), { appPath, bundleId: BUNDLE });
  assert.deepEqual(toolData(output), output.structuredContent.data);
});

async function provider(t) {
  const runId = randomUUID();
  const supervisor = "a".repeat(64);
  const broker = await startProvider(runId, supervisor);
  t.after(() => broker.close());
  const post = (path, body, token = broker.token) =>
    fetch(new URL(path, broker.url), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-situate-test-kind": "main",
      },
      body: JSON.stringify(body),
    });
  return { broker, post, runId, supervisor };
}
function decode(text) {
  const events = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  return events.at(-1).response;
}

test("local provider drives file and captured native plugin descriptors without live forwarding", async (t) => {
  const { post } = await provider(t);
  const name =
    "plugin_" +
    createHash("sha256")
      .update("native-ios-worker")
      .digest("hex")
      .slice(0, 16) +
    "_record";
  const tools = ["write", "read", name].map((name) => ({
    type: "function",
    name,
    parameters: { type: "object" },
  }));
  const input = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: "Synthetic iOS attachment: retained Unicode 🌍\nSynthetic iOS referenced source\n",
        },
        {
          type: "input_image",
          image_url: "data:image/png;base64,c3ludGhldGlj",
        },
      ],
    },
  ];
  for (const [expectedName, output] of [
    ["write", "saved"],
    ["read", "Synthetic native iOS note\n"],
    [name, "Synthetic iOS Worker effect recorded."],
  ]) {
    const response = await post("/v1/responses", {
      model: "gpt-4.1-mini",
      stream: true,
      tools,
      input,
    });
    assert.equal(response.status, 200);
    const result = decode(await response.text());
    assert.equal(result.usage.total_tokens, 40);
    const call = result.output[0];
    assert.equal(call.type, "function_call");
    assert.equal(call.name, expectedName);
    if (expectedName === "write")
      assert.deepEqual(JSON.parse(call.arguments), {
        path: "ios-smoke-note.txt",
        text: "Synthetic native iOS note\n",
        expectedRevision: null,
      });
    input.push(call, {
      type: "function_call_output",
      call_id: call.call_id,
      output,
    });
  }
  const done = await post("/v1/responses", {
    model: "gpt-4.1-mini",
    stream: true,
    tools,
    input,
  });
  assert.equal(done.status, 200);
  assert.equal(decode(await done.text()).output[0].type, "message");
  assert.equal(
    (await post("/v1/responses", { model: "other", stream: true, input: [] }))
      .status,
    400,
  );
  assert.equal(
    (
      await post("/v1/responses", {
        model: "gpt-4.1-mini",
        stream: true,
        input,
        tools: tools.slice(0, 2),
      })
    ).status,
    400,
  );
  assert.equal((await post("/v1/responses?token=private", {})).status, 400);
});

test("the local iOS provider rejects inputs that omit resolved attachment and reference sources", async (t) => {
  const { post } = await provider(t);
  const tools = [
    "write",
    "read",
    `plugin_${createHash("sha256").update("native-ios-worker").digest("hex").slice(0, 16)}_record`,
  ].map((name) => ({ type: "function", name }));
  assert.equal(
    (
      await post("/v1/responses", {
        model: "gpt-4.1-mini",
        stream: true,
        tools,
        input: [
          { role: "user", content: "Raw submitted text without its sources" },
        ],
      })
    ).status,
    400,
  );
});

test("native reports require authentication, current run, launch identity and artifact digest", async (t) => {
  const { broker, post, runId, supervisor } = await provider(t);
  const launchId = randomUUID();
  const report = {
    version: 1,
    runId,
    launchId,
    phase: "exercise",
    passed: true,
    qualification: "debug",
    supervisorSha256: supervisor,
  };
  assert.equal((await post("/report", report, "wrong")).status, 401);
  assert.equal(
    (await post("/report", { ...report, runId: randomUUID() })).status,
    400,
  );
  assert.equal(
    (await post("/report", { ...report, supervisorSha256: "b".repeat(64) }))
      .status,
    400,
  );
  assert.equal((await post("/report", report)).status, 200);
  assert.equal(
    (await broker.report(launchId, AbortSignal.timeout(1000))).providerRequests,
    0,
  );
  assert.equal((await post("/report", report)).status, 400);
  const abort = new AbortController();
  const pending = broker.report(randomUUID(), abort.signal);
  abort.abort();
  await assert.rejects(pending, /deadline/);
});

test("mobile workspace entries need no kind field and failures retain the static operation stage", async () => {
  const calls = [];
  const workspace = {
    id: "ios-documents:Native iOS fixture",
    name: "Native iOS fixture",
    display: "Synthetic workspace",
  };
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "mobile_smoke_info")
      return { phase: "exercise", workspaceName: workspace.name };
    if (command === "smoke_parent")
      return { id: "ios-documents:", name: "Documents", display: "Documents" };
    if (command === "smoke_create_fixture") return true;
    if (command === "workspace_snapshot")
      return { ready: true, current: workspace };
    if (command === "mobile_smoke_prepare")
      throw new Error("Synthetic preparation failure");
    if (command === "mobile_smoke_finish") return;
    assert.fail("Unexpected command");
  };
  const source = readFileSync(
    new URL("../app/src-tauri/tests/support/mobile-smoke.js", import.meta.url),
    "utf8",
  );
  await runInNewContext(source, {
    window: {
      __TAURI_INTERNALS__: { invoke },
      nativeSmokeWait: {
        wait: async (probe) => {
          const value = await probe();
          assert.ok(value);
          return value;
        },
      },
    },
  });
  assert.deepEqual(
    calls.map(([command]) => command),
    [
      "mobile_smoke_info",
      "smoke_parent",
      "smoke_create_fixture",
      "workspace_snapshot",
      "mobile_smoke_prepare",
      "mobile_smoke_finish",
    ],
  );
  assert.equal(calls.at(-1)[1].failure, "workspace-prepare");
});

test("opening a migrated queue must remain inactive and retain its draft before new work is admitted", async () => {
  const calls = [];
  const workspace = {
    id: "ios-documents:Native iOS fixture",
    name: "Native iOS fixture",
  };
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "mobile_smoke_info")
      return { phase: "exercise", workspaceName: workspace.name };
    if (command === "smoke_parent") return { id: "ios-documents:" };
    if (
      command === "smoke_create_fixture" ||
      command === "mobile_smoke_prepare" ||
      command === "mobile_smoke_finish"
    )
      return;
    if (command === "workspace_snapshot")
      return { ready: true, current: workspace };
    if (command === "ai_conversation_snapshot")
      return {
        taskActive: true,
        record: { draft: "written by A", runtime: { runs: [] } },
      };
    assert.fail("Migration verification admitted unexpected work");
  };
  const source = readFileSync(
    new URL("../app/src-tauri/tests/support/mobile-smoke.js", import.meta.url),
    "utf8",
  );
  await runInNewContext(source, {
    window: {
      __TAURI_INTERNALS__: { invoke },
      nativeSmokeWait: { wait: async (probe) => probe() },
    },
  });
  assert.equal(calls.at(-1)[0], "mobile_smoke_finish");
  assert.equal(calls.at(-1)[1].failure, "migration");
  assert.ok(
    !calls.some(
      ([command]) =>
        command === "ai_create_conversation" ||
        command === "ai_conversation_action",
    ),
  );
});

test("reference sources use the user file-creation contract before admitting the synthetic conversation", async () => {
  const calls = [];
  const workspace = {
    id: "ios-documents:Native iOS fixture",
    name: "Native iOS fixture",
  };
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "mobile_smoke_info")
      return {
        phase: "exercise",
        workspaceName: workspace.name,
        textAttachment: "Attached text",
        referenceText: "Referenced text",
        imageBase64: "AA==",
      };
    if (command === "smoke_parent") return { id: "ios-documents:" };
    if (
      command === "smoke_create_fixture" ||
      command === "mobile_smoke_prepare" ||
      command === "mobile_smoke_finish"
    )
      return;
    if (command === "workspace_snapshot")
      return { ready: true, current: workspace };
    if (command === "ai_conversation_snapshot")
      return {
        taskActive: false,
        record: {
          draft: "written by A",
          messages: [{ content: "Retained synthetic message" }],
          runtime: {
            runs: [],
            pending: [{ text: "Retained queued input", state: "pending" }],
          },
        },
      };
    if (command === "ai_attachment_put") return { id: args.name };
    if (command === "files_request") {
      if (args.request.operation === "create") {
        assert.deepEqual(JSON.parse(JSON.stringify(args.request)), {
          workspaceId: workspace.id,
          operation: "create",
          path: "ios-reference.txt",
          text: "Referenced text",
        });
        return { status: "saved" };
      }
      assert.equal(args.request.operation, "captureReference");
      return { status: "ok", reference: { anchorRevision: "a".repeat(40) } };
    }
    if (command === "ai_create_conversation")
      throw new Error("Stop after source preparation");
    assert.fail("Unexpected fixture command");
  };
  const source = readFileSync(
    new URL("../app/src-tauri/tests/support/mobile-smoke.js", import.meta.url),
    "utf8",
  );
  await runInNewContext(source, {
    TextEncoder,
    atob,
    document: {
      querySelector: (selector) => (selector === ".topic-window" ? {} : null),
    },
    window: {
      __TAURI_INTERNALS__: { invoke },
      nativeSmokeWait: { wait: async (probe) => probe() },
    },
  });
  assert.equal(calls.at(-1)[1].failure, "conversation");
  assert.equal(
    calls.filter(([command]) => command === "files_request").length,
    2,
  );
});

test("an IPC-capable WebView without the application shell cannot qualify native presentation", async () => {
  const calls = [];
  const workspace = { id: "ios-documents:fixture", name: "Fixture" };
  const invoke = async (command, args) => {
    calls.push([command, args]);
    if (command === "mobile_smoke_info")
      return { phase: "exercise", workspaceName: workspace.name };
    if (command === "smoke_parent") return { id: "ios-documents:" };
    if (command === "workspace_snapshot")
      return { ready: true, current: workspace };
    if (command === "ai_conversation_snapshot")
      return {
        taskActive: false,
        record: {
          draft: "written by A",
          messages: [{ content: "Retained synthetic message" }],
          runtime: {
            runs: [],
            pending: [{ text: "Retained queued input", state: "pending" }],
          },
        },
      };
    if (
      [
        "smoke_create_fixture",
        "mobile_smoke_prepare",
        "mobile_smoke_finish",
      ].includes(command)
    )
      return;
    assert.fail("An unloaded application shell admitted work");
  };
  const source = readFileSync(
    new URL("../app/src-tauri/tests/support/mobile-smoke.js", import.meta.url),
    "utf8",
  );
  await runInNewContext(source, {
    document: { querySelector: () => null },
    window: {
      __TAURI_INTERNALS__: { invoke },
      nativeSmokeWait: {
        wait: async (probe) => {
          const value = await probe();
          if (!value) throw new Error("Shell is unavailable");
          return value;
        },
      },
    },
  });
  assert.equal(calls.at(-1)[1].failure, "presentation");
  assert.ok(!calls.some(([command]) => command === "ai_create_conversation"));
});

test("failed native reports expose only allowlisted stages and retain fresh-run identity", async (t) => {
  const container = directory(t),
    runId = randomUUID();
  claimContainer(container, runId);
  for (const [stage, expected, cleanupError, expectedCleanupError] of [
    ...["worker-enter", "worker-outcome", "worker-idle"].map((stage) => [
      stage,
      stage,
      null,
      null,
    ]),
    [
      "workspace-parent",
      "workspace-parent",
      "native.ai.secureStore.failed",
      "native.ai.secureStore.failed",
    ],
    [
      "/Users/PRIVATE/path?token=SECRET",
      "verification",
      "PRIVATE",
      "native.smoke.cleanupFailed",
    ],
  ]) {
    const calls = [];
    const apple = {
      async call(name) {
        calls.push(name);
      },
    };
    const provider = {
      url: "http://127.0.0.1:1234/v1/responses",
      token: "synthetic",
      async report(launchId) {
        return {
          passed: false,
          stage,
          ipcTrace: [
            {
              command: "workspace_action",
              operation: "close",
              status: "rejected",
              code: "PRIVATE",
              args: { token: "SECRET" },
            },
          ],
          runId,
          launchId,
          phase: "exercise",
          keysDeleted: false,
          cleanupError,
        };
      },
    };
    await assert.rejects(
      launchPhase(
        apple,
        provider,
        {
          container,
          runId,
          simulatorId: randomUUID(),
          supervisor: "a".repeat(64),
          phase: "exercise",
        },
        AbortSignal.timeout(1000),
      ),
      (error) => {
        assert.equal(error.code, "ios-native-report-failed");
        assert.deepEqual(error.nativeFailure, {
          stage: expected,
          ipcTrace: [
            {
              command: "workspace_action",
              operation: "close",
              status: "rejected",
              code: "unclassified",
            },
          ],
          cleanupError: expectedCleanupError,
          keysDeleted: false,
          phase: "exercise",
          runId,
        });
        assert.ok(!JSON.stringify(error.nativeFailure).includes("PRIVATE"));
        return true;
      },
    );
    assert.deepEqual(calls, ["launch_app_sim", "stop_app_sim"]);
  }
  assert.equal(nativeFailureStage("worker-stop"), "worker-stop");
  assert.equal(
    nativeCleanupError("native.ai.secureStore.locked"),
    "native.ai.secureStore.locked",
  );
  assert.equal(
    nativeCleanupError("/Users/PRIVATE/path?token=SECRET"),
    "native.smoke.cleanupFailed",
  );
});

test("launch orchestration addresses only the claimed smoke app and stops after verified report", async (t) => {
  const container = directory(t);
  const runId = randomUUID();
  claimContainer(container, runId);
  const calls = [];
  let launched;
  const apple = {
    async call(name, args) {
      calls.push([name, args]);
      if (name === "launch_app_sim") launched = args;
    },
  };
  const broker = {
    url: "http://127.0.0.1:1234/v1/responses",
    token: "synthetic-token",
    async report(launchId) {
      return {
        passed: true,
        runId,
        launchId,
        phase: "reopen",
        keysDeleted: true,
        deletedKeys: 1,
      };
    },
  };
  await launchPhase(
    apple,
    broker,
    {
      container,
      runId,
      simulatorId: randomUUID(),
      supervisor: "a".repeat(64),
      phase: "reopen",
    },
    AbortSignal.timeout(1000),
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    ["launch_app_sim", "stop_app_sim"],
  );
  assert.equal(launched.bundleId, BUNDLE);
  assert.equal(launched.env.SITUATE_NATIVE_IOS_RUN_ID, runId);
  assert.equal(launched.env.SITUATE_NATIVE_IOS_PHASE, "reopen");
  assert.equal(launched.env.SITUATE_NATIVE_IOS_TOKEN, broker.token);
  assert.ok(!("HOME" in launched.env));
  writeFileSync(
    join(container, ".native-ios-smoke-owner"),
    JSON.stringify({ version: 1, runId: randomUUID() }),
  );
  await assert.rejects(
    launchPhase(
      apple,
      broker,
      { container, runId, phase: "reopen" },
      AbortSignal.timeout(1000),
    ),
    /ownership/,
  );
  assert.equal(calls.length, 2);
});
