import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  windowsJob,
  windowsProbe,
  windowsTestLoaderReport,
} from "./test-windows-host.mjs";
import { prepareDependencies } from "./test.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const client = join(root, "client");
export const windowsTarget = "x86_64-pc-windows-msvc";
const durations = {
  setup: 1200,
  "client-windows-build": 3000,
  "client-windows-workspace": 3000,
};

export function windowsCommands(phase, rust, directory) {
  assert.match(rust, /^\d+\.\d+\.\d+$/);
  const cargo = (...args) => [
    "rustup",
    ["run", rust, "cargo", ...args],
    client,
  ];
  const target = [
    "--target",
    windowsTarget,
    "--target-dir",
    join(directory, "target"),
  ];
  switch (phase) {
    case "setup":
      return [
        [
          "rustup",
          [
            "toolchain",
            "install",
            rust,
            "--profile",
            "minimal",
            "--target",
            windowsTarget,
          ],
          client,
        ],
        cargo("fetch", "--locked", "--target", windowsTarget),
      ];
    case "client-windows-build":
      return [
        ["volta", ["run", "npm", "run", "build"], client],
        [
          process.execPath,
          [
            join(client, "node_modules/@tauri-apps/cli/tauri.js"),
            "build",
            "--no-bundle",
            "--target",
            windowsTarget,
            "--config",
            JSON.stringify({ build: { beforeBuildCommand: "" } }),
            "--",
            "--locked",
          ],
          join(client, "app"),
        ],
      ];
    case "client-windows-workspace":
      return [cargo("test", "--workspace", "--locked", ...target)];
    default:
      throw new Error("Unknown Windows build phase");
  }
}

export function windowsRunner(environment, platform, arch) {
  assert.equal(platform, "win32", "Windows suites require native Windows");
  assert.equal(arch, "x64", "This Windows CI lane requires x64");
  assert.equal(
    environment.PROCESSOR_ARCHITECTURE,
    "AMD64",
    "Native AMD64 runner required",
  );
  assert(
    !environment.PROCESSOR_ARCHITEW6432,
    "An emulated process cannot qualify this lane",
  );
  for (const value of [environment.ImageOS, environment.ImageVersion])
    assert.match(
      value ?? "",
      /^[a-z0-9][a-z0-9._-]{0,79}$/i,
      "Missing hosted runner image identity",
    );
  assert.match(environment.ImageVersion, /^\d+\.\d+\.\d+$/);
  const temporary = environment.RUNNER_TEMP;
  assert.equal(environment.RUNNER_ENVIRONMENT, "github-hosted");
  assert(isAbsolute(temporary ?? ""), "Missing runner temporary directory");
  return {
    directory: join(temporary, "situate-windows-ci"),
    image: environment.ImageOS,
    imageVersion: environment.ImageVersion,
  };
}

