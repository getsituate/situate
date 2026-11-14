import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import {
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { base, fixture, report, tui } from "./test-support.mjs";

function blocked(f) {
  const started = Promise.withResolvers();
  f.execute(
    (_command, _args, { signal }) =>
      new Promise((resolve) => {
        started.resolve(signal);
        signal.addEventListener("abort", () => resolve(report("cancelled")), {
          once: true,
        });
      }),
  );
  return started.promise;
}

const message = (result) => {
  const entry = result.entries.at(-1);
  return entry.type === "custom"
    ? { ...entry, details: entry.data, content: entry.data.summary }
    : entry;
};

test("loading registers lifecycle hooks without executing commands or intercepting commits", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.calls, []);
  for (const event of [
    "tool_call",
    "tool_result",
    "agent_end",
    "turn_end",
    "agent_settled",
  ])
    assert.equal(f.handlers[event], undefined);
  assert.deepEqual(Object.keys(f.commands), ["cancel-unit-tests"]);
});

test("one final check delegates selection and committed changes to the central runner", async (t) => {
  const f = fixture(t);
  f.ctx.hasUI = true;
  await f.start();
  const prior = {
    type: "custom",
    customType: "another-extension",
    data: "retained",
  };
  const result = await f.settle({ entries: [prior] });
  assert.equal(result.entries[0], prior);
  assert.equal(result.continue, undefined);
  assert.equal(message(result).type, "custom");
  assert.equal(message(result).display, undefined);
  assert.equal(
    result.entries.some((entry) => entry.type === "custom_message"),
    false,
  );
  assert.match(message(result).content, /passed \(1\/1 suites passed\)/);
  const [run] = f.runs();
  assert.equal(run.command, realpathSync(f.selectedTools.node));
  assert.deepEqual(run.args, [
    fileURLToPath(new URL("./run.mjs", import.meta.url)),
    ["npm", "npx", "node"]
      .map((tool) => dirname(realpathSync(f.selectedTools[tool])))
      .join(delimiter),
    join(f.cwd, "tools/test.mjs"),
    "--quick",
    "--changed",
    "--base",
    base,
    "--json",
    "--success-cache",
    cachePath(run),
  ]);
  assert.equal(run.options.cwd, f.cwd);
  assert.equal(
    readFileSync(message(result).details.logPath, "utf8"),
    "Suite output\n",
  );
  assert.equal(
    JSON.parse(readFileSync(message(result).details.reportPath, "utf8"))
      .profile,
    "quick",
  );
  if (process.platform !== "win32")
    assert.equal(statSync(message(result).details.logPath).mode & 0o777, 0o600);
  assert.deepEqual(f.statuses.at(-1), [
    "unit-tests",
    "Quality checks: passed (1/1 suites passed).",
  ]);
  assert.equal(await f.settle(), undefined);
  assert.equal(f.runs().length, 1);
});

test("the project runtime is selected through Volta independently of Pi's executable", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "execPath");
  Object.defineProperty(process, "execPath", {
    ...descriptor,
    value: join("unrelated-pi-runtime", "node"),
  });
  t.after(() => Object.defineProperty(process, "execPath", descriptor));
  const f = fixture(t);
  await f.start();
  assert.equal(message(await f.settle()).details.status, "passed");
  assert.equal(f.runs()[0].command, realpathSync(f.selectedTools.node));
  assert.notEqual(f.runs()[0].command, process.execPath);
  assert.equal(f.runs()[0].args[2], join(f.cwd, "tools/test.mjs"));
  assert.deepEqual(
    f.calls
      .filter(({ command }) => command === "volta")
      .map(({ args }) => args),
    [
      ["which", "node"],
      ["which", "npm"],
      ["which", "npx"],
    ],
  );
  assert.equal(f.runs()[0].options.cwd, f.cwd);
});

