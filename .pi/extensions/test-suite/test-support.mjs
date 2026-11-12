import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = process.env.PI_PACKAGE_ROOT;
const require = createRequire(
  packageRoot ? join(packageRoot, "package.json") : import.meta.url,
);
export const sdkPath = packageRoot
  ? join(packageRoot, "dist/index.js")
  : fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const tuiPath = require.resolve("@earendil-works/pi-tui");
const { createJiti } = require("jiti");
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent": sdkPath,
    "@earendil-works/pi-tui": tuiPath,
  },
});
const { default: testSuite } = await jiti.import("./index.ts");
export const tui = await jiti.import(tuiPath);
export const base = "a".repeat(40);

export function report(status = "passed") {
  const results =
    status === "no-tests"
      ? []
      : [
          {
            id: "example-unit",
            project: "client",
            kind: "unit",
            status,
            exitCode: status === "passed" ? 0 : 1,
            durationMs: 1,
          },
        ];
  return {
    code: status === "passed" || status === "no-tests" ? 0 : 1,
    killed: false,
    stderr: status === "failed" ? "Assertion failed\n" : "Suite output\n",
    stdout: JSON.stringify({
      status,
      profile: "quick",
      changed: true,
      base,
      suites: results.map(({ id, kind }) => ({ id, kind })),
      results,
    }),
  };
}

export function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "situate-test-hook-"));
  const cwd = join(directory, "checkout with spaces");
  mkdirSync(join(cwd, "tools"), { recursive: true });
  writeFileSync(join(cwd, "tools/test.mjs"), "");
  const selectedTools = Object.fromEntries(
    ["node", "npm", "npx"].map((tool) => [
      tool,
      join(directory, "selected-tools", tool, "bin", tool),
    ]),
  );
  for (const path of Object.values(selectedTools)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "initial tool");
  }
  const variables = [
    "TMPDIR",
    "TEMP",
    "SITUATE_AUTO_TESTS",
    "PI_SUBAGENT_WORKER",
    "CI",
  ];
  const previous = Object.fromEntries(
    variables.map((key) => [key, process.env[key]]),
  );
  process.env.TMPDIR = directory;
  process.env.TEMP = directory;
  delete process.env.SITUATE_AUTO_TESTS;
  delete process.env.PI_SUBAGENT_WORKER;
  // Fixtures model a local Pi session even when the test runner itself runs in CI.
  delete process.env.CI;
  t.after(() => {
    for (const key of variables) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const handlers = {},
    commands = {},
    calls = [],
    statuses = [],
    notices = [];
  let terminalInput,
    idle = false,
    pending = false,
    execute = options.execute ?? (() => report());
  const ctx = {
    cwd,
    mode: "print",
    hasUI: false,
    signal: undefined,
    isIdle: () => idle,
    hasPendingMessages: () => pending,
    ui: {
      setStatus: (...args) => statuses.push(args),
      notify: (...args) => notices.push(args),
      onTerminalInput: (handler) => {
        terminalInput = handler;
        return () => {
          terminalInput = undefined;
        };
      },
    },
  };
  const pi = {
    on: (name, handler) => {
      handlers[name] = handler;
    },
    registerCommand: (name, command) => {
      commands[name] = command;
    },
    exec: async (command, args, execOptions) => {
      calls.push({ command, args, options: execOptions });
      if (command === "git")
        return {
          code: 0,
          killed: false,
          stderr: "",
          stdout:
            args[0] === "rev-parse"
              ? `${args.includes("--show-toplevel") ? cwd : base}\n`
              : args[0] === "status"
                ? (options.clientChanges ?? " M client/example.ts\0")
                : (options.committedClientChanges ?? ""),
        };
      if (command === "volta" && args[0] === "which")
        return {
          code: 0,
          killed: false,
          stdout: selectedTools[args[1]],
          stderr: "",
        };
      return execute(command, args, execOptions);
    },
  };
  testSuite(pi);
  const event = (overrides = {}) => ({
    outcome: "completed",
    entries: [],
    continue: false,
    context: { pendingMessages: [], canContinue: false },
    ...overrides,
  });
  return {
    directory,
    selectedTools,
    cwd,
    ctx,
    pi,
    calls,
    handlers,
    commands,
    statuses,
    notices,
    event,
    start: () => handlers.before_agent_start({}, ctx),
    settle: (overrides) => handlers.agent_before_settle(event(overrides), ctx),
    execute: (next) => {
      execute = next;
    },
    idle: (value) => {
      idle = value;
    },
    pending: (value) => {
      pending = value;
    },
    input: (data) => terminalInput?.(data),
    hasInput: () => Boolean(terminalInput),
    runs: () =>
      calls.filter(
        (call) =>
          call.args[0] === fileURLToPath(new URL("./run.mjs", import.meta.url)),
      ),
  };
}
