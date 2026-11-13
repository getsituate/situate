import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { dependencyLockPath } from "./test.mjs";

const helperSource = new URL("./run-coordinated.mjs", import.meta.url);
const supervisorSource = fileURLToPath(
  new URL("./worktree-supervisor.py", import.meta.url),
);

async function until(predicate) {
  const end = performance.now() + 15000;
  while (!predicate()) {
    assert.ok(performance.now() < end, "condition did not become true");
    await delay(25);
  }
}

function fixture(t, inspection = () => "") {
  const directory = mkdtempSync(join(tmpdir(), "situate-coordination-test-"));
  const helperPath = join(directory, "run-coordinated.mjs");
  copyFileSync(helperSource, helperPath);
  const helper = pathToFileURL(helperPath).href;
  writeFileSync(
    join(directory, "worktree-supervisor.py"),
    `import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("supervisor", ${JSON.stringify(supervisorSource)})
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)
${inspection(directory)}
try:
    sys.exit(supervisor.main(Path(${JSON.stringify(join(directory, "coordination"))})))
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(2)
`,
  );
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await child.done;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  function run(cwd, source, resource = "worktree", environment = {}) {
    const worker = join(directory, `worker-${children.length}.mjs`);
    writeFileSync(worker, source);
    const script = `import {runCoordinated} from ${JSON.stringify(helper)};
      process.exitCode = await runCoordinated({directory: ${JSON.stringify(cwd)}, resource: ${JSON.stringify(resource)}, command: process.execPath, args: [${JSON.stringify(worker)}], onTiming: event => console.log('TIMING:' + JSON.stringify(event))});`;
    const inheritedEnvironment = { ...process.env };
    delete inheritedEnvironment.SITUATE_TOOL_BUILD_SLOTS;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...inheritedEnvironment, ...environment, NODE_TEST_CONTEXT: "" },
      },
    );
    child.output = "";
    child.stdout.on("data", (chunk) => (child.output += chunk));
    child.stderr.on("data", (chunk) => (child.output += chunk));
    child.done = new Promise((resolve) => {
      child.once("close", resolve);
    });
    children.push(child);
    return child;
  }
  return { directory, run, helper };
}

function fakeDocker(directory) {
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "docker"),
    `#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(${JSON.stringify(directory)})
(root / 'docker-environment.json').write_text(json.dumps({key: os.environ[key] for key in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'SSH_AUTH_SOCK', 'HOME') if key in os.environ}))
args = sys.argv[1:]
with (root / 'docker-calls.jsonl').open('a') as stream:
    stream.write(json.dumps(args) + '\\n')
if (root / 'docker-outage').exists():
    print('Cannot connect to the Docker daemon', file=sys.stderr)
    sys.exit(1)
state = root / 'docker-state.json'
if args[:2] == ['container', 'inspect']:
    if state.exists():
        print('[' + state.read_text() + ']')
    else:
        print('[]')
        print('Error response from daemon: No such container: ' + args[2], file=sys.stderr)
        sys.exit(1)
elif args[:3] == ['container', 'rm', '--force']:
    if (root / 'docker-remove-failure').exists():
        print('container removal failed', file=sys.stderr)
        sys.exit(1)
    assert json.loads(state.read_text())['Id'] == args[3]
    state.unlink()
else:
    raise ValueError(args)
`,
    { mode: 0o700 },
  );
  return { PATH: `${bin}:${process.env.PATH}` };
}

const dockerToken = "11111111-1111-4111-8111-111111111111";
const dockerName = `situate-pipeline-${dockerToken}`;
const dockerId = "a".repeat(64);
const dockerState = (token = dockerToken) => ({
  Name: `/${dockerName}`,
  Id: dockerId,
  Config: { Labels: { "dev.situate.ci-run": token } },
});
function dockerWorker(
  directory,
  token = dockerToken,
  tail = "setInterval(()=>{},1000);",
) {
  return `import {openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
    const lease=process.env.SITUATE_DOCKER_LEASE;
    if(!lease) throw new Error('missing Docker lease');
    const fd=openSync(lease,'wx',0o600);
    writeFileSync(fd,JSON.stringify({name:${JSON.stringify(dockerName)},token:${JSON.stringify(dockerToken)}})+'\\n');
    fsyncSync(fd);closeSync(fd);
    writeFileSync(${JSON.stringify(join(directory, "docker-state.json"))},JSON.stringify(${JSON.stringify(dockerState(token))}));
    writeFileSync(${JSON.stringify(join(directory, "lease-path"))},lease);
    ${tail}`;
}

