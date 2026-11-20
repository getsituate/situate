import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prerequisites, prepareLane } from "./pipeline-setup.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
test("portable tools come from the image and native setup contains only Apple-host prerequisites", () => {
  assert.deepEqual(prerequisites({ host: "linux", suites: ["root-secrets"] }), {
    image: true,
    docker: false,
    rust: false,
    coverage: false,
    swift: false,
    native: false,
  });
  const tooling = prerequisites({ host: "macos", suites: ["dev-tui-macos"] });
  assert.equal(tooling.rust, true);
  assert.equal(tooling.swift, false);
  const native = prerequisites({ host: "macos", suites: ["client-native"] });
  assert.equal(native.native, true);
  assert.equal(native.rust, true);
  assert.equal(native.swift, true);
});
test("portable setup cannot fall back to installing tools on the host", async () => {
  await assert.rejects(
    prepareLane(
      { host: "linux", suites: ["root-secrets"] },
      { environment: {} },
    ),
    /tool-container/,
  );
  await assert.rejects(
    prepareLane(
      { host: "macos", suites: ["root-swift"] },
      { platform: "darwin" },
    ),
    /tool image/,
  );
});
test("Docker integration setup checks the host daemon without installing project packages", async () => {
  const calls = [];
  await prepareLane(
    {
      host: "linux",
      execution: "host-docker",
      suites: ["client-docker-context"],
    },
    {
      platform: "linux",
      execute: (...args) => calls.push(args),
    },
  );
  assert.deepEqual(
    calls.map(([command, args]) => [command, args]),
    [
      ["docker", ["info"]],
      ["docker", ["buildx", "version"]],
    ],
  );
});
test("native macOS setup retains pinned Rust and exposes its binary path", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-setup-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const githubPath = join(directory, "path"),
    calls = [];
  await prepareLane(
    { id: "tooling-macos", host: "macos", suites: ["dev-tui-macos"] },
    {
      platform: "darwin",
      environment: { RUNNER_TEMP: directory, GITHUB_PATH: githubPath },
      execute: (...args) => calls.push(args),
    },
  );
  assert.equal(calls.length, 3);
  assert.ok(calls[2][1].includes("fetch"));
  assert.ok(calls[1][1].includes("1.98.1"));
  assert.equal(calls[0][2].env.RUSTUP_AUTO_INSTALL, "0");
  assert.match(readFileSync(githubPath, "utf8"), /situate-tools-.*\/bin/);
  await assert.rejects(
    prepareLane({ host: "macos", suites: [] }, { platform: "linux" }),
    /require macOS/,
  );
});
test("native client setup installs every declared component before Cargo resolution", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-native-setup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  await prepareLane(
    { id: "macos-native", host: "macos", suites: ["client-native"] },
    {
      platform: "darwin",
      environment: { RUNNER_TEMP: directory },
      execute: (...args) => calls.push(args),
    },
  );
  const install = calls[1][1];
  assert.ok(install.includes("install"));
  const declared = JSON.parse(
    readFileSync(join(root, "client/rust-toolchain.toml"), "utf8").match(
      /components\s*=\s*(\[[^\]]*\])/,
    )[1],
  );
  assert.ok(declared.includes("llvm-tools"));
  for (const component of declared)
    assert.ok(
      install.some(
        (arg, index) =>
          arg === "--component" && install[index + 1] === component,
      ),
      component,
    );
  assert.ok(calls[2][1].includes("fetch"));
});

test("native setup reuses only a complete pinned Rust toolchain for the host", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-warm-rust-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const host = process.arch === "arm64" ? "aarch64" : "x86_64";
  const other = host === "aarch64" ? "x86_64" : "aarch64";
  const components = [
    "rustc",
    "cargo",
    "rust-std",
    "rustfmt",
    "clippy",
    "llvm-tools",
  ];
  const installed = components.map((name) => `${name}-${host}-apple-darwin`);
  for (const [inventory, needsInstall] of [
    [installed, false],
    [[...installed.slice(0, -1), `llvm-tools-${other}-apple-darwin`], true],
  ]) {
    const calls = [];
    await prepareLane(
      {
        id: "macos-compatibility",
        host: "macos",
        suites: ["client-native-compatibility"],
      },
      {
        platform: "darwin",
        environment: { RUNNER_TEMP: directory },
        execute: (command, args) => {
          calls.push(args);
          if (command === "rustup") return inventory.join("\n");
        },
      },
    );
    assert.equal(
      calls.some((args) => args.includes("install")),
      needsInstall,
    );
    assert(
      calls.some((args) => args.includes("fetch") && args.includes("--locked")),
    );
  }
});

