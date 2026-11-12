import { test } from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runSmokePhase,
  withSmokeRoot,
  parseSmokeOptions,
} from "./native-smoke-runtime.mjs";

test("diagnostic measurement modes are explicit and cannot replace the default recovery suite implicitly", () => {
  assert.deepEqual(parseSmokeOptions([]), {
    diagnosticsOnly: false,
    profile: undefined,
    release: false,
  });
  assert.deepEqual(parseSmokeOptions(["--diagnostics"]), {
    diagnosticsOnly: true,
    profile: undefined,
    release: false,
  });
  for (const profile of ["disabled", "healthy", "slow", "blocked"])
    assert.deepEqual(parseSmokeOptions(["--diagnostics-profile", profile]), {
      diagnosticsOnly: true,
      profile,
      release: false,
    });
  for (const args of [
    ["--release", "--release"],
    ["--document-sources", "--diagnostics"],
    ["--document-sources", "--document-sources"],
    ["--diagnostics-profile"],
    ["--diagnostics-profile", "unknown"],
    ["--diagnostics", "healthy"],
    ["--diagnostics-profile", "healthy", "extra"],
    ["--diagnostics-profile", "disabled", "--diagnostics"],
  ])
    assert.throws(() => parseSmokeOptions(args), /Usage:/);
});

test("document-source checks are explicit and can use release builds", () => {
  for (const release of [false, true]) {
    assert.deepEqual(
      parseSmokeOptions([
        "--document-sources",
        ...(release ? ["--release"] : []),
      ]),
      {
        diagnosticsOnly: false,
        documentSourcesOnly: true,
        profile: undefined,
        release,
      },
    );
  }
});

test("release builds retain the explicitly selected journey", () => {
  assert.deepEqual(parseSmokeOptions(["--release"]), {
    diagnosticsOnly: false,
    profile: undefined,
    release: true,
  });
  assert.deepEqual(parseSmokeOptions(["--release", "--diagnostics"]), {
    diagnosticsOnly: true,
    profile: undefined,
    release: true,
  });
  assert.deepEqual(
    parseSmokeOptions(["--diagnostics-profile", "healthy", "--release"]),
    { diagnosticsOnly: true, profile: "healthy", release: true },
  );
});

const output = { write() {} };
const report = (value) =>
  `console.log('SITUATE_NATIVE_SMOKE ' + JSON.stringify(${JSON.stringify(value)}));`;
const child = (source, options = {}) =>
  runSmokePhase(process.execPath, {
    args: ["-e", source],
    output,
    desktopIssue: () => null,
    ...options,
  });
const missing = (path) => assert.rejects(access(path), { code: "ENOENT" });

test("an already cancelled phase never probes the desktop or starts an executable", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runSmokePhase("/must-not-launch", {
      signal: controller.signal,
      desktopIssue: () => assert.fail("probed after cancellation"),
      output: { write: () => assert.fail("started after cancellation") },
    }),
    { name: "AbortError" },
  );
});

test("a locked desktop blocks before spawning the native executable", async () => {
  await assert.rejects(
    runSmokePhase(join(tmpdir(), "must-not-launch"), {
      desktopIssue: () => "desktop-session-locked",
      output: {
        write() {
          assert.fail("native phase started");
        },
      },
    }),
    /Native tests blocked: desktop-session-locked/,
  );
});