function dockerBuildWorker(
  directory,
  gate,
  tail = "setInterval(()=>{},1000);",
) {
  return `import {openSync,writeFileSync,readFileSync,lstatSync,fsyncSync,closeSync,existsSync,renameSync} from 'node:fs';
    const lease=process.env.SITUATE_DOCKER_LEASE;
    const token=${JSON.stringify(dockerToken)};
    const name=${JSON.stringify(dockerName)};
    const temporary=lease+'.publishing';
    const fd=openSync(temporary,'wx',0o600);
    writeFileSync(fd,JSON.stringify({name,token,creationPending:true,buildPending:true}));fsyncSync(fd);closeSync(fd);renameSync(temporary,lease);
    writeFileSync(${JSON.stringify(join(directory, "lease-path"))},lease);
    const until=predicate=>new Promise(resolve=>{const timer=setInterval(()=>{if(predicate()){clearInterval(timer);resolve();}},10);});
    const ack=lease+'.'+token+'.build';
    await until(()=>{try{const stat=lstatSync(ack);const value=JSON.parse(readFileSync(ack,'utf8'));return stat.isFile()&&stat.nlink===1&&(stat.mode&0o777)===0o600&&value.name===name&&value.token===token;}catch{return false;}});
    writeFileSync(${JSON.stringify(join(directory, "build-admitted"))},'');
    ${gate ? `await until(()=>existsSync(${JSON.stringify(gate)}));` : ""}
    writeFileSync(${JSON.stringify(join(directory, "docker-state.json"))},JSON.stringify(${JSON.stringify(dockerState())}));
    const cid=openSync(lease+'.'+token+'.cid','wx',0o600);writeFileSync(cid,${JSON.stringify(dockerId)});fsyncSync(cid);closeSync(cid);
    ${tail}`;
}

function gated(directory, name, extra = "") {
  return `import {existsSync, writeFileSync} from 'node:fs';
    ${extra}
    writeFileSync(${JSON.stringify(join(directory, name))}, String(process.pid));
    const timer = setInterval(() => {
      if (existsSync(${JSON.stringify(join(directory, `${name}-release`))})) clearInterval(timer);
    }, 10);`;
}

test("worktree owners expose a private absent Docker lease without requiring Docker", async (t) => {
  const { directory, run } = fixture(t);
  const result = run(
    directory,
    `import {existsSync,statSync,writeFileSync} from 'node:fs';
    import {dirname} from 'node:path';
    const lease=process.env.SITUATE_DOCKER_LEASE;
    if(!lease || existsSync(lease) || (statSync(dirname(lease)).mode & 0o777)!==0o700) throw new Error('invalid lease directory');
    writeFileSync(${JSON.stringify(join(directory, "lease-path"))},lease);`,
    "worktree",
    fakeDocker(directory),
  );
  assert.equal(await result.done, 0, result.output);
  assert.equal(existsSync(join(directory, "docker-calls.jsonl")), false);
  assert.equal(
    existsSync(readFileSync(join(directory, "lease-path"), "utf8")),
    false,
  );
});

test("nested resource supervisors inherit but do not reclaim the outer Docker lease", async (t) => {
  const { directory, run, helper } = fixture(t);
  const tail = `const {runCoordinated}=await import(${JSON.stringify(helper)});
    const {existsSync}=await import('node:fs');
    const result=await runCoordinated({directory:${JSON.stringify(directory)},resource:'desktop',command:process.execPath,args:['-e',"if(!require('node:fs').existsSync(process.env.SITUATE_DOCKER_LEASE)) throw new Error('outer lease missing')"]});
    if(result!==0 || !existsSync(${JSON.stringify(join(directory, "docker-state.json"))})) throw new Error('nested supervisor reclaimed outer container');`;
  const result = run(
    directory,
    dockerWorker(directory, dockerToken, tail),
    "worktree",
    fakeDocker(directory),
  );
  assert.equal(await result.done, 0, result.output);
  assert.equal(existsSync(join(directory, "docker-state.json")), false);
});

test("cancellation waits for late Docker creation acknowledgement before draining its client", async (t) => {
  const { directory, run } = fixture(t);
  const env = fakeDocker(directory);
  const gate = join(directory, "allow-creation");
  const owner = run(
    directory,
    `import {openSync,writeFileSync,fsyncSync,closeSync,existsSync} from 'node:fs';
    const lease=process.env.SITUATE_DOCKER_LEASE;
    const fd=openSync(lease,'wx',0o600);
    writeFileSync(fd,JSON.stringify({name:${JSON.stringify(dockerName)},token:${JSON.stringify(dockerToken)},creationPending:true}));fsyncSync(fd);closeSync(fd);
    writeFileSync(${JSON.stringify(join(directory, "creating-client"))},String(process.pid));
    const timer=setInterval(()=>{
      if(!existsSync(${JSON.stringify(gate)})) return;
      clearInterval(timer);
      writeFileSync(${JSON.stringify(join(directory, "docker-state.json"))},JSON.stringify(${JSON.stringify(dockerState())}));
      const cid=openSync(lease+'.'+${JSON.stringify(dockerToken)}+'.cid','wx',0o600);writeFileSync(cid,${JSON.stringify(dockerId)});fsyncSync(cid);closeSync(cid);
      setInterval(()=>{},1000);
    },10);`,
    "worktree",
    env,
  );
  let next;
  try {
    await until(() => existsSync(join(directory, "creating-client")));
    owner.kill("SIGTERM");
    await until(() =>
      owner.output.includes("Docker creation is unacknowledged"),
    );
    next = run(directory, "console.log('after-creation');", "worktree", env);
    await until(() => next.output.includes("Waiting for the current worktree"));
    process.kill(
      Number(readFileSync(join(directory, "creating-client"), "utf8")),
      0,
    );
    assert.equal(next.exitCode, null);
    assert.equal(existsSync(join(directory, "docker-calls.jsonl")), false);
    writeFileSync(gate, "");
    assert.equal(await owner.done, 143, owner.output);
    assert.equal(await next.done, 0, next.output);
    assert.equal(existsSync(join(directory, "docker-state.json")), false);
  } finally {
    writeFileSync(gate, "");
    if (owner.exitCode === null && owner.signalCode === null) owner.kill();
    await owner.done;
    if (next) await next.done;
  }
});

