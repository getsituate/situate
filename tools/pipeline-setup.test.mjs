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

function pythonBootstrap(script, ...args) {
  const loader = `import runpy, sys
bootstrap = runpy.run_path(sys.argv[1])
`;
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      loader + script,
      join(root, "tools/pipeline-bootstrap.py"),
      ...args,
    ],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.equal(result.status, 0, result.stderr);
}

test("Python bootstrap installs only the pinned Volta executables before calling their shims", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-bootstrap-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "client/docker"), { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ volta: { node: "24.21.0", npm: "11.19.1" } }),
  );
  pythonBootstrap(
    `import hashlib, io, json, pathlib, stat, tarfile, types
root = pathlib.Path(sys.argv[2])
names = ('volta', 'volta-shim', 'volta-migrate')

def archive(entries):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as source:
        for name, kind in entries:
            member = tarfile.TarInfo(name)
            member.type = kind
            contents = name.encode() if kind == tarfile.REGTYPE else b''
            member.size = len(contents)
            source.addfile(member, io.BytesIO(contents))
    return buffer.getvalue()

def pin(data):
    (root / 'client/docker/ci-volta.json').write_text(json.dumps({
        'version': '2.0.2',
        'x64': {'url': 'https://fixture.invalid/volta', 'sha256': hashlib.sha256(data).hexdigest()},
    }))

calls = []
def execute(args, **kwargs):
    calls.append(args)
    version = {'node': 'v24.21.0', 'npm': '11.19.1'}.get(pathlib.Path(args[0]).name, '2.0.2')
    return types.SimpleNamespace(returncode=0, stdout=version)

def install(data, home):
    def fetch(url):
        assert url == 'https://fixture.invalid/volta'
        return data
    bootstrap['bootstrap'](root=root, home=home, system='Linux', machine='x86_64', fetch=fetch, execute=execute)

entries = [(name, tarfile.REGTYPE) for name in names]
data = archive(entries)
pin(data)
home = root / 'volta'
install(data, home)
bin_dir = home / 'bin'
assert {path.name for path in bin_dir.iterdir()} == set(names)
for name in names:
    assert (bin_dir / name).read_bytes() == name.encode()
    assert stat.S_IMODE((bin_dir / name).stat().st_mode) == 0o755
assert calls == [
    [str(bin_dir / 'volta'), '--version'],
    [str(bin_dir / 'volta'), 'install', 'node@24.21.0', 'npm@11.19.1'],
    [str(bin_dir / 'node'), '--version'],
    [str(bin_dir / 'npm'), '--version'],
]
calls.clear()
bad = root / 'rejected'
for fixture, message in [
    (b'not the pinned archive', 'digest mismatch'),
    (archive(entries[:-1]), 'archive contents'),
    (archive(entries + [entries[0]]), 'archive contents'),
    (archive(entries[:-1] + [('volta-migrate', tarfile.DIRTYPE)]), 'archive contents'),
]:
    if message == 'archive contents':
        pin(fixture)
    try:
        install(fixture, bad)
    except ValueError as error:
        assert message in str(error), error
    else:
        raise AssertionError('Unexpected archive accepted')
    assert not bad.exists()
assert not calls

pin(data)
blocked = bad / 'bin/volta-migrate'
blocked.mkdir(parents=True)
try:
    install(data, bad)
except ValueError as error:
    assert 'non-regular bootstrap binary destination' in str(error)
else:
    raise AssertionError('Non-regular binary destination accepted')
assert list(blocked.parent.iterdir()) == [blocked]
assert not calls
`,
    directory,
  );
});

test("Python bootstrap downloads require HTTPS at the initial URL and redirects", () => {
  pythonBootstrap(`import io, urllib.request
from unittest.mock import patch

with patch.object(urllib.request, 'build_opener') as build:
    try:
        bootstrap['download']('http://fixture.invalid/volta')
    except ValueError as error:
        assert 'require HTTPS' in str(error)
    else:
        raise AssertionError('Non-HTTPS download accepted')
    build.assert_not_called()
    build.return_value.open.return_value = io.BytesIO(b'fixture')
    origin = 'https://fixture.invalid/volta'
    assert bootstrap['download'](origin) == b'fixture'
    build.return_value.open.assert_called_once_with(origin, timeout=120)
    handler, = build.call_args.args
    request = urllib.request.Request(origin)
    secure = 'https://cdn.fixture.invalid/volta'
    assert handler.redirect_request(request, None, 302, 'Found', {}, secure).full_url == secure
    try:
        handler.redirect_request(request, None, 302, 'Found', {}, 'http://cdn.fixture.invalid/volta')
    except ValueError as error:
        assert 'require HTTPS' in str(error)
    else:
        raise AssertionError('Non-HTTPS redirect accepted')
`);
});
