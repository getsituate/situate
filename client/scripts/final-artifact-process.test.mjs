import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  watch,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createQualificationProcess,
  qualificationCommandTimeouts,
} from "./final-artifact-process.mjs";
import { run } from "./ios-xcode.mjs";
import { spawnSync } from "node:child_process";

function assertStopped(pid) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "stat="], {
    encoding: "utf8",
  });
  assert.ifError(result.error);
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim())
    return;
  assert.equal(result.status, 0, "Cannot inspect owned native process");
  assert.match(result.stdout.trim(), /^Z/, "Owned native process remains live");
}

test("subprocess exit observers preserve output and cannot mask native failure", async () => {
  const exits = [];
  assert.equal(
    await run(process.execPath, ["-e", "console.log('synthetic output')"], {
      capture: true,
      onExit: (event) => exits.push(event),
    }),
    "synthetic output",
  );
  assert.deepEqual(exits, [{ code: 0, signal: null }]);
  const observation = new Error("Synthetic observer failure");
  await assert.rejects(
    run(process.execPath, ["-e", "process.exitCode=3"], {
      capture: true,
      onExit: () => {
        throw observation;
      },
    }),
    (error) =>
      error instanceof AggregateError &&
      error.cause.message.includes("failed (3)") &&
      error.errors.includes(observation),
  );
});

