import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { landingContentSecurityPolicy } from "../../website/site.mjs";
import { main, stage } from "./deploy.mjs";
import { fileURLToPath } from "node:url";
import { childEnvironment } from "../website/config.mjs";

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-production-stage-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const environment = {
  CI: "true",
  WEBSITE_DEPLOY_HOST: "deploy@example.test",
  HCLOUD_TOKEN: "not-for-ssh",
  TAURI_SIGNING_PRIVATE_KEY: "not-for-ssh",
  PATH: process.env.PATH,
};

test("production stage contains public website/download assets and repository-owned service configuration", async (t) => {
  const directory = temporary(t);
  await stage(directory);
  for (const name of [
    "compose.yaml",
    "edge-compose.yaml",
    "nginx.conf",
    "Caddyfile",
    "activate.sh",
    "configure-proxy.sh",
    "relocate-edge.sh",
    "retire-prototype.py",
    "site/index.html",
    "site/download.js",
  ])
    assert.equal(existsSync(join(directory, name)), true, name);
  for (const name of [
    "site/.env",
    "site/.git/config",
    "site/messages.en.json",
    "site/site.mjs",
    "site/media/birthday-fixture.json",
  ])
    assert.equal(existsSync(join(directory, name)), false, name);
  const nginx = readFileSync(join(directory, "nginx.conf"), "utf8");
  assert.ok(nginx.includes(landingContentSecurityPolicy));
  assert.doesNotMatch(nginx, /download-counter|proxy_pass[^;]*posthog/i);
  assert.match(nginx, /current-release\/download\.json/);
  if (process.platform !== "win32") {
    assert.equal(lstatSync(join(directory, "site")).mode & 0o777, 0o755);
    assert.equal(
      lstatSync(join(directory, "site/index.html")).mode & 0o777,
      0o644,
    );
  }
});

test("local production check only builds and validates Compose without host configuration", async () => {
  const calls = [];
  await main(["check"], {
    environment: { CI: "true" },
    execute: (...args) => calls.push(args),
  });
  assert.equal(calls.length, 2);
  for (const [command, args] of calls) {
    assert.equal(command, "docker");
    assert.deepEqual(args.slice(-2), ["config", "--quiet"]);
  }
});

test("feed routing and full website activation are distinct explicitly confirmed SSH actions", async () => {
  for (const [args, mode] of [
    [["feeds", "--confirm-domain", "getsituate.com"], "feeds"],
    [
      [
        "activate",
        "--confirm-domain",
        "getsituate.com",
        "--confirm-public-content",
      ],
      "website",
    ],
  ]) {
    const calls = [];
    await main(args, { environment, execute: (...call) => calls.push(call) });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "ssh");
    assert.ok(calls[0][1].includes("StrictHostKeyChecking=yes"));
    assert.ok(calls[0][1].includes("deploy@example.test"));
    assert.equal(
      calls[0][1].at(-1),
      `bash /opt/situate-production/current/configure-proxy.sh ${mode}`,
    );
    assert.equal(calls[0][2].env.HCLOUD_TOKEN, undefined);
    assert.equal(calls[0][2].env.TAURI_SIGNING_PRIVATE_KEY, undefined);
  }
});

