import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createQualificationHost,
  withQualificationRoute,
} from "./qualification-host.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const config = {
  host: "synthetic@release.example",
  sshIdentity: "/synthetic/id",
  sshKnownHosts: "/synthetic/known_hosts",
  caddyContainer: "production-caddy",
  hostname: "updates.example.com",
  certificateMount: "/data",
  certificatePath: "certificates/updates.example.com.crt",
  keyPath: "certificates/updates.example.com.key",
  hostPort: 24443,
  feedPath: "releases/current/update.json",
  publicFeedSha256: "a".repeat(64),
};
const operation = {
  operationId: "actions-123-1",
  operationNonce: "actions-123-1",
};
const binding = Object.fromEntries(
  Object.entries(config).filter(
    ([key]) => !["host", "sshIdentity", "sshKnownHosts"].includes(key),
  ),
);
const modulePath = fileURLToPath(
  new URL("./qualification-host.py", import.meta.url),
);
function temporary(t) {
  const path = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-private-host-test-")),
  );
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

const pythonSetup = `import importlib.util,sys,json,os
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('qualification',sys.argv[1])
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
base=m.Path(sys.argv[2])
m.ROOT=base/'private'
m.HOST_UID=os.getuid()
m.RUNNER_UID=os.geteuid()
m.RUNNER_LOCK=base/'runner-lock'
m.RUNNER_HISTORY=base/'history'
m.HOSTS=base/'hosts'
sys.platform='darwin'
trace=base/'commands.json'
world=base/'world.json'
def fake(args):
    calls=json.loads(trace.read_text()) if trace.exists() else []
    calls.append(args)
    trace.write_text(json.dumps(calls))
    state=json.loads(world.read_text()) if world.exists() else {'container':None,'alias':False}
    result=''
    if args[:3]==['docker','container','inspect']:
        if args[3]=='production-caddy':
            result=json.dumps([{'State':{'Running':True},'Image':'sha256:'+'b'*64,'Mounts':[{'Destination':'/data','Type':'volume','Name':'synthetic-caddy-data'}]}])
        else:
            result=json.dumps([state['container']])
    elif args[:2]==['docker','exec']:
        pass
    elif args[:3]==['docker','container','ls']:
        result='1234' if state['container'] else ''
    elif args[:2]==['docker','run']:
        nonce=args[args.index('--label')+1].split('=',1)[1]
        state['container']={'Id':'synthetic-container-id','Image':'sha256:'+'b'*64,'Config':{'Labels':{m.LABEL:nonce}},'State':{'Running':True},'HostConfig':{'PortBindings':{'8443/tcp':[{'HostIp':'127.0.0.1','HostPort':'24443'}]}}}
        result='synthetic-container-id'
    elif args[:3]==['docker','container','rm']:
        state['container']=None
    elif args[:2]==['/sbin/ifconfig','lo0']:
        if len(args)==2:
            result='lo0: flags=8049\\n inet 127.0.0.1 netmask 0xff000000\\n'+(' inet 127.0.0.2 netmask 0xffffffff\\n' if state['alias'] else '')
        elif args[2]=='alias':
            state['alias']=True
        elif args[2]=='-alias':
            state['alias']=False
    elif args[0] not in ['/usr/bin/dscacheutil','/usr/bin/killall']:
        raise AssertionError('Unexpected external effect: '+repr(args))
    world.write_text(json.dumps(state))
    if args[:2]==['docker','run'] and (base/'fail-run').exists():
        raise RuntimeError('Synthetic lost docker response')
    return result
m.command=fake
request=json.loads(sys.argv[4])
`;
function harness(t) {
  const root = temporary(t);
  mkdirSync(join(root, "history"));
  writeFileSync(join(root, "hosts"), "127.0.0.1 localhost\n::1 localhost\n");
  const payload = join(root, "payload");
  mkdirSync(join(payload, "releases/current"), { recursive: true });
  writeFileSync(join(payload, config.feedPath), '{"version":"1.2.3"}\n');
  writeFileSync(join(payload, "candidate.tar.gz"), "synthetic signed package");
  const files = Object.fromEntries(
    [config.feedPath, "candidate.tar.gz"].map((name) => {
      const bytes = readFileSync(join(payload, name));
      return [name, { size: bytes.length, sha256: sha(bytes) }];
    }),
  );
  const tar = execFileSync(
    "tar",
    ["--format=ustar", "-cf", "-", "-C", payload, ...Object.keys(files)],
    { env: { PATH: process.env.PATH, COPYFILE_DISABLE: "1" } },
  );
  const request = { ...operation, config: binding, files };
  const invoke = (action, value = request, input = tar, extra = "") =>
    spawnSync(
      "python3",
      [
        "-c",
        `${pythonSetup}\n${extra}\nresult=m.runner_perform(sys.argv[3],request) if sys.argv[3].startswith('runner-') else m.perform(sys.argv[3],request)\nprint(json.dumps(result))`,
        modulePath,
        root,
        action,
        JSON.stringify(value),
      ],
      { input, encoding: "utf8", timeout: 5000 },
    );
  const success = (action, value, input, extra) => {
    const result = invoke(action, value, input, extra);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return {
    root,
    payload,
    files,
    tar,
    request,
    invoke,
    success,
    state: () =>
      JSON.parse(
        readFileSync(
          join(root, "private", sha(operation.operationNonce), "state.json"),
        ),
      ),
    calls: () => JSON.parse(readFileSync(join(root, "commands.json"))),
  };
}

test("host prepares immutable identity before staging and privately serves exact hash-bound files", (t) => {
  const h = harness(t);
  assert.equal(h.success("inspect").status, "absent");
  assert(!existsSync(join(h.root, "private")));
  const prepared = h.success("prepare");
  assert.equal(prepared.operationId, operation.operationId);
  assert.equal(prepared.publicFeedSha256, config.publicFeedSha256);
  const resource = join(h.root, "private", sha(operation.operationNonce));
  const identityBytes = readFileSync(join(resource, "identity/identity.json"));
  assert.equal(prepared.identitySha256, sha(identityBytes));
  assert.equal(JSON.parse(identityBytes).operationId, operation.operationId);
  assert.match(
    prepared.identityPath,
    /^\/releases\/\.qualification\/[a-f0-9]{64}\/identity.json$/,
  );
  assert.equal(
    h.success("stage").candidateFeedSha256,
    h.files[config.feedPath].sha256,
  );
  assert.equal(h.success("serve").status, "serving");
  assert.equal(statSync(resource).mode & 0o777, 0o700);
  assert.equal(statSync(join(resource, "payload")).mode & 0o777, 0o755);
  assert.equal(
    statSync(join(resource, "payload", config.feedPath)).mode & 0o777,
    0o644,
  );
  const run = h.calls().find((args) => args[1] === "run");
  assert(run.includes("sha256:" + "b".repeat(64)));
  assert(
    run.includes("--pull=never") &&
      run.includes("--read-only") &&
      run.includes("--cap-drop=ALL"),
  );
  assert.equal(
    run[run.indexOf("--cap-add=NET_BIND_SERVICE")],
    "--cap-add=NET_BIND_SERVICE",
  );
  assert.equal(run[run.indexOf("--publish") + 1], "127.0.0.1:24443:8443/tcp");
  const mounts = run.flatMap((arg, index) =>
    arg === "--mount" ? [run[index + 1]] : [],
  );
  assert.equal(mounts.length, 4);
  assert(mounts.every((value) => value.endsWith(",readonly")));
  assert(
    mounts.every(
      (value) =>
        !value.includes("docker.sock") &&
        !value.includes("/opt/situate/releases"),
    ),
  );
  const caddy = JSON.parse(readFileSync(join(resource, "caddy.json")));
  assert.equal(caddy.admin.disabled, true);
  assert.deepEqual(caddy.apps.http.servers.qualification.listen, [":8443"]);
  assert.deepEqual(caddy.apps.tls.certificates.load_files, [
    {
      certificate: "/cert-store/" + config.certificatePath,
      key: "/cert-store/" + config.keyPath,
    },
  ]);
  assert.equal(h.success("inspect").containerRunning, true);
  assert.equal(h.success("cleanup").status, "cleaned");
  assert.equal(h.success("cleanup").status, "cleaned");
  assert(!existsSync(join(resource, "payload")));
  assert(!existsSync(join(h.root, "releases")));
  assert(
    h
      .calls()
      .filter((args) => args[0] === "docker" && args[1] === "exec")
      .every((args) => args[5].startsWith("test -f")),
  );
});

test("host lock rejects concurrent mutations without changing prepared state", (t) => {
  const h = harness(t);
  h.success("prepare");
  const result = h.invoke(
    "stage",
    undefined,
    undefined,
    "held=os.open(m.ROOT/'lock',os.O_WRONLY)\nm.fcntl.flock(held,m.fcntl.LOCK_EX|m.fcntl.LOCK_NB)",
  );
  assert.match(result.stderr, /BlockingIOError/);
  assert.equal(h.state().status, "prepared");
  assert(
    !existsSync(
      join(h.root, "private", sha(operation.operationNonce), "payload"),
    ),
  );
});

test("host rejects ownership changes, replay, path traversal and mismatched bytes", (t) => {
  const h = harness(t);
  h.success("prepare");
  assert.match(h.invoke("prepare").stderr, /already exists/);
  assert.match(
    h.invoke("stage", { ...h.request, operationId: "other-operation" }).stderr,
    /ownership/,
  );
  assert.match(
    h.invoke("stage", {
      ...h.request,
      files: { "../outside": h.files[config.feedPath] },
    }).stderr,
    /file path/,
  );
  const files = structuredClone(h.files);
  files[config.feedPath].sha256 = "c".repeat(64);
  assert.match(
    h.invoke("stage", { ...h.request, files }).stderr,
    /hash differs/,
  );
  assert.equal(h.state().status, "stage-failed");
  assert.equal(h.state().uncertain, true);
  assert.match(h.invoke("stage").stderr, /fresh prepared/);
  assert.equal(h.success("cleanup").status, "cleaned-retained");
  assert(
    existsSync(
      join(
        h.root,
        "private",
        sha(operation.operationNonce),
        "payload",
        config.feedPath,
      ),
    ),
  );
  assert.equal(h.state().artifactsRetained, true);
});

test("host rejects archive links and unexpected members without extracting them", (t) => {
  const h = harness(t);
  h.success("prepare");
  const malicious = execFileSync("python3", [
    "-c",
    "import io,tarfile,sys\nb=io.BytesIO()\nwith tarfile.open(fileobj=b,mode='w') as t:\n m=tarfile.TarInfo('../outside');m.type=tarfile.SYMTYPE;m.linkname='/tmp/other';t.addfile(m)\nsys.stdout.buffer.write(b.getvalue())",
  ]);
  assert.match(
    h.invoke("stage", undefined, malicious).stderr,
    /Unexpected staged archive/,
  );
  assert(!existsSync(join(h.root, "outside")));
  assert.equal(h.state().status, "stage-failed");
});

test("cleanup can retain candidate bytes while removing the owned listener", (t) => {
  const h = harness(t);
  h.success("prepare");
  h.success("stage");
  h.success("serve");
  const cleaned = h.success("cleanup", { ...h.request, retainArtifacts: true });
  assert.equal(cleaned.status, "cleaned-retained");
  assert.equal(cleaned.artifactsRetained, true);
  assert.equal(h.success("inspect").containerRunning, false);
  assert(
    existsSync(
      join(
        h.root,
        "private",
        sha(operation.operationNonce),
        "payload",
        config.feedPath,
      ),
    ),
  );
});

test("serve records uncertain failure once and cleanup refuses a foreign container", (t) => {
  const h = harness(t);
  h.success("prepare");
  h.success("stage");
  writeFileSync(join(h.root, "fail-run"), "fail");
  assert.match(h.invoke("serve").stderr, /lost docker response/);
  assert.equal(h.state().status, "serve-failed");
  assert.equal(h.state().uncertain, true);
  assert.equal(h.success("inspect").containerRunning, true);
  assert.match(h.invoke("serve").stderr, /verified staged/);
  assert.equal(h.calls().filter((args) => args[1] === "run").length, 1);
  const world = JSON.parse(readFileSync(join(h.root, "world.json")));
  world.container = {
    Id: "foreign",
    Image: "sha256:" + "b".repeat(64),
    Config: {
      Labels: { "com.situate.qualification-operation": "someone-else" },
    },
    State: { Running: true },
  };
  writeFileSync(join(h.root, "world.json"), JSON.stringify(world));
  assert.match(h.invoke("cleanup").stderr, /ownership differs/);
  assert(!h.calls().some((args) => args[2] === "rm"));
});

test("cleanup removes an owned listener after a lost run response but retains all uncertain artifacts", (t) => {
  const h = harness(t);
  h.success("prepare");
  h.success("stage");
  writeFileSync(join(h.root, "fail-run"), "fail");
  assert.notEqual(h.invoke("serve").status, 0);
  const result = h.success("cleanup");
  assert.equal(result.status, "cleaned-retained");
  assert.equal(result.artifactsRetained, true);
  assert.equal(result.uncertain, true);
  assert(
    h
      .calls()
      .some(
        (args) => args[2] === "rm" && args.at(-1) === "synthetic-container-id",
      ),
  );
  const resource = join(h.root, "private", sha(operation.operationNonce));
  assert(existsSync(join(resource, "payload", config.feedPath)));
  assert(existsSync(join(resource, "caddy.json")));
  assert.equal(h.success("inspect").containerRunning, false);
});

const routeRequest = {
  ...operation,
  hostname: config.hostname,
  privateAddress: "127.0.0.2",
  localPort: 443,
};
test("runner reserves hostname/alias exclusively and restores exact original hosts bytes", (t) => {
  const h = harness(t);
  const before = readFileSync(join(h.root, "hosts"));
  assert.equal(h.success("runner-prepare", routeRequest).status, "prepared");
  assert.match(
    readFileSync(join(h.root, "hosts"), "utf8"),
    /127\.0\.0\.2 updates\.example\.com/,
  );
  const mapped = readFileSync(join(h.root, "hosts"));
  assert.match(h.invoke("runner-prepare", routeRequest).stderr, /File exists/);
  assert.deepEqual(readFileSync(join(h.root, "hosts")), mapped);
  assert.equal(
    JSON.parse(readFileSync(join(h.root, "world.json"))).alias,
    true,
  );
  assert.match(
    h.invoke("runner-prepare", { ...routeRequest, operationNonce: "foreign" })
      .stderr,
    /File exists/,
  );
  assert.match(
    h.invoke("runner-cleanup", { ...routeRequest, operationNonce: "foreign" })
      .stderr,
    /ownership differs/,
  );
  h.success("runner-ssh-pending", routeRequest);
  h.success("runner-serving", routeRequest);
  assert.equal(h.success("runner-cleanup", routeRequest).status, "cleaned");
  assert.deepEqual(readFileSync(join(h.root, "hosts")), before);
  assert.equal(
    JSON.parse(readFileSync(join(h.root, "world.json"))).alias,
    false,
  );
  assert(!existsSync(join(h.root, "runner-lock")));
  assert(
    existsSync(
      join(
        h.root,
        "history",
        "situate-qualification-route-" + sha(operation.operationNonce),
        "state.json",
      ),
    ),
  );
});

test("runner retains its reservation while an SSH control socket remains", (t) => {
  const h = harness(t);
  h.success("runner-prepare", routeRequest);
  const socket = join(h.root, "runner-lock", "ssh");
  writeFileSync(socket, "synthetic control socket");
  assert.match(
    h.invoke("runner-cleanup", routeRequest).stderr,
    /control socket still exists/,
  );
  assert.match(
    readFileSync(join(h.root, "hosts"), "utf8"),
    /127\.0\.0\.2 updates\.example\.com/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(h.root, "world.json"))).alias,
    true,
  );
});