test("Docker cleanup uses the recorded client environment rather than inherited defaults", async (t) => {
  const { directory, run } = fixture(t);
  const source = dockerWorker(directory, dockerToken, "").replace(
    `token:${JSON.stringify(dockerToken)}}`,
    `token:${JSON.stringify(dockerToken)},dockerEnvironment:{DOCKER_CONTEXT:'exact-client',SSH_AUTH_SOCK:'/synthetic/client-agent',HOME:${JSON.stringify(directory)}}}`,
  );
  const result = run(directory, source, "worktree", {
    ...fakeDocker(directory),
    DOCKER_CONTEXT: "other-client",
    DOCKER_HOST: "tcp://unrelated.invalid",
    SSH_AUTH_SOCK: "/synthetic/other-agent",
  });
  assert.equal(await result.done, 0, result.output);
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(directory, "docker-environment.json"), "utf8"),
    ),
    {
      DOCKER_CONTEXT: "exact-client",
      SSH_AUTH_SOCK: "/synthetic/client-agent",
      HOME: directory,
    },
  );
});

test("hard caller termination retains the worktree until Docker ownership cleanup resolves", async (t) => {
  const { directory, run } = fixture(t);
  const env = fakeDocker(directory);
  const outage = join(directory, "docker-outage");
  writeFileSync(outage, "");
  const owner = run(directory, dockerWorker(directory), "worktree", env);
  let next;
  try {
    await until(() => existsSync(join(directory, "lease-path")));
    next = run(directory, "console.log('after-container');", "worktree", env);
    await until(() => next.output.includes("Waiting for the current worktree"));
    owner.kill("SIGKILL");
    await owner.done;
    await until(() => existsSync(join(directory, "docker-calls.jsonl")));
    assert.equal(next.exitCode, null);
    assert.equal(existsSync(join(directory, "docker-state.json")), true);
    rmSync(outage);
    assert.equal(await next.done, 0, next.output);
    assert.equal(existsSync(join(directory, "docker-state.json")), false);
    const calls = readFileSync(join(directory, "docker-calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      calls.filter((args) => args[1] === "rm"),
      [["container", "rm", "--force", dockerId]],
    );
    assert.deepEqual(calls.at(-1), ["container", "inspect", dockerName]);
  } finally {
    rmSync(outage, { force: true });
    if (owner.exitCode === null && owner.signalCode === null) owner.kill();
    if (next) await next.done;
  }
});

for (const obstacle of ["label-mismatch", "removal-failure"]) {
  test(`Docker ${obstacle} retains the queue and never removes an unrelated container`, async (t) => {
    const { directory, run } = fixture(t);
    const env = fakeDocker(directory);
    const failure = join(directory, "docker-remove-failure");
    if (obstacle === "removal-failure") writeFileSync(failure, "");
    const owner = run(
      directory,
      dockerWorker(
        directory,
        obstacle === "label-mismatch" ? "unrelated" : dockerToken,
      ),
      "worktree",
      env,
    );
    let next;
    try {
      await until(() => existsSync(join(directory, "lease-path")));
      owner.kill("SIGTERM");
      await until(() => owner.output.includes("Docker cleanup is unverified"));
      next = run(directory, "console.log('resolved');", "worktree", env);
      await until(() =>
        next.output.includes("Waiting for the current worktree"),
      );
      assert.equal(owner.exitCode, null);
      assert.equal(next.exitCode, null);
      if (obstacle === "label-mismatch") {
        assert(
          !readFileSync(join(directory, "docker-calls.jsonl"), "utf8").includes(
            '"rm"',
          ),
        );
        rmSync(join(directory, "docker-state.json"));
      } else rmSync(failure);
      assert.equal(await owner.done, 143, owner.output);
      assert.equal(await next.done, 0, next.output);
    } finally {
      rmSync(failure, { force: true });
      rmSync(join(directory, "docker-state.json"), { force: true });
      if (owner.exitCode === null && owner.signalCode === null) owner.kill();
      await owner.done;
      if (next) await next.done;
    }
  });
}

test("launchers can clean sequential containers without removing the outer lease directory", async (t) => {
  const { directory, run } = fixture(t);
  const cleanup = `import importlib.util, sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('supervisor',${JSON.stringify(supervisorSource)})\ns=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(s)\ns.cleanup_docker_lease(Path(sys.argv[1]))`;
  const tail = `const {execFileSync}=await import('node:child_process');
    const {existsSync}=await import('node:fs');
    const {dirname}=await import('node:path');
    const cleanup=()=>execFileSync('python3',['-c',${JSON.stringify(cleanup)},lease]);
    cleanup();
    if(existsSync(lease) || !existsSync(dirname(lease))) throw new Error('lease directory cannot be reused');
    const second=openSync(lease,'wx',0o600);
    writeFileSync(second,JSON.stringify({name:${JSON.stringify(dockerName)},token:${JSON.stringify(dockerToken)}}));fsyncSync(second);closeSync(second);
    writeFileSync(${JSON.stringify(join(directory, "docker-state.json"))},JSON.stringify(${JSON.stringify(dockerState())}));
    cleanup();`;
  const result = run(
    directory,
    dockerWorker(directory, dockerToken, tail),
    "worktree",
    fakeDocker(directory),
  );
  assert.equal(await result.done, 0, result.output);
  const calls = readFileSync(join(directory, "docker-calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(calls.filter((args) => args[1] === "rm").length, 2);
});

test(
  "real owned Docker container is removed after hard caller termination",
  { skip: !process.env.SITUATE_TEST_DOCKER_LEASE_IMAGE },
  async (t) => {
    const image = process.env.SITUATE_TEST_DOCKER_LEASE_IMAGE;
    assert.match(image, /^\S+@sha256:[a-f0-9]{64}$/u);
    const { directory, run } = fixture(t);
    const token = randomUUID();
    const name = `situate-pipeline-${token}`;
    const inspect = () =>
      JSON.parse(
        execFileSync("docker", ["container", "inspect", name], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 10000,
        }),
      )[0];
    const owner = run(
      directory,
      `import {openSync,writeFileSync,readFileSync,lstatSync,fsyncSync,closeSync,renameSync} from 'node:fs';
    import {spawn} from 'node:child_process';
    process.umask(0o077);
    const temporary=process.env.SITUATE_DOCKER_LEASE+'.publishing';
    const fd=openSync(temporary,'wx',0o600);
    writeFileSync(fd,JSON.stringify({name:${JSON.stringify(name)},token:${JSON.stringify(token)},creationPending:true,buildPending:true}));fsyncSync(fd);closeSync(fd);renameSync(temporary,process.env.SITUATE_DOCKER_LEASE);
    const ack=process.env.SITUATE_DOCKER_LEASE+'.'+${JSON.stringify(token)}+'.build';
    await new Promise(resolve=>{const timer=setInterval(()=>{try{const stat=lstatSync(ack);const value=JSON.parse(readFileSync(ack,'utf8'));if(stat.nlink===1&&(stat.mode&0o777)===0o600&&value.name===${JSON.stringify(name)}&&value.token===${JSON.stringify(token)}){clearInterval(timer);resolve();}}catch{}},10);});
    const docker=spawn('docker',['run','--cidfile',process.env.SITUATE_DOCKER_LEASE+'.'+${JSON.stringify(token)}+'.cid','--pull=never','--network=none','--label',${JSON.stringify(`dev.situate.ci-run=${token}`)},'--name',${JSON.stringify(name)},'--entrypoint','/bin/sh',${JSON.stringify(image)},'-c','trap "" TERM; while :; do sleep 1; done'],{stdio:'ignore'});
    docker.on('exit',code=>{process.exitCode=code ?? 1;});`,
    );
    let next;
    try {
      await until(() => {
        try {
          return inspect().State.Running === true;
        } catch {
          return false;
        }
      });
      next = run(directory, "console.log('after-real-container');");
      await until(() =>
        next.output.includes("Waiting for the current worktree"),
      );
      owner.kill("SIGKILL");
      await owner.done;
      assert.equal(await next.done, 0, next.output);
      assert.throws(inspect);
    } finally {
      try {
        const container = inspect();
        if (container.Config.Labels?.["dev.situate.ci-run"] === token)
          execFileSync("docker", ["container", "rm", "--force", container.Id], {
            stdio: "ignore",
            timeout: 30000,
          });
      } catch {
        /* The supervisor normally removes the owned container. */
      }
      if (owner.exitCode === null && owner.signalCode === null) owner.kill();
      await owner.done;
      if (next) await next.done;
    }
  },
);

test("Docker admission shares the host build budget and survives caller loss through cleanup", async (t) => {
  const { directory, run } = fixture(t);
  const portable = join(directory, "portable");
  mkdirSync(portable);
  const env = fakeDocker(portable);
  const gate = join(portable, "create-container");
  const outage = join(portable, "docker-outage");
  const first = run(directory, gated(directory, "host-one"), "build");
  const second = run(directory, gated(directory, "host-two"), "build");
  let owner, next;
  try {
    await until(
      () =>
        existsSync(join(directory, "host-one")) &&
        existsSync(join(directory, "host-two")),
    );
    owner = run(portable, dockerBuildWorker(portable, gate), "worktree", env);
    await until(() => owner.output.includes("Waiting for the current build"));
    assert.equal(existsSync(join(portable, "build-admitted")), false);
    writeFileSync(join(directory, "host-one-release"), "");
    assert.equal(await first.done, 0, first.output);
    await until(() => existsSync(join(portable, "build-admitted")));
    const lease = readFileSync(join(portable, "lease-path"), "utf8");
    assert.equal(existsSync(`${lease}.${dockerToken}.build`), true);
    assert.equal(existsSync(`${lease}.${dockerToken}.cid`), false);
    writeFileSync(outage, "");
    owner.kill("SIGKILL");
    await owner.done;
    next = run(directory, "console.log('after-admitted-container');", "build");
    await until(() => next.output.includes("Waiting for the current build"));
    assert.equal(next.exitCode, null);
    writeFileSync(gate, "");
    await until(() => existsSync(join(portable, "docker-calls.jsonl")));
    assert.equal(next.exitCode, null);
    assert.equal(existsSync(join(portable, "docker-state.json")), true);
    rmSync(outage);
    assert.equal(await next.done, 0, next.output);
    assert.equal(existsSync(join(portable, "docker-state.json")), false);
    assert.equal(existsSync(`${lease}.${dockerToken}.build`), false);
  } finally {
    writeFileSync(gate, "");
    rmSync(outage, { force: true });
    for (const marker of ["host-one-release", "host-two-release"])
      writeFileSync(join(directory, marker), "");
    if (owner && owner.exitCode === null && owner.signalCode === null)
      owner.kill();
    await Promise.all([
      first.done,
      second.done,
      ...(owner ? [owner.done] : []),
      ...(next ? [next.done] : []),
    ]);
  }
});

test("cancellation before Docker build acknowledgement clears an unstarted intent without CID lookup", async (t) => {
  const { directory, run } = fixture(t);
  const portable = join(directory, "portable");
  mkdirSync(portable);
  const env = fakeDocker(portable);
  const first = run(directory, gated(directory, "host-one"), "build");
  const second = run(directory, gated(directory, "host-two"), "build");
  let owner, next;
  try {
    await until(
      () =>
        existsSync(join(directory, "host-one")) &&
        existsSync(join(directory, "host-two")),
    );
    owner = run(portable, dockerBuildWorker(portable), "worktree", env);
    await until(() => owner.output.includes("Waiting for the current build"));
    const lease = readFileSync(join(portable, "lease-path"), "utf8");
    owner.kill("SIGKILL");
    await owner.done;
    next = run(
      portable,
      "console.log('after-unstarted-container');",
      "worktree",
      env,
    );
    assert.equal(await next.done, 0, next.output);
    assert.equal(existsSync(lease), false);
    assert.equal(existsSync(`${lease}.${dockerToken}.build`), false);
    assert.equal(existsSync(join(portable, "docker-calls.jsonl")), false);
    assert.equal(first.exitCode, null);
    assert.equal(second.exitCode, null);
  } finally {
    for (const marker of ["host-one-release", "host-two-release"])
      writeFileSync(join(directory, marker), "");
    if (owner && owner.exitCode === null && owner.signalCode === null)
      owner.kill();
    await Promise.all([
      first.done,
      second.done,
      ...(owner ? [owner.done] : []),
      ...(next ? [next.done] : []),
    ]);
  }
});

test("normal Docker cleanup admits a following host build before its worktree owner exits", async (t) => {
  const { directory, run, helper } = fixture(t);
  const portable = join(directory, "portable");
  mkdirSync(portable);
  const env = fakeDocker(portable);
  const heavy = run(directory, gated(directory, "host-heavy"), "build");
  const cleanup = `import importlib.util,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('supervisor',${JSON.stringify(supervisorSource)})\ns=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(s)\ns.cleanup_docker_lease(Path(sys.argv[1]))`;
  let owner;
  try {
    await until(() => existsSync(join(directory, "host-heavy")));
    const tail = `const {execFileSync}=await import('node:child_process');
      execFileSync('python3',['-c',${JSON.stringify(cleanup)},lease]);
      const {runCoordinated}=await import(${JSON.stringify(helper)});
      const result=await runCoordinated({directory:${JSON.stringify(portable)},resource:'build',command:process.execPath,args:['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(join(portable, "host-phase"))},'');`)}]});
      if(result!==0) throw new Error('following host build failed');`;
    owner = run(
      portable,
      dockerBuildWorker(portable, undefined, tail),
      "worktree",
      env,
    );
    await until(() => existsSync(join(portable, "host-phase")));
    assert.equal(await owner.done, 0, owner.output);
    assert.equal(heavy.exitCode, null);
    assert.equal(existsSync(join(portable, "docker-state.json")), false);
  } finally {
    writeFileSync(join(directory, "host-heavy-release"), "");
    if (owner && owner.exitCode === null && owner.signalCode === null)
      owner.kill();
    await Promise.all([heavy.done, ...(owner ? [owner.done] : [])]);
  }
});

test("one guest build slot serializes heavy jobs without changing the default host budget", async (t) => {
  const { directory, run } = fixture(t);
  const env = { SITUATE_TOOL_BUILD_SLOTS: "1" };
  const first = run(directory, gated(directory, "guest-one"), "build", env);
  try {
    await until(() => existsSync(join(directory, "guest-one")));
    const second = run(directory, "console.log('guest-two');", "build", env);
    await until(() => second.output.includes("Waiting for the current build"));
    assert.equal(second.exitCode, null);
    writeFileSync(join(directory, "guest-one-release"), "");
    assert.equal(await first.done, 0, first.output);
    assert.equal(await second.done, 0, second.output);
  } finally {
    writeFileSync(join(directory, "guest-one-release"), "");
  }
});

test("commands in one worktree wait while different worktrees proceed", async (t) => {
  const { directory, run } = fixture(t);
  const a = join(directory, "checkout with spaces");
  const b = join(directory, "other");
  mkdirSync(a);
  mkdirSync(b);
  const first = run(a, gated(directory, "first"), "worktree", { TMPDIR: a });
  await until(() => existsSync(join(directory, "first")));
  const second = run(a, gated(directory, "second"), "worktree", { TMPDIR: b });
  await until(() => second.output.includes("Waiting for the current worktree"));
  assert.equal(existsSync(join(directory, "second")), false);
  const independent = run(b, "console.log('independent');");
  assert.equal(await independent.done, 0, independent.output);
  assert.match(independent.output, /independent/);
  writeFileSync(join(directory, "first-release"), "");
  assert.equal(await first.done, 0, first.output);
  await until(() => existsSync(join(directory, "second")));
  writeFileSync(join(directory, "second-release"), "");
  assert.equal(await second.done, 0, second.output);
});

test("cancelling a queued command never starts it or interrupts its owner", async (t) => {
  const { directory, run } = fixture(t);
  const first = run(directory, gated(directory, "first"));
  await until(() => existsSync(join(directory, "first")));
  const waiter = run(directory, gated(directory, "waiter"));
  await until(() => waiter.output.includes("Waiting for the current worktree"));
  waiter.kill("SIGTERM");
  assert.equal(await waiter.done, 143, waiter.output);
  assert.equal(existsSync(join(directory, "waiter")), false);
  assert.equal(first.exitCode, null);
  writeFileSync(join(directory, "first-release"), "");
  assert.equal(await first.done, 0, first.output);
});

test("hard caller termination drains detached descendants and releases only owned dependency locks", async (t) => {
  const { directory, run } = fixture(t);
  const lock = dependencyLockPath(directory, ".");
  t.after(() => rmSync(lock, { recursive: true, force: true }));
  const first = run(
    directory,
    `
    import {spawn, execFileSync} from 'node:child_process';
    import {mkdirSync, writeFileSync} from 'node:fs';
    const listing = execFileSync('ps',['-p',String(process.pid),'-o','lstart='],{encoding:'utf8'}).trim();
    mkdirSync(${JSON.stringify(lock)});
    writeFileSync(${JSON.stringify(join(lock, "owner.json"))},JSON.stringify({pid:process.pid,born:listing}));
    const child=spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    writeFileSync(${JSON.stringify(join(directory, "descendant"))},String(child.pid));
    writeFileSync(${JSON.stringify(join(directory, "first"))},String(process.pid));
    setInterval(()=>{},1000);
  `,
  );
  await until(() => existsSync(join(directory, "descendant")));
  // The queue diagnostic also gives the supervisor time to observe the child.
  const next = run(directory, "console.log('next');");
  await until(() => next.output.includes("Waiting for the current worktree"));
  const pid = Number(readFileSync(join(directory, "descendant"), "utf8"));
  first.kill("SIGKILL");
  await first.done;
  assert.equal(await next.done, 0, next.output);
  assert.equal(existsSync(lock), false);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("desktop phases queue across worktrees without blocking worktree-only commands", async (t) => {
  const { directory, run } = fixture(t);
  const other = join(directory, "other");
  mkdirSync(other);
  const first = run(directory, gated(directory, "gui-one"), "desktop", {
    TMPDIR: directory,
  });
  await until(() => existsSync(join(directory, "gui-one")));
  const second = run(other, gated(directory, "gui-two"), "desktop", {
    TMPDIR: other,
  });
  await until(() => second.output.includes("Waiting for the current desktop"));
  const build = run(other, "console.log('build');");
  assert.equal(await build.done, 0, build.output);
  assert.equal(existsSync(join(directory, "gui-two")), false);
  writeFileSync(join(directory, "gui-one-release"), "");
  assert.equal(await first.done, 0, first.output);
  await until(() => existsSync(join(directory, "gui-two")));
  writeFileSync(join(directory, "gui-two-release"), "");
  assert.equal(await second.done, 0, second.output);
});

test("nested desktop leases remain held until cancellation drains their descendants", async (t) => {
  const { directory, run, helper } = fixture(t);
  const marker = join(directory, "nested.pid");
  const app = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
  const source = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(app)}],{detached:true,stdio:'ignore'}).unref();process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
  const owner = run(
    directory,
    `import {runCoordinated} from ${JSON.stringify(helper)};
    await runCoordinated({directory: ${JSON.stringify(directory)},resource:'desktop',command:process.execPath,args:['-e',${JSON.stringify(source)}]});`,
  );
  await until(
    () => existsSync(marker) && /^[1-9]\d*$/.test(readFileSync(marker, "utf8")),
  );
  const pid = Number(readFileSync(marker, "utf8"));
  const next = run(
    directory,
    `import {spawnSync} from 'node:child_process';
    const old=spawnSync('ps',['-p',${JSON.stringify(String(pid))},'-o','stat='],{encoding:'utf8'});
    if(old.status===0 && !old.stdout.trim().startsWith('Z')) throw new Error('desktop lease released before descendant exit');`,
    "desktop",
  );
  await until(() => next.output.includes("Waiting for the current desktop"));
  owner.kill("SIGKILL");
  await owner.done;
  assert.equal(await next.done, 0, next.output);
});

test("an initial process inspection failure preserves the running command and its lease", async (t) => {
  const { directory, run } = fixture(t);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const marker = join(directory, "ps-failed");
  writeFileSync(
    join(bin, "ps"),
    `#!/bin/sh\nif [ ! -f '${marker}' ]; then touch '${marker}'; exit 1; fi\nexec /bin/ps "$@"\n`,
    { mode: 0o700 },
  );
  const result = run(directory, gated(directory, "healthy"), "worktree", {
    PATH: `${bin}:${process.env.PATH}`,
  });
  await until(
    () =>
      existsSync(marker) &&
      existsSync(join(directory, "healthy")) &&
      result.output.includes("preserving the running command"),
  );
  const next = run(directory, "console.log('after-recovery');");
  await until(() => next.output.includes("Waiting for the current worktree"));
  assert.equal(result.exitCode, null);
  process.kill(Number(readFileSync(join(directory, "healthy"), "utf8")), 0);
  writeFileSync(join(directory, "healthy-release"), "");
  assert.equal(await result.done, 0, result.output);
  assert.equal(await next.done, 0, next.output);
});

