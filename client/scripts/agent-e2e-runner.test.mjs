import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentRunError,
  MODEL,
  acquireBuildCache,
  childEnvironment,
  createIsolation,
  parseAgentOptions,
  safeNativeStage,
  safeNativeObservation,
  safeProviderReport,
} from "./agent-e2e-runtime.mjs";
import { runAgent } from "./test-agent-e2e.mjs";
import { loadAgentTestKey } from "./agent-e2e-credentials.mjs";

const paid = ["--provider", "openai"];

test("fixture default cannot spend; selecting openai explicitly permits paid execution", () => {
  const fixture = parseAgentOptions([]);
  assert.equal(fixture.provider, "fixture");
  assert.equal(fixture.journey, "workspace");
  assert.equal(
    parseAgentOptions(["--journey", "onboarding"]).journey,
    "onboarding",
  );
  assert.equal(
    parseAgentOptions([...paid, "--journey", "onboarding"])["max-requests"],
    24,
  );
  assert.equal(fixture["allow-paid"], undefined);
  assert.equal(fixture["max-requests"], 64);
  assert.equal(fixture.timeout, 300);
  assert.equal(parseAgentOptions(paid)["max-requests"], 24);
  assert.equal(parseAgentOptions(paid).timeout, 180);
  assert.equal(MODEL, "gpt-4.1-mini");
  for (const args of [
    ["--allow-paid"],
    ["--provider", "other"],
    ["--journey", "other"],
    ["--model", "other"],
    ["--allow-shell"],
    ["--timeout", "0"],
    [...paid, "--timeout", "181"],
    [...paid, "--max-requests", "25"],
    [...paid, "--max-total-input-tokens", "262145"],
    [...paid, "--max-total-output-tokens", "24577"],
    ["--max-output-tokens", "1025"],
    ["--build-timeout", "1801"],
    ["--timeout", "1.5"],
  ])
    assert.throws(() => parseAgentOptions(args), AgentRunError);
  assert.equal(
    parseAgentOptions([...paid, "--max-requests", "1"])["max-requests"],
    1,
  );
});

test("missing test key and unsupported hosts block before isolation, build, or network", async () => {
  let touched = false;
  const forbidden = async () => {
    touched = true;
    throw new Error("unexpected");
  };
  const deps = {
    platform: "darwin",
    desktopIssue: () => null,
    environment: { OPENAI_API_KEY: "personal-secret", TEST_OPENAI_API_KEY: "" },
    isolate: forbidden,
    build: forbidden,
    provider: forbidden,
  };
  const missing = await runAgent(paid, deps);
  assert.equal(missing.outcome, "blocked");
  assert.equal(missing.code, "missing-TEST_OPENAI_API_KEY");
  for (const platform of ["linux", "win32"])
    assert.equal(
      (await runAgent(paid, { ...deps, platform, loadKey: forbidden })).code,
      "macos-keychain-required",
    );
  assert.equal(touched, false);
  assert.ok(!JSON.stringify(missing).includes("personal-secret"));
});

test("an unavailable desktop blocks before key access, isolation, build, or provider startup", async () => {
  const forbidden = () => {
    assert.fail("native prerequisites were bypassed");
  };
  for (const issue of [
    "desktop-session-locked",
    "desktop-session-unavailable",
  ]) {
    const result = await runAgent(paid, {
      platform: "darwin",
      desktopIssue: () => issue,
      loadKey: forbidden,
      isolate: forbidden,
      build: forbidden,
      provider: forbidden,
      launch: forbidden,
    });
    assert.equal(result.outcome, "blocked");
    assert.equal(result.code, issue);
    assert.equal(result.phasesPassed, 0);
    assert.equal(result.cleanup, "not-needed");
  }
});