test("missing Volta is reported without falling back to Pi's runtime", async (t) => {
  const f = fixture(t);
  const execute = f.pi.exec;
  f.pi.exec = (command, args, options) => {
    if (command === "volta") throw new Error("spawn volta ENOENT");
    return execute(command, args, options);
  };
  await f.start();
  const result = await f.settle();
  assert.equal(message(result).details.status, "error");
  assert.match(message(result).content, /spawn volta ENOENT/);
  assert.equal(result.continue, true);
  assert.equal(f.runs().length, 0);
  assert.ok(f.calls.every(({ command }) => ["git", "volta"].includes(command)));
});

test("failed Volta selection cannot expose resolver diagnostics or start a host runner", async (t) => {
  const f = fixture(t);
  const execute = f.pi.exec;
  f.pi.exec = (command, args, options) =>
    command === "volta"
      ? Promise.resolve({
          code: 1,
          killed: false,
          stdout: "",
          stderr: "synthetic-private-diagnostic",
        })
      : execute(command, args, options);
  await f.start();
  const result = await f.settle();
  assert.equal(message(result).details.status, "error");
  assert.match(
    message(result).content,
    /Volta could not resolve the project's node/,
  );
  assert.ok(!message(result).content.includes("synthetic-private-diagnostic"));
  assert.equal(f.runs().length, 0);
});

test("automatic feedback does not forward a host Pi package override or change process state", async (t) => {
  const previous = process.env.PI_PACKAGE_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_PACKAGE_ROOT;
    else process.env.PI_PACKAGE_ROOT = previous;
  });
  const f = fixture(t);
  const override = join(f.directory, "alternate Pi package");
  process.env.PI_PACKAGE_ROOT = override;
  await f.start();
  await f.settle();
  assert.ok(!f.runs()[0].args.includes("--pi-package-root"));
  assert.ok(!f.runs()[0].args.includes(override));
  assert.ok(f.runs()[0].args.includes("--quick"));
  assert.ok(f.runs()[0].args.includes("--success-cache"));
  assert.equal(process.env.PI_PACKAGE_ROOT, override);
});

test("automatic feedback leaves Pi dependency selection to the repository runner", async (t) => {
  const previous = process.env.PI_PACKAGE_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_PACKAGE_ROOT;
    else process.env.PI_PACKAGE_ROOT = previous;
  });
  delete process.env.PI_PACKAGE_ROOT;
  const f = fixture(t);
  await f.start();
  await f.settle();
  assert.ok(!f.runs()[0].args.includes("--pi-package-root"));
  assert.equal(process.env.PI_PACKAGE_ROOT, undefined);
});

test("failure appends runnable feedback even when the incoming context cannot continue", async (t) => {
  const f = fixture(t, { execute: () => report("failed") });
  await f.start();
  const first = await f.settle();
  assert.equal(first.continue, true);
  assert.match(message(first).content, /example-unit: failed/);
  assert.match(
    message(first).content,
    /regressions introduced by your changes/,
  );
  await f.handlers.agent_start({}, f.ctx);
  const second = await f.settle();
  assert.equal(second.continue, undefined);
  assert.equal(message(second).details.status, "failed");
  assert.equal(await f.settle(), undefined);
  assert.equal(f.runs().length, 2);
});

test("a repair is checked once and success never starts another model request", async (t) => {
  const f = fixture(t, { execute: () => report("failed") });
  await f.start();
  assert.equal((await f.settle()).continue, true);
  f.execute(() => report());
  await f.handlers.agent_start({}, f.ctx);
  const result = await f.settle();
  assert.equal(result.continue, undefined);
  assert.equal(message(result).details.status, "passed");
  assert.equal(await f.settle(), undefined);
});

test("further agent work invalidates completion without replenishing automatic repair turns", async (t) => {
  const f = fixture(t, { execute: () => report("failed") });
  await f.start();
  await f.settle();
  f.execute(() => report());
  await f.handlers.agent_start({}, f.ctx);
  await f.settle();
  await f.handlers.agent_start({}, f.ctx);
  f.execute(() => report("failed"));
  const result = await f.settle();
  assert.equal(message(result).details.status, "failed");
  assert.equal(result.continue, undefined);
});

