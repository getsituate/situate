import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import {
  setTimeout as delay,
  setImmediate as nextTurn,
} from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { fixture, sdkPath } from "./test-support.mjs";
import { cacheConfigurations } from "../../../tools/fixtures/suite-cache.mjs";

const {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} = await import(pathToFileURL(sdkPath).href);
const aiPackage = findPackageJSON(
  "@earendil-works/pi-ai",
  pathToFileURL(sdkPath),
);
const { createAssistantMessageEventStream } = await import(
  pathToFileURL(join(dirname(aiPackage), "dist/index.js")).href
);
const { volta } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
);
const passing = 'import test from "node:test"; test("example", () => {});\n';
const failing =
  'import test from "node:test"; import assert from "node:assert/strict"; test("example", () => assert.fail("Example failure"));\n';

async function sessionFixture(
  t,
  { source = passing, onReply = () => {}, typeChecks = false } = {},
) {
  let runtime;
  // Shutdown handlers must finish before fixture cleanup removes their cwd and environment.
  t.after(async () => {
    await runtime?.dispose();
  });
  const f = fixture(t);
  const put = (path, content = "example") => {
    mkdirSync(dirname(join(f.cwd, path)), { recursive: true });
    writeFileSync(join(f.cwd, path), content);
  };
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: f.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  // The fixture supplies Node contracts, not a Vue or native workspace.
  const runner = readFileSync(
    new URL("../../../tools/test.mjs", import.meta.url),
    "utf8",
  );
  put(
    "tools/test.mjs",
    runner
      .replace(
        "return suites;",
        `return suites.filter((suite) => ['root-lint', 'root-format', 'client-scripts-unit', 'pi-unit', 'design-contracts'${typeChecks ? ", 'client-types'" : ""}].includes(suite.id)).map(({ npm, ...suite }) => suite);`,
      )
      .replace(
        '"tools/test-inputs.test.mjs"',
        '"client/scripts/example.test.mjs"',
      )
      // Fixture executables do not compile artifacts or need host build slots.
      .replace(
        "const report = await runPlan(plan, {",
        "const report = await runPlan(plan, { buildLease: false,",
      ),
  );
  for (const name of [
    "quality-cache.mjs",
    "test-scope.mjs",
    "test-budget.mjs",
    "quick-source.mjs",
    "test-inputs.mjs",
    "suite-cache.mjs",
    "suite-cache-config.mjs",
    "suite-cache-policy/ui-boundary.mjs",
    "run-coordinated.mjs",
    "worktree-supervisor.py",
    "cargo-environment.mjs",
    "compiler-cache.mjs",
  ]) {
    const content = readFileSync(
      new URL(`../../../tools/${name}`, import.meta.url),
      "utf8",
    );
    put(`tools/${name}`, content);
  }
  if (typeChecks) {
    put(
      "client/app/tsconfig.json",
      cacheConfigurations["client/app/tsconfig.json"],
    );
    put(
      "client/node_modules/vue-tsc/bin/vue-tsc.js",
      `
const { mkdirSync, readFileSync, writeFileSync, existsSync } = require("node:fs");
mkdirSync("../../test-results", { recursive: true });
const file = "../../test-results/type-count";
const count = existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;
writeFileSync(file, String(count + 1));
`,
    );
  }
  put("node_modules/prettier/bin/prettier.cjs", "process.exitCode = 0;\n");
  put("design/brand/validation/check.cjs", "process.exitCode = 0;\n");
  put("tools/example.test.mjs", passing);
  put("tools/example.integration.test.mjs", passing);
  put(
    "package.json",
    JSON.stringify({
      private: true,
      volta,
      scripts: { lint: "node --version", "format:check": "node --version" },
    }),
  );
  put("client/scripts/example.test.mjs", source);
  put("client/scripts/example.integration.test.mjs", passing);
  put("requirements/tests/example.test.js", passing);
  put("requirements/tests/example.integration.test.js", passing);
  put(".pi/extensions/role-switcher/index.test.mjs", passing);
  put(".pi/extensions/test-suite/index.test.mjs", passing);
  put(".gitignore", "agent/\ntest-results/\nnode_modules/\n");
  git("init", "--initial-branch=main");
  git("config", "user.name", "Test Runner");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", join(f.directory, "no-hooks"));
  git("add", ".");
  git("commit", "-m", "Initial fixture");
  const base = git("rev-parse", "HEAD");
  const requests = [],
    errors = [];
  const agentDir = join(f.cwd, "agent");
  mkdirSync(agentDir);
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: "test-fixture",
    defaultModel: "fixture",
    retry: { enabled: false },
    compaction: { enabled: false },
    cacheWarming: "off",
  });
  const loaderOptions = {
    cwd: f.cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [
      fileURLToPath(new URL("./index.ts", import.meta.url)),
    ],
    extensionFactories: [
      (pi) =>
        pi.registerProvider("test-fixture", {
          api: "test-fixture-stream",
          apiKey: "fixture",
          baseUrl: "https://unused.example.invalid",
          models: [
            {
              id: "fixture",
              name: "Fixture",
              reasoning: false,
              input: ["text"],
              contextWindow: 32000,
              maxTokens: 1000,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
          streamSimple: (model, context) => {
            const stream = createAssistantMessageEventStream();
            const message = {
              role: "assistant",
              content: [],
              api: model.api,
              provider: model.provider,
              model: model.id,
              stopReason: "pending",
              timestamp: Date.now(),
              usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 2,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
            };
            queueMicrotask(async () => {
              try {
                requests.push(context.messages);
                await onReply({
                  number: requests.length,
                  put,
                  git,
                  cwd: f.cwd,
                });
                stream.push({ type: "start", partial: message });
                message.content.push({ type: "text", text: "" });
                stream.push({
                  type: "text_start",
                  contentIndex: 0,
                  partial: message,
                });
                message.content[0].text = "Finished.";
                stream.push({
                  type: "text_delta",
                  contentIndex: 0,
                  delta: "Finished.",
                  partial: message,
                });
                stream.push({
                  type: "text_end",
                  contentIndex: 0,
                  content: "Finished.",
                  partial: message,
                });
                message.stopReason = "stop";
                stream.push({ type: "done", reason: "stop", message });
              } catch (error) {
                message.stopReason = "error";
                message.errorMessage = String(error);
                stream.push({ type: "error", reason: "error", error: message });
              }
              stream.end();
            });
            return stream;
          },
        }),
    ],
  };
  const createRuntime = async ({ sessionManager, sessionStartEvent }) => {
    const resourceLoader = new DefaultResourceLoader(loaderOptions);
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    });
    const services = {
      cwd: f.cwd,
      agentDir,
      resourceLoader,
      modelRuntime,
      settingsManager,
      diagnostics: [],
    };
    const { session } = await createAgentSessionFromServices({
      services,
      noTools: true,
      sessionManager,
      sessionStartEvent,
    });
    await session.bindExtensions({
      onError: (error) => errors.push(error),
      mode: "print",
    });
    const model = modelRuntime.getModel("test-fixture", "fixture");
    assert.ok(model, "The local model fixture was not registered");
    await session.setModel(model);
    return { session, services, diagnostics: [] };
  };
  runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: f.cwd,
    agentDir,
    sessionManager: SessionManager.inMemory(f.cwd),
  });
  const session = runtime.session;
  const results = () =>
    session.sessionManager
      .getBranch()
      .filter(
        (entry) =>
          ["custom", "custom_message"].includes(entry.type) &&
          entry.customType === "unit-test-result",
      )
      .map((entry) =>
        entry.type === "custom" ? { ...entry, details: entry.data } : entry,
      );
  return { ...f, session, runtime, requests, errors, results, base, put, git };
}