test("runner preserves concurrent hosts edits and refuses preexisting hostname or alias ownership", (t) => {
  const h = harness(t);
  h.success("runner-prepare", routeRequest);
  writeFileSync(
    join(h.root, "hosts"),
    "127.0.0.1 localhost\n# concurrent change\n",
  );
  assert.match(
    h.invoke("runner-cleanup", routeRequest).stderr,
    /hosts file changed/,
  );
  assert.match(
    readFileSync(join(h.root, "hosts"), "utf8"),
    /concurrent change/,
  );
  assert(existsSync(join(h.root, "runner-lock")));
  for (const kind of ["hostname", "alias"]) {
    const fixture = harness(t);
    if (kind === "hostname")
      writeFileSync(
        join(fixture.root, "hosts"),
        "1.2.3.4 updates.example.com\n",
      );
    else
      writeFileSync(
        join(fixture.root, "world.json"),
        JSON.stringify({ container: null, alias: true }),
      );
    const before = readFileSync(join(fixture.root, "hosts"));
    assert.match(
      fixture.invoke("runner-prepare", routeRequest).stderr,
      /already/,
    );
    assert.deepEqual(readFileSync(join(fixture.root, "hosts")), before);
  }
});

function controllerFixture({ ready = true, cleaned = true } = {}) {
  const calls = [],
    spawns = [];
  const facts = {
    ...operation,
    status: "serving",
    containerRunning: true,
    identityPath: "/releases/.qualification/identity.json",
    identitySha256: "b".repeat(64),
    publicFeedSha256: config.publicFeedSha256,
  };
  const host = createQualificationHost(config, {
    environment: {
      PATH: process.env.PATH,
      HOME: "/synthetic",
      SSH_AUTH_SOCK: "/synthetic/agent",
      GITHUB_TOKEN: "not-for-qualification",
    },
    execute: (command, args, options) => {
      calls.push({ command, args, options });
      return JSON.stringify(facts);
    },
  });
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      child.stdout.write(
        JSON.stringify({
          closed: true,
          cleaned,
          uncertain: !cleaned,
          operationNonce: operation.operationNonce,
        }) + "\n",
      );
      child.stdout.end();
      child.stderr.end();
      child.emit("close", cleaned && ready ? 0 : 1);
    };
    const input = [];
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        input.push(chunk.toString());
        done();
      },
      final(done) {
        done();
        queueMicrotask(stop);
      },
    });
    spawns.push({ command, args, options, child, input, stop });
    queueMicrotask(() => {
      if (ready)
        child.stdout.write(
          JSON.stringify({
            ready: true,
            operationNonce: operation.operationNonce,
          }) + "\n",
        );
      else stop();
    });
    return child;
  };
  return {
    host,
    route: { ...routeRequest, host, trustedEphemeralRunner: true },
    calls,
    spawns,
    spawnProcess,
    facts,
  };
}

