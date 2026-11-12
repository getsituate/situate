import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  access,
  realpath,
  readdir,
  stat,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createNativeVmRun, nativeVmConfiguration } from "./native-vm.mjs";

async function fixture(t) {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "native-vm-test-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = path.join(directory, "home");
  const bin = path.join(directory, "bin");
  await mkdir(home);
  await mkdir(bin);
  const config = {
    version: 1,
    vm: "situate-tests",
    user: "admin",
    identityFile: "/synthetic/key",
    knownHostsFile: "/synthetic/known_hosts",
    node: process.execPath,
  };
  const configFile = path.join(directory, "config.json");
  await writeFile(configFile, JSON.stringify(config));
  const environment = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    SITUATE_NATIVE_VM_CONFIG: configFile,
    TEST_HOME: home,
    TEST_LOG: path.join(directory, "ssh.log"),
  };
  await writeFile(
    path.join(bin, "tart"),
    "#!/bin/sh\nprintf '192.0.2.1\\n'\n",
    { mode: 0o700 },
  );
  await writeFile(
    path.join(bin, "ssh"),
    `#!/usr/bin/python3
import base64,json,os,pathlib,shlex,sys
with open(os.environ['TEST_LOG'],'a') as log: log.write(json.dumps(sys.argv[1:])+'\\n')
parts=shlex.split(sys.argv[-1])
request=json.loads(base64.b64decode(parts[-1]))
request['root']=request['root'].replace('/Users/admin',os.environ['TEST_HOME'])
pathlib.Path.home=classmethod(lambda cls: pathlib.Path(os.environ['TEST_HOME']))
sys.argv=['supervisor',base64.b64encode(json.dumps(request).encode()).decode()]
if request['operation']=='execute':
 pathlib.Path(os.environ['TEST_HOME'],request['id']+'.connected').touch()
 if os.environ.get('TEST_PS_FAILURES') or os.environ.get('TEST_PS_BLOCK_FILE'):
  import subprocess
  real_check_output=subprocess.check_output
  attempts=0
  def observed_output(command,*args,**kwargs):
   global attempts
   if command[0]=='/bin/ps':
    attempts+=1
    if attempts<=int(os.environ.get('TEST_PS_FAILURES','0')) or pathlib.Path(os.environ.get('TEST_PS_BLOCK_FILE','/nonexistent')).exists():
     pathlib.Path(os.environ['TEST_HOME'],'inspection-failed').write_text(str(attempts))
     raise subprocess.TimeoutExpired(command,10)
    result=real_check_output(command,*args,**kwargs)
    pathlib.Path(os.environ['TEST_HOME'],'inspection-observed').touch()
    return result
   return real_check_output(command,*args,**kwargs)
  subprocess.check_output=observed_output
if request['operation']=='upload' and os.environ.get('TEST_CORRUPT'):
 import io,tarfile
 source=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode='r:')
 output=io.BytesIO()
 with tarfile.open(fileobj=output,mode='w') as archive:
  for member in source:
   data=source.extractfile(member).read() if member.isfile() else None
   if member.name.endswith('entry.mjs'): data=b'process.exit(99)'; member.size=len(data)
   archive.addfile(member,io.BytesIO(data) if data is not None else None)
 sys.stdin=io.TextIOWrapper(io.BytesIO(output.getvalue()))
exec(parts[2])
`,
    { mode: 0o700 },
  );
  const packageDirectory = path.join(directory, "package");
  await mkdir(packageDirectory);
  const guestRoot = (run) => path.join(home, ".situate-test-runs", run.id);
  const metadata = (run) =>
    path.join(home, ".situate-test-runs", ".native-vm-owners", run.id);
  return {
    directory,
    home,
    config,
    configFile,
    environment,
    packageDirectory,
    guestRoot,
    metadata,
  };
}

test("configuration selection is explicit and validates the complete schema", async (t) => {
  const f = await fixture(t);
  assert.equal(nativeVmConfiguration({ HOME: f.home }), null);
  assert.equal(
    nativeVmConfiguration({
      ...f.environment,
      SITUATE_NATIVE_EXECUTOR: "local",
    }),
    null,
  );
  assert.throws(
    () =>
      nativeVmConfiguration({ HOME: f.home, SITUATE_NATIVE_EXECUTOR: "vm" }),
    /missing/,
  );
  assert.throws(
    () =>
      nativeVmConfiguration({ HOME: f.home, SITUATE_NATIVE_EXECUTOR: "other" }),
    /Invalid/,
  );
  assert.deepEqual(nativeVmConfiguration(f.environment), f.config);
  for (const invalid of [
    { ...f.config, version: 2 },
    { ...f.config, node: "relative" },
    { ...f.config, vm: "-option" },
    { ...f.config, user: "../admin" },
    { ...f.config, extra: true },
    { ...f.config, vm: 123 },
  ]) {
    await writeFile(f.configFile, JSON.stringify(invalid));
    assert.throws(() => nativeVmConfiguration(f.environment), /Invalid/);
  }
});