test("help needs no supported host, key, filesystem, build, or provider", async () => {
  let touched = false;
  const forbidden = async () => {
    touched = true;
    throw new Error("unexpected");
  };
  const report = await runAgent(["--help"], {
    platform: "linux",
    desktopIssue: forbidden,
    environment: {},
    isolate: forbidden,
    build: forbidden,
    provider: forbidden,
    loadKey: forbidden,
  });
  assert.equal(report.outcome, "help");
  assert.match(report.help, /--provider openai explicitly permits paid calls/);
  assert.doesNotMatch(report.help, /--allow-paid/);
  assert.match(report.help, /TEST_OPENAI_API_KEY/);
  assert.match(report.help, /--max-total-input-tokens/);
  assert.match(report.help, /Default fixture makes no paid calls/);
  assert.equal(touched, false);
});

test("child environments exclude keys, proxies, injected scripts and personal Pi settings", async () => {
  const isolated = await createIsolation();
  try {
    const inherited = {
      HOME: "/personal",
      PATH: "/usr/bin",
      TEST_OPENAI_API_KEY: "secret",
      OPENAI_API_KEY: "personal",
      NODE_OPTIONS: "--require bad",
      HTTP_PROXY: "secret",
      PI_CODING_AGENT_DIR: "/personal/pi",
      CARGO_HOME: "/personal/cargo",
      DEVELOPER_DIR: "/Applications/Xcode_26.0.1.app/Contents/Developer",
      RUSTFLAGS: "secret",
    };
    for (const build of [false, true]) {
      const env = childEnvironment(isolated, inherited, { build });
      for (const name of [
        "TEST_OPENAI_API_KEY",
        "OPENAI_API_KEY",
        "NODE_OPTIONS",
        "HTTP_PROXY",
        "RUSTFLAGS",
      ])
        assert.equal(env[name], undefined);
      assert.equal(env.HOME, join(isolated.root, "home"));
      assert.equal(env.PI_CODING_AGENT_DIR, join(isolated.root, "pi"));
      if (build) assert.equal(env.CARGO_HOME, join(isolated.root, "cargo"));
      assert.equal(env.VOLTA_HOME, build ? "/personal/.volta" : undefined);
      assert.equal(
        env.DEVELOPER_DIR,
        build ? inherited.DEVELOPER_DIR : undefined,
      );
    }
  } finally {
    await isolated.cleanup();
  }
});

async function journey(overrides = {}, args = []) {
  let root;
  const launches = [];
  const providers = [];
  const builds = [];
  const result = await runAgent(args, {
    environment: {
      HOME: "/synthetic",
      PATH: "/usr/bin",
      TEST_OPENAI_API_KEY: "sk-test-not-real",
    },
    platform: "darwin",
    desktopIssue: () => null,
    isolate: async () => {
      const isolated = await createIsolation();
      root = isolated.root;
      return isolated;
    },
    copyJourney: async () => {},
    build: async (...args) => {
      builds.push(args);
      return { executable: "/synthetic/app", release: async () => {} };
    },
    provider: async (options) => {
      providers.push(options);
      return {
        url: "http://127.0.0.1:1/v1/responses",
        token: "synthetic-token",
        report: () => ({
          requests: 2,
          records: [
            {
              outcome: "completed",
              requestId: "req_one",
              usage: { input_tokens: 10, output_tokens: 20 },
            },
          ],
        }),
        close: async () => {},
      };
    },
    launch: async (_executable, _args, options) => {
      launches.push(options);
      assert.equal(options.env.TEST_OPENAI_API_KEY, undefined);
      if (options.env.SITUATE_AGENT_E2E_CLEANUP) return;
      const config = JSON.parse(
        await readFile(options.env.SITUATE_AGENT_E2E_CONFIG, "utf8"),
      );
      assert.equal(config.providerToken, "synthetic-token");
      await writeFile(
        config.reportPath,
        JSON.stringify({
          passed: true,
          category: "passed",
          phase: config.phase,
        }),
      );
    },
    ...overrides,
  });
  if (root) {
    if (result.cleanup === "failed") {
      await access(root);
      await rm(root, { recursive: true });
    } else await assert.rejects(access(root));
  }
  assert.ok(!JSON.stringify(result).includes("sk-test-not-real"));
  assert.ok(!JSON.stringify(result).includes("synthetic-token"));
  return { result, launches, providers, builds };
}