test("all repository selection is delegated without a client-only gate", async (t) => {
  const f = fixture(t, { clientChanges: "", committedClientChanges: "" });
  await f.start();
  assert.equal(message(await f.settle()).details.status, "passed");
  assert.equal(f.runs().length, 1);
  assert.deepEqual(
    f.calls.filter(({ command }) => command === "git").map(({ args }) => args),
    [
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "--verify", "HEAD"],
    ],
  );
});

test("a clean selection is silent, not a passing-test claim", async (t) => {
  const f = fixture(t, { execute: () => report("no-tests") });
  await f.start();
  assert.equal(await f.settle(), undefined);
  assert.equal(await f.settle(), undefined);
  assert.equal(f.runs().length, 1);
});

for (const outcome of ["aborted", "error"]) {
  test(`${outcome} activity does not launch tests`, async (t) => {
    const f = fixture(t);
    await f.start();
    assert.equal(await f.settle({ outcome }), undefined);
    assert.equal(f.runs().length, 0);
  });
}

test("queued work and another extension's continuation defer tests", async (t) => {
  const f = fixture(t);
  await f.start();
  assert.equal(await f.settle({ continue: true }), undefined);
  assert.equal(
    await f.settle({ context: { pendingMessages: [{}], canContinue: true } }),
    undefined,
  );
  f.pending(true);
  assert.equal(await f.settle(), undefined);
  assert.equal(f.runs().length, 0);
  f.pending(false);
  await f.settle();
  assert.equal(f.runs().length, 1);
});

for (const invalid of [
  "not json",
  "null",
  JSON.stringify({ status: "planned" }),
  JSON.stringify({ status: "error", error: "Unclassified tests" }),
]) {
  test(`runner errors and invalid reports are failures: ${invalid}`, async (t) => {
    const f = fixture(t, { execute: () => ({ ...report(), stdout: invalid }) });
    await f.start();
    const result = await f.settle();
    assert.equal(message(result).details.status, "error");
    assert.equal(result.continue, true);
    assert.match(message(result).content, /could not complete/);
  });
}

for (const change of [
  (value) => {
    value.code = 1;
  },
  (value) => {
    const data = JSON.parse(value.stdout);
    data.profile = "all";
    value.stdout = JSON.stringify(data);
  },
  (value) => {
    const data = JSON.parse(value.stdout);
    data.results = [];
    value.stdout = JSON.stringify(data);
  },
  (value) => {
    const data = JSON.parse(value.stdout);
    data.results[0].status = "failed";
    value.stdout = JSON.stringify(data);
  },
  (value) => {
    const data = JSON.parse(value.stdout);
    data.results[0].reused = "true";
    value.stdout = JSON.stringify(data);
  },
]) {
  test("inconsistent success reports cannot become green", async (t) => {
    const value = report();
    change(value);
    const f = fixture(t, { execute: () => value });
    await f.start();
    assert.equal(message(await f.settle()).details.status, "error");
  });
}

for (const value of [report("cancelled"), { ...report(), killed: true }]) {
  test("an interrupted runner never requests repair", async (t) => {
    const f = fixture(t, { execute: () => value });
    await f.start();
    const result = await f.settle();
    assert.equal(message(result).details.status, "cancelled");
    assert.equal(result.continue, undefined);
  });
}

test("failure excerpts are bounded and terminal escapes do not enter feedback", async (t) => {
  const output =
    "old output\n".repeat(3000) + "\x1b[31mAssertion failed\x1b[0m\n";
  const f = fixture(t, {
    execute: () => ({ ...report("failed"), stderr: output }),
  });
  await f.start();
  const entry = message(await f.settle());
  assert.ok(entry.content.length < 5000);
  assert.match(entry.content, /Assertion failed/);
  assert.match(entry.content, /24 lines \/ 2000 characters/);
  assert.ok(!entry.content.includes("\x1b"));
  assert.equal(readFileSync(entry.details.logPath, "utf8"), output);
});