test("an explicit package runs with a minimal local-only guest environment and verified SSH options", async (t) => {
  const f = await fixture(t);
  const run = await createNativeVmRun({ environment: f.environment });
  assert.match(run.root, /^\/Users\/admin\/\.situate-test-runs\/[a-f0-9-]+$/);
  await access(f.guestRoot(run));
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    `import {writeFileSync} from 'node:fs'; writeFileSync('observed.json',JSON.stringify({args:process.argv.slice(2),env:process.env})); process.exitCode=7;`,
    { mode: 0o751 },
  );
  await chmod(path.join(f.packageDirectory, "entry.mjs"), 0o751);
  await run.upload(f.packageDirectory);
  assert.deepEqual(await readdir(f.guestRoot(run)), ["entry.mjs"]);
  assert.equal(
    (await stat(path.join(f.guestRoot(run), "entry.mjs"))).mode & 0o777,
    0o751,
  );
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    "process.exit(99)",
  );
  assert.equal(
    await run.execute({
      entrypoint: "entry.mjs",
      args: ["a b", "$(false)", "'"],
      timeoutMs: 10000,
    }),
    7,
  );
  const observed = JSON.parse(
    await readFile(path.join(f.guestRoot(run), "observed.json"), "utf8"),
  );
  assert.deepEqual(observed.args, ["a b", "$(false)", "'"]);
  assert.equal(observed.env.SITUATE_NATIVE_EXECUTOR, "local");
  assert.equal(observed.env.CI, "true");
  assert.equal(observed.env.TEST_HOME, undefined);
  const calls = (await readFile(f.environment.TEST_LOG, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const call of calls) {
    for (const option of [
      "HostKeyAlias=situate-native-vm-situate-tests",
      "StrictHostKeyChecking=yes",
      "ForwardAgent=no",
      "PasswordAuthentication=no",
      "BatchMode=yes",
      "IdentitiesOnly=yes",
    ])
      assert.ok(call.includes(option));
  }
  await run.cleanup();
  await assert.rejects(access(f.guestRoot(run)), { code: "ENOENT" });
});

test("package links and unsafe entrypoints fail closed", async (t) => {
  const f = await fixture(t);
  const run = await createNativeVmRun({ environment: f.environment });
  await symlink("/etc/passwd", path.join(f.packageDirectory, "link"));
  await assert.rejects(run.upload(f.packageDirectory), /symlink/);
  await run.cleanup();
  const next = await createNativeVmRun({ environment: f.environment });
  await rm(path.join(f.packageDirectory, "link"));
  await writeFile(path.join(f.packageDirectory, "entry.mjs"), "");
  await next.upload(f.packageDirectory);
  await assert.rejects(next.execute({ entrypoint: "../entry.mjs" }), /Invalid/);
  await next.cleanup();
});

