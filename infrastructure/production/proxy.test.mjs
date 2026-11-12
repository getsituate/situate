import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { childEnvironment } from "../website/config.mjs";

function fixture(t, { mode = "feeds", failure = "", legacy = true } = {}) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-production-proxy-")),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const base = join(directory, "new");
  const old = join(directory, "old");
  const config = legacy
    ? join(old, "releases/old/Caddyfile")
    : join(base, "edge/Caddyfile");
  const volume = join(directory, "volume");
  const original =
    "import /config/sites/*.caddy\nwww.getsituate.com {\n respond www\n}\ngetsituate.com {\n respond original\n}\n";
  for (const path of [
    base,
    dirname(config),
    join(volume, "sites"),
    join(directory, "bin"),
  ])
    mkdirSync(path, { recursive: true });
  writeFileSync(config, original);
  writeFileSync(
    join(volume, "sites/reboot.caddy"),
    "preview route remains unchanged\n",
  );
  if (
    [
      "pending",
      "deploy.pending",
      "current.next",
      "edge.pending",
      "retirement.pending",
    ].includes(failure)
  )
    writeFileSync(
      join(base, failure === "pending" ? "proxy.pending" : failure),
      "unresolved",
    );
  if (failure === "edge-lock") symlinkSync(config, join(base, "edge.lock"));
  const canonical = readFileSync(
    new URL("./docker/Caddyfile", import.meta.url),
    "utf8",
  );
  writeFileSync(join(base, "Caddyfile"), canonical);
  const script = readFileSync(
    new URL("./configure-proxy.sh", import.meta.url),
    "utf8",
  )
    .replaceAll("/opt/situate-production", base)
    .replaceAll("/opt/getsituate", old);
  writeFileSync(join(base, "configure-proxy.sh"), script);
  const executable = (name, source) =>
    writeFileSync(
      join(directory, "bin", name),
      `#!${process.execPath}\n${source}`,
      { mode: 0o700 },
    );
  executable("flock", "process.exit(0)");
  executable(
    "docker",
    `
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const root = ${JSON.stringify(directory)}, config = ${JSON.stringify(config)}, volume = ${JSON.stringify(volume)}, original = ${JSON.stringify(original)}, failure = ${JSON.stringify(failure)};
const map = value => value.replace(/^getsituate-caddy-1:/, '').replace(/^\\/config(?=\\/|$)/, volume);
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify(args)+'\\n');
const fail = () => process.exit(1);
if (args[0] === 'exec' && args[1] === '-i') {
 if (failure === 'copy') fail();
 fs.writeFileSync(map(args.at(-1)), fs.readFileSync(0), {mode:0o600, flag:'wx'});
 process.exit(0);
}
if (args[0] === 'inspect') { console.log(config); process.exit(0); }
if (args[0] === 'cp') { fs.copyFileSync(map(args[1]), map(args[2])); process.exit(0); }
const command = args[2], rest = args.slice(3);
if (command === 'wget') {
 if (failure === 'metadata' && rest.at(-1).includes('download.json')) fail();
 if (rest.at(-1).includes('/jobs/')) fail();
 process.exit(0);
}
if (command === 'mktemp') { fs.mkdirSync(path.join(volume,'production-stage.TEST')); console.log('/config/production-stage.TEST'); process.exit(0); }
if (command === 'rm') { fs.rmSync(map(rest.at(-1)), {recursive:true,force:true}); process.exit(0); }
if (command === 'caddy') {
 if (rest[0] === 'validate' && rest.includes('/config/production-stage.TEST/Caddyfile')) {
  if (fs.readFileSync(config,'utf8') !== original) throw new Error('live config changed before validation');
  if (failure === 'validation') fail();
 }
 if (rest[0] === 'reload' && ['reload','uncertain'].includes(failure)) {
  const marker = path.join(root,'reload-failed');
  if (!fs.existsSync(marker) || failure === 'uncertain') { fs.writeFileSync(marker,''); fail(); }
 }
 process.exit(0);
}
throw new Error('Unexpected mock docker invocation: '+args.join(' '));
`,
  );
  const result = spawnSync("bash", [join(base, "configure-proxy.sh"), mode], {
    env: {
      ...childEnvironment(),
      PATH: `${join(directory, "bin")}:${process.env.PATH}`,
    },
    encoding: "utf8",
  });
  const calls = existsSync(join(directory, "calls"))
    ? readFileSync(join(directory, "calls"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse)
    : [];
  return { result, base, old, config, original, canonical, calls, volume };
}