test("session cleanup retains its workspace and environment until shutdown settles", async () => {
  const cleanup = [];
  const f = await sessionFixture({ after: (handler) => cleanup.push(handler) });
  const dispose = f.runtime.dispose.bind(f.runtime);
  let enter, release;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  f.runtime.dispose = async () => {
    enter();
    await released;
    await dispose();
  };
  const cleaning = (async () => {
    for (const handler of cleanup) await handler();
  })();
  await entered;
  try {
    assert.ok(existsSync(f.cwd), "Shutdown still needs the workspace");
    assert.equal(process.env.TMPDIR, f.directory);
  } finally {
    release();
    await cleaning;
  }
  assert.ok(!existsSync(f.directory));
});

test(
  "the loaded extension checks a commit made during the real Pi activity, with no extra success turn",
  { timeout: 30000 },
  async (t) => {
    const f = await sessionFixture(t, {
      onReply: ({ put, git }) => {
        put("client/change.txt");
        git("add", "client/change.txt");
        git("commit", "-m", "Change fixture");
      },
    });
    await f.session.prompt("Update the example.");
    assert.equal(f.git("status", "--porcelain"), "");
    assert.equal(f.requests.length, 1, JSON.stringify(f.results()));
    assert.equal(f.results().length, 1);
    const [entry] = f.results();
    assert.equal(entry.details.status, "passed");
    const result = JSON.parse(readFileSync(entry.details.reportPath, "utf8"));
    assert.equal(result.base, f.base);
    assert.deepEqual(result.changedFiles, ["client/change.txt"]);
    assert.deepEqual(
      result.results.map(({ id }) => id),
      ["runner-fast", "quick-source"],
    );
    assert.deepEqual(f.errors, []);
  },
);

