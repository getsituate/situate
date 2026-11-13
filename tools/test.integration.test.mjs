import test from "node:test";
import { suiteAvailable } from "./test-scope.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPlan,
  executeSuite,
  runPlan,
  dependencyLockPath,
  prepareDependencies,
} from "./test.mjs";

test("CLI plans identify supported suites and optional diagnostics in JSON and text", () => {
  const run = (...args) => {
    const result = spawnSync(
      process.execPath,
      ["tools/test.mjs", "--list", ...args],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_TEST_CONTEXT: "" },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const plan = JSON.parse(run("--json"));
  assert.equal(plan.status, "planned");
  assert.equal(plan.scope, "supported");
  assert.equal(plan.profile, "supported");
  assert.ok(plan.deferredSuiteIds.includes("client-visual"));
  assert.ok(!plan.suites.some((suite) => suite.id === "client-visual"));
  const text = run();
  assert.match(text, /supported scope, supported profile/);
  assert.match(text, /Not selected: .*client-visual/);
  const extended = JSON.parse(run("--extended", "--json"));
  assert.equal(extended.scope, "extended");
  assert.equal(extended.profile, "all");
  assert.ok(extended.deferredSuiteIds.every((id) => !suiteAvailable({ id })));
  assert.ok(extended.suites.some((suite) => suite.id === "client-visual"));
  assert.match(
    run("--extended", "--feedback"),
    /extended scope, feedback profile/,
  );
  assert.doesNotMatch(run("--extended"), /MVP/);
});

test(
  "separate runners install a fresh locked workspace once and execute every selected suite",
  { timeout: 30000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "situate-npm-process-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const put = (file, content) => {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), content);
    };
    const devDependencies = {};
    const packages = {};
    for (const [name, folder, entry] of [
      ["vite", "vite", "bin/vite.js"],
      ["@playwright/test", "playwright", "cli.js"],
      ["yaml", "yaml", "index.js"],
      ["marked", "marked", "index.js"],
      ["dompurify", "dompurify", "index.js"],
    ]) {
      devDependencies[name] = `file:../packages/${folder}`;
      packages[`../packages/${folder}`] = { name, version: "1.0.0", dev: true };
      packages[`node_modules/${name}`] = {
        resolved: `../packages/${folder}`,
        link: true,
      };
      put(
        `packages/${folder}/package.json`,
        JSON.stringify({ name, version: "1.0.0" }),
      );
      put(
        `packages/${folder}/${entry}`,
        'console.log("fixture tool executed");',
      );
    }
    put(
      "requirements/package.json",
      JSON.stringify({
        name: "fixture",
        private: true,
        devDependencies,
      }),
    );
    put(
      "requirements/package-lock.json",
      JSON.stringify({
        name: "fixture",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "fixture", devDependencies }, ...packages },
      }),
    );
    const lockfile = readFileSync(
      join(directory, "requirements/package-lock.json"),
      "utf8",
    );
    const lock = dependencyLockPath(directory, "requirements");
    t.after(() => rmSync(lock, { recursive: true, force: true }));
    const source = `import { runPlan } from ${JSON.stringify(new URL("./test.mjs", import.meta.url).href)};
    const report = await runPlan({ suites: [{ id: 'fixture', project: 'requirements', kind: 'check', npm: 'requirements', cwd: 'requirements', command: process.execPath, args: ['node_modules/vite/bin/vite.js'] }] }, { directory: ${JSON.stringify(directory)}, timeout: 20 });
    console.log(JSON.stringify(report)); process.exitCode = report.status === 'passed' ? 0 : 1;`;
    const run = () =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--input-type=module", "-e", source],
          {
            env: {
              ...process.env,
              npm_config_offline: "true",
              NODE_ENV: "production",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      });
    const results = await Promise.all([run(), run()]);
    for (const result of results) {
      assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
      assert.equal(JSON.parse(result.stdout).results[0].status, "passed");
      assert.match(result.stderr, /fixture tool executed/);
    }
    assert.equal(
      results.filter((result) =>
        result.stderr.includes("Installing missing npm dependencies"),
      ).length,
      1,
    );
    const warm = await run();
    assert.equal(warm.code, 0, `${warm.stderr}\n${warm.stdout}`);
    assert.doesNotMatch(warm.stderr, /Installing missing npm dependencies/);
    assert.equal(
      readFileSync(join(directory, "requirements/package-lock.json"), "utf8"),
      lockfile,
    );
    assert.equal(existsSync(lock), false);
  },
);