test("onboarding selection reaches both native launches without enabling paid access", async () => {
  const phases = [];
  const { result, providers } = await journey(
    {
      launch: async (_executable, _args, { env }) => {
        if (env.SITUATE_AGENT_E2E_CLEANUP) return;
        const config = JSON.parse(
          await readFile(env.SITUATE_AGENT_E2E_CONFIG, "utf8"),
        );
        assert.equal(config.journey, "onboarding");
        assert.equal(config.mode, "fixture");
        phases.push(config.phase);
        await writeFile(
          config.reportPath,
          JSON.stringify({
            passed: true,
            category: "passed",
            phase: config.phase,
          }),
        );
      },
    },
    ["--journey", "onboarding"],
  );
  assert.equal(result.outcome, "passed");
  assert.equal(result.journey, "onboarding");
  assert.deepEqual(phases, ["exercise", "reopen"]);
  assert.equal(providers[0].allowLive, false);
  assert.equal(providers[0].apiKey, undefined);
});

test("plugins controller requires four development and three ordinary source turns without effect replay", async () => {
  for (const redispatch of [
    "none",
    "model",
    "http",
    "missing-manual",
    "source-missing",
    "wrong-graph",
  ]) {
    let requests = redispatch === "source-missing" ? 6 : 7;
    const pluginEffects = {
      POST: 1,
      DELETE: redispatch === "missing-manual" ? 0 : 1,
    };
    const { result } = await journey(
      {
        provider: async () => ({
          url: "http://127.0.0.1:1/v1/responses",
          token: "synthetic-token",
          close: async () => {},
          report: () => ({
            requests,
            pluginEffects,
            records: Array.from({ length: requests }, (_, index) => ({
              kind: "main",
              scenario:
                index < (redispatch === "wrong-graph" ? 5 : 4)
                  ? "plugins"
                  : "source-chat",
              outcome: "completed",
            })),
          }),
        }),
        launch: async (_executable, _args, { env }) => {
          if (env.SITUATE_AGENT_E2E_CLEANUP) return;
          const config = JSON.parse(
            await readFile(env.SITUATE_AGENT_E2E_CONFIG, "utf8"),
          );
          assert.equal(config.journey, "plugins");
          assert.equal(config.mode, "fixture");
          if (config.phase === "reopen") {
            if (redispatch === "model") requests++;
            if (redispatch === "http") pluginEffects.DELETE++;
          }
          await writeFile(
            config.reportPath,
            JSON.stringify({
              passed: true,
              category: "passed",
              phase: config.phase,
              stage:
                config.phase === "exercise"
                  ? "plugins-complete"
                  : "reopen-complete",
              observation: { mainRequests: 7, auxiliaryRequests: 0 },
            }),
          );
        },
      },
      ["--journey", "plugins", "--max-requests", "7"],
    );
    assert.equal(result.outcome, redispatch !== "none" ? "product" : "passed");
    if (redispatch !== "none")
      assert.equal(
        result.code,
        redispatch === "model"
          ? "plugins-redispatched-on-reopen"
          : ["source-missing", "wrong-graph"].includes(redispatch)
            ? "plugins-request-count"
            : "plugins-http-effect-count",
      );
    else
      assert.deepEqual(result.observation, {
        mainRequests: 7,
        auxiliaryRequests: 0,
      });
  }
});

test("locking during build blocks provider startup and releases the build cache", async () => {
  let locked = false;
  let released = false;
  const { result, providers, launches } = await journey({
    desktopIssue: () => (locked ? "desktop-session-locked" : null),
    build: async () => {
      locked = true;
      return {
        executable: "/synthetic/app",
        release: async () => {
          released = true;
        },
      };
    },
  });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.code, "desktop-session-locked");
  assert.equal(result.phasesPassed, 0);
  assert.equal(providers.length, 0);
  assert.equal(launches.length, 0);
  assert.equal(released, true);
});