const powerShell = () =>
  join(
    process.env.SystemRoot,
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
const psArgs = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
];
function run(command, args, cwd = root, capture = false, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Windows command failed (${result.status}): ${command}`);
  return result.stdout?.trim();
}

async function hash(file) {
  const sha256 = createHash("sha256");
  for await (const chunk of createReadStream(file)) sha256.update(chunk);
  return sha256.digest("hex");
}

async function runPhase(phase, { directory, image, imageVersion }, workspace) {
  const rust = (
    await readFile(join(client, "rust-toolchain.toml"), "utf8")
  ).match(/^\s*channel\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m)?.[1];
  assert(rust, "Missing exact Rust pin");
  if (phase === "setup") {
    const probe = join(workspace, "probe.ps1");
    await writeFile(probe, windowsProbe);
    const tools = JSON.parse(run(powerShell(), [...psArgs, probe], root, true));
    const pins = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ).volta;
    run(process.execPath, [
      "--test",
      "--test-name-pattern=atomic JSON|Windows job object|Windows dependency owner",
      "tools/pipeline-state.test.mjs",
      "tools/test-windows.test.mjs",
    ]);
    assert.equal(process.versions.node, pins.node);
    assert.equal(
      run("volta", ["run", "npm", "--version"], root, true),
      pins.npm,
    );
    const source = run("git", ["rev-parse", "HEAD"], root, true);
    assert.match(source, /^[a-f0-9]{40}$/);
    for (const args of windowsCommands(phase, rust, directory)) run(...args);
    const dependencies = await prepareDependencies("client", { force: true });
    try {
      if (dependencies.failure) throw new Error(dependencies.failure.error);
    } finally {
      dependencies.release();
    }
    const rustc = run("rustup", ["run", rust, "rustc", "-vV"], client, true);
    assert.match(rustc, /^host: x86_64-pc-windows-msvc\r?$/m);
    assert.equal(rustc.match(/^release: ([^\r\n]+)/m)?.[1], rust);
    const identity = {
      source,
      target: windowsTarget,
      runner: { image, imageVersion, ...tools },
      tools: { ...pins, rust },
    };
    await writeFile(
      join(directory, "identity.json"),
      JSON.stringify(identity),
      { flag: "wx" },
    );
    console.log(JSON.stringify({ type: "windows-runner", ...identity }));
    return;
  }
  const identity = JSON.parse(
    await readFile(join(directory, "identity.json"), "utf8"),
  );
  assert.equal(identity.source, run("git", ["rev-parse", "HEAD"], root, true));
  const exe = join(
    directory,
    "target",
    windowsTarget,
    "release",
    "situate-client.exe",
  );
  const artifact = join(directory, "artifact");
  const destination = join(artifact, "situate-client.exe");
  if (phase === "client-windows-build") {
    const [frontend, build] = windowsCommands(phase, rust, directory);
    assert.equal(
      process.env.TAURI_CONFIG,
      undefined,
      "Unexpected inherited Tauri build configuration",
    );
    await mkdir(artifact);
    run(...frontend);
    run(...build, false, {
      ...process.env,
      RUSTUP_TOOLCHAIN: rust,
      CARGO_TARGET_DIR: join(directory, "target"),
    });
    await copyFile(exe, destination);
    const sha256 = await hash(destination);
    await writeFile(
      join(artifact, "manifest.json"),
      `${JSON.stringify({ schemaVersion: 1, ...identity, sha256 }, null, 2)}\n`,
      { flag: "wx" },
    );
    return;
  }
  try {
    for (const args of windowsCommands(phase, rust, directory)) run(...args);
  } catch (error) {
    try {
      const report = join(workspace, "loader-report.ps1");
      await writeFile(report, windowsTestLoaderReport, { flag: "wx" });
      const deps = join(directory, "target", windowsTarget, "debug", "deps");
      const result = spawnSync(powerShell(), [...psArgs, report, deps], {
        stdio: ["ignore", "inherit", "inherit"],
        timeout: 30_000,
      });
      if (result.error || result.status !== 0)
        console.error("Could not collect the Windows loader report.");
    } catch {
      console.error("Could not collect the Windows loader report.");
    }
    throw error;
  }
}

export async function runWindowsJob(script, phase, seconds, workspace) {
  assert.match(phase, /^[a-z][a-z0-9-]*$/);
  const supervisor = join(workspace, "job.ps1");
  await writeFile(supervisor, windowsJob, { flag: "wx" });
  return new Promise((done, reject) => {
    const host = spawn(
      powerShell(),
      [
        ...psArgs,
        supervisor,
        process.execPath,
        script,
        phase,
        String(seconds),
        workspace,
      ],
      { cwd: root, stdio: ["pipe", "inherit", "inherit"] },
    );
    host.once("error", reject);
    host.once("close", done);
  });
}

export async function main([phase, child, workspace, ...rest]) {
  assert(
    Object.hasOwn(durations, phase) && !rest.length,
    "Unknown Windows verification phase",
  );
  const runner = windowsRunner(process.env, process.platform, process.arch);
  if (child === "--child") {
    assert(
      isAbsolute(workspace ?? "") &&
        relative(runner.directory, workspace).startsWith("phase-"),
    );
    return runPhase(phase, runner, workspace);
  }
  assert(child === undefined && workspace === undefined);
  if (phase === "setup") await mkdir(runner.directory);
  workspace = await mkdtemp(join(runner.directory, "phase-"));
  const started = performance.now();
  try {
    const status = await runWindowsJob(
      fileURLToPath(import.meta.url),
      phase,
      durations[phase],
      workspace,
    );
    if (status !== 0)
      throw new Error(
        `${phase} failed${status === 124 ? " (deadline or cancellation)" : ` (${status})`}`,
      );
  } finally {
    await rm(workspace, { recursive: true, force: true, maxRetries: 3 });
    console.log(
      JSON.stringify({
        type: "windows-phase",
        phase,
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