test("compact failure feedback retains an assertion hidden by later successful suites", async (t) => {
  const output =
    "AssertionError [ERR_ASSERTION]: Expected example\n" +
    "Passing check\n".repeat(500);
  const f = fixture(t, {
    execute: () => ({ ...report("failed"), stderr: output }),
  });
  await f.start();
  const entry = message(await f.settle());
  assert.match(entry.content, /Expected example/);
  assert.ok(entry.content.length < 5000);
  assert.equal(readFileSync(entry.details.logPath, "utf8"), output);
});

test("duplicate settlement cannot launch overlapping runs", async (t) => {
  const f = fixture(t);
  await f.start();
  const started = blocked(f);
  const running = f.settle();
  await started;
  assert.equal(await f.settle(), undefined);
  await f.commands["cancel-unit-tests"].handler("", f.ctx);
  assert.equal(await running, undefined);
  assert.equal(f.runs().length, 1);
});

for (const boundary of [
  "session_start",
  "session_before_switch",
  "session_before_fork",
  "session_tree",
  "session_shutdown",
]) {
  test(`${boundary} cancels work and suppresses stale feedback`, async (t) => {
    const f = fixture(t);
    await f.start();
    const started = blocked(f);
    const running = f.settle();
    const signal = await started;
    await f.handlers[boundary]({}, f.ctx);
    assert.equal(signal.aborted, true);
    assert.equal(await running, undefined);
    await f.handlers[boundary]({}, f.ctx);
    assert.equal(await f.settle(), undefined);
  });
}

test("an available operation signal is propagated", async (t) => {
  const f = fixture(t);
  await f.start();
  const controller = new AbortController();
  f.ctx.signal = controller.signal;
  const started = blocked(f);
  const running = f.settle();
  const signal = await started;
  controller.abort();
  assert.equal(signal.aborted, true);
  assert.equal(await running, undefined);
});

test("TUI interruption works without an operation signal and honors rebound keys", async (t) => {
  const f = fixture(t);
  const previous = tui.getKeybindings();
  tui.setKeybindings(
    new tui.KeybindingsManager(
      { "app.interrupt": { defaultKeys: "escape" } },
      { "app.interrupt": "ctrl+q" },
    ),
  );
  t.after(() => tui.setKeybindings(previous));
  f.ctx.mode = "tui";
  f.ctx.hasUI = true;
  await f.start();
  const started = blocked(f);
  const running = f.settle();
  const signal = await started;
  assert.equal(f.hasInput(), true);
  assert.equal(f.input("\x1b"), undefined);
  assert.equal(signal.aborted, false);
  assert.equal(f.input("\x11"), undefined);
  assert.equal(signal.aborted, true);
  assert.equal(await running, undefined);
  assert.equal(f.hasInput(), false);
});

test("user input cancels a stale result, preserves the original base, and restores the repair budget", async (t) => {
  const f = fixture(t);
  f.ctx.hasUI = true;
  await f.start();
  const started = blocked(f);
  const running = f.settle();
  const signal = await started;
  await f.handlers.input({ source: "rpc" }, f.ctx);
  assert.equal(signal.aborted, true);
  assert.equal(await running, undefined);
  assert.deepEqual(f.statuses.at(-1), ["unit-tests", undefined]);
  f.execute(() => report("failed"));
  assert.equal((await f.settle()).continue, true);
  assert.equal(
    f.calls.filter((call) => call.args.includes("--show-toplevel")).length,
    1,
  );
  const args = f.runs().at(-1).args;
  assert.equal(args[args.indexOf("--base") + 1], base);
});

test("extension-origin input does not replenish an exhausted repair budget", async (t) => {
  const f = fixture(t, { execute: () => report("failed") });
  await f.start();
  await f.settle();
  await f.handlers.input({ source: "extension" }, f.ctx);
  assert.equal((await f.settle()).continue, undefined);
});