test(
  "the loaded extension runs Node and npm selected by the checkout's Volta pins",
  { timeout: 30000 },
  async (t) => {
    const f = await sessionFixture(t, {
      source: `import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
test("project toolchain", () => {
  assert.equal(process.versions.node, ${JSON.stringify(volta.node)});
  assert.equal(execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(), ${JSON.stringify(volta.npm)});
  assert.equal(realpathSync(process.execPath), realpathSync(execFileSync("volta", ["which", "node"], { encoding: "utf8" }).trim()));
});
`,
      onReply: ({ put }) => put("client/change.txt"),
    });
    await f.session.prompt("Update the example.");
    assert.equal(f.requests.length, 1, JSON.stringify(f.results()));
    assert.equal(f.results().length, 1);
    assert.equal(f.results()[0].details.status, "passed");
    assert.deepEqual(f.errors, []);
  },
);

test(
  "contracts without a bounded input cache are rechecked on an unchanged dirty request",
  { timeout: 30000 },
  async (t) => {
    const f = await sessionFixture(t, {
      onReply: ({ number, put }) => {
        if (number === 1) put("client/change.txt");
      },
    });
    await f.session.prompt("Update the example.");
    assert.equal(f.results().length, 1);
    assert.equal(f.results()[0].details.status, "passed");
    await f.session.prompt("Explain the example without editing it.");
    assert.equal(f.requests.length, 2);
    assert.equal(f.results().length, 2);
    assert.equal(f.results()[1].details.status, "passed");
    assert.ok(f.results().every((entry) => entry.type === "custom"));
    assert.ok(
      f.requests[1].every(
        (message) => !JSON.stringify(message).includes("Quality checks:"),
      ),
    );
    assert.deepEqual(f.errors, []);
  },
);

test(
  "automatic checks retain dirty source inputs without invoking typecheck suites",
  { timeout: 30000 },
  async (t) => {
    const f = await sessionFixture(t, {
      typeChecks: true,
      onReply: ({ number, put }) => {
        if (number === 1)
          put("client/app/src/example.ts", "export const value = 1;\n");
        if (number === 2) put("client/README.md", "# Updated client\n");
        if (number === 3)
          put("client/app/src/example.ts", "export const value = 2;\n");
      },
    });
    for (const prompt of [
      "Update code.",
      "Update documentation.",
      "Change code again.",
    ]) {
      await f.session.prompt(prompt);
      assert.equal(
        f.results().at(-1).details.status,
        "passed",
        JSON.stringify(f.results()),
      );
      assert.equal(existsSync(join(f.cwd, "test-results/type-count")), false);
    }
    const reports = f
      .results()
      .map((entry) =>
        JSON.parse(readFileSync(entry.details.reportPath, "utf8")),
      );
    assert.ok(
      reports.every(
        (report) =>
          report.results.every(({ id }) => id !== "client-types") &&
          report.elapsedMs < 5000,
      ),
    );
    assert.ok(
      reports.every((report) =>
        report.changedFiles.includes("client/app/src/example.ts"),
      ),
    );
    assert.equal(f.requests.length, 3);
    assert.deepEqual(f.errors, []);
  },
);