test("root quality checks bootstrap locked local tools without changing the lockfile", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-root-npm-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const put = (file, content) => {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), content);
  };
  const devDependencies = {};
  const packages = {};
  for (const [name, entry] of [
    ["eslint", "bin/eslint.js"],
    ["prettier", "bin/prettier.cjs"],
    ["marked", "lib/marked.esm.js"],
  ]) {
    devDependencies[name] = `file:packages/${name}`;
    packages[`packages/${name}`] = { name, version: "1.0.0", dev: true };
    packages[`node_modules/${name}`] = {
      resolved: `packages/${name}`,
      link: true,
    };
    put(
      `packages/${name}/package.json`,
      JSON.stringify({ name, version: "1.0.0" }),
    );
    put(`packages/${name}/${entry}`, `console.log('${name} executed');`);
  }
  put(
    "package.json",
    JSON.stringify({
      name: "fixture",
      private: true,
      devDependencies,
      scripts: {
        lint: "node node_modules/eslint/bin/eslint.js",
        "format:check": "node node_modules/prettier/bin/prettier.cjs",
      },
    }),
  );
  const lockfile = JSON.stringify({
    name: "fixture",
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "fixture", devDependencies }, ...packages },
  });
  put("package-lock.json", lockfile);
  let output = "";
  const suites = createPlan({ feedback: true }).suites.filter(
    (s) => s.npm === "." && s.kind === "check",
  );
  assert.equal(suites.length, 2);
  const options = {
    directory,
    timeout: 20,
    environment: {
      ...process.env,
      npm_config_offline: "true",
      NODE_ENV: "production",
    },
    output: new Writable({
      write(chunk, _encoding, done) {
        output += chunk;
        done();
      },
    }),
  };
  const plan = { profile: "feedback", suites };
  assert.equal((await runPlan(plan, options)).status, "passed", output);
  assert.match(output, /Installing missing npm dependencies/);
  assert.match(output, /eslint executed/);
  assert.match(output, /prettier executed/);
  output = "";
  assert.equal((await runPlan(plan, options)).status, "passed", output);
  assert.doesNotMatch(output, /Installing missing npm dependencies/);
  assert.equal(
    readFileSync(join(directory, "package-lock.json"), "utf8"),
    lockfile,
  );
  assert.equal(existsSync(dependencyLockPath(directory, ".")), false);
});