test("new user input revives a cancelled activity, but extension input does not", async (t) => {
  const f = fixture(t, { execute: () => report("failed") });
  await f.start();
  await f.settle();
  await f.handlers.agent_start({}, f.ctx);
  await f.commands["cancel-unit-tests"].handler("", f.ctx);
  await f.handlers.input({ source: "extension" }, f.ctx);
  assert.equal(await f.settle(), undefined);
  assert.equal(f.runs().length, 1);
  await f.handlers.input({ source: "rpc" }, f.ctx);
  assert.equal((await f.settle()).continue, true);
  assert.equal(f.runs().length, 2);
});

test("fresh prompts capture a new baseline and reset state independently", async (t) => {
  const f = fixture(t, { execute: () => report("failed") });
  await f.start();
  await f.settle();
  await f.settle();
  await f.start();
  assert.equal((await f.settle()).continue, true);
  assert.equal(
    f.calls.filter((call) => call.args.includes("--show-toplevel")).length,
    2,
  );
});

test("Git failures are reported rather than silently dropping the baseline", async (t) => {
  const f = fixture(t);
  f.pi.exec = async () => ({
    code: 128,
    killed: false,
    stdout: "",
    stderr: "Git unavailable",
  });
  await f.start();
  assert.match(message(await f.settle()).content, /Git unavailable/);
});

for (const argument of ["--show-toplevel", "--verify"]) {
  test(`queued input during ${argument} preserves baseline initialization`, async (t) => {
    const f = fixture(t);
    const started = Promise.withResolvers(),
      released = Promise.withResolvers();
    const execute = f.pi.exec;
    f.pi.exec = async (command, args, options) => {
      if (command === "git" && args.includes(argument)) {
        started.resolve();
        await released.promise;
      }
      return execute(command, args, options);
    };
    const starting = f.start();
    await started.promise;
    await f.handlers.input({ source: "rpc" }, f.ctx);
    assert.equal(await f.settle(), undefined);
    released.resolve();
    await starting;
    assert.equal(message(await f.settle()).details.base, base);
  });
}

test("discarding a result for queued work does not consume the repair allowance", async (t) => {
  const f = fixture(t);
  await f.start();
  f.execute(() => {
    f.pending(true);
    return report("failed");
  });
  assert.equal(await f.settle(), undefined);
  f.pending(false);
  f.execute(() => report("failed"));
  assert.equal((await f.settle()).continue, true);
});

test("large planning diagnostics are sanitized and bounded while the report retains them", async (t) => {
  const error =
    "\x1b[31mUnclassified tests\x1b[0m\n" + "example.test.mjs\n".repeat(10000);
  const f = fixture(t, {
    execute: () => ({
      ...report(),
      code: 2,
      stdout: JSON.stringify({ status: "error", error }),
    }),
  });
  await f.start();
  const entry = message(await f.settle());
  assert.ok(entry.content.length < 9000);
  assert.ok(!entry.content.includes("\x1b"));
  assert.equal(
    JSON.parse(readFileSync(entry.details.reportPath, "utf8")).error,
    error,
  );
});

test("checkouts without the central runner do not execute unrelated commands", async (t) => {
  const f = fixture(t);
  rmSync(join(f.cwd, "tools/test.mjs"));
  await f.start();
  await f.handlers.input({ source: "rpc" }, f.ctx);
  await f.handlers.agent_start({}, f.ctx);
  assert.equal(await f.settle(), undefined);
  assert.equal(f.calls.length, 1);
});

const cachePath = (run) => {
  const index = run.args.indexOf("--success-cache");
  assert.ok(index >= 0, "Local sessions must request a suite cache");
  assert.ok(run.args[index + 1], "The suite cache requires a directory");
  return run.args[index + 1];
};

function reusedReport() {
  const result = report();
  const body = JSON.parse(result.stdout);
  body.results[0].reused = true;
  result.stdout = JSON.stringify(body);
  return result;
}

