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
import test from "node:test";
import { prerequisites, prepareLane } from "./pipeline-setup.mjs";

const root = new URL("../", import.meta.url).pathname;
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
  assert.equal(calls.length, 2);
  assert.ok(calls[1][1].includes("fetch"));
  assert.ok(calls[0][1].includes("1.98.1"));
  assert.match(readFileSync(githubPath, "utf8"), /situate-tools-.*\/bin/);
  await assert.rejects(
    prepareLane({ host: "macos", suites: [] }, { platform: "linux" }),
    /require macOS/,
  );
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