test(
  "feedback subprocesses overlap and preserve individual failures",
  { timeout: 15000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "situate-parallel-process-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const suites = ["root-lint", "root-format"].map((id, index) => ({
      id,
      project: "runner",
      kind: "check",
      cwd: ".",
      command: process.execPath,
      args: [
        "-e",
        `const fs = require('node:fs');
      fs.writeFileSync('${index}.ready', 'ready');
      const timer = setInterval(() => {
        if (fs.existsSync('${1 - index}.ready')) { clearInterval(timer); process.exitCode = ${index === 0 ? 7 : 0}; }
      }, 10);`,
      ],
    }));
    const report = await runPlan(
      { profile: "feedback", suites },
      {
        directory,
        timeout: 5,
        output: new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        }),
      },
    );
    assert.equal(report.status, "failed");
    assert.deepEqual(
      report.results.map((r) => [r.id, r.status, r.exitCode]),
      [
        ["root-lint", "failed", 7],
        ["root-format", "passed", 0],
      ],
    );
  },
);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-suite-process-"));
  const pidFile = join(directory, "child.pid");
  let owner;
  t.after(async () => {
    if (owner && birthTime(owner.pid) === owner.born) {
      try {
        process.kill(owner.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      for (let i = 0; i < 100 && running(owner.pid); i++) await delay(10);
      assert.equal(
        running(owner.pid),
        false,
        "Fixture process must stop before cleanup",
      );
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const leaf = `process.on('SIGTERM',()=>{}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); setInterval(()=>{},1000);`;
  const start = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(leaf)}],{detached:true,stdio:['ignore',1,2]}).unref();`;
  const suite = (code) => ({
    id: "process-fixture",
    project: "runner",
    kind: "integration",
    cwd: ".",
    command: process.execPath,
    args: ["-e", code],
  });
  const childReady = async () => {
    const pid = await ready(pidFile);
    const born = birthTime(pid);
    assert.ok(born);
    owner = { pid, born };
    return pid;
  };
  return {
    directory,
    childReady,
    start,
    suite,
    output: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  };
}

async function ready(file) {
  for (let i = 0; i < 200; i++) {
    if (existsSync(file)) {
      const content = readFileSync(file, "utf8");
      if (/^[1-9]\d*$/.test(content)) return Number(content);
    }
    await delay(10);
  }
  assert.fail("Child must publish a complete PID before reporting readiness");
}

function birthTime(pid) {
  try {
    return (
      execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function running(pid) {
  try {
    process.kill(pid, 0);
    return !execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
    })
      .trim()
      .startsWith("Z");
  } catch {
    return false;
  }
}

test(
  "cancellation terminates detached descendants and preserves a final result",
  { skip: process.platform === "win32", timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    const controller = new AbortController();
    t.after(() => controller.abort());
    const pending = runPlan(
      {
        suites: [
          f.suite(`${f.start}setInterval(()=>{},1000);`),
          f.suite("process.exit(0)"),
        ],
      },
      {
        signal: controller.signal,
        output: f.output,
        timeout: 5,
      },
    );
    const pid = await f.childReady();
    controller.abort();
    const report = await pending;
    assert.equal(report.status, "cancelled");
    assert.deepEqual(
      report.results.map((result) => result.status),
      ["cancelled", "not-run"],
    );
    for (let i = 0; i < 100 && running(pid); i++) await delay(10);
    assert.equal(running(pid), false);
  },
);

test(
  "installer cancellation waits for descendants with closed output before releasing the lock",
  { skip: process.platform === "win32", timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    mkdirSync(join(f.directory, "client"));
    writeFileSync(join(f.directory, "client/package-lock.json"), "{}");
    const lock = dependencyLockPath(f.directory, "client");
    t.after(() => rmSync(lock, { recursive: true, force: true }));
    const controller = new AbortController();
    t.after(() => controller.abort());
    const pending = prepareDependencies("client", {
      directory: f.directory,
      signal: controller.signal,
      output: f.output,
      install: (_suite, options) =>
        executeSuite(
          f.suite(
            `${f.start.replace("stdio:['ignore',1,2]", "stdio:'ignore'")}setInterval(()=>{},1000);`,
          ),
          options,
        ),
    });
    const pid = await f.childReady();
    assert.ok(existsSync(lock));
    controller.abort();
    const dependencies = await pending;
    assert.equal(dependencies.failure.status, "cancelled");
    assert.equal(dependencies.failure.cleanupIncomplete, undefined);
    assert.equal(running(pid), false);
    assert.ok(existsSync(lock));
    dependencies.release();
    assert.equal(existsSync(lock), false);
  },
);

test(
  "a killed lock owner is diagnosed without admitting another installer",
  { skip: process.platform === "win32", timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    mkdirSync(join(f.directory, "client"));
    const lock = dependencyLockPath(f.directory, "client");
    t.after(() => rmSync(lock, { recursive: true, force: true }));
    const source = `import {prepareDependencies} from ${JSON.stringify(new URL("./test.mjs", import.meta.url).href)};
      import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);
      await prepareDependencies('client', { directory: ${JSON.stringify(f.directory)}, install: async () => { ${f.start} setInterval(()=>{},1000); await new Promise(()=>{}); } });`;
    writeFileSync(join(f.directory, "client/package-lock.json"), "{}");
    const owner = spawn(
      process.execPath,
      ["--input-type=module", "-e", source],
      { stdio: "ignore" },
    );
    const closed = new Promise((resolve) => {
      owner.once("close", resolve);
    });
    t.after(async () => {
      owner.kill("SIGKILL");
      await closed;
    });
    const pid = await f.childReady();
    const metadata = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
    assert.equal(metadata.pid, owner.pid);
    owner.kill("SIGKILL");
    await closed;
    assert.equal(running(pid), true);
    await assert.rejects(
      prepareDependencies("client", {
        directory: f.directory,
        timeout: 2,
        output: f.output,
        install: async () =>
          assert.fail("must not install while descendants survive"),
      }),
      /Dependency lock owner is no longer running/,
    );
    assert.ok(existsSync(lock));
  },
);

test(
  "an orphan retaining output pipes cannot hang the runner after its deadline",
  { skip: process.platform === "win32", timeout: 12000 },
  async (t) => {
    const f = fixture(t);
    const started = performance.now();
    const pending = executeSuite(f.suite(`${f.start}process.exit(0);`), {
      output: f.output,
      timeout: 1,
    });
    await f.childReady();
    const result = await pending;
    assert.equal(result.status, "timed-out");
    assert.match(result.error, /output did not close/);
    assert.equal(result.cleanupIncomplete, true);
    assert.ok(performance.now() - started < 8000);
  },
);