test("reuse is delegated to the runner with one private cache across prompts", async (t) => {
  const f = fixture(t);
  await f.start();
  await f.settle();
  f.execute(reusedReport);
  await f.start();
  assert.equal(await f.settle(), undefined);
  assert.equal(f.runs().length, 2);
  assert.equal(cachePath(f.runs()[0]), cachePath(f.runs()[1]));
  assert.ok(cachePath(f.runs()[0]).startsWith(realpathSync(f.directory)));
  assert.equal(cachePath(f.runs()[0]), realpathSync(cachePath(f.runs()[0])));
  if (process.platform !== "win32")
    assert.equal(statSync(cachePath(f.runs()[0])).mode & 0o777, 0o700);
  assert.ok(!f.calls.some(({ args }) => args[0] === "ls-files"));
});

for (const event of [
  "session_start",
  "session_before_switch",
  "session_before_fork",
  "session_tree",
  "session_shutdown",
]) {
  test(`${event} removes prior successful suite results`, async (t) => {
    const f = fixture(t);
    await f.start();
    await f.settle();
    const previous = cachePath(f.runs()[0]);
    await f.handlers[event]({}, f.ctx);
    assert.equal(existsSync(previous), false);
    await f.start();
    await f.settle();
    assert.notEqual(cachePath(f.runs()[1]), previous);
  });
}

test("explicit cancellation rotates the suite cache", async (t) => {
  const f = fixture(t);
  await f.start();
  await f.settle();
  await f.commands["cancel-unit-tests"].handler("", f.ctx);
  await f.start();
  await f.settle();
  assert.notEqual(cachePath(f.runs()[0]), cachePath(f.runs()[1]));
});

for (const result of [
  report("cancelled"),
  { ...report(), stdout: "invalid JSON" },
]) {
  test(`uncertain runner report discards prior cache access: ${result.stdout}`, async (t) => {
    const f = fixture(t);
    await f.start();
    await f.settle();
    f.execute(() => result);
    await f.start();
    await f.settle();
    f.execute(() => report());
    await f.start();
    await f.settle();
    assert.notEqual(cachePath(f.runs()[0]), cachePath(f.runs()[2]));
  });
}

test("mixed results distinguish reused checks from executed checks", async (t) => {
  const result = reusedReport();
  const body = JSON.parse(result.stdout);
  body.suites.push({ id: "another", kind: "check" });
  body.results.push({ id: "another", kind: "check", status: "passed" });
  result.stdout = JSON.stringify(body);
  const f = fixture(t, { execute: () => result });
  await f.start();
  assert.match(
    message(await f.settle()).content,
    /1 reused with unchanged inputs/,
  );
});

test("CI automatic checks do not request success reuse", async (t) => {
  const f = fixture(t);
  process.env.CI = "true";
  await f.start();
  await f.settle();
  assert.ok(!f.runs()[0].args.includes("--success-cache"));
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  test(
    `runner adapter preserves CLI entry and direct ${signal} delivery`,
    { timeout: 10000 },
    async (t) => {
      const f = fixture(t);
      const runner = join(realpathSync(f.cwd), "tools/test.mjs");
      writeFileSync(
        runner,
        `import { pathToFileURL } from "node:url";
if (import.meta.url !== pathToFileURL(process.argv[1]).href) throw new Error("CLI entry was bypassed");
process.on(${JSON.stringify(signal)}, () => { process.exitCode = 73; clearInterval(keepAlive); });
const keepAlive = setInterval(() => {}, 1000);
console.log(JSON.stringify({ pid: process.pid, args: process.argv.slice(2), path: process.env.PATH }));
`,
      );
      const toolPath = dirname(f.selectedTools.node);
      const args = ["--quick", "--changed", "--json"];
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./run.mjs", import.meta.url)),
          toolPath,
          runner,
          ...args,
        ],
        { cwd: f.cwd, stdio: ["ignore", "pipe", "pipe"] },
      );
      t.after(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      });
      const lines = createInterface({ input: child.stdout });
      t.after(() => lines.close());
      const exited = once(child, "exit");
      let stderr = "";
      child.stderr.setEncoding("utf8").on("data", (chunk) => {
        stderr += chunk;
      });
      const [line] = await Promise.race([
        once(lines, "line", { signal: t.signal }),
        exited.then(([code, signal]) => {
          throw new Error(
            `Runner exited before readiness (${code}, ${signal}): ${stderr}`,
          );
        }),
      ]);
      const ready = JSON.parse(line);
      assert.equal(ready.pid, child.pid);
      assert.deepEqual(ready.args, args);
      assert.ok(ready.path.startsWith(`${toolPath}${delimiter}`));
      child.kill(signal);
      assert.deepEqual(await exited, [73, null]);
    },
  );
}