test("locking between native launches blocks reopen but still cleans credentials", async () => {
  let locked = false;
  const phases = [];
  const { result } = await journey({
    desktopIssue: () => (locked ? "desktop-session-locked" : null),
    launch: async (_executable, _args, { env }) => {
      if (env.SITUATE_AGENT_E2E_CLEANUP) {
        phases.push("cleanup");
        return;
      }
      const config = JSON.parse(
        await readFile(env.SITUATE_AGENT_E2E_CONFIG, "utf8"),
      );
      phases.push(config.phase);
      await writeFile(
        config.reportPath,
        JSON.stringify({
          passed: true,
          category: "passed",
          phase: config.phase,
        }),
      );
      locked = true;
    },
  });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.code, "desktop-session-locked");
  assert.equal(result.phasesPassed, 1);
  assert.equal(result.cleanup, "passed");
  assert.deepEqual(phases, ["exercise", "cleanup"]);
});

test("two launches share a single fixture broker and always clean credentials and owned files", async () => {
  const { result, launches, providers, builds } = await journey();
  assert.equal(result.outcome, "passed");
  assert.equal(result.phasesPassed, 2);
  assert.equal(result.cleanup, "passed");
  assert.equal(builds.length, 1);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].apiKey, undefined);
  assert.equal(providers[0].allowLive, false);
  assert.equal(providers[0].limits.maxBodyBytes, 33554432);
  assert.equal(providers[0].limits.maxTotalInputTokens, 268435456);
  assert.equal(providers[0].limits.timeoutMs, 60000);
  assert.equal(providers[0].limits.deadlineMs, 300000);
  assert.equal(launches.length, 3);
  assert.equal(launches[2].env.SITUATE_AGENT_E2E_CLEANUP, "1");
  assert.equal(launches[2].timeoutMs, 10000);
  assert.ok(launches[1].timeoutMs <= launches[0].timeoutMs);
  assert.equal(result.usage.outputTokens, 20);
});

test("paid mode passes only the dedicated key to one bounded broker", async () => {
  const { providers, result } = await journey({}, paid);
  assert.equal(result.outcome, "passed");
  assert.equal(providers[0].apiKey, "sk-test-not-real");
  assert.equal(providers[0].model, "gpt-4.1-mini");
  assert.equal(providers[0].limits.maxRequests, 24);
  assert.equal(providers[0].limits.maxTotalOutputTokens, 24576);
  assert.equal(providers[0].limits.maxBodyBytes, 1048576);
  assert.equal(providers[0].limits.maxTotalInputTokens, 262144);
  assert.equal(providers[0].limits.timeoutMs, 60000);
  assert.equal(providers[0].limits.deadlineMs, 180000);
});

test("fixture does not access a test-key environment property or credential loader", async () => {
  const environment = { HOME: "/synthetic", PATH: "/usr/bin" };
  Object.defineProperty(environment, "TEST_OPENAI_API_KEY", {
    get() {
      throw new Error("key must not be read");
    },
  });
  const { result } = await journey({
    environment,
    loadKey: async () => {
      throw new Error("loader must not run");
    },
  });
  assert.equal(result.outcome, "passed");
});

test("live dotenv key goes only to the broker without modifying build or app environments", async () => {
  const isolated = await createIsolation();
  const environment = Object.freeze({ HOME: "/synthetic", PATH: "/usr/bin" });
  try {
    await writeFile(
      join(isolated.root, ".env"),
      "TEST_OPENAI_API_KEY=synthetic-file-key\nEXTRA_KEY=not-inherited\n",
      { mode: 0o600 },
    );
    const { result, providers, builds, launches } = await journey(
      {
        environment,
        loadKey: (options) =>
          loadAgentTestKey({ ...options, directory: isolated.root }),
      },
      paid,
    );
    assert.equal(result.outcome, "passed");
    assert.equal(providers[0].apiKey, "synthetic-file-key");
    assert.equal(providers[0].allowLive, true);
    assert.deepEqual(environment, { HOME: "/synthetic", PATH: "/usr/bin" });
    assert.equal(builds[0][2].TEST_OPENAI_API_KEY, undefined);
    for (const launch of launches) {
      assert.equal(launch.env.TEST_OPENAI_API_KEY, undefined);
      assert.equal(launch.env.EXTRA_KEY, undefined);
    }
    assert.ok(!JSON.stringify(result).includes("synthetic-file-key"));
  } finally {
    await isolated.cleanup();
  }
});