test("transient ownership timeouts never rerun or signal the healthy command", async (t) => {
  const { directory, run } = fixture(
    t,
    (root) => `
real_snapshot = supervisor.snapshot
attempts = 0
def transient_snapshot():
    global attempts
    attempts += 1
    if attempts <= 2:
        raise supervisor.subprocess.TimeoutExpired('ps', 10)
    result = real_snapshot()
    Path(${JSON.stringify(join(root, "observed"))}).touch()
    return result
supervisor.snapshot = transient_snapshot
`,
  );
  const starts = join(directory, "starts");
  const current = run(
    directory,
    gated(
      directory,
      "healthy",
      `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(starts)}, 'started\\n');`,
    ),
  );
  await until(
    () =>
      existsSync(join(directory, "observed")) &&
      existsSync(join(directory, "healthy")),
  );
  assert.equal(current.exitCode, null);
  assert.match(
    current.output,
    /preserving the running command and resource lease/,
  );
  assert.equal(readFileSync(starts, "utf8"), "started\n");
  process.kill(Number(readFileSync(join(directory, "healthy"), "utf8")), 0);
  writeFileSync(join(directory, "healthy-release"), "");
  assert.equal(await current.done, 0, current.output);
});

test("cancellation during unverified ownership retains the job and lease until inspection recovers", async (t) => {
  const { directory, run } = fixture(
    t,
    (root) => `
real_snapshot = supervisor.snapshot
def gated_snapshot():
    if Path(${JSON.stringify(join(root, "inspection-down"))}).exists():
        Path(${JSON.stringify(join(root, "inspection-failed"))}).touch()
        raise supervisor.subprocess.TimeoutExpired('ps', 10)
    result = real_snapshot()
    Path(${JSON.stringify(join(root, "observed"))}).touch()
    return result
supervisor.snapshot = gated_snapshot
`,
  );
  const outage = join(directory, "inspection-down");
  const current = run(directory, gated(directory, "healthy"));
  try {
    await until(
      () =>
        existsSync(join(directory, "healthy")) &&
        existsSync(join(directory, "observed")),
    );
    const pid = Number(readFileSync(join(directory, "healthy"), "utf8"));
    writeFileSync(outage, "");
    await until(() => existsSync(join(directory, "inspection-failed")));
    current.kill("SIGTERM");
    await until(() => current.output.includes("retaining the resource lease"));
    const queued = run(directory, "console.log('recovered');");
    await until(() =>
      queued.output.includes("Waiting for the current worktree"),
    );
    assert.equal(current.exitCode, null);
    assert.equal(queued.exitCode, null);
    process.kill(pid, 0);
    rmSync(outage);
    assert.equal(await current.done, 143, current.output);
    assert.equal(await queued.done, 0, queued.output);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    rmSync(outage, { force: true });
  }
});