test("controller binds an isolated guardian lifeline and limits callback facts and environments", async () => {
  const f = controllerFixture();
  let lifetime;
  const result = await withQualificationRoute(
    f.route,
    async (facts, signal) => {
      lifetime = signal;
      assert.equal(signal.aborted, false);
      assert.equal(facts.operationId, operation.operationId);
      assert.equal(facts.privateAddress, "127.0.0.2");
      assert.equal(facts.sshIdentity, undefined);
      return "qualified";
    },
    { spawnProcess: f.spawnProcess, platform: "darwin" },
  );
  assert.equal(result, "qualified");
  assert.equal(lifetime.aborted, true);
  assert.equal(f.spawns.length, 1);
  assert.equal(f.spawns[0].command, "/usr/bin/sudo");
  assert.deepEqual(f.spawns[0].args.slice(0, 2), ["-n", "/usr/bin/python3"]);
  assert.deepEqual(f.spawns[0].options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(f.spawns[0].input.join(""), "close\n");
  assert(!Object.hasOwn(f.spawns[0].options.env, "GITHUB_TOKEN"));
  assert(!Object.hasOwn(f.spawns[0].options.env, "SSH_AUTH_SOCK"));
  assert(!Object.hasOwn(f.calls[0].options.env, "GITHUB_TOKEN"));
});

test("controller closes its lifeline on callback failure and distinguishes uncertain teardown", async () => {
  for (const cleaned of [false, true]) {
    const f = controllerFixture({ cleaned });
    const cause = new Error("Synthetic qualification failure");
    await assert.rejects(
      withQualificationRoute(
        f.route,
        async () => {
          throw cause;
        },
        { spawnProcess: f.spawnProcess, platform: "darwin" },
      ),
      (error) => {
        assert.equal(error.name, "AggregateError");
        assert(error.errors.includes(cause));
        assert.equal(error.uncertain, !cleaned);
        return true;
      },
    );
    assert.equal(f.spawns.length, 1);
    assert.equal(f.spawns[0].input.join(""), "close\n");
  }
});

test("guardian exit aborts the active qualification lifetime", async () => {
  const f = controllerFixture();
  await assert.rejects(
    withQualificationRoute(
      f.route,
      async (_facts, signal) => {
        queueMicrotask(() => f.spawns[0].stop());
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
      { spawnProcess: f.spawnProcess, platform: "darwin" },
    ),
    (error) => error.uncertain === true,
  );
});

test("controller cannot enter qualification without verified guardian readiness", async () => {
  const f = controllerFixture({ ready: false, cleaned: false });
  let called = false;
  await assert.rejects(
    withQualificationRoute(
      f.route,
      () => {
        called = true;
      },
      { spawnProcess: f.spawnProcess, platform: "darwin" },
    ),
    { name: "AggregateError" },
  );
  assert.equal(called, false);
  assert.equal(f.spawns.length, 1);
});

test("controller rejects untrusted runners and invalid input without remote effects", async () => {
  const f = controllerFixture();
  for (const route of [
    { ...f.route, trustedEphemeralRunner: false },
    { ...f.route, privateAddress: "0.0.0.0" },
    { ...f.route, localPort: 8443 },
  ])
    await assert.rejects(
      withQualificationRoute(route, () => {}, {
        spawnProcess: f.spawnProcess,
        platform: "darwin",
      }),
    );
  await assert.rejects(
    withQualificationRoute(f.route, () => {}, {
      spawnProcess: f.spawnProcess,
      platform: "linux",
    }),
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.spawns.length, 0);
  assert.throws(
    () => f.host.prepare({ operationNonce: "../escape" }),
    /identity/,
  );
  assert.throws(
    () => createQualificationHost({ ...config, host: "-oProxyCommand=bad" }),
    /WEBSITE_DEPLOY_HOST/,
  );
});

test("staging verifies local files before SSH and preserves exact inventory in the helper request", (t) => {
  const root = temporary(t);
  const source = join(root, "feed.json");
  const bytes = Buffer.from('{"version":"1.2.3"}');
  writeFileSync(source, bytes);
  const calls = [];
  const host = createQualificationHost(config, {
    environment: { PATH: process.env.PATH },
    execute: (command, args, options) => {
      if (command === "tar") return execFileSync(command, args, options);
      calls.push({ command, args, options });
      const archive = readFileSync(options.stdio[0]);
      assert(archive.includes(bytes));
      const request = JSON.parse(
        Buffer.from(args.at(-1).split(" ").at(-1), "base64"),
      );
      assert.deepEqual(request.files, {
        [config.feedPath]: { size: bytes.length, sha256: sha(bytes) },
      });
      assert.equal(request.operationNonce, operation.operationNonce);
      return JSON.stringify({ candidateFeedSha256: sha(bytes) });
    },
  });
  const request = {
    ...operation,
    files: [
      { path: config.feedPath, source, size: bytes.length, sha256: sha(bytes) },
    ],
  };
  assert.equal(host.stage(request).candidateFeedSha256, sha(bytes));
  assert.equal(calls.length, 1);
  assert.throws(
    () =>
      host.stage({
        ...request,
        files: [{ ...request.files[0], sha256: "b".repeat(64) }],
      }),
    /hash differs/,
  );
  assert.equal(calls.length, 1);
});