test("a real launcher exit is observable before a descendant closes captured streams", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-exit-observation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const release = join(root, "release"),
    exited = join(root, "exited");
  const application = `const fs=require('fs');const end=()=>{fs.writeFileSync(${JSON.stringify(exited)},'exited');console.log('application output');process.exit(0)};setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))end()},10);setTimeout(end,5000);`;
  const launcher = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(application)}],{detached:true,stdio:['ignore',1,2]}).unref();`;
  const observations = [];
  const output = await run(process.execPath, ["-e", launcher], {
    capture: true,
    onExit: (event) => {
      observations.push(event);
      assert.equal(existsSync(exited), false);
      writeFileSync(release, "release");
    },
  });
  assert.equal(output, "application output");
  assert.deepEqual(observations, [{ code: 0, signal: null }]);
  assert.equal(existsSync(exited), true);
});

test("the Finder install helper uses the bounded accessibility command", async () => {
  const events = [];
  const execute = createQualificationProcess({
    progress: (...event) => events.push(event),
    execute: async () => "moved",
  });
  const args = [
    "/fixture/qualification-finder-install.swift",
    "/source",
    "/destination",
  ];
  assert.equal(await execute("/usr/bin/swift", args), "moved");
  assert.deepEqual(
    events.map((event) => event.slice(1, 3)),
    [
      ["started", "accessibility"],
      ["completed", "accessibility"],
    ],
  );
  await assert.rejects(
    execute("/usr/bin/swift", [...args, "unexpected"]),
    /Unsupported qualification native command/,
  );
});

test("only pre-abort launch exits produce nonterminal observations", async () => {
  const events = [],
    timeout = new AbortController();
  const execute = createQualificationProcess({
    deadline: () => timeout.signal,
    progress: (...event) => events.push(event),
    execute: async (_command, _args, options) => {
      options.onExit({ code: 0, signal: null });
      timeout.abort(new Error("synthetic timeout"));
      options.onExit({ code: null, signal: "SIGTERM" });
      throw timeout.signal.reason;
    },
  });
  await assert.rejects(
    execute("open", ["-n", "/synthetic/Situate.app"]),
    /launch: timeout/,
  );
  assert.deepEqual(
    events.map((event) => event[1]),
    ["started", "exited_zero", "timeout"],
  );
});

test("launch dialog observation is sampled at most once while pending", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = [];
  let samples = 0,
    finish;
  const native = new Promise((resolve) => {
    finish = resolve;
  });
  const execute = createQualificationProcess({
    deadline: () => new AbortController().signal,
    progress: (...event) => events.push(event),
    observeLaunch: async () => {
      samples++;
      return "dialog_observed";
    },
    execute: () => native,
  });
  const pending = execute("open", ["-n", "/synthetic/Situate.app"]);
  t.mock.timers.tick(3999);
  assert.equal(samples, 0);
  t.mock.timers.tick(1);
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(samples, 1);
  t.mock.timers.tick(4000);
  assert.equal(samples, 1);
  finish("");
  await pending;
  assert.ok(events.some((event) => event[1] === "dialog_observed"));
});

test("settled launch cancels an unstarted observation and drains a started one", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let samples = 0;
  const fast = createQualificationProcess({
    observeLaunch: async () => {
      samples++;
      return "dialog_observed";
    },
    execute: async () => "",
  });
  await fast("open", ["-n", "/synthetic/Situate.app"]);
  t.mock.timers.tick(4000);
  assert.equal(samples, 0);
  let finish,
    drained = false;
  const native = new Promise((resolve) => {
    finish = resolve;
  });
  const slow = createQualificationProcess({
    deadline: () => new AbortController().signal,
    observeLaunch: ({ signal }) => {
      samples++;
      return new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            drained = true;
            resolve("observation_unavailable");
          },
          { once: true },
        );
      });
    },
    execute: () => native,
  });
  const pending = slow("open", ["-n", "/synthetic/Situate.app"]);
  t.mock.timers.tick(4000);
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  finish("");
  await pending;
  assert.equal(samples, 1);
  assert.equal(drained, true);
});

test("first install confirms once during a pending launch and drains the confirmation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = [],
    calls = [];
  let finish, finishConsent;
  const native = new Promise((resolve) => {
    finish = resolve;
  });
  const consent = new Promise((resolve) => {
    finishConsent = resolve;
  });
  const execute = createQualificationProcess({
    deadline: (ms) => {
      assert.equal(ms, 10_000);
      return new AbortController().signal;
    },
    progress: (_phase, status) => events.push(status),
    launchConsent: (mode, { signal }) => {
      calls.push(mode);
      if (mode === "baseline") return "absent";
      assert.equal(signal.aborted, false);
      return consent;
    },
    execute: async (_command, _args, options) => {
      calls.push("open");
      await native;
      options.onExit({ code: 0, signal: null });
      return "";
    },
  });
  let settled = false;
  const pending = execute("open", ["-n", "/synthetic/Situate.app"], {
    confirmFirstLaunch: true,
  }).then(() => {
    settled = true;
  });
  await new Promise(setImmediate);
  assert.deepEqual(calls, ["baseline", "open"]);
  t.mock.timers.tick(4000);
  await new Promise(setImmediate);
  finish();
  await new Promise(setImmediate);
  assert.equal(settled, false);
  finishConsent("confirmed");
  await pending;
  t.mock.timers.tick(4000);
  assert.deepEqual(calls, ["baseline", "open", "confirm"]);
  assert.deepEqual(events, [
    "started",
    "confirmation_baseline_clear",
    "exited_zero",
    "confirmation_confirmed",
    "completed",
  ]);
});

test("unknown baseline prevents launch and a fast launch does not trigger a press", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let launches = 0;
  const calls = [];
  const statuses = [];
  let baseline = "unexpected";
  const execute = createQualificationProcess({
    progress: (_phase, status) => statuses.push(status),
    launchConsent: (mode) => {
      calls.push(mode);
      return baseline;
    },
    execute: async (_command, _args, options) => {
      launches++;
      options.onExit({ code: 0, signal: null });
      return "";
    },
  });
  const args = ["-n", "/synthetic/Situate.app"];
  for (const [result, status] of [
    ["unexpected", "confirmation_baseline_dialog_present"],
    ["query_timeout", "confirmation_baseline_timeout"],
    ["query_failed", "confirmation_baseline_query_failed"],
  ]) {
    baseline = result;
    await assert.rejects(
      execute("open", args, { confirmFirstLaunch: true }),
      (error) =>
        error.qualificationLaunchNotStarted === true &&
        /clear macOS confirmation baseline/.test(error.cause.message),
    );
    assert.ok(statuses.includes(status));
  }
  assert.equal(launches, 0);
  baseline = "absent";
  await execute("open", args, { confirmFirstLaunch: true });
  t.mock.timers.tick(4000);
  assert.deepEqual(calls, ["baseline", "baseline", "baseline", "baseline"]);
  assert.equal(launches, 1);
});

test("process cleanup assertions reject a live process", () => {
  assert.throws(() => assertStopped(process.pid), /remains live/);
});

test("progress failures cannot prevent cleanup commands and remain observable afterward", async () => {
  const progressFailure = new Error("Synthetic progress failure");
  const commands = [];
  const execute = createQualificationProcess({
    getPhase: () => "cleanup",
    progress: () => {
      throw progressFailure;
    },
    execute: async (command) => {
      commands.push(command);
      return "";
    },
  });
  await execute("ps", ["-p", "123"]);
  await execute("hdiutil", ["detach", "/synthetic/mount"]);
  assert.deepEqual(commands, ["ps", "hdiutil"]);
  assert.throws(
    () => execute.assertProgress(),
    (error) => error === progressFailure,
  );
  const nativeFailure = new Error("Synthetic native failure");
  const failed = createQualificationProcess({
    progress: () => {
      throw progressFailure;
    },
    execute: async () => {
      throw nativeFailure;
    },
  });
  await assert.rejects(
    failed("ps", []),
    (error) => error.cause === nativeFailure,
  );
  assert.throws(
    () => failed.assertProgress(),
    (error) => error === progressFailure,
  );
});

test("fixed native policy reports categories, not arguments or stderr", async () => {
  const events = [];
  const budgets = [];
  const original = new Error("private stderr with account paths and UI text");
  const execute = createQualificationProcess({
    progress: (...event) => events.push(event),
    getPhase: () => "install",
    deadline: (ms) => {
      budgets.push(ms);
      return new AbortController().signal;
    },
    execute: async (_command, _args, options) => {
      assert.equal(options.capture, true);
      throw original;
    },
  });
  await assert.rejects(execute("osascript", ["private UI text"]), (error) => {
    assert.equal(error.cause, original);
    assert.equal(
      error.message,
      "Qualification native command accessibility: nonzero",
    );
    return true;
  });
  assert.deepEqual(budgets, [30_000]);
  assert.equal(events[1][2], "accessibility");
  assert.doesNotMatch(JSON.stringify(events), /private|account|stderr/);
  await assert.rejects(
    execute("unknown-secret-command", []),
    /Unsupported qualification native command/,
  );
  assert.equal(qualificationCommandTimeouts.route, 10_000);
  assert.equal(qualificationCommandTimeouts.mount, 120_000);
  assert.equal(qualificationCommandTimeouts.detach, 30_000);
});

test("application launches redirect application streams without losing launcher output", async () => {
  const calls = [];
  const execute = createQualificationProcess({
    execute: async (command, args, options) => {
      calls.push({ command, args, capture: options.capture });
      return "launcher output";
    },
  });
  assert.equal(
    await execute("open", ["-n", "/synthetic/Situate.app"]),
    "launcher output",
  );
  assert.deepEqual(calls, [
    {
      command: "open",
      args: [
        "--stdout",
        "/dev/null",
        "--stderr",
        "/dev/null",
        "-n",
        "/synthetic/Situate.app",
      ],
      capture: true,
    },
  ]);
  assert.equal(qualificationCommandTimeouts.launch, 10_000);
});

test(
  "a launched process cannot hold the bounded launcher's captured streams open",
  { timeout: 10000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "situate-launch-streams-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const ready = join(root, "ready"),
      exited = join(root, "exited"),
      release = join(root, "release");
    const application = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');let ending=false;const stop=()=>{if(ending)return;ending=true;fs.writeFileSync(${JSON.stringify(exited)},'exited');process.exit(0)};setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))stop()},10);setTimeout(stop,5000);`;
    const launcher = `const fs=require('fs');const args=process.argv.slice(1);const stream=(flag,fallback)=>args.includes(flag)?fs.openSync(args[args.indexOf(flag)+1],'w'):fallback;const app=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(application)}],{detached:true,stdio:['ignore',stream('--stdout',1),stream('--stderr',2)]});app.unref();console.log('launcher complete');`;
    const waitForFile = async (file) => {
      for (let i = 0; i < 600 && !existsSync(file); i++)
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
      assert.ok(existsSync(file));
    };
    const execute = createQualificationProcess({
      deadline: () => AbortSignal.timeout(2500),
      execute: (_command, args, options) =>
        run(process.execPath, ["-e", launcher, "--", ...args], options),
    });
    try {
      assert.equal(
        await execute("open", ["-n", "/synthetic/Situate.app"]),
        "launcher complete",
      );
      await waitForFile(ready);
      assert.equal(
        existsSync(exited),
        false,
        "Application must remain alive independently of the completed launcher",
      );
    } finally {
      writeFileSync(release, "release");
      await waitForFile(exited);
    }
  },
);