test("build failures redact diagnostics and still remove temporary files", async () => {
  const { result } = await journey({
    build: async () => {
      throw new Error("sk-test-not-real");
    },
  });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.phasesPassed, 0);
});

test("build failure reports allowlist diagnostic fields", async () => {
  for (const reason of [
    "sccache-tempdir-unavailable",
    "command-failed",
    "synthetic-secret",
  ]) {
    const { result } = await journey({
      build: async () => {
        const error = new AgentRunError("product", "child-failed");
        error.build = { reason, exitCode: 23, output: "synthetic-secret" };
        throw error;
      },
    });
    assert.equal(result.outcome, "product");
    if (reason === "synthetic-secret") assert.equal(result.build, undefined);
    else assert.deepEqual(result.build, { reason, exitCode: 23 });
    assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
  }
});

test("native failure and cleanup failure remain nonpassing with no raw error payload", async () => {
  let cleanup = false;
  const { result } = await journey({
    launch: async (_command, _args, { env }) => {
      if (env.SITUATE_AGENT_E2E_CLEANUP) {
        cleanup = true;
        throw new Error("sk-test-not-real");
      }
      throw new AgentRunError("product", "child-failed");
    },
  });
  assert.equal(cleanup, true);
  assert.equal(result.outcome, "blocked");
  assert.equal(result.code, "credential-cleanup-failed");
  assert.equal(result.cleanup, "failed");
  assert.equal(result.beforeCleanup.outcome, "product");
  assert.equal(result.beforeCleanup.code, "native-report-missing-or-invalid");
});

test("budget and cancellation trigger cleanup without retrying the native journey", async () => {
  for (const outcome of ["budget", "cancel"]) {
    let calls = 0;
    const { result } = await journey({
      launch: async (_command, _args, { env }) => {
        calls++;
        if (!env.SITUATE_AGENT_E2E_CLEANUP)
          throw new AgentRunError(outcome, "stopped");
      },
    });
    assert.equal(result.outcome, outcome);
    assert.equal(result.cleanup, "passed");
    assert.equal(calls, 2);
  }
});

test("uncertain process cleanup retains the recovery tree and exclusive build lock", async () => {
  let released = false;
  let launches = 0;
  const { result } = await journey({
    build: async () => ({
      executable: "/synthetic/app",
      release: async () => {
        released = true;
      },
    }),
    launch: async () => {
      launches++;
      const error = new AgentRunError("blocked", "process-cleanup-failed");
      error.cleanupUnsafe = true;
      throw error;
    },
  });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.cleanup, "failed");
  assert.equal(released, false);
  assert.equal(launches, 1);
});

test("cleanup refuses an altered ownership marker", async () => {
  const isolated = await createIsolation();
  try {
    await writeFile(join(isolated.root, ".smoke-owner"), "not-owner");
    await assert.rejects(isolated.cleanup(), /ownership/);
    await access(isolated.root);
  } finally {
    await rm(isolated.root, { recursive: true });
  }
});

test("build cache is owned, reusable and exclusive; credentials fail closed", async () => {
  const isolated = await createIsolation();
  try {
    const first = await acquireBuildCache(isolated.root);
    await assert.rejects(
      acquireBuildCache(isolated.root, { timeoutMs: 1 }),
      /build-cache-busy/,
    );
    await first.release();
    const second = await acquireBuildCache(isolated.root);
    assert.equal(second.target, first.target);
    await writeFile(join(second.cargo, "credentials.toml"), "synthetic-secret");
    await second.release();
    await assert.rejects(
      acquireBuildCache(isolated.root),
      /build-cache-contains-personal-config/,
    );
  } finally {
    await isolated.cleanup();
  }
});