test("the per-VM queue is cancellable and a timeout drains guest descendants", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); writeFileSync('child.pid',String(child.pid)); setInterval(()=>{},1000);`,
  );
  const abort = new AbortController();
  const first = await createNativeVmRun({
    environment: f.environment,
    signal: abort.signal,
  });
  const secondAbort = new AbortController();
  const second = await createNativeVmRun({
    environment: f.environment,
    signal: secondAbort.signal,
  });
  await first.upload(f.packageDirectory);
  await second.upload(f.packageDirectory);
  const running = first.execute({ entrypoint: "entry.mjs", timeoutMs: 20000 });
  running.catch(() => {});
  let queued;
  try {
    const pidFile = path.join(f.guestRoot(first), "child.pid");
    let pid;
    for (let attempt = 0; attempt < 200; attempt++) {
      pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      if (pid > 0) break;
      await delay(25);
    }
    assert.ok(pid, "first guest command started");
    queued = second.execute({ entrypoint: "entry.mjs", timeoutMs: 20000 });
    queued.catch(() => {});
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        await access(path.join(f.home, `${second.id}.connected`));
        break;
      } catch {
        await delay(25);
      }
    }
    await access(path.join(f.home, `${second.id}.connected`));
    secondAbort.abort();
    await assert.rejects(queued);
    await assert.rejects(access(path.join(f.guestRoot(second), "child.pid")), {
      code: "ENOENT",
    });
    abort.abort();
    await assert.rejects(running);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    await assert.rejects(first.cleanup(), /uncertain/);
    await assert.rejects(second.cleanup(), /uncertain/);
  } finally {
    abort.abort();
    secondAbort.abort();
    await Promise.allSettled([running, queued]);
  }
  const timed = await createNativeVmRun({ environment: f.environment });
  await timed.upload(f.packageDirectory);
  assert.equal(
    await timed.execute({ entrypoint: "entry.mjs", timeoutMs: 1500 }),
    124,
  );
  assert.equal(
    await readFile(path.join(f.metadata(timed), ".native-vm-state"), "utf8"),
    "completed",
  );
});

test("transient guest inspection timeouts preserve the original command and its exit code", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    "import {appendFileSync} from 'node:fs'; appendFileSync('starts','once\\n'); setTimeout(()=>process.exit(7),800);",
  );
  const run = await createNativeVmRun({
    environment: { ...f.environment, TEST_PS_FAILURES: "2" },
  });
  await run.upload(f.packageDirectory);
  assert.equal(
    await run.execute({ entrypoint: "entry.mjs", timeoutMs: 10000 }),
    7,
  );
  assert.equal(
    await readFile(path.join(f.guestRoot(run), "starts"), "utf8"),
    "once\n",
  );
  assert.equal(
    await readFile(path.join(f.home, "inspection-failed"), "utf8"),
    "2",
  );
  await run.cleanup();
});

test("guest deadlines preserve unverified jobs, roots and leases until ownership observation recovers", async (t) => {
  const f = await fixture(t);
  const outage = path.join(f.home, "inspection-down");
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    "import {appendFileSync,writeFileSync} from 'node:fs'; appendFileSync('starts','once\\n'); writeFileSync('ready',String(process.pid)); if(process.argv[2]==='hold')setInterval(()=>{},1000);",
  );
  const environment = { ...f.environment, TEST_PS_BLOCK_FILE: outage };
  const first = await createNativeVmRun({ environment });
  const second = await createNativeVmRun({ environment });
  await first.upload(f.packageDirectory);
  await second.upload(f.packageDirectory);
  const running = first.execute({
    entrypoint: "entry.mjs",
    args: ["hold"],
    timeoutMs: 1000,
  });
  let queued;
  async function present(file) {
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        await access(file);
        return;
      } catch {
        await delay(25);
      }
    }
    assert.fail("Expected owned fixture evidence did not appear");
  }
  try {
    await present(path.join(f.guestRoot(first), "ready"));
    await present(path.join(f.home, "inspection-observed"));
    const pid = Number(
      await readFile(path.join(f.guestRoot(first), "ready"), "utf8"),
    );
    await writeFile(outage, "");
    await present(path.join(f.home, "inspection-failed"));
    let completed = false;
    running
      .finally(() => {
        completed = true;
      })
      .catch(() => {});
    await delay(1200);
    assert.equal(completed, false);
    process.kill(pid, 0);
    assert.equal(
      await readFile(path.join(f.metadata(first), ".native-vm-state"), "utf8"),
      "running",
    );
    await assert.rejects(first.cleanup(), /uncertain/);
    queued = second.execute({ entrypoint: "entry.mjs", timeoutMs: 3000 });
    await present(path.join(f.home, `${second.id}.connected`));
    await assert.rejects(access(path.join(f.guestRoot(second), "starts")), {
      code: "ENOENT",
    });
    await rm(outage);
    assert.equal(await running, 124);
    assert.equal(await queued, 0);
    assert.equal(
      await readFile(path.join(f.guestRoot(first), "starts"), "utf8"),
      "once\n",
    );
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    await first.cleanup();
    await second.cleanup();
  } finally {
    await rm(outage, { force: true });
    await Promise.allSettled([running, queued]);
  }
});

test("an uncertain earlier owner blocks execution and ownership mismatch blocks deletion", async (t) => {
  const f = await fixture(t);
  const old = await createNativeVmRun({ environment: f.environment });
  await writeFile(path.join(f.metadata(old), ".native-vm-state"), "running");
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    "throw Error('must not execute')",
  );
  const next = await createNativeVmRun({ environment: f.environment });
  await next.upload(f.packageDirectory);
  assert.equal(
    await next.execute({ entrypoint: "entry.mjs", timeoutMs: 10000 }),
    2,
  );
  await next.cleanup();
  await assert.rejects(old.cleanup(), /may still own processes/);
  await writeFile(path.join(f.metadata(old), ".native-vm-owner"), "{}");
  await assert.rejects(old.cleanup(), /ownership/);
  await access(f.guestRoot(old));
});

test("execution timeout does not include time waiting for the VM lease", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    "import {writeFileSync} from 'node:fs'; if(process.argv[2]==='hold'){writeFileSync('ready','1'); setInterval(()=>{},1000);}",
  );
  const abort = new AbortController();
  const first = await createNativeVmRun({
    environment: f.environment,
    signal: abort.signal,
  });
  const second = await createNativeVmRun({ environment: f.environment });
  await first.upload(f.packageDirectory);
  await second.upload(f.packageDirectory);
  const holding = first.execute({
    entrypoint: "entry.mjs",
    args: ["hold"],
    timeoutMs: 20000,
  });
  holding.catch(() => {});
  let queued;
  try {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (
        await readFile(path.join(f.guestRoot(first), "ready"), "utf8").catch(
          () => "",
        )
      )
        break;
      await delay(25);
    }
    await access(path.join(f.guestRoot(first), "ready"));
    let settled = false;
    queued = second.execute({ entrypoint: "entry.mjs", timeoutMs: 500 });
    queued
      .finally(() => {
        settled = true;
      })
      .catch(() => {});
    await delay(1000);
    assert.equal(settled, false);
    abort.abort();
    await assert.rejects(holding);
    assert.equal(await queued, 0);
    await second.cleanup();
  } finally {
    abort.abort();
    await Promise.allSettled([holding, queued]);
  }
});

test("caller death closes the lifetime pipe and drains the guest process tree", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    "import {writeFileSync} from 'node:fs'; writeFileSync('child.pid',String(process.pid)); setInterval(()=>{},1000);",
  );
  const source = `import {createNativeVmRun} from ${JSON.stringify(new URL("./native-vm.mjs", import.meta.url).href)}; import {writeFileSync} from 'node:fs'; const run=await createNativeVmRun(); writeFileSync(process.env.TEST_HOME+'/caller-run',run.id); await run.upload(${JSON.stringify(f.packageDirectory)}); await run.execute({entrypoint:'entry.mjs',timeoutMs:20000});`;
  const caller = spawn(
    process.execPath,
    ["--input-type=module", "-e", source],
    { env: f.environment, stdio: "ignore" },
  );
  const exited = once(caller, "exit");
  let run;
  let pid;
  try {
    for (let attempt = 0; attempt < 400; attempt++) {
      const id = await readFile(path.join(f.home, "caller-run"), "utf8").catch(
        () => "",
      );
      if (id) {
        run = { id };
        pid = Number(
          await readFile(
            path.join(f.guestRoot(run), "child.pid"),
            "utf8",
          ).catch(() => "0"),
        );
        if (pid > 0) break;
      }
      await delay(25);
    }
    assert.ok(pid, "guest command started");
  } finally {
    caller.kill("SIGKILL");
    await exited;
    if (run) {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (
          (await readFile(
            path.join(f.metadata(run), ".native-vm-state"),
            "utf8",
          ).catch(() => "")) === "completed"
        )
          break;
        await delay(25);
      }
    }
  }
  assert.equal(
    await readFile(path.join(f.metadata(run), ".native-vm-state"), "utf8"),
    "completed",
  );
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("a changed upload is rejected by the guest hash verifier", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    "process.exit(0)",
  );
  const run = await createNativeVmRun({
    environment: { ...f.environment, TEST_CORRUPT: "1" },
  });
  await assert.rejects(run.upload(f.packageDirectory), /hash mismatch/);
  await run.cleanup();
});

test("recovery retention prevents deletion even after successful process teardown", async (t) => {
  const f = await fixture(t);
  await writeFile(
    path.join(f.packageDirectory, "entry.mjs"),
    "import {writeFileSync} from 'node:fs'; writeFileSync('.native-vm-retain','');",
  );
  const run = await createNativeVmRun({ environment: f.environment });
  await run.upload(f.packageDirectory);
  assert.equal(
    await run.execute({ entrypoint: "entry.mjs", timeoutMs: 10000 }),
    0,
  );
  await assert.rejects(run.cleanup(), /recovery retention/);
  await access(path.join(f.guestRoot(run), ".native-vm-retain"));
  await rm(path.join(f.guestRoot(run), ".native-vm-retain"));
  await symlink(
    "/nonexistent",
    path.join(f.guestRoot(run), ".native-vm-retain"),
  );
  await assert.rejects(run.cleanup(), /recovery retention/);
});
