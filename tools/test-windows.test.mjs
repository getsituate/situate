import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runWindowsJob,
  windowsCommands,
  windowsRunner,
  windowsTarget,
} from "./test-windows.mjs";
import { dependencyOwnerBirth } from "./test.mjs";

const native = { skip: process.platform !== "win32" || process.arch !== "x64" };

test(
  "Windows dependency owner has a stable process birth identity",
  native,
  () => {
    const birth = dependencyOwnerBirth(process.pid);
    assert.match(birth ?? "", /^\d+$/);
    assert.equal(dependencyOwnerBirth(process.pid), birth);
  },
);

test(
  "Windows job object drains its child tree after success and deadline",
  { ...native, timeout: 60_000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "windows job fixture "));
    t.after(() => rm(root, { recursive: true, force: true }));
    const script = join(root, "phase.mjs");
    await writeFile(
      script,
      `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'});
await once(child, 'spawn');
writeFileSync(join(process.argv[4], 'pid'), String(child.pid));
if (process.argv[2] === 'deadline') await new Promise(() => {});
child.unref();
`,
    );
    for (const phase of ["success", "deadline"]) {
      const workspace = await mkdtemp(join(root, `${phase}-`));
      assert.equal(
        await runWindowsJob(script, phase, 4, workspace),
        phase === "success" ? 0 : 124,
      );
      const pid = Number(await readFile(join(workspace, "pid"), "utf8"));
      assert.equal(dependencyOwnerBirth(pid), undefined);
    }
  },
);

test("Windows runs the full locked client workspace on the native MSVC target", () => {
  const temporary = join(tmpdir(), "windows-ci fixture");
  const [workspace] = windowsCommands(
    "client-windows-workspace",
    "1.98.1",
    temporary,
  );
  assert.deepEqual(workspace[1], [
    "run",
    "1.98.1",
    "cargo",
    "test",
    "--workspace",
    "--locked",
    "--no-fail-fast",
    "--target",
    windowsTarget,
    "--target-dir",
    join(temporary, "target"),
  ]);
  const [frontend, [node, [cli, ...flags], cwd]] = windowsCommands(
    "client-windows-build",
    "1.98.1",
    temporary,
  );
  assert.deepEqual(frontend, [
    "volta",
    ["run", "npm", "run", "build"],
    join(cwd, ".."),
  ]);
  assert.equal(node, process.execPath);
  assert.equal(cli, join(cwd, "../node_modules/@tauri-apps/cli/tauri.js"));
  assert.deepEqual(flags, [
    "build",
    "--no-bundle",
    "--target",
    windowsTarget,
    "--config",
    '{"build":{"beforeBuildCommand":""}}',
    "--",
    "--locked",
  ]);
});

test("Windows CI requires the measured hosted x64 environment", () => {
  const environment = {
    PROCESSOR_ARCHITECTURE: "AMD64",
    ImageOS: "win25",
    ImageVersion: "20261103.298.1",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_TEMP: tmpdir(),
  };
  assert.deepEqual(windowsRunner(environment, "win32", "x64"), {
    directory: join(tmpdir(), "situate-windows-ci"),
    image: environment.ImageOS,
    imageVersion: environment.ImageVersion,
  });
  for (const patch of [
    { ImageOS: undefined },
    { ImageVersion: "latest" },
    { RUNNER_ENVIRONMENT: "self-hosted" },
    { PROCESSOR_ARCHITEW6432: "ARM64" },
  ])
    assert.throws(() =>
      windowsRunner({ ...environment, ...patch }, "win32", "x64"),
    );
  assert.throws(() => windowsRunner(environment, "linux", "x64"));
  assert.throws(() => windowsRunner(environment, "win32", "arm64"));
});