test(
  "explicit feedback reports cache decisions in CLI and JSON",
  { timeout: 120000 },
  async (t) => {
    const f = await sessionFixture(t, { typeChecks: true });
    const cacheDirectory = join(f.directory, "success-cache");
    mkdirSync(cacheDirectory, { mode: 0o700 });
    const cachePath = realpathSync(cacheDirectory);
    const decisions = [];
    for (const [file, content] of [
      ["client/app/src/example.ts", "export const value = 1;\n"],
      ["client/README.md", "# Updated client\n"],
      ["client/app/src/example.ts", "export const value = 2;\n"],
    ]) {
      f.put(file, content);
      const result = spawnSync(
        process.execPath,
        [
          "tools/test.mjs",
          "--feedback",
          "--changed",
          "--base",
          f.base,
          "--success-cache",
          cachePath,
          "--json",
        ],
        { cwd: f.cwd, encoding: "utf8", timeout: 30000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout);
      decisions.push(
        report.results.find(({ id }) => id === "client-types").cache.reason,
      );
      if (decisions.length === 1)
        assert.match(
          result.stderr,
          /client-types: passed \[cache not used: no previous successful result\]/,
        );
    }
    assert.deepEqual(decisions, [
      "no-success",
      "unchanged-inputs",
      "inputs-changed",
    ]);
  },
);

test(
  "reloaded extensions preserve bounded quick selection for documentation edits",
  { timeout: 30000 },
  async (t) => {
    const f = await sessionFixture(t, {
      typeChecks: true,
      onReply: ({ number, put }) => {
        if (number === 1)
          put("client/app/src/example.ts", "export const value = 1;\n");
        else put("client/README.md", `# Client revision ${number}\n`);
      },
    });
    await f.session.prompt("Update code.");
    await f.session.reload();
    await f.session.prompt("Update documentation after reload.");
    await f.session.prompt("Revise the documentation again.");
    const reports = f
      .results()
      .map((entry) =>
        JSON.parse(readFileSync(entry.details.reportPath, "utf8")),
      );
    assert.deepEqual(
      reports.map(({ status }) => status),
      ["passed", "passed", "passed"],
    );
    assert.ok(
      reports.every((report) =>
        report.results.every(({ id }) => id !== "client-types"),
      ),
    );
    assert.equal(existsSync(join(f.cwd, "test-results/type-count")), false);
    assert.equal(f.requests.length, 3);
    assert.deepEqual(f.errors, []);
  },
);

test(
  "Pi delivers failed tests to the model and verifies its repair without looping",
  { timeout: 30000 },
  async (t) => {
    const f = await sessionFixture(t, {
      source: failing,
      onReply: ({ number, put }) => {
        put("client/change.txt");
        if (number === 2) put("client/scripts/example.test.mjs", passing);
      },
    });
    await f.session.prompt("Update the example.");
    assert.equal(
      f.requests.length,
      2,
      JSON.stringify({
        results: f.results(),
        errors: f.errors,
        assistant: f.session.getLastAssistantText(),
      }),
    );
    assert.deepEqual(
      f.results().map((entry) => entry.details.status),
      ["failed", "passed"],
    );
    assert.ok(
      f.requests[1].some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("Example failure"),
      ),
    );
    assert.deepEqual(f.errors, []);
  },
);

test(
  "persistent failures get one repair turn and remain visible",
  { timeout: 30000 },
  async (t) => {
    const f = await sessionFixture(t, {
      source: failing,
      onReply: ({ put }) => put("client/change.txt"),
    });
    await f.session.prompt("Update the example.");
    assert.equal(f.requests.length, 2);
    assert.deepEqual(
      f.results().map((entry) => entry.details.status),
      ["failed", "failed"],
    );
    assert.deepEqual(f.errors, []);
  },
);

