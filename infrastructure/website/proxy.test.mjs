import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { childEnvironment } from "./config.mjs";

function fixture(
  t,
  failure = "",
  existing = true,
  imported = false,
  legacy = true,
) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "situate-proxy-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const base = join(directory, "preview");
  const production = join(directory, "production");
  const old = join(directory, "old");
  const config = legacy
    ? join(old, "releases", "old", "Caddyfile")
    : join(production, "edge", "Caddyfile");
  const volume = join(directory, "volume");
  const route = join(volume, "sites", "reboot.caddy");
  const original =
    "getsituate.example {\n respond ok\n}\n" +
    (imported ? "\nimport /config/sites/*.caddy\n" : "");
  for (const path of [
    base,
    production,
    dirname(config),
    join(volume, "sites"),
    join(directory, "bin"),
  ])
    mkdirSync(path, { recursive: true });
  writeFileSync(config, original, { mode: 0o644 });
  if (failure === "pending")
    writeFileSync(join(base, "proxy.pending"), "existing backup");
  if (failure === "retirement.pending")
    writeFileSync(
      join(production, "retirement.pending"),
      "uncertain retirement",
    );
  if (failure === "edge.pending")
    writeFileSync(join(production, "edge.pending"), "existing edge backup");
  if (failure === "edge-lock")
    symlinkSync(config, join(production, "edge.lock"));
  if (failure === "next") writeFileSync(route + ".next", "unresolved route");
  if (existing) writeFileSync(route, "old preview route\n", { mode: 0o600 });
  writeFileSync(join(volume, "sites", "other.caddy"), "unrelated route\n", {
    mode: 0o600,
  });
  const script = readFileSync(
    new URL("./configure-proxy.sh", import.meta.url),
    "utf8",
  )
    .replaceAll("/opt/situate-reboot", base)
    .replaceAll("/opt/situate-production", production)
    .replaceAll("/opt/getsituate", old);
  writeFileSync(join(base, "configure-proxy.sh"), script);
  writeFileSync(join(base, "reboot.caddy"), "new preview route\n", {
    mode: 0o600,
  });
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
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const root = ${JSON.stringify(directory)};
const config = ${JSON.stringify(config)};
const volume = ${JSON.stringify(volume)};
const failure = ${JSON.stringify(failure)};
const original = ${JSON.stringify(original)};
const map = value => value.replace(/^getsituate-caddy-1:/, '').replace(/^\\/config(?=\\/|$)/, volume);
const fail = message => { console.error(message); process.exit(1); };
fs.appendFileSync(path.join(root, 'calls'), JSON.stringify(args) + '\\n');
if (args[0] === 'exec' && args[1] === '-i') {
 const destination = args.at(-1);
 if ((failure === 'copy-stage' && destination.includes('website-stage.')) || (failure === 'copy-install' && destination.endsWith('reboot.caddy.next'))) fail('copy failed');
 fs.writeFileSync(map(destination), fs.readFileSync(0), {mode:0o600, flag:'wx'});
 process.exit(0);
}
if (args[0] === 'inspect') { console.log(config); process.exit(0); }
if (args[0] === 'cp') {
  fs.copyFileSync(map(args[1]), map(args[2])); process.exit(0);
}
const command = args[2], rest = args.slice(3);
if (command === 'wget') process.exit(0);
if (command === 'test') {
 const exists = fs.existsSync(map(rest.at(-1)));
 process.exit((rest[0] === '!' ? !exists : exists) ? 0 : 1);
}
if (command === 'mktemp') {
  fs.mkdirSync(path.join(volume, 'website-stage.TEST'));
  console.log('/config/website-stage.TEST'); process.exit(0);
}
if (command === 'mkdir') { fs.mkdirSync(map(rest.at(-1)), { recursive: true }); process.exit(0); }
if (command === 'sh') {
 if (rest[1].includes('touch -r')) {
  fs.copyFileSync(map(rest.at(-2)), map(rest.at(-1)));
  fs.chmodSync(map(rest.at(-1)), fs.statSync(map(rest.at(-2))).mode & 0o777);
 } else fs.cpSync(path.join(volume, 'sites'), path.join(map(rest.at(-1)), 'sites'), { recursive: true });
 process.exit(0);
}
if (command === 'cp') {
 if (failure === 'recovery-copy') fail('copy failed');
 fs.copyFileSync(map(rest[1]), map(rest[2]));
 fs.chmodSync(map(rest[2]), fs.statSync(map(rest[1])).mode & 0o777);
 process.exit(0);
}
if (command === 'rm') { fs.rmSync(map(rest.at(-1)), { recursive: true, force: true }); process.exit(0); }
if (command === 'mv') {
  fs.renameSync(map(rest[0]), map(rest[1]));
  if (failure === 'signal' && !fs.existsSync(path.join(root, 'signal-sent'))) {
    fs.writeFileSync(path.join(root, 'signal-sent'), '');
    process.kill(process.ppid, 'SIGTERM');
  }
  process.exit(0);
}
if (command === 'caddy') {
  if (rest[0] === 'validate' && rest.includes('/config/website-stage.TEST/Caddyfile')) {
    if (fs.readFileSync(config, 'utf8') !== original) fail('live configuration was changed before validation');
    if (!fs.readFileSync(path.join(volume, 'website-stage.TEST/Caddyfile'), 'utf8').includes('import /config/website-stage.TEST/sites/*.caddy')) fail('staged import missing');
    if (fs.readFileSync(path.join(volume, 'website-stage.TEST/sites/other.caddy'), 'utf8') !== 'unrelated route\\n') fail('unrelated snippet changed');
    if (failure === 'validation') fail('invalid staged configuration');
  }
  if (rest[0] === 'reload' && ['reload', 'recovery-copy'].includes(failure) && !fs.existsSync(path.join(root, 'reload-failed'))) {
    fs.writeFileSync(path.join(root, 'reload-failed'), ''); fail('reload failed');
  }
  process.exit(0);
}
fail('Unexpected mock command: ' + args.join(' '));
`,
  );
  const result = spawnSync("bash", [join(base, "configure-proxy.sh")], {
    env: {
      ...childEnvironment(),
      PATH: `${join(directory, "bin")}:${process.env.PATH}`,
    },
    encoding: "utf8",
  });
  return {
    result,
    base,
    old,
    config,
    route,
    original,
    volume,
    calls: existsSync(join(directory, "calls"))
      ? readFileSync(join(directory, "calls"), "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse)
      : [],
  };
}

test("proxy installation validates the complete candidate before changing production files", (t) => {
  const { result, config, route, original, base, volume } = fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(config, "utf8"),
    original + "\nimport /config/sites/*.caddy\n",
  );
  assert.equal(readFileSync(route, "utf8"), "new preview route\n");
  assert.equal(
    readFileSync(join(volume, "sites", "other.caddy"), "utf8"),
    "unrelated route\n",
  );
  assert.equal(existsSync(join(base, "proxy.pending")), false);
  assert.deepEqual(
    readdirSync(base, { recursive: true }).filter(
      (name) => name.includes("pending") || name.endsWith(".next"),
    ),
    [],
  );
});

test("an existing import remains unique and other snippets are preserved", (t) => {
  const { result, config, original } = fixture(t, "", true, true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(config, "utf8"), original);
});

test("an interrupted proxy change blocks all subsequent Docker operations", (t) => {
  const { result, config, original, calls } = fixture(t, "pending");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /interrupted proxy change/);
  assert.equal(readFileSync(config, "utf8"), original);
  assert.equal(calls.length, 0);
});

test("preview proxy installation works after the prototype directory has been removed", (t) => {
  const f = fixture(t, "", true, true, false);
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(readFileSync(f.config, "utf8"), f.original);
  assert.equal(readFileSync(f.route, "utf8"), "new preview route\n");
  assert.equal(existsSync(f.old), false);
});

for (const failure of ["edge.pending", "retirement.pending", "edge-lock"]) {
  test(`${failure} blocks preview proxy changes before Docker operations`, (t) => {
    const f = fixture(t, failure);
    assert.notEqual(f.result.status, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(readFileSync(f.config, "utf8"), f.original);
  });
}

test("invalid staged proxy configuration leaves production files untouched", (t) => {
  const { result, config, route, original, base, calls } = fixture(
    t,
    "validation",
  );
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(config, "utf8"), original);
  assert.equal(readFileSync(route, "utf8"), "old preview route\n");
  assert.equal(existsSync(join(base, "proxy.pending")), false);
  assert.ok(!calls.some((args) => args.includes("reload")));
});

for (const failure of ["reload", "signal", "copy-install"]) {
  test(`${failure} restores both the original proxy configuration and snippet`, (t) => {
    const { result, config, route, original, base } = fixture(t, failure);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(config, "utf8"), original);
    assert.equal(readFileSync(route, "utf8"), "old preview route\n");
    assert.equal(existsSync(join(base, "proxy.pending")), false, result.stderr);
  });
}

for (const failure of ["copy-stage", "next"]) {
  test(`${failure} leaves live preview files unchanged`, (t) => {
    const f = fixture(t, failure);
    assert.notEqual(f.result.status, 0);
    assert.equal(readFileSync(f.config, "utf8"), f.original);
    assert.equal(readFileSync(f.route, "utf8"), "old preview route\n");
    assert.equal(existsSync(join(f.base, "proxy.pending")), false);
    assert.ok(!f.calls.some((args) => args.includes("reload")));
    if (failure === "next")
      assert.equal(readFileSync(f.route + ".next", "utf8"), "unresolved route");
  });
}

test("first proxy installation failure removes the new snippet", (t) => {
  const { result, route, config, original } = fixture(t, "reload", false);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(route), false);
  assert.equal(readFileSync(config, "utf8"), original);
});

test("failed snippet restoration leaves a recovery marker and does not reload partial state", (t) => {
  const { result, base, calls } = fixture(t, "recovery-copy");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Proxy recovery failed/);
  assert.equal(existsSync(join(base, "proxy.pending")), true);
  assert.equal(calls.filter((args) => args.includes("reload")).length, 1);
});