const delegationSkill = readFileSync(
  new URL("../../skills/delegate-with-herdr/SKILL.md", import.meta.url),
  "utf8",
);
const reviewerSetup = delegationSkill.match(
  /^herdr pane run <new-pane-id> '([^'\n]+)'$/m,
)?.[1];

for (const customHome of [false, true]) {
  test(`documented reviewer shell exports hook suppression and Volta before launch (custom home: ${customHome})`, async (t) => {
    assert.ok(
      reviewerSetup,
      "The reviewer recipe must configure the target shell",
    );
    const f = fixture(t);
    const voltaHome = join(f.directory, customHome ? "custom volta" : ".volta");
    mkdirSync(join(voltaHome, "bin"), { recursive: true });
    for (const tool of ["node", "npm", "volta"])
      writeFileSync(join(voltaHome, "bin", tool), "#!/bin/sh\nexit 0\n", {
        mode: 0o700,
      });
    const env = {
      ...process.env,
      HOME: f.directory,
      PATH: "/usr/bin:/bin",
      SITUATE_AUTO_TESTS: "1",
    };
    delete env.VOLTA_HOME;
    if (customHome) env.VOLTA_HOME = voltaHome;
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        `${reviewerSetup} && /bin/sh -c 'printf "CHILD_AUTO=%s NODE=%s NPM=%s\\n" "$SITUATE_AUTO_TESTS" "$(command -v node)" "$(command -v npm)"'`,
      ],
      { cwd: f.cwd, env, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      `review-shell-ready AUTO=0 CWD=${realpathSync(f.cwd)}\nCHILD_AUTO=0 NODE=${voltaHome}/bin/node NPM=${voltaHome}/bin/npm\n`,
    );
    process.env.SITUATE_AUTO_TESTS = "0";
    await f.start();
    assert.equal(await f.settle(), undefined);
    assert.deepEqual(f.calls, []);
  });
}

test("independent Pi instances never share successful-suite caches", async (t) => {
  const paths = [];
  for (let index = 0; index < 2; index++)
    await t.test(`instance ${index}`, async (t) => {
      const f = fixture(t);
      await f.start();
      await f.settle();
      paths.push(cachePath(f.runs()[0]));
    });
  assert.notEqual(paths[0], paths[1]);
});

test("documented reviewer shell does not confirm readiness without Volta project tools", (t) => {
  assert.ok(reviewerSetup);
  const f = fixture(t);
  const result = spawnSync("/bin/bash", ["-c", reviewerSetup], {
    cwd: f.cwd,
    env: { HOME: f.directory, PATH: "/usr/bin:/bin" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /review-shell-ready/);
});

for (const [key, value] of [
  ["SITUATE_AUTO_TESTS", "0"],
  ["PI_SUBAGENT_WORKER", "1"],
]) {
  test(`${key} disables automatic execution`, async (t) => {
    const f = fixture(t);
    process.env[key] = value;
    await f.start();
    assert.equal(await f.settle(), undefined);
    assert.deepEqual(f.calls, []);
  });
}

test("automatic budget overruns remain visible without an automatic repair turn", async (t) => {
  const f = fixture(t, {
    execute: (_command, _args, options) =>
      new Promise((resolve) => {
        options.signal.addEventListener("abort", () => resolve(report()), {
          once: true,
        });
      }),
  });
  await f.start();
  const started = performance.now();
  const result = await f.settle();
  assert.equal(message(result).details.status, "budget-exceeded");
  assert.match(message(result).content, /five-second budget/);
  assert.notEqual(result.continue, true);
  assert.ok(performance.now() - started < 5000);
  assert.equal(f.runs().length, 1);
});