test("edge relocation requires a confirmed production domain and forwards no signing or cloud secrets", async () => {
  const calls = [];
  await main(["edge", "--confirm-domain", "getsituate.com"], {
    environment,
    execute: (...args) => calls.push(args),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "ssh");
  assert.ok(calls[0][1].includes("StrictHostKeyChecking=yes"));
  assert.equal(
    calls[0][1].at(-1),
    "bash /opt/situate-production/current/relocate-edge.sh",
  );
  assert.equal(calls[0][2].env.HCLOUD_TOKEN, undefined);
  assert.equal(calls[0][2].env.TAURI_SIGNING_PRIVATE_KEY, undefined);
});

test("unsafe or unconfirmed production commands fail before executing anything", async () => {
  for (const args of [
    [],
    ["activate"],
    ["feeds"],
    ["edge"],
    ["retire", "inventory.json"],
    [
      "retire",
      "inventory.json",
      "--confirm-host",
      "wrong-host",
      "--confirm-discard-prototype",
    ],
    ["edge", "--confirm-domain", "example.test"],
    ["feeds", "--confirm-domain", "example.test"],
    ["activate", "--confirm-domain", "getsituate.com"],
    ["deploy", "extra"],
    ["rollback", "1.2.3"],
  ])
    await assert.rejects(
      main(args, { execute: () => assert.fail("unexpected execution") }),
      /Usage:/,
    );
});

test("retirement sends reviewed inventory only after exact destructive confirmation", async (t) => {
  const path = join(temporary(t), "inventory.json");
  writeFileSync(path, '{"synthetic":true}');
  const calls = [];
  await main(
    [
      "retire",
      path,
      "--confirm-host",
      "getsituate-production",
      "--confirm-discard-prototype",
    ],
    {
      environment,
      execute: (...args) => calls.push(args),
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "ssh");
  assert.match(
    calls[0][1].at(-1),
    /^sudo -n python3 .*retire-prototype.py retire --confirm-host getsituate-production --confirm-discard-prototype$/,
  );
  assert.equal(calls[0][2].input.toString(), '{"synthetic":true}');
  assert.equal(calls[0][2].env.HCLOUD_TOKEN, undefined);
});

test("a failed SSH operation is not automatically retried", async () => {
  let attempts = 0;
  await assert.rejects(
    main(["feeds", "--confirm-domain", "getsituate.com"], {
      environment,
      execute: () => {
        attempts++;
        throw new Error("synthetic uncertain transport");
      },
    }),
    /uncertain transport/,
  );
  assert.equal(attempts, 1);
});

function activationFixture(t, failure = "", previous = true) {
  const root = realpathSync(temporary(t));
  const base = join(root, "website");
  const distribution = join(root, "distribution");
  const oldId = "20260101000000-aaaaaaaaaaaa";
  const newId = "20260102000000-bbbbbbbbbbbb";
  const old = join(base, "releases", oldId);
  const candidate = join(base, "releases", newId);
  const bin = join(root, "bin");
  for (const path of [old, candidate, join(distribution, "releases"), bin])
    mkdirSync(path, { recursive: true });
  writeFileSync(
    join(distribution, "current-release"),
    "unchanged application pointer",
  );
  if (previous) symlinkSync(old, join(base, "current"));
  const script = readFileSync(new URL("./activate.sh", import.meta.url), "utf8")
    .replaceAll("/opt/situate-production", base)
    .replaceAll("/opt/situate", distribution);
  const scriptPath = join(candidate, "activate.sh");
  writeFileSync(scriptPath, script);
  const executable = (name, code) =>
    writeFileSync(join(bin, name), `#!${process.execPath}\n${code}`, {
      mode: 0o700,
    });
  executable("flock", "process.exit(0)");
  executable(
    "readlink",
    "try {console.log(require('fs').realpathSync(process.argv.at(-1)))} catch {process.exit(1)}",
  );
  executable(
    "mv",
    "require('fs').renameSync(process.argv.at(-2),process.argv.at(-1))",
  );
  executable(
    "docker",
    `
const fs = require('fs');
const args = process.argv.slice(2), cwd = process.cwd();
fs.appendFileSync(${JSON.stringify(join(root, "calls"))}, JSON.stringify({args,cwd})+'\\n');
const failure = ${JSON.stringify(failure)}, candidate = ${JSON.stringify(candidate)};
if (args.includes('up') && (failure === 'recovery' || (failure === 'health' && cwd === candidate))) process.exit(1);
process.exit(0);
`,
  );
  if (["proxy.pending", "edge.pending"].includes(failure))
    writeFileSync(join(base, failure), "unresolved");
  const result = spawnSync("bash", [scriptPath, newId], {
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}` },
  });
  return {
    result,
    base,
    distribution,
    old,
    candidate,
    calls: existsSync(join(root, "calls"))
      ? readFileSync(join(root, "calls"), "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse)
      : [],
  };
}

test("healthy website activation switches only the website pointer, not the application release", (t) => {
  const f = activationFixture(t);
  assert.equal(f.result.status, 0, f.result.stderr);
  assert.equal(readlinkSync(join(f.base, "current")), f.candidate);
  assert.equal(
    readFileSync(join(f.distribution, "current-release"), "utf8"),
    "unchanged application pointer",
  );
  assert.equal(existsSync(join(f.base, "deploy.pending")), false);
});

test("failed website health restores the previous service and pointer", (t) => {
  const f = activationFixture(t, "health");
  assert.notEqual(f.result.status, 0);
  assert.equal(readlinkSync(join(f.base, "current")), f.old);
  assert.equal(existsSync(join(f.base, "deploy.pending")), false);
  assert.ok(
    f.calls.some((call) => call.cwd === f.old && call.args.includes("up")),
  );
});

test("failed first website deployment removes only its own service", (t) => {
  const f = activationFixture(t, "health", false);
  assert.notEqual(f.result.status, 0);
  assert.equal(existsSync(join(f.base, "current")), false);
  assert.ok(f.calls.some((call) => call.args.includes("down")));
  assert.equal(
    readFileSync(join(f.distribution, "current-release"), "utf8"),
    "unchanged application pointer",
  );
});

test("unresolved proxy recovery blocks a website deployment before any service operation", (t) => {
  const f = activationFixture(t, "proxy.pending");
  assert.notEqual(f.result.status, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(readlinkSync(join(f.base, "current")), f.old);
  assert.equal(
    readFileSync(join(f.base, "proxy.pending"), "utf8"),
    "unresolved",
  );
});

test("unresolved edge relocation blocks website deployment", (t) => {
  const f = activationFixture(t, "edge.pending");
  assert.notEqual(f.result.status, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(readlinkSync(join(f.base, "current")), f.old);
});

test("failed website service recovery preserves the pending marker", (t) => {
  const f = activationFixture(t, "recovery");
  assert.notEqual(f.result.status, 0);
  assert.equal(existsSync(join(f.base, "deploy.pending")), true);
  assert.match(f.result.stderr, /recovery failed/);
});

function retirementFixture(t, failure = "") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "situate-retire-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const legacy = join(root, "legacy"),
    production = join(root, "production"),
    data = join(root, "data"),
    preview = join(root, "preview");
  for (const path of [
    legacy,
    join(production, "edge"),
    join(production, "current"),
    data,
    preview,
    join(root, "bin"),
  ])
    mkdirSync(path, { recursive: true });
  writeFileSync(join(legacy, "prototype.txt"), "discarded prototype");
  writeFileSync(join(data, "artifact.dmg"), "retained published artifact");
  writeFileSync(join(preview, "index.html"), "retained preview");
  for (const path of ["edge/Caddyfile", "current/Caddyfile"])
    writeFileSync(join(production, path), "reviewed canonical configuration");
  const container = (name, project, service, mounts = []) => ({
    Id: name,
    Name: "/" + name,
    Config: {
      Labels: {
        "com.docker.compose.project": project,
        "com.docker.compose.service": service,
      },
    },
    State: { Running: true, Health: { Status: "healthy" } },
    Mounts: mounts,
    NetworkSettings: {
      Networks: { getsituate_default: { Aliases: [name], IPAddress: "" } },
    },
  });
  const edge = container("getsituate-caddy-1", "getsituate", "caddy", [
    {
      Destination: "/etc/caddy/Caddyfile",
      Source: join(production, "edge/Caddyfile"),
    },
    {
      Destination: "/data",
      Name: "getsituate_caddy_data",
      Source: "/synthetic/certificates",
    },
    {
      Destination: "/config",
      Name: "getsituate_caddy_config",
      Source: "/synthetic/config",
    },
  ]);
  const website = container("new-website", "situate-production", "website", [
    { Destination: "/srv/distribution", Source: data },
  ]);
  const old = container("getsituate-site-1", "getsituate", "site", [
    { Destination: "/site", Source: legacy },
  ]);
  const counter = container(
    "getsituate-download-counter-1",
    "getsituate",
    "download-counter",
  );
  old.State.Running = ["running", "stop", "quiesce"].includes(failure);
  counter.State.Running = old.State.Running;
  mkdirSync(join(legacy, "download-counter"));
  writeFileSync(
    join(legacy, "download-counter/counter.db"),
    "synthetic counter",
  );
  if (failure === "unknown-service")
    old.Config.Labels["com.docker.compose.service"] = "unknown";
  if (failure === "unknown-name") old.Name = "/unreviewed-site";
  const unrelated = container("preview", "situate-reboot", "website");
  if (failure === "mount")
    unrelated.Mounts.push({ Source: legacy, Destination: "/unknown" });
  if (failure === "edge") edge.Mounts[0].Source = join(legacy, "Caddyfile");
  if (failure === "volume") edge.Mounts[1].Name = "unknown";
  if (failure === "health") website.State.Health.Status = "unhealthy";
  writeFileSync(
    join(root, "containers.json"),
    JSON.stringify([edge, website, old, counter, unrelated]),
  );
  writeFileSync(
    join(root, "bin/docker"),
    `#!${process.execPath}\n
const fs = require('fs'), path = require('path');
const root = ${JSON.stringify(root)}, failure = ${JSON.stringify(failure)};
const args = process.argv.slice(2), state = path.join(root, 'containers.json');
fs.appendFileSync(path.join(root,'calls'), JSON.stringify(args)+'\\n');
const all = JSON.parse(fs.readFileSync(state));
if (args[0] === 'ps') console.log(all.map(c=>c.Id).join('\\n'));
else if (args[0] === 'inspect') console.log(JSON.stringify(all));
else if (args[0] === 'stop') {
 if (failure === 'stop') process.exit(1);
 for (const c of all) if (c.Id === args.at(-1)) c.State.Running = false;
 fs.writeFileSync(state, JSON.stringify(all));
 if (failure === 'quiesce') fs.writeFileSync(path.join(root,'legacy/download-counter/counter.db'), 'final counter flush');
}
else if (args[0] === 'rm') fs.writeFileSync(state, JSON.stringify(all.filter(c=>c.Id !== args[1])));
else if (args[0] === 'exec') {
 if (args.includes('adapt') || args.at(-1).includes('2019/config/')) {
  const active = {dial: failure === 'route' ? 'site:8080' : 'situate-production:8080'};
  if (failure === 'stale' && args.includes('adapt')) active.other = true;
  console.log(JSON.stringify(active));
 } else if (args.at(-1).includes('/jobs/') || args.at(-1).includes('/go/')) process.exit(1);
 else if (failure === 'endpoint' && args.at(-1).includes('/releases/current/')) process.exit(1);
} else throw new Error('Unexpected docker invocation');
`,
    { mode: 0o700 },
  );
  const script = fileURLToPath(
    new URL("./retire-prototype.py", import.meta.url),
  );
  const wrapper = `import importlib.util, pathlib, socket, sys\nspec=importlib.util.spec_from_file_location('retire',${JSON.stringify(script)})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nm.LEGACY=pathlib.Path(${JSON.stringify(legacy)})\nm.PRODUCTION=pathlib.Path(${JSON.stringify(production)})\nm.DISTRIBUTION=pathlib.Path(${JSON.stringify(data)})\nm.PREVIEW=pathlib.Path(${JSON.stringify(preview)})\nsocket.gethostname=lambda: ${JSON.stringify(failure === "host" ? "wrong-host" : "getsituate-production")}\nm.os.geteuid=lambda: ${failure === "privilege" ? 501 : 0}\noriginal_scan=m.os.scandir\ndef scan(path):\n if pathlib.Path(path) == m.LEGACY/'download-counter' and (m.PRODUCTION/'deny-scan').exists(): raise PermissionError('Synthetic unreadable counter directory')\n return original_scan(path)\nm.os.scandir=scan\npathlib.Path.read_bytes=lambda self: (_ for _ in ()).throw(AssertionError('Unbounded file read'))\nm.main()\n`;
  const run = (args, input) =>
    spawnSync("python3", ["-B", "-c", wrapper, ...args], {
      input,
      encoding: "utf8",
      env: {
        ...childEnvironment(),
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
      },
    });
  const inventory = run(["inventory"]);
  const confirmed = [
    "retire",
    "--confirm-host",
    "getsituate-production",
    "--confirm-discard-prototype",
  ];
  return { root, legacy, production, data, preview, run, inventory, confirmed };
}

test("explicit reviewed retirement removes only prototype containers and files", (t) => {
  const f = retirementFixture(t);
  assert.equal(f.inventory.status, 0, f.inventory.stderr);
  const result = f.run(f.confirmed, f.inventory.stdout);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(f.legacy), false);
  assert.equal(
    readFileSync(join(f.data, "artifact.dmg"), "utf8"),
    "retained published artifact",
  );
  assert.equal(
    readFileSync(join(f.preview, "index.html"), "utf8"),
    "retained preview",
  );
  assert.equal(
    existsSync(join(f.production, "retirement.complete.json")),
    true,
  );
  const calls = readFileSync(join(f.root, "calls"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    calls.filter((a) => a[0] === "rm"),
    [
      ["rm", "getsituate-download-counter-1"],
      ["rm", "getsituate-site-1"],
    ],
  );
  assert.ok(
    !calls.some(
      (a) => a.includes("prune") || a.includes("down") || a.includes("-v"),
    ),
  );
});

for (const failure of [
  "mount",
  "edge",
  "volume",
  "route",
  "stale",
  "health",
  "endpoint",
  "host",
  "unknown-service",
  "unknown-name",
  "privilege",
  "unreadable",
  "running",
  "confirmation",
  "inventory",
  "pending",
  "stop",
]) {
  test(`${failure} blocks retirement and preserves prototype files`, (t) => {
    const f = retirementFixture(t, failure);
    if (failure === "inventory")
      writeFileSync(join(f.legacy, "unknown.txt"), "unreviewed");
    if (failure === "pending")
      writeFileSync(join(f.data, "release-pending.json"), "uncertain");
    if (failure === "unreadable")
      writeFileSync(join(f.production, "deny-scan"), "synthetic denial");
    const args =
      failure === "stop" ? ["quiesce", ...f.confirmed.slice(1)] : f.confirmed;
    const result = f.run(
      failure === "confirmation" ? ["retire"] : args,
      f.inventory.stdout,
    );
    assert.notEqual(result.status, 0);
    assert.equal(
      readFileSync(join(f.legacy, "prototype.txt"), "utf8"),
      "discarded prototype",
    );
    assert.equal(
      existsSync(join(f.production, "retirement.pending")),
      failure === "stop",
    );
    if (
      ["unknown-service", "unknown-name", "unreadable", "privilege"].includes(
        failure,
      )
    ) {
      const calls = existsSync(join(f.root, "calls"))
        ? readFileSync(join(f.root, "calls"), "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse)
        : [];
      assert.ok(!calls.some((args) => args[0] === "stop" || args[0] === "rm"));
    }
    if (failure === "unreadable")
      assert.match(result.stderr, /unreadable counter/);
    if (failure === "stop") {
      const retry = f.run(f.confirmed, f.inventory.stdout);
      assert.notEqual(retry.status, 0);
      assert.match(retry.stderr, /Unresolved operation evidence/);
    }
  });
}

test("quiesce preserves final counter writes for a fresh reviewed retirement inventory", (t) => {
  const f = retirementFixture(t, "quiesce");
  assert.equal(f.inventory.status, 0, f.inventory.stderr);
  const quiesced = f.run(
    ["quiesce", ...f.confirmed.slice(1)],
    f.inventory.stdout,
  );
  assert.equal(quiesced.status, 0, quiesced.stderr);
  assert.equal(
    readFileSync(join(f.legacy, "download-counter/counter.db"), "utf8"),
    "final counter flush",
  );
  assert.equal(
    existsSync(join(f.production, "retirement-quiesced.json")),
    true,
  );
  const stale = f.run(f.confirmed, f.inventory.stdout);
  assert.notEqual(stale.status, 0);
  assert.equal(existsSync(join(f.production, "retirement.pending")), false);
  const fresh = f.run(["inventory"]);
  assert.equal(fresh.status, 0, fresh.stderr);
  const retired = f.run(f.confirmed, fresh.stdout);
  assert.equal(retired.status, 0, retired.stderr);
  assert.equal(existsSync(f.legacy), false);
});

for (const name of [
  "AuthKey_synthetic.p8",
  "terraform.tfstate.123456",
  "terraform.tfstate.backup.gz",
]) {
  test(`protected ${name} blocks inventory before any service stop`, (t) => {
    const f = retirementFixture(t);
    writeFileSync(join(f.legacy, name), "synthetic protected fixture");
    const result = f.run(["inventory"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Protected or unknown content/);
    const calls = readFileSync(join(f.root, "calls"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.ok(!calls.some((args) => args[0] === "stop" || args[0] === "rm"));
  });
}

for (const failure of ["", "network", "symlink", "file"]) {
  test(`host preparation is non-destructive with failure=${failure || "none"}`, (t) => {
    const root = realpathSync(temporary(t));
    const bin = join(root, "bin");
    mkdirSync(bin);
    const executable = (name, code) =>
      writeFileSync(join(bin, name), `#!${process.execPath}\n${code}`, {
        mode: 0o700,
      });
    executable("id", "console.log('0')");
    executable("getent", "process.exit(0)");
    executable("flock", "process.exit(0)");
    executable(
      "docker",
      failure === "network" ? "process.exit(1)" : "process.exit(0)",
    );
    executable(
      "install",
      `const fs=require('fs'); const args=process.argv.slice(2); for(let i=0;i<args.length;i++){if(['-m','-o','-g'].includes(args[i])) i++; else if(!args[i].startsWith('-')) fs.mkdirSync(args[i],{recursive:true});}`,
    );
    const data = join(root, "situate");
    if (failure === "symlink") symlinkSync(bin, data);
    if (failure === "file") writeFileSync(data, "unknown content");
    const script = readFileSync(
      new URL("./prepare-host.sh", import.meta.url),
      "utf8",
    ).replaceAll("/opt/", root + "/");
    const run = () =>
      spawnSync("bash", ["-c", script], {
        encoding: "utf8",
        env: { ...childEnvironment(), PATH: bin + ":" + process.env.PATH },
      });
    const result = run();
    if (failure) {
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(root, "situate-production")), false);
      if (failure === "file")
        assert.equal(readFileSync(data, "utf8"), "unknown content");
    } else {
      assert.equal(result.status, 0, result.stderr);
      writeFileSync(join(data, "retained.dmg"), "published");
      const repeat = run();
      assert.equal(repeat.status, 0, repeat.stderr);
      assert.equal(
        readFileSync(join(data, "retained.dmg"), "utf8"),
        "published",
      );
      assert.equal(existsSync(join(root, "situate-production/edge")), true);
    }
  });
}