test("timeouts drain a synthetic owned process before reporting its command", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-bounded-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pidFile = join(root, "pid");
  const events = [];
  const execute = createQualificationProcess({
    deadline: () => AbortSignal.timeout(500),
    getPhase: () => "install",
    progress: (...event) => events.push(event),
    execute: (_command, _args, options) =>
      run(
        process.execPath,
        [
          "-e",
          `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); console.error('private-native-error'); setInterval(()=>{},1000)`,
        ],
        options,
      ),
  });
  await assert.rejects(
    execute("hdiutil", ["attach", "private-path"]),
    (error) => {
      assert.equal(error.qualificationStatus, "timeout");
      assert.equal(error.qualificationCommand, "mount");
      assert.equal(error.uncertain, true);
      assert.doesNotMatch(error.message, /private/);
      return true;
    },
  );
  const pid = Number(readFileSync(pidFile, "utf8"));
  assertStopped(pid);
  assert.equal(events.at(-1)[1], "timeout");
});

test("cancellation drains a synthetic owned native call", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-cancel-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pidFile = join(root, "pid");
  const abort = new AbortController();
  let ready;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const observer = watch(root, () => {
    if (existsSync(pidFile)) ready();
  });
  const deadline = setTimeout(() => {
    abort.abort();
    ready();
  }, 5000);
  t.after(() => {
    observer.close();
    clearTimeout(deadline);
  });
  const execute = createQualificationProcess({
    execute: (_command, _args, options) =>
      run(
        process.execPath,
        [
          "-e",
          `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));setInterval(()=>{},1000)`,
        ],
        options,
      ),
  });
  const pending = assert.rejects(
    execute("osascript", ["private text"], { signal: abort.signal }),
    /accessibility: cancelled/,
  );
  await started;
  abort.abort(new Error("private cancellation"));
  await pending;
  const pid = Number(readFileSync(pidFile, "utf8"));
  assertStopped(pid);
});

test("cleanup commands retain independent deadlines after global cancellation", async () => {
  const abort = new AbortController();
  abort.abort(new Error("private cancellation"));
  const statuses = [];
  let calls = 0;
  const execute = createQualificationProcess({
    progress: (_phase, status) => statuses.push(status),
    getPhase: () => "cleanup",
    execute: async (_command, _args, { signal }) => {
      calls++;
      signal.throwIfAborted();
      return "";
    },
  });
  await assert.rejects(
    execute("osascript", [], { signal: abort.signal }),
    /accessibility: cancelled/,
  );
  await execute("hdiutil", ["detach", "private-path"], { signal: undefined });
  assert.equal(calls, 2);
  assert.deepEqual(statuses, ["started", "cancelled", "started", "completed"]);
});