for (const metadata of [
  undefined,
  {},
  [],
  { pid: process.pid, born: "unrelated" },
]) {
  test(`failed commands preserve their exit code and never reclaim unknown locks (${JSON.stringify(metadata)})`, async (t) => {
    const { directory, run } = fixture(t);
    const lock = dependencyLockPath(directory, ".");
    mkdirSync(lock);
    if (metadata)
      writeFileSync(join(lock, "owner.json"), JSON.stringify(metadata));
    t.after(() => rmSync(lock, { recursive: true, force: true }));
    const result = run(
      directory,
      "console.error('failed');process.exitCode=7;",
    );
    assert.equal(await result.done, 7, result.output);
    assert.match(result.output, /failed/);
    assert.equal(existsSync(lock), true);
    if (metadata)
      assert.equal(
        readFileSync(join(lock, "owner.json"), "utf8"),
        JSON.stringify(metadata),
      );
  });
}

test("nested working directories share the Git worktree lease", async (t) => {
  const { directory, run } = fixture(t);
  execFileSync("git", ["init", "-q", directory]);
  const nested = join(directory, "client");
  mkdirSync(nested);
  const first = run(directory, gated(directory, "root-owner"));
  await until(() => existsSync(join(directory, "root-owner")));
  const second = run(nested, "console.log('nested');");
  await until(() => second.output.includes("Waiting for the current worktree"));
  assert.equal(second.exitCode, null);
  writeFileSync(join(directory, "root-owner-release"), "");
  assert.equal(await first.done, 0, first.output);
  assert.equal(await second.done, 0, second.output);
});