for (const path of [
  "client/README.md",
  "docs/example.md",
  ".pi/change.txt",
  "client-other/example.txt",
]) {
  test(
    `changes to ${path} use the central suite selection`,
    { timeout: 30000 },
    async (t) => {
      const f = await sessionFixture(t, { onReply: ({ put }) => put(path) });
      await f.session.prompt("Update the example.");
      assert.equal(f.requests.length, 1, JSON.stringify(f.results()));
      assert.equal(f.results().length, 1);
      const entry = f.results()[0];
      assert.equal(entry.details.status, "passed");
      const result = JSON.parse(readFileSync(entry.details.reportPath, "utf8"));
      if (path === "docs/example.md" || path === "client/README.md")
        assert.deepEqual(
          result.results.map(({ id }) => id),
          ["quick-source"],
        );
      if (path === ".pi/change.txt")
        assert.ok(result.results.some(({ id }) => id === "quick-source"));
      assert.deepEqual(f.errors, []);
    },
  );
}

async function waitForRunner(ready, running, signal) {
  let settled = false;
  let failure;
  running.then(
    () => {
      settled = true;
    },
    (error) => {
      settled = true;
      failure = error;
    },
  );
  while (true) {
    signal.throwIfAborted();
    if (existsSync(ready)) {
      const pid = Number(readFileSync(ready, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    }
    if (settled)
      throw (
        failure ??
        new Error(
          "The quality-check run settled before its test process started.",
        )
      );
    await delay(25, undefined, { signal });
  }
}

test("runner readiness tolerates startup beyond five seconds within the test deadline", async (t) => {
  const f = fixture(t);
  const ready = join(f.directory, "ready");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let waiting = true;
  const started = waitForRunner(ready, new Promise(() => {}), t.signal).then(
    (pid) => {
      waiting = false;
      return pid;
    },
  );
  for (let tick = 0; tick < 240; tick++) {
    t.mock.timers.tick(25);
    await nextTurn();
  }
  assert.ok(waiting);
  writeFileSync(ready, "12345");
  t.mock.timers.tick(25);
  assert.equal(await started, 12345);
});

test("runner readiness stops on cancellation or an already settled run", async (t) => {
  const f = fixture(t);
  const ready = join(f.directory, "missing");
  const controller = new AbortController();
  const cancelled = waitForRunner(
    ready,
    new Promise(() => {}),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  await assert.rejects(
    waitForRunner(ready, Promise.resolve(), t.signal),
    /settled before/,
  );
  const failure = new Error("Synthetic prompt failure");
  await assert.rejects(
    waitForRunner(ready, Promise.reject(failure), t.signal),
    (error) => error === failure,
  );
});

for (const action of ["command", "new-session", "fork", "reload", "shutdown"]) {
  test(
    `${action} stops a real runner at settlement without an operation signal`,
    { timeout: 30000 },
    async (t) => {
      const source =
        'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("test-results", { recursive: true }); writeFileSync("test-results/ready", String(process.pid)); setInterval(() => {}, 1000);\n';
      const f = await sessionFixture(t, {
        source,
        onReply: ({ put }) => put("client/change.txt"),
      });
      const running = f.session.prompt("Update the example.");
      const ready = join(f.cwd, "test-results/ready");
      const pid = await waitForRunner(ready, running, t.signal);
      assert.equal(f.session.agent.signal, undefined);
      if (action === "command") await f.session.prompt("/cancel-unit-tests");
      else if (action === "new-session") await f.runtime.newSession();
      else if (action === "reload") await f.session.reload();
      else if (action === "shutdown") await f.runtime.dispose();
      else {
        const entry = f.session.sessionManager
          .getBranch()
          .find(
            (entry) =>
              entry.type === "message" && entry.message.role === "user",
          );
        await f.runtime.fork(entry.id);
      }
      await running;
      assert.equal(f.requests.length, 1);
      assert.deepEqual(f.results(), []);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      assert.deepEqual(f.errors, []);
    },
  );
}
