import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  hostContainerEnvironment,
  runContainerLane,
} from "./pipeline-container.mjs";
import {
  browserInstallations,
  prepareContainerLane,
} from "./pipeline-container-entry.mjs";

const launcher = new URL("./pipeline-container.py", import.meta.url).pathname;
function fixture(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "situate-container-test-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "client/app"), { recursive: true });
  mkdirSync(join(root, "state"));
  writeFileSync(
    join(root, "client/package.json"),
    JSON.stringify({ workspaces: ["app"] }),
  );
  writeFileSync(join(root, "client/app/package.json"), "{}");
  writeFileSync(
    join(root, "client/rust-toolchain.toml"),
    '[toolchain]\nchannel = "1.98.1"\n',
  );
  return root;
}
function python(source) {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      `import importlib.util,json,pathlib,os\nspec=importlib.util.spec_from_file_location('launcher',${JSON.stringify(launcher)});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n${source}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("tool containers isolate dependencies and credentials and retain their owner identity", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, ".env"), "PRIVATE_SYNTHETIC_INPUT=fixture");
  mkdirSync(join(root, "client/node_modules"));
  writeFileSync(join(root, "client/node_modules/host-sentinel"), "host-native");
  const args = python(
    `print(json.dumps(m.arguments(pathlib.Path(${JSON.stringify(root)}), pathlib.Path(${JSON.stringify(join(root, "state"))}), 'ghcr.io/getsituate/situate-ci-linux@sha256:'+'a'*64, ['actions','plan','--workflow','verify'], {'GH_TOKEN':'synthetic-read-token','OPENAI_API_KEY':'synthetic-private-provider','HTTPS_PROXY':'synthetic-private-proxy','DOCKER_HOST':'synthetic-private-engine','DOCKER_CONFIG':'synthetic-private-config','SSH_AUTH_SOCK':'synthetic-private-socket'}, 'situate-pipeline-fixture','fixture-token')))`,
  );
  assert(args.includes("--init"));
  assert(args.includes("--cap-drop"));
  assert(args.includes("ALL"));
  assert(args.includes("no-new-privileges"));
  assert(args.includes("dev.situate.ci-run=fixture-token"));
  assert(args.includes(`type=bind,src=${root},dst=${root}`));
  assert(args.includes(`${root}/client/node_modules:exec,mode=1777`));
  assert(args.includes(`${root}/client/app/node_modules:exec,mode=1777`));
  assert(args.includes(`${root}/node_modules:exec,mode=1777`));
  assert(args.includes("RUSTUP_TOOLCHAIN=1.98.1"));
  assert(args.includes("PLAYWRIGHT_BROWSERS_PATH=/ci-cache/browsers"));
  assert(args.includes("GH_TOKEN"));
  assert(
    !args.some((arg) =>
      /synthetic-read-token|synthetic-private|docker.sock|--privileged|DOCKER_HOST|DOCKER_CONFIG|SSH_AUTH_SOCK/.test(
        arg,
      ),
    ),
  );
  assert(args.includes("HTTPS_PROXY="));
  assert(args.some((arg) => arg.endsWith(`dst=${root}/.env,readonly`)));
  assert.equal(
    readFileSync(join(root, "client/node_modules/host-sentinel"), "utf8"),
    "host-native",
  );
});

test("Git mounts expose an anonymous origin without host credentials or hooks", (t) => {
  const root = fixture(t);
  for (const args of [
    ["init", root],
    [
      "-C",
      root,
      "remote",
      "add",
      "origin",
      "https://synthetic-user:synthetic-password@github.com/getsituate/situate.git",
    ],
    [
      "-C",
      root,
      "config",
      "http.extraHeader",
      "Authorization: synthetic-private-token",
    ],
  ])
    assert.equal(spawnSync("git", args, { encoding: "utf8" }).status, 0);
  mkdirSync(join(root, ".git/worktrees/other"), { recursive: true });
  writeFileSync(
    join(root, ".git/worktrees/other/config.worktree"),
    "[credential]\n helper = synthetic-private-helper\n",
  );
  const args = python(
    `root=pathlib.Path(${JSON.stringify(root)})\nprint(json.dumps(m.arguments(root,root/'state','ghcr.io/getsituate/situate-ci-linux@sha256:'+'a'*64,[],{},'fixture','fixture')))`,
  );
  assert(
    args.includes(
      `type=bind,src=${root}/state/git-config,dst=${root}/.git/config,readonly`,
    ),
  );
  assert(
    args.includes(
      `type=bind,src=${root}/state/empty-env,dst=${root}/.git/worktrees/other/config.worktree,readonly`,
    ),
  );
  assert(args.includes(`${root}/.git/hooks:mode=0555`));
  const config = readFileSync(join(root, "state/git-config"), "utf8");
  assert.match(config, /url = https:\/\/github.com\/getsituate\/situate.git/);
  assert.doesNotMatch(config, /synthetic|extraHeader|credential/);
  assert.match(
    readFileSync(join(root, ".git/config"), "utf8"),
    /synthetic-password/,
  );
});

test("lease publication is private and cannot overwrite an active container", (t) => {
  const root = fixture(t);
  chmodSync(join(root, "state"), 0o700);
  const value = python(
    `path=pathlib.Path(${JSON.stringify(join(root, "state/lease.json"))})\nm.write_lease(path,'situate-pipeline-first','first')\ntry:m.write_lease(path,'situate-pipeline-second','second')\nexcept ValueError:rejected=True\nelse:rejected=False\nprint(json.dumps({'lease':json.loads(path.read_text()),'mode':path.stat().st_mode&0o777,'rejected':rejected}))`,
  );
  assert.deepEqual(value, {
    lease: { name: "situate-pipeline-first", token: "first" },
    mode: 0o600,
    rejected: true,
  });
});

test("an interrupted lease write cannot publish incomplete ownership data", (t) => {
  const root = fixture(t);
  chmodSync(join(root, "state"), 0o700);
  const lease = join(root, "state/lease.json");
  const source = `import os,signal,json,runpy,pathlib\nm=runpy.run_path(${JSON.stringify(launcher)},run_name='lease_fixture')\ndef interrupted(value,stream):\n stream.write('{');stream.flush();os.kill(os.getpid(),signal.SIGKILL)\njson.dump=interrupted\nm['write_lease'](pathlib.Path(${JSON.stringify(lease)}),'situate-pipeline-first','first')`;
  const result = spawnSync("python3", ["-B", "-c", source], {
    encoding: "utf8",
  });
  assert.equal(result.signal, "SIGKILL", result.stderr);
  assert(!existsSync(lease));
  assert.equal(readFileSync(`${lease}.publishing/container.json`, "utf8"), "{");
});

test("Docker client settings remain on host launchers without production credentials", () => {
  const connection = {
    PATH: "/tools",
    HOME: "/home/ci",
    DOCKER_HOST: "tcp://docker.invalid:2376",
    DOCKER_CONTEXT: "test-engine",
    DOCKER_CONFIG: "/synthetic/docker-config",
    DOCKER_TLS_VERIFY: "1",
    DOCKER_CERT_PATH: "/synthetic/certificates",
    DOCKER_API_VERSION: "1.48",
    SSH_AUTH_SOCK: "/synthetic/ssh-agent.sock",
    SITUATE_DOCKER_LEASE: "/synthetic/lease",
  };
  assert.deepEqual(
    hostContainerEnvironment({
      ...connection,
      OPENAI_API_KEY: "provider-key",
      APPLE_DEVELOPER_ID_P12_BASE64: "signing-key",
      GH_TOKEN: "github-key",
    }),
    connection,
  );
});

test("Python host commands retain only their scoped inputs", () => {
  const value = python(
    `env={'PATH':'/tools','HOME':'/home/ci','DOCKER_CONTEXT':'test-engine','GH_TOKEN':'read-token','OPENAI_API_KEY':'private-provider','APPLE_DEVELOPER_ID_P12_BASE64':'private-signing'}\nprint(json.dumps({'lane':m.host_environment(env,['lane']),'plan':m.host_environment(env,['actions','plan'])}))`,
  );
  assert.deepEqual(value.lane, {
    PATH: "/tools",
    HOME: "/home/ci",
    DOCKER_CONTEXT: "test-engine",
  });
  assert.deepEqual(value.plan, { ...value.lane, GH_TOKEN: "read-token" });
});

test("a local Docker exec failure confirms non-submission without guessing daemon state", () => {
  const value = python(
    `import types\ncleanups=[]\nowner=types.SimpleNamespace(read_docker_lease=lambda path:({'token':'first'},None),cleanup_docker_lease=lambda path,**kwargs:cleanups.append(kwargs))\nm.container_owner=lambda:owner\ndef failed_exec(*args): raise OSError('executable unavailable')\nm.os.execvpe=failed_exec\ntry:m.docker_client('/synthetic/lease','first',['version'],{})\nexcept OSError:failed=True\nelse:failed=False\nprint(json.dumps({'failed':failed,'cleanups':cleanups}))`,
  );
  assert.deepEqual(value, {
    failed: true,
    cleanups: [{ creation_started: false }],
  });
});

test("a withdrawn build admission never starts the Docker client", () => {
  const value = python(
    `import types\nstate={'lease':({'token':'first','buildPending':True},None)}\nexecutions=[]\nowner=types.SimpleNamespace(read_docker_lease=lambda path:state['lease'],docker_build_ack=lambda *args:None)\nm.container_owner=lambda:owner\nm.os.execvpe=lambda *args:executions.append(args)\nm.time.sleep=lambda seconds:state.update(lease=None)\ncode=m.docker_client('/synthetic/lease','first',['version'],{})\nprint(json.dumps({'code':code,'executions':executions}))`,
  );
  assert.deepEqual(value, { code: 130, executions: [] });
});

test("ordinary lane containers receive no GitHub token and reject mutable image tags", (t) => {
  const root = fixture(t);
  const value = python(
    `root=pathlib.Path(${JSON.stringify(root)}); state=root/'state'\nargs=m.arguments(root,state,'ghcr.io/getsituate/situate-ci-linux@sha256:'+'a'*64,['lane','verify'],{'GH_TOKEN':'synthetic-read-token'},'situate-pipeline-fixture','fixture-token')\ntry:m.arguments(root,state,'ghcr.io/getsituate/situate-ci-linux:latest',[],{},'fixture','fixture')\nexcept ValueError:rejected=True\nelse:rejected=False\nprint(json.dumps({'args':args,'rejected':rejected}))`,
  );
  assert(!value.args.some((arg) => arg.includes("GH_TOKEN")));
  assert(value.rejected);
});

test("lane transport retains failed results and binds receipts to their Linux plan", async (t) => {
  const root = fixture(t);
  const plan = {
    workflow: "verify",
    source: "a".repeat(40),
    authorizationDigest: "b".repeat(64),
  };
  for (const status of ["passed", "failed"]) {
    const receipt = {
      source: plan.source,
      planDigest: plan.authorizationDigest,
      lane: "tooling",
      host: "linux",
      executionHost: "linux",
      status,
      results: [{ id: "runner-unit", status }],
    };
    const actual = await runContainerLane(root, plan, "tooling", {
      launch(_command, args) {
        const child = Object.assign(new EventEmitter(), {
          stdout: new PassThrough(),
          stderr: new PassThrough(),
        });
        queueMicrotask(() => {
          writeFileSync(args[5], JSON.stringify(receipt));
          child.emit("close", status === "passed" ? 0 : 1);
        });
        return child;
      },
    });
    assert.deepEqual(actual, receipt);
  }
});

test("lane cancellation waits for the launcher to close before deleting transport files", async (t) => {
  const root = fixture(t);
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  let planFile;
  let settled = false;
  const error = new Error("cancelled");
  const running = runContainerLane(root, { workflow: "verify" }, "tooling", {
    launch(_command, args) {
      planFile = args[3];
      return child;
    },
  });
  const rejection = assert
    .rejects(running, (cause) => cause === error)
    .then(() => {
      settled = true;
    });
  child.emit("error", error);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert(existsSync(planFile));
  child.emit("close", null, "SIGTERM");
  await rejection;
  assert(!existsSync(planFile));
});

test("browser downloads follow selected workspace metadata and share matching versions", () => {
  const manifest = {
    client: { version: "1.63.0" },
    requirements: { version: "1.63.0" },
  };
  assert.deepEqual(
    browserInstallations(
      [
        { npm: "requirements", browsers: ["chromium"] },
        { npm: "client", browsers: ["chromium", "webkit"] },
        { npm: "." },
      ],
      manifest,
    ),
    [
      [
        "/opt/ci-tools/playwright-1.63.0/cli.js",
        "install",
        "chromium",
        "webkit",
      ],
    ],
  );
  assert.deepEqual(browserInstallations([{ npm: "." }], manifest), []);
  assert.throws(
    () =>
      browserInstallations(
        [{ npm: "missing", browsers: ["chromium"] }],
        manifest,
      ),
    /installer/,
  );
});

test("browser download output cannot corrupt the suite progress stream", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "client/docker"));
  writeFileSync(
    join(root, "client/docker/ci-browsers.json"),
    JSON.stringify({ requirements: { version: "1.63.0" } }),
  );
  const calls = [];
  prepareContainerLane(
    root,
    [{ npm: "requirements", browsers: ["chromium"] }],
    (_command, _args, options) => {
      calls.push(options.stdio);
      return { status: 0 };
    },
  );
  assert.deepEqual(calls, [["ignore", 2, 2]]);
});

test("a failed browser download blocks the selected lane", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "client/docker"));
  writeFileSync(
    join(root, "client/docker/ci-browsers.json"),
    JSON.stringify({ requirements: { version: "1.63.0" } }),
  );
  assert.throws(
    () =>
      prepareContainerLane(
        root,
        [{ npm: "requirements", browsers: ["chromium"] }],
        () => ({ status: 1 }),
      ),
    /download failed/,
  );
});