test("concurrent invocations own distinct roots and retain data across restart phases", async () => {
  const parent = await mkdtemp(join(tmpdir(), "native-smoke-test-"));
  const unrelated = join(parent, "production-data");
  await writeFile(unrelated, "do not change");
  const roots = [];
  try {
    await Promise.all(
      [1, 2].map((index) =>
        withSmokeRoot(async ({ root, env }) => {
          roots.push(root);
          const first = `require('node:fs').writeFileSync(require('node:path').join(process.env.SITUATE_SMOKE_ROOT, 'draft'), '${index}'); ${report({ passed: true, recoveryStaged: true })} setInterval(() => {}, 1000);`;
          await child(first, { env, recovery: true });
          await child(
            `const text = require('node:fs').readFileSync(require('node:path').join(process.env.SITUATE_SMOKE_ROOT, 'draft'), 'utf8'); if (text !== '${index}') process.exit(1); ${report({ passed: true })}`,
            { env },
          );
          assert.equal(
            await readFile(join(root, "draft"), "utf8"),
            String(index),
          );
        }, parent),
      ),
    );
    assert.notEqual(roots[0], roots[1]);
    await Promise.all(roots.map(missing));
    assert.equal(await readFile(unrelated, "utf8"), "do not change");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("smoke roots resolve temporary-directory aliases before native storage access", async () => {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "native-smoke-alias-")),
  );
  const alias = join(parent, "through-link");
  let owned;
  try {
    await symlink(parent, alias, "dir");
    await withSmokeRoot(async ({ root, env }) => {
      owned = root;
      assert.equal(root, await realpath(root));
      assert.equal(env.SITUATE_SMOKE_ROOT, root);
      assert.ok(root.startsWith(parent + "/situate-native-smoke-"));
      assert.equal(
        await readFile(join(root, ".smoke-owner"), "utf8"),
        env.SITUATE_SMOKE_OWNER,
      );
    }, alias);
    await missing(owned);
    await access(alias);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("failed startup and timeout remove only the owned root after the process ends", async () => {
  for (const run of [
    () =>
      runSmokePhase(join(tmpdir(), "missing-native-smoke-executable"), {
        output,
        desktopIssue: () => null,
      }),
    () => child("setInterval(() => {}, 1000)", { timeout: 50 }),
    () => child(report({ passed: false, error: "save failed" })),
  ]) {
    let owned;
    await assert.rejects(
      withSmokeRoot(async ({ root }) => {
        owned = root;
        await run();
      }),
    );
    await missing(owned);
  }
});

test("interruption kills the active process before root cleanup", async () => {
  const controller = new AbortController();
  let owned;
  await assert.rejects(
    withSmokeRoot(async ({ root }) => {
      owned = root;
      await child("console.log('ready'); setInterval(() => {}, 1000)", {
        signal: controller.signal,
        output: {
          write(chunk) {
            if (String(chunk).includes("ready")) controller.abort();
          },
        },
      });
    }),
    /interrupted/,
  );
  await missing(owned);
});

test("recovery requires a durable staging acknowledgement, not just success or process exit", async () => {
  await assert.rejects(child(report({ passed: true }), { recovery: true }));
  await assert.rejects(child("process.exit(0)"));
  await assert.rejects(
    child(
      "console.log('SITUATE_NATIVE_SMOKE not-json'); setInterval(() => {}, 1000)",
    ),
  );
});

test("a failed report identifies the launch phase and preserves chunked progress", async () => {
  await assert.rejects(
    child(
      `process.stdout.write('SITUATE_SMOKE_PRO');
       setImmediate(() => {
         console.log('GRESS {"window":"main","stage":"navigation-finished"}');
         console.log('SITUATE_SMOKE_PROGRESS {"window":"main","stage":"script-evaluated","details":{"ipc":true}}');
         ${report({ passed: false, error: "Native smoke deadline exceeded" })}
       });`,
      { recovery: true },
    ),
    (error) => {
      assert.match(error.message, /Native smoke deadline exceeded/);
      assert.match(error.message, /recovery staging/);
      assert.match(error.message, /navigation-finished/);
      assert.match(error.message, /"ipc":true/);
      return true;
    },
  );
});

test("a focused smoke failure identifies its own phase", async () => {
  await assert.rejects(
    child(report({ passed: false, error: "missing record" }), {
      phase: "diagnostics",
    }),
    /missing record \(diagnostics\)/,
  );
});

test("progress is diagnostic only and retains a bounded recent tail", async () => {
  await assert.rejects(
    child(`for (let i = 0; i < 20; i++) {
      console.log('SITUATE_SMOKE_PROGRESS stage-' + i + ':' + 'x'.repeat(3000));
    }`),
    (error) => {
      assert.match(error.message, /restart verification/);
      assert.doesNotMatch(error.message, /stage-3:/);
      assert.match(error.message, /stage-4:/);
      assert.match(error.message, /stage-19:/);
      assert.ok(error.message.length < 34000);
      return true;
    },
  );
});

test("startup exit without diagnostics is distinguished from a later stall", async () => {
  await assert.rejects(child("process.exit(1)"), /No smoke progress received/);
});

const blockingStage = "plugin-check-block-armed";
const armed = `console.log('SITUATE_SMOKE_PROGRESS ' + JSON.stringify({ stage: '${blockingStage}' }));`;
const blockingOptions = {
  expectedBlockingStage: blockingStage,
  timeout: 10000,
};

test("an armed blocking child survives two seconds and is killed before repair and restart in the same owned root", async () => {
  let owned;
  await withSmokeRoot(async ({ root, env }) => {
    owned = root;
    const started = performance.now();
    await child(
      `require('node:fs').writeFileSync(require('node:path').join(process.env.SITUATE_SMOKE_ROOT, 'blocked-pid'), String(process.pid)); ${armed} setInterval(() => { ${armed} }, 100);`,
      { ...blockingOptions, env },
    );
    assert.ok(performance.now() - started >= 2000);
    const pid = Number(await readFile(join(root, "blocked-pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    await child(
      `require('node:fs').writeFileSync(require('node:path').join(process.env.SITUATE_SMOKE_ROOT, 'repair'), 'repaired'); ${report({ passed: true })}`,
      { env },
    );
    await child(
      `if (require('node:fs').readFileSync(require('node:path').join(process.env.SITUATE_SMOKE_ROOT, 'repair'), 'utf8') !== 'repaired') process.exit(1); ${report({ passed: true })}`,
      { env },
    );
  });
  await missing(owned);
});

test("blocking phases reject ordinary completion before or after arming and never accept early exit", async () => {
  for (const source of [
    report({ passed: true }),
    `${armed} ${report({ passed: true })} setInterval(() => {}, 1000);`,
    `${armed} ${report({ passed: false, error: "view failed" })}`,
    `${armed} console.log('SITUATE_NATIVE_SMOKE not-json'); setInterval(() => {}, 1000);`,
    `${armed} process.stdout.write('SITUATE_NATIVE_SMOKE {"passed":true}');`,
    `${armed} process.exit(0);`,
    `${armed} process.kill(process.pid, 'SIGKILL');`,
  ])
    await assert.rejects(
      child(source, blockingOptions),
      /completed unexpectedly|exited before the owned stop|incomplete report/,
    );
});

test("only the exact structured blocking stage arms the check and the original deadline still applies", async () => {
  for (const progress of [
    "",
    "plugin-check-block-armed",
    '{"stage":"plugin-check-block-armed-extra"}',
    '{"other":"plugin-check-block-armed"}',
  ])
    await assert.rejects(
      child(
        `console.log('SITUATE_SMOKE_PROGRESS ' + ${JSON.stringify(progress)}); setInterval(() => {}, 1000);`,
        { ...blockingOptions, timeout: 150 },
      ),
      /timed out/,
    );
  await assert.rejects(
    child(`${armed} setInterval(() => {}, 1000);`, {
      ...blockingOptions,
      timeout: 150,
    }),
    /timed out/,
  );
});

test("cancelling an armed blocking phase fails rather than counting the interruption as the expected kill", async () => {
  const controller = new AbortController();
  await assert.rejects(
    child(`${armed} setInterval(() => {}, 1000);`, {
      ...blockingOptions,
      signal: controller.signal,
      output: {
        write(chunk) {
          if (String(chunk).includes(blockingStage))
            setImmediate(() => controller.abort());
        },
      },
    }),
    /interrupted/,
  );
});

test("blocking phase state cannot authorize a later phase or change ordinary report requirements", async () => {
  await assert.rejects(child(`${armed} process.exit(0);`, blockingOptions));
  await assert.rejects(
    child("setInterval(() => {}, 1000)", { ...blockingOptions, timeout: 100 }),
    /No smoke progress received/,
  );
  await assert.rejects(
    child(`${armed} setInterval(() => {}, 1000);`, { timeout: 150 }),
    /timed out/,
  );
  await child(report({ passed: true }));
  await assert.rejects(
    child(report({ passed: false, error: "repair failed" })),
    /repair failed/,
  );
  await assert.rejects(
    child(report({ passed: true }), { ...blockingOptions, recovery: true }),
    /configuration/,
  );
});

test("cleanup refuses a changed ownership marker", async () => {
  let owned;
  try {
    await assert.rejects(
      withSmokeRoot(async ({ root }) => {
        owned = root;
        await writeFile(join(root, ".smoke-owner"), "different owner");
      }),
      /unowned/,
    );
    assert.equal(
      await readFile(join(owned, ".smoke-owner"), "utf8"),
      "different owner",
    );
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
});

test("a cleanup refusal preserves the original execution failure", async () => {
  const original = new Error("Fixture execution failed");
  let owned;
  try {
    await assert.rejects(
      withSmokeRoot(async ({ root }) => {
        owned = root;
        await writeFile(join(root, ".smoke-owner"), "different owner");
        throw original;
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], original);
        assert.match(error.errors[1].message, /unowned/);
        return true;
      },
    );
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
});