test("feed activation preserves the existing apex website, www and preview snippets", (t) => {
  const f = fixture(t);
  assert.equal(f.result.status, 0, f.result.stderr);
  const after = readFileSync(f.config, "utf8");
  assert.ok(after.includes("getsituate.com {\n\thandle /releases/*"));
  assert.ok(after.includes("www.getsituate.com {\n respond www\n}"));
  assert.ok(after.includes(" respond original\n}"));
  assert.equal(
    readFileSync(join(f.volume, "sites/reboot.caddy"), "utf8"),
    "preview route remains unchanged\n",
  );
  assert.equal(existsSync(join(f.base, "proxy.pending")), false);
});

test("website activation installs the canonical complete configuration only after preflight", (t) => {
  const f = fixture(t, { mode: "website" });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(readFileSync(f.config, "utf8"), f.canonical);
  const retirement = spawnSync(
    "python3",
    [
      "-c",
      `import pathlib, sys
scope = {"__name__": "retirement_fixture"}
exec(compile(sys.stdin.read(), "retire-prototype.py", "exec"), scope)
for name, value in ${JSON.stringify({ LEGACY: f.old, PRODUCTION: f.base, DISTRIBUTION: join(f.base, "absent-distribution"), PREVIEW: join(f.base, "absent-preview") })}.items():
    scope[name] = pathlib.Path(value)
scope["pending"]()
`,
    ],
    {
      input: readFileSync(new URL("./retire-prototype.py", import.meta.url)),
      env: childEnvironment(),
      encoding: "utf8",
    },
  );
  assert.equal(retirement.status, 0, retirement.stderr);
  assert.ok(!f.calls.some((args) => args.at(-1)?.includes?.("/jobs/")));
  assert.doesNotMatch(f.canonical, /\/jobs\/|\/go\//);
  assert.match(
    f.canonical,
    /www\.getsituate\.com, reboot\.getsituate\.com \{\s+redir https:\/\/getsituate\.com\{uri\} permanent\s+\}/,
  );
});

for (const failure of [
  "pending",
  "deploy.pending",
  "current.next",
  "edge.pending",
  "retirement.pending",
  "edge-lock",
  "metadata",
  "copy",
  "validation",
]) {
  test(`${failure} blocks cutover without changing live configuration`, (t) => {
    const f = fixture(t, { mode: "website", failure });
    assert.notEqual(f.result.status, 0);
    assert.equal(readFileSync(f.config, "utf8"), f.original);
    assert.ok(!f.calls.some((args) => args.includes("reload")));
    if (
      [
        "pending",
        "deploy.pending",
        "current.next",
        "edge.pending",
        "retirement.pending",
        "edge-lock",
      ].includes(failure)
    )
      assert.equal(f.calls.length, 0);
  });
}

test("production proxy changes work without a prototype directory", (t) => {
  const f = fixture(t, { mode: "website", legacy: false });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(readFileSync(f.config, "utf8"), f.canonical);
  assert.equal(existsSync(f.old), false);
});

test("reload failure restores the prior file and clears only a recovered operation", (t) => {
  const f = fixture(t, { failure: "reload" });
  assert.notEqual(f.result.status, 0);
  assert.equal(readFileSync(f.config, "utf8"), f.original);
  assert.equal(existsSync(join(f.base, "proxy.pending")), false);
  assert.equal(f.calls.filter((args) => args.includes("reload")).length, 2);
});

test("failed proxy recovery retains the marker and reports the uncertain state", (t) => {
  const f = fixture(t, { failure: "uncertain" });
  assert.notEqual(f.result.status, 0);
  assert.equal(existsSync(join(f.base, "proxy.pending")), true);
  assert.match(f.result.stderr, /Proxy recovery failed/);
});

function edgeFixture(
  t,
  { failure = "", legacy = true, relocated = false } = {},
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "situate-edge-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = join(root, "production");
  const edge = join(base, "edge");
  const old = join(root, "old");
  const release = join(
    legacy ? old : base,
    "releases/20260101000000-aaaaaaaaaaaa",
  );
  const config = relocated
    ? join(edge, "Caddyfile")
    : join(
        failure === "unknown-mount" ? join(root, "unknown") : release,
        "Caddyfile",
      );
  const previousCompose = relocated
    ? join(edge, "compose.yaml")
    : join(release, legacy ? "compose.yaml" : "edge-compose.yaml");
  const original =
    "import /config/sites/*.caddy\ngetsituate.com {\n respond original\n}\n";
  const bin = join(root, "bin");
  const volume = join(root, "volume");
  for (const path of [edge, dirname(config), release, bin, volume])
    mkdirSync(path, { recursive: true });
  chmodSync(edge, 0o750);
  writeFileSync(config, original, { mode: 0o600 });
  const compose = readFileSync(
    new URL("./docker/edge-compose.yaml", import.meta.url),
    "utf8",
  );
  writeFileSync(join(release, "edge-compose.yaml"), compose);
  writeFileSync(
    join(release, "edge-snippets.sh"),
    readFileSync(new URL("./edge-snippets.sh", import.meta.url)),
  );
  writeFileSync(previousCompose, "previous proxy definition", { mode: 0o600 });
  chmodSync(previousCompose, 0o600);
  const mounted = join(root, "mount");
  writeFileSync(mounted, config);
  if (
    [
      "edge.pending",
      "retirement.pending",
      "proxy.pending",
      "deploy.pending",
      "current.next",
    ].includes(failure)
  )
    writeFileSync(join(base, failure), "unresolved operation");
  if (failure === "edge-lock") symlinkSync(config, join(base, "edge.lock"));
  if (failure === "missing-compose") rmSync(previousCompose);
  if (failure === "existing-files")
    writeFileSync(join(edge, "Caddyfile"), "unresolved edge file");
  const script = readFileSync(
    new URL("./relocate-edge.sh", import.meta.url),
    "utf8",
  )
    .replaceAll("/opt/situate-production", base)
    .replaceAll("/opt/getsituate", old);
  const scriptPath = join(release, "relocate-edge.sh");
  writeFileSync(scriptPath, script);
  const executable = (name, source) =>
    writeFileSync(join(bin, name), `#!${process.execPath}\n${source}`, {
      mode: 0o700,
    });
  executable("flock", "process.exit(0)");
  executable(
    "readlink",
    "try {console.log(require('fs').realpathSync(process.argv.at(-1)))} catch {process.exit(1)}",
  );
  executable(
    "docker",
    `
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const root = ${JSON.stringify(root)}, edge = ${JSON.stringify(edge)}, mounted = ${JSON.stringify(mounted)}, previous = ${JSON.stringify(config)}, original = ${JSON.stringify(original)}, volume = ${JSON.stringify(volume)}, failure = ${JSON.stringify(failure)};
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify(args)+'\\n');
const map = value => value.replace(/^getsituate-caddy-1:/, '').replace(/^\\/config(?=\\/|$)/, volume);
if (args[0] === 'inspect') {
 if (args.at(-1) === '{{json .}}') console.log(JSON.stringify({State:{Running:true},Config:{Labels:{'com.docker.compose.project':'getsituate','com.docker.compose.service':'caddy'}},Mounts:[{Destination:'/data',Name:failure === 'volume' ? 'unknown' : 'getsituate_caddy_data'},{Destination:'/config',Name:'getsituate_caddy_config'}],NetworkSettings:{Networks:{getsituate_default:{}}}}));
 else console.log(fs.readFileSync(mounted,'utf8'));
 process.exit(0);
}
if (args[0] === 'network' || args[0] === 'volume') process.exit(0);
if (args[0] === 'compose') {
 if (args.includes('up')) {
  const next = args[args.indexOf('-f')+1] === path.join(edge, 'compose.yaml');
  if (next && fs.readFileSync(path.join(edge,'Caddyfile'),'utf8') !== original) throw new Error('routes changed during relocation');
  fs.writeFileSync(mounted, next && failure !== 'wrong-mount' ? path.join(edge,'Caddyfile') : previous);
  if (next && failure === 'signal') process.kill(process.ppid, 'SIGTERM');
  if (failure === 'uncertain' || (next && ['health', 'snippet-restore'].includes(failure))) process.exit(1);
 }
 process.exit(0);
}
if (args[0] === 'cp') { fs.copyFileSync(map(args[1]),map(args[2])); process.exit(0); }
const command = args[2], rest = args.slice(3);
if (command === 'sh') {
 if (rest[1] === 'backup') fs.writeFileSync(map(rest[2]), 'private snippet archive', {mode:0o600});
 if (rest[1] === 'migrate' && failure === 'snippets') process.exit(1);
 if (rest[1] === 'restore' && failure === 'snippet-restore') process.exit(1);
 process.exit(0);
}
if (command === 'mktemp') { fs.mkdirSync(path.join(volume,'edge-stage.TEST')); console.log('/config/edge-stage.TEST'); process.exit(0); }
if (command === 'rm') { fs.rmSync(map(rest.at(-1)),{recursive:true,force:true}); process.exit(0); }
if (command === 'caddy') {
 if (rest.includes('/config/edge-stage.TEST/Caddyfile') && failure === 'validation') process.exit(1);
 process.exit(0);
}
throw new Error('Unexpected Docker call: '+args.join(' '));
`,
  );
  const result = spawnSync(
    "bash",
    ["-c", 'umask 077; exec bash "$1"', "bash", scriptPath],
    {
      env: { ...childEnvironment(), PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    },
  );
  const calls = existsSync(join(root, "calls"))
    ? readFileSync(join(root, "calls"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse)
    : [];
  return {
    result,
    base,
    edge,
    old,
    config,
    original,
    previousCompose,
    calls,
    mounted,
  };
}

for (const legacy of [true, false]) {
  test(`edge relocation preserves routes and recreates only Caddy with legacy=${legacy}`, (t) => {
    const f = edgeFixture(t, { legacy });
    assert.equal(f.result.status, 0, f.result.stderr);
    assert.equal(readFileSync(join(f.edge, "Caddyfile"), "utf8"), f.original);
    assert.equal(readFileSync(f.mounted, "utf8"), join(f.edge, "Caddyfile"));
    assert.equal(readFileSync(f.config, "utf8"), f.original);
    const mode = (path) => statSync(path).mode & 0o777;
    assert.equal(mode(f.edge), 0o750);
    assert.equal(mode(join(f.edge, "Caddyfile")), 0o644);
    assert.equal(mode(join(f.edge, "compose.yaml")), 0o600);
    const backup = readdirSync(f.base).find((name) =>
      name.startsWith("edge-backup."),
    );
    assert.ok(backup);
    assert.equal(mode(join(f.base, backup)), 0o700);
    for (const name of [
      "Caddyfile",
      "previous-compose.yaml",
      "previous-paths",
      "compose.next.yaml",
      "snippets.tar",
    ])
      assert.equal(mode(join(f.base, backup, name)), 0o600, name);
    assert.equal(existsSync(join(f.base, "edge.pending")), false);
    if (!legacy) assert.equal(existsSync(f.old), false);
    const up = f.calls.filter((args) => args.includes("up"));
    assert.equal(up.length, 1);
    assert.equal(up[0].at(-1), "caddy");
    assert.ok(up[0].includes("--no-deps"));
    assert.ok(up[0].includes("never"));
    assert.ok(
      !f.calls.some((args) =>
        args.some((arg) => ["down", "prune", "--remove-orphans"].includes(arg)),
      ),
    );
  });
}

for (const failure of [
  "edge.pending",
  "retirement.pending",
  "proxy.pending",
  "deploy.pending",
  "current.next",
  "edge-lock",
  "missing-compose",
  "existing-files",
  "unknown-mount",
  "volume",
  "validation",
]) {
  test(`${failure} prevents edge recreation`, (t) => {
    const f = edgeFixture(t, { failure });
    assert.notEqual(f.result.status, 0);
    assert.equal(readFileSync(f.mounted, "utf8"), f.config);
    assert.equal(readFileSync(f.config, "utf8"), f.original);
    assert.ok(!f.calls.some((args) => args.includes("up")));
  });
}

for (const failure of ["health", "signal", "wrong-mount", "snippets"]) {
  test(`${failure} restores the previous edge mount and clears only a recovered relocation`, (t) => {
    const f = edgeFixture(t, { failure });
    assert.notEqual(f.result.status, 0);
    assert.equal(readFileSync(f.mounted, "utf8"), f.config);
    assert.equal(existsSync(join(f.base, "edge.pending")), false);
    assert.equal(existsSync(join(f.edge, "Caddyfile")), false);
    assert.equal(existsSync(join(f.edge, "compose.yaml")), false);
    assert.ok(f.calls.some((args) => args.includes("restore")));
    assert.ok(
      f.calls.some(
        (args) => args.includes(f.previousCompose) && args.includes("up"),
      ),
    );
  });
}

for (const failure of ["uncertain", "snippet-restore"]) {
  test(`${failure} recovery retains pending evidence and blocks blind retries`, (t) => {
    const f = edgeFixture(t, { failure });
    assert.notEqual(f.result.status, 0);
    assert.equal(existsSync(join(f.base, "edge.pending")), true);
    assert.match(f.result.stderr, /Edge recovery failed/);
  });
}

test("an already relocated edge is validated without recreating services or requiring the prototype directory", (t) => {
  const f = edgeFixture(t, { legacy: false, relocated: true });
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.ok(!f.calls.some((args) => args.includes("up")));
  assert.equal(existsSync(f.old), false);
});