test("unknown native assertion stages expose only a stable digest", () => {
  assert.deepEqual(safeNativeStage("startup"), { stage: "startup" });
  const stage = safeNativeStage("synthetic-secret");
  assert.equal(stage.stage, "native-assertion");
  assert.match(stage.stageDigest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(stage).includes("synthetic-secret"));
});

test("native bootstrap and bounded OS status codes remain actionable without arbitrary text", () => {
  for (const stage of [
    "bootstrap-directory",
    "bootstrap-credential-manifest",
    "credential-save-os--60006",
    "credential-read-os-0",
    "credential-read-os--2147483648",
    "credential-save-os-2147483647",
    "snapshot-storage-open-native-ai-storage-busy",
    "snapshot-read-conversation-native-ai-conversation-versionInvalid",
    "snapshot-history-page-failed",
    "conversation-error",
    "alert-chat-history-read",
    "alert-model-storage-busy",
    "alert-model-other",
    "conversation-save-error",
    "assistant-stream-error",
    "observation-snapshot-failed",
  ])
    assert.deepEqual(safeNativeStage(stage), { stage });
  for (const stage of [
    "bootstrap-secret",
    "snapshot-secret-failed",
    "alert-chat-private-message",
    "alert-private-origin-other",
    "alert-model-other\n",
    "snapshot-file-open-secret",
    "snapshot-file-open-failed\n",
    "credential-delete-os-0",
    "credential-read-os-2147483648",
    "credential-save-os--2147483649",
    "credential-read-os-12345678901",
    "credential-read-os-0 secret",
    "credential-read-os-0\n",
    "credential-read-os-NaN",
    null,
  ]) {
    const report = safeNativeStage(stage);
    assert.equal(report.stage, "native-assertion");
    assert.equal(report.stageDigest === undefined, stage === null);
  }
});

test("expected fixture provider errors do not hide a passing native recovery journey", async () => {
  const { result } = await journey({
    provider: async () => ({
      url: "http://127.0.0.1:1/v1/responses",
      token: "synthetic-token",
      report: () => ({
        requests: 1,
        records: [{ outcome: "upstream_failure" }, { outcome: "aborted" }],
      }),
      close: async () => {},
    }),
  });
  assert.equal(result.outcome, "passed");
  assert.equal(result.usage.failed, 2);
});

test("only genuine upstream failures reclassify a failed live journey", async () => {
  for (const outcome of [
    "upstream_failure",
    "upstream_status",
    "upstream_content_type",
    "incomplete_response",
    "invalid_request",
    "input_not_allowed",
    "tool_not_allowed",
    "aborted",
  ]) {
    const { result } = await journey(
      {
        provider: async () => ({
          url: "http://127.0.0.1:1/v1/responses",
          token: "synthetic-token",
          report: () => ({ requests: 1, records: [{ outcome }] }),
          close: async () => {},
        }),
        launch: async (_command, _args, { env }) => {
          if (env.SITUATE_AGENT_E2E_CLEANUP) return;
          const config = JSON.parse(
            await readFile(env.SITUATE_AGENT_E2E_CONFIG, "utf8"),
          );
          await writeFile(
            config.reportPath,
            JSON.stringify({
              passed: false,
              category: "assertion",
              phase: config.phase,
              stage: "startup",
            }),
          );
        },
      },
      paid,
    );
    assert.equal(
      result.outcome,
      [
        "upstream_failure",
        "upstream_status",
        "upstream_content_type",
        "incomplete_response",
      ].includes(outcome)
        ? "provider"
        : "product",
      outcome,
    );
  }
});

