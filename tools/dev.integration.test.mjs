import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const supported = process.platform === "darwin" || process.platform === "linux";

function fixture(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "situate dev launcher-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ["tools/dev-tui", "nested/directory", "bin"])
    mkdirSync(join(root, path), { recursive: true });
  copyFileSync(
    new URL("./dev.mjs", import.meta.url),
    join(root, "tools/dev.mjs"),
  );
  copyFileSync(
    new URL("../package.json", import.meta.url),
    join(root, "package.json"),
  );
  copyFileSync(new URL("../dev.sh", import.meta.url), join(root, "dev.sh"));
  writeFileSync(
    join(root, "bin/cargo"),
    `#!${process.execPath}
console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), pid: process.pid }));
if (process.env.HOLD === "1") setInterval(() => {}, 1000);
else process.exit(17);
`,
    { mode: 0o755 },
  );
  return {
    root,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` },
  };
}

function launch(t, command, args, options) {
  const child = spawn(command, args, options);
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  const closed = once(child, "close");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, closed, output: () => ({ stdout, stderr }) };
}

test(
  "root npm dev runs locked Cargo in the independent crate and preserves failure",
  { skip: !supported, timeout: 10000 },
  async (t) => {
    const { root, env } = fixture(t);
    const run = launch(t, "npm", ["run", "dev"], { cwd: root, env });
    assert.deepEqual(await run.closed, [17, null], run.output().stderr);
    const line = run
      .output()
      .stdout.split("\n")
      .find((line) => line.startsWith("{"));
    const invocation = JSON.parse(line);
    assert.equal(invocation.cwd, join(root, "tools/dev-tui"));
    assert.deepEqual(invocation.args, [
      "run",
      "--locked",
      "--manifest-path",
      "Cargo.toml",
    ]);
  },
);

test(
  "executable root script resolves a checkout with spaces from another directory",
  { skip: !supported, timeout: 10000 },
  async (t) => {
    const { root, env } = fixture(t);
    const run = launch(t, join(root, "dev.sh"), [], {
      cwd: join(root, "nested/directory"),
      env,
    });
    assert.deepEqual(await run.closed, [17, null], run.output().stderr);
    const invocation = JSON.parse(run.output().stdout);
    assert.equal(invocation.cwd, join(root, "tools/dev-tui"));
    assert.deepEqual(invocation.args, [
      "run",
      "--locked",
      "--manifest-path",
      "Cargo.toml",
    ]);
  },
);

test(
  "local terminal startup requires no Actions environment or release arguments",
  { skip: !supported, timeout: 10000 },
  async (t) => {
    const { root, env } = fixture(t);
    const localEnv = Object.fromEntries(
      Object.entries(env).filter(
        ([name]) => !name.startsWith("GITHUB_") && !name.startsWith("ACTIONS_"),
      ),
    );
    const run = launch(t, process.execPath, [join(root, "tools/dev.mjs")], {
      cwd: root,
      env: localEnv,
    });
    assert.deepEqual(await run.closed, [17, null], run.output().stderr);
    const invocation = JSON.parse(run.output().stdout);
    assert.deepEqual(invocation.args, [
      "run",
      "--locked",
      "--manifest-path",
      "Cargo.toml",
    ]);
  },
);

for (const launcher of ["node", "script"]) {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    test(
      `${launcher} launcher from a subdirectory preserves PID and ${signal}`,
      { skip: !supported, timeout: 10000 },
      async (t) => {
        const { root, env } = fixture(t);
        const run = launch(
          t,
          launcher === "node" ? process.execPath : join(root, "dev.sh"),
          launcher === "node" ? [join(root, "tools/dev.mjs")] : [],
          {
            cwd: join(root, "nested/directory"),
            env: { ...env, HOLD: "1" },
          },
        );
        let line = "";
        for await (const chunk of run.child.stdout) {
          line += chunk;
          if (line.includes("\n")) break;
        }
        const invocation = JSON.parse(line);
        assert.equal(invocation.pid, run.child.pid);
        assert.equal(invocation.cwd, join(root, "tools/dev-tui"));
        run.child.kill(signal);
        assert.deepEqual(await run.closed, [null, signal], run.output().stderr);
      },
    );
  }
}