test("coordination fixtures do not share build or desktop slots", async (t) => {
  const occupied = fixture(t);
  const independent = fixture(t);
  const owners = [
    occupied.run(
      occupied.directory,
      gated(occupied.directory, "build-one"),
      "build",
    ),
    occupied.run(
      occupied.directory,
      gated(occupied.directory, "build-two"),
      "build",
    ),
    occupied.run(
      occupied.directory,
      gated(occupied.directory, "desktop"),
      "desktop",
    ),
  ];
  await until(() =>
    ["build-one", "build-two", "desktop"].every((name) =>
      existsSync(join(occupied.directory, name)),
    ),
  );
  for (const resource of ["build", "desktop"]) {
    const child = independent.run(
      independent.directory,
      "console.log('independent');",
      resource,
    );
    await until(() => child.exitCode !== null);
    assert.equal(await child.done, 0, child.output);
    assert.match(child.output, /independent/);
  }
  assert.ok(owners.every((child) => child.exitCode === null));
  for (const name of ["build-one", "build-two", "desktop"])
    writeFileSync(join(occupied.directory, `${name}-release`), "");
  for (const child of owners) assert.equal(await child.done, 0, child.output);
});

test("only two heavy jobs run across worktrees and cancellation releases a slot", async (t) => {
  const { directory, run } = fixture(t);
  const first = run(directory, gated(directory, "heavy-one"), "build");
  const second = run(directory, gated(directory, "heavy-two"), "build");
  await until(
    () =>
      existsSync(join(directory, "heavy-one")) &&
      existsSync(join(directory, "heavy-two")),
  );
  const third = run(directory, "console.log('third');", "build");
  await until(() => third.output.includes("Waiting for the current build"));
  assert.equal(third.exitCode, null);
  first.kill("SIGTERM");
  assert.equal(await first.done, 143, first.output);
  assert.equal(await third.done, 0, third.output);
  const timings = third.output
    .split("\n")
    .filter((line) => line.startsWith("TIMING:"))
    .map((line) => JSON.parse(line.slice(7)));
  assert.deepEqual(
    timings.map(({ phase }) => phase),
    ["acquired", "released"],
  );
  assert.ok(timings[0].waitMs > 0);
  assert.ok(timings[1].runMs >= 0);
  writeFileSync(join(directory, "heavy-two-release"), "");
  assert.equal(await second.done, 0, second.output);
});