test("cleanup failure retains the preceding classified provider outcome", async () => {
  const { result } = await journey(
    {
      provider: async () => ({
        url: "http://127.0.0.1:1/v1/responses",
        token: "synthetic-token",
        report: () => ({
          requests: 1,
          records: [{ outcome: "upstream_status" }],
        }),
        close: async () => {},
      }),
      launch: async (_command, _args, { env }) => {
        if (env.SITUATE_AGENT_E2E_CLEANUP) throw new Error("synthetic-secret");
        const config = JSON.parse(
          await readFile(env.SITUATE_AGENT_E2E_CONFIG, "utf8"),
        );
        await writeFile(
          config.reportPath,
          JSON.stringify({
            passed: false,
            category: "assertion",
            phase: config.phase,
            stage: "startup",
          }),
        );
      },
    },
    paid,
  );
  assert.equal(result.outcome, "blocked");
  assert.equal(result.code, "credential-cleanup-failed");
  assert.deepEqual(result.beforeCleanup, {
    outcome: "provider",
    code: "provider-boundary-failed",
    phase: "exercise",
    stage: "startup",
  });
});

test("exhausted shared provider budgets cannot report success", async () => {
  const { result } = await journey({
    provider: async () => ({
      url: "http://127.0.0.1:1/v1/responses",
      token: "synthetic-token",
      report: () => ({ budgetDenials: 1, records: [] }),
      close: async () => {},
    }),
  });
  assert.equal(result.outcome, "budget");
});

test("native observations retain only typed bounded counts, booleans, and known states", () => {
  assert.deepEqual(
    safeNativeObservation({
      hasComposer: true,
      hasSend: false,
      hasStop: "secret",
      hasAlert: 1,
      conversationCount: 100000000,
      userMessages: -1,
      assistantMessages: 100000001,
      toolResults: 1.5,
      draftChars: "secret",
      identifiedTasks: 2,
      metadataIssues: 0,
      runStates: ["running", "error", "unknown"],
      text: "secret",
      path: "secret",
      authorization: "secret",
    }),
    {
      hasComposer: true,
      hasSend: false,
      conversationCount: 100000000,
      identifiedTasks: 2,
      metadataIssues: 0,
      runStates: ["running", "error", "unknown"],
    },
  );
  for (const value of [
    null,
    [],
    "secret",
    { runStates: ["secret"] },
    { runStates: Array(33).fill("running") },
    { text: "secret" },
    { draftChars: Infinity },
  ])
    assert.equal(safeNativeObservation(value), undefined);
});

test("native failure observations survive report validation without exposing raw text", async () => {
  const { result } = await journey({
    launch: async (_command, _args, { env }) => {
      if (env.SITUATE_AGENT_E2E_CLEANUP) return;
      const config = JSON.parse(
        await readFile(env.SITUATE_AGENT_E2E_CONFIG, "utf8"),
      );
      await writeFile(
        config.reportPath,
        JSON.stringify({
          passed: false,
          category: "assertion",
          phase: config.phase,
          stage: "startup",
          observation: {
            hasComposer: true,
            hasSend: false,
            hasStop: false,
            hasAlert: true,
            conversationCount: 1,
            userMessages: 0,
            assistantMessages: 0,
            toolResults: 0,
            draftChars: 32,
            runStates: ["failed"],
            text: "synthetic-private-text",
          },
        }),
      );
    },
  });
  assert.equal(result.outcome, "product");
  assert.deepEqual(result.observation, {
    hasComposer: true,
    hasSend: false,
    hasStop: false,
    hasAlert: true,
    conversationCount: 1,
    userMessages: 0,
    assistantMessages: 0,
    toolResults: 0,
    draftChars: 32,
    runStates: ["failed"],
  });
  assert.ok(!JSON.stringify(result).includes("synthetic-private-text"));
});

test("provider diagnostics export only numeric usage and bounded request IDs", () => {
  assert.deepEqual(
    safeProviderReport({
      requests: 1,
      apiKey: "secret",
      records: [
        {
          outcome: "completed",
          requestId: "sk-secret",
          usage: { input_tokens: -1, output_tokens: 5 },
          body: "secret",
        },
      ],
    }),
    {
      requests: 1,
      inputTokens: 0,
      outputTokens: 5,
      completed: 1,
      failed: 0,
      requestIds: [],
    },
  );
});