test("Windows setup rejects other hosts and delegates only to its native setup", async () => {
  const lane = {
    id: "windows-native",
    host: "windows",
    execution: "native",
    suites: ["client-windows-build"],
  };
  const calls = [];
  const execute = (...args) => calls.push(args);
  await assert.rejects(
    prepareLane(lane, { platform: "darwin", execute }),
    /native Windows/,
  );
  assert.equal(calls.length, 0);
  await prepareLane(lane, { platform: "win32", execute, directory: root });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [
    join(root, "tools/test-windows.mjs"),
    "setup",
  ]);
});

test("Python bootstrap verifies archive before installation and invokes Node only through Volta shims", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-bootstrap-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "client/docker"), { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ volta: { node: "24.21.0", npm: "11.19.1" } }),
  );
  const script = `import importlib.util,io,json,hashlib,pathlib,tarfile,types
spec=importlib.util.spec_from_file_location('bootstrap',${JSON.stringify(join(root, "tools/pipeline-bootstrap.py"))}); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=pathlib.Path(${JSON.stringify(directory)}); buffer=io.BytesIO()
with tarfile.open(fileobj=buffer,mode='w:gz') as archive:
 for name in ['volta','volta-shim','volta-migrate']:
  data=b'fixture';member=tarfile.TarInfo(name);member.size=len(data);archive.addfile(member,io.BytesIO(data))
data=buffer.getvalue();(root/'client/docker/ci-volta.json').write_text(json.dumps({'version':'2.0.2','x64':{'url':'https://fixture.invalid/volta','sha256':hashlib.sha256(data).hexdigest()}})); calls=[]
def execute(args,**kwargs):
 calls.append(args);return types.SimpleNamespace(returncode=0,stdout='24.21.0' if args[0].endswith('/node') else '11.19.1' if args[0].endswith('/npm') else '2.0.2')
module.bootstrap(root=root,home=root/'volta',system='Linux',machine='x86_64',fetch=lambda url:data,execute=execute)
assert calls[0]==[str(root/'volta/bin/volta'),'--version']
assert calls[1]==[str(root/'volta/bin/volta'),'install','node@24.21.0','npm@11.19.1']
assert all(args[0].startswith(str(root/'volta/bin/')) for args in calls)
try:module.bootstrap(root=root,home=root/'bad',system='Linux',machine='x86_64',fetch=lambda url:b'bad',execute=execute)
except ValueError:pass
else:raise AssertionError('corrupt archive accepted')
assert not (root/'bad/bin').exists()
`;
  const result = spawnSync("python3", ["-B", "-c", script], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_PATH: "", GITHUB_ENV: "" },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Windows Volta bootstrap validates zip members before extraction and uses cmd shims", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-win-bootstrap-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ volta: { node: "24.21.0", npm: "11.19.1" } }),
  );
  const script = `import hashlib,importlib.util,io,pathlib,types,zipfile
spec=importlib.util.spec_from_file_location('bootstrap',${JSON.stringify(join(root, "tools/pipeline-bootstrap.py"))}); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
root=pathlib.Path(${JSON.stringify(directory)}); calls=[]
assert module.WINDOWS_X64['sha256']=='d7678a485e2fc9b1a3f7e9da256d8b88a97d7e4c45e63701c4874f6c2a587e0f'
def execute(args,**kwargs):
 calls.append(args);return types.SimpleNamespace(stdout={'node':'v24.21.0', 'npm':'11.19.1'}.get(args[3] if len(args)>3 else '', '2.0.2'))
def archive(names):
 buffer=io.BytesIO()
 with zipfile.ZipFile(buffer,'w') as file:
  for name in names: file.writestr(name,b'fixture')
 return buffer.getvalue()
names=['volta.exe','volta-shim.exe','volta-migrate.exe']
for name,data in [('hash',b'wrong digest'),('entries',archive(names+['../unexpected']))]:
 if name=='entries': module.WINDOWS_X64['sha256']=hashlib.sha256(data).hexdigest()
 try: module.bootstrap(root=root,home=root/name,system='Windows',machine='AMD64',fetch=lambda url:data,execute=execute)
 except ValueError: pass
 else: raise AssertionError('invalid Windows archive accepted')
 assert not (root/name).exists()
 assert not calls
data=archive(names);module.WINDOWS_X64['sha256']=hashlib.sha256(data).hexdigest()
module.bootstrap(root=root,home=root/'valid',system='Windows',machine='AMD64',fetch=lambda url:data,execute=execute)
assert calls[0]==[str(root/'valid/bin/volta.exe'),'--version']
assert calls[1]==[str(root/'valid/bin/volta.exe'),'install','node@24.21.0','npm@11.19.1']
assert calls[2:]==[['cmd.exe','/d','/c','node','--version'],['cmd.exe','/d','/c','npm','--version']]
assert (root/'valid/bin/npm.cmd').read_bytes().endswith(b'volta run %~n0 %*\\r\\n')
`;
  const result = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    ["-B", "-c", script],
    {
      encoding: "utf8",
      env: { ...process.env, GITHUB_PATH: "", GITHUB_ENV: "" },
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
