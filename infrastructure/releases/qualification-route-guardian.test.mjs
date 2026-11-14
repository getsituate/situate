import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const guardianPath = fileURLToPath(
  new URL("./qualification-route-guardian.py", import.meta.url),
);
const request = {
  route: {
    operationId: "actions-123-1",
    operationNonce: "actions-123-1",
    hostname: "updates.example.com",
    privateAddress: "127.0.0.2",
    localPort: 443,
  },
  ssh: {
    host: "release@synthetic.example",
    identityPath: "/synthetic/id",
    knownHostsPath: "/synthetic/known_hosts",
    hostPort: 24443,
  },
};
function temporary(t) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "guardian-test-")));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
const setup = `import importlib.util,json,os,pathlib,socket,subprocess,sys,types
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('guardian',sys.argv[1])
g=importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
base=pathlib.Path(sys.argv[2])
request=json.loads(sys.argv[3])
mode=sys.argv[4]
actions=[]
commands=[]
state={}
lock=base/'route'
lock.mkdir()
control=lock/'ssh'
endpoint=None
child=None
class FakeChild:
    pid=12345
    returncode=None
    def poll(self): return self.returncode
    def wait(self,timeout):
        commands.append(['wait',timeout])
        if self.returncode is None: raise subprocess.TimeoutExpired('synthetic',timeout)
        return self.returncode
    def terminate(self):
        commands.append(['terminate',self.pid])
        if mode=='stuck': return
        self.returncode=-15
        if endpoint: endpoint.close()
        if control.exists(): control.unlink()
    def kill(self):
        commands.append(['kill',self.pid])
        if mode!='stuck': self.terminate()
def save(path,value):
    state.clear()
    state.update(value)
    path.write_text(json.dumps(value))
def runner_action(action,route):
    actions.append(action)
    if action=='runner-prepare':
        if mode=='foreign-reservation': raise ValueError('Already reserved')
        save(lock/'state.json',{'request':route,'status':'prepared'})
    elif action=='runner-failed' and mode=='journal-failure':
        raise OSError('Synthetic journal failure')
    else:
        value=json.loads((lock/'state.json').read_text())
        value['status']=action
        save(lock/'state.json',value)
    return {'status':action}
runner=types.SimpleNamespace(RUNNER_LOCK=lock,runner_perform=runner_action,read=lambda path:path.read_bytes(),save=save)
def popen(args,**options):
    global endpoint,child
    commands.append(['popen',args,options])
    child=FakeChild()
    if mode!='no-socket':
        endpoint=socket.socket(socket.AF_UNIX)
        endpoint.bind(str(control))
    if mode=='signal-during-spawn': os.kill(os.getpid(),15)
    return child
def run(args,**options):
    commands.append(['run',args,options])
    action=args[args.index('-O')+1]
    if action=='exit':
        if mode=='control-timeout': raise subprocess.TimeoutExpired('synthetic-control',options['timeout'])
        if mode!='stuck': child.terminate()
    return types.SimpleNamespace(returncode=0)
g.subprocess.Popen=popen
g.subprocess.run=run
g.GUARDIAN_READY_SECONDS=0.01
g.GUARDIAN_STOP_SECONDS=0.01
g.GUARDIAN_POLL_SECONDS=0
reads=0
def lifeline(buffer):
    global reads
    reads+=1
    if mode in ['journal-failure','invalid-lifeline'] and reads>1: raise ValueError('Synthetic lifeline failure')
    if mode=='no-socket': return False
    if mode=='early-eof': return True
    if mode=='signal-term' and reads>1: os.kill(os.getpid(),15)
    if mode=='signal-int' and reads>1: os.kill(os.getpid(),2)
    if mode=='foreign-socket' and reads>1:
        endpoint.close()
        control.unlink()
        control.write_text('foreign control path')
    return reads>1
g.guardian_lifeline=lifeline
real_emit=g.guardian_emit
def emit(value):
    if mode=='broken-ready' and value.get('ready'): raise BrokenPipeError('Caller is gone')
    real_emit(value)
g.guardian_emit=emit
if mode=='nonpipe': sys.stdin=open(os.devnull)
`;
function unit(t, mode = "success", value = request) {
  const root = temporary(t);
  const result = spawnSync(
    "python3",
    [
      "-c",
      `${setup}\ntry:\n code=g.guardian_main(runner,request)\nexcept ValueError:\n code=2\n(base/'result.json').write_text(json.dumps({'actions':actions,'commands':commands,'state':state,'socketPresent':control.exists(),'returncode':child.returncode if child else None}))\nsys.exit(code)`,
      guardianPath,
      root,
      JSON.stringify(value),
      mode,
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, "");
  return {
    ...result,
    records: result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
    details: JSON.parse(readFileSync(join(root, "result.json"))),
  };
}

test("guardian owns a foreground verified SSH process and reports readiness before lifeline cleanup", (t) => {
  const result = unit(t);
  assert.equal(result.status, 0);
  assert.deepEqual(result.records, [
    { ready: true, operationNonce: request.route.operationNonce },
    {
      closed: true,
      operationNonce: request.route.operationNonce,
      cleaned: true,
      uncertain: false,
      failure: null,
    },
  ]);
  assert.deepEqual(result.details.actions, [
    "runner-prepare",
    "runner-ssh-pending",
    "runner-serving",
    "runner-cleanup",
  ]);
  const launch = result.details.commands.find((entry) => entry[0] === "popen");
  assert.equal(launch[1][0], "/usr/bin/ssh");
  assert(!launch[1].includes("-f"));
  for (const option of [
    "-M",
    "-N",
    "StrictHostKeyChecking=yes",
    "ConnectionAttempts=1",
    "ControlPersist=no",
    "ForkAfterAuthentication=no",
    "ExitOnForwardFailure=yes",
    "127.0.0.2:443:127.0.0.1:24443",
  ])
    assert(launch[1].includes(option), option);
  assert.deepEqual(launch[2].env, {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "C",
  });
  assert.equal(launch[2].start_new_session, true);
  assert.equal(launch[2].stdin, -3);
  assert.equal(result.details.state.guardian.sshPid, 12345);
  assert.equal(result.details.socketPresent, false);
  const controls = result.details.commands
    .filter((entry) => entry[0] === "run")
    .map((entry) => entry[1][entry[1].indexOf("-O") + 1]);
  assert.deepEqual(controls, ["check", "exit"]);
});

test("guardian rejects command injection and non-loopback contracts before any resource effects", (t) => {
  const changes = [
    { ...request, command: "anything" },
    { ...request, ssh: { ...request.ssh, host: "-oProxyCommand=bad" } },
    { ...request, ssh: { ...request.ssh, identityPath: "/synthetic/../id" } },
    {
      ...request,
      ssh: { ...request.ssh, knownHostsPath: "/synthetic/known\nhosts" },
    },
    { ...request, ssh: { ...request.ssh, hostPort: true } },
    { ...request, route: { ...request.route, operationNonce: "../foreign" } },
    { ...request, route: { ...request.route, privateAddress: "0.0.0.0" } },
    { ...request, route: { ...request.route, localPort: 8443 } },
  ];
  for (const value of changes) {
    const result = unit(t, "success", value);
    assert.equal(result.status, 2);
    assert.deepEqual(result.details.actions, []);
    assert.deepEqual(result.details.commands, []);
  }
});

test("guardian requires a pipe lifeline and parses only close or EOF", (t) => {
  const nonpipe = unit(t, "nonpipe");
  assert.equal(nonpipe.status, 2);
  assert.deepEqual(nonpipe.details.actions, []);
  const code = `import importlib.util,os,sys\nsys.dont_write_bytecode=True\nspec=importlib.util.spec_from_file_location('guardian',sys.argv[1])\ng=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(g)\nr,w=os.pipe()\nsys.stdin=os.fdopen(r,'rb')\nb=bytearray()\nos.write(w,b'cl')\nassert g.guardian_lifeline(b) is False\nos.write(w,b'ose\\n')\nassert g.guardian_lifeline(b) is True\nos.write(w,b'arbitrary-command\\n')\ntry:\n g.guardian_lifeline(bytearray())\n raise AssertionError('Invalid command accepted')\nexcept ValueError: pass\nos.close(w)\nassert g.guardian_lifeline(bytearray()) is True`;
  const parsed = spawnSync("python3", ["-c", code, guardianPath], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(parsed.status, 0, parsed.stderr);
});

test("guardian leaves an unknown preexisting reservation untouched", (t) => {
  const result = unit(t, "foreign-reservation");
  assert.equal(result.status, 1);
  assert.deepEqual(result.details.actions, ["runner-prepare"]);
  assert.deepEqual(result.details.commands, []);
  assert.equal(result.records.at(-1).uncertain, true);
  assert.equal(result.records.at(-1).cleaned, false);
});

test("guardian cleans early EOF without starting SSH and bounds readiness failure to one owned launch", (t) => {
  const early = unit(t, "early-eof");
  assert.equal(early.status, 0);
  assert.deepEqual(early.details.actions, ["runner-prepare", "runner-cleanup"]);
  assert.deepEqual(early.details.commands, []);
  assert.equal(early.records.length, 1);
  const timeout = unit(t, "no-socket");
  assert.equal(timeout.status, 1);
  assert.equal(
    timeout.details.commands.filter((entry) => entry[0] === "popen").length,
    1,
  );
  assert(timeout.details.commands.some((entry) => entry[0] === "terminate"));
  assert.equal(timeout.records.at(-1).cleaned, true);
  assert(!timeout.records.some((entry) => entry.ready));
});

test("guardian terminates its owned process even if control exit or journal recording fails", (t) => {
  const timeout = unit(t, "control-timeout");
  assert.equal(timeout.status, 0);
  assert(timeout.details.commands.some((entry) => entry[0] === "terminate"));
  assert.equal(timeout.records.at(-1).cleaned, true);
  const journal = unit(t, "journal-failure");
  assert.equal(journal.status, 1);
  assert(journal.details.commands.some((entry) => entry[0] === "terminate"));
  assert.equal(journal.details.socketPresent, false);
  assert(!journal.details.actions.includes("runner-cleanup"));
  assert.equal(journal.records.at(-1).uncertain, true);
});

test("guardian retains ownership when the exact SSH process or socket cannot be removed", (t) => {
  const result = unit(t, "stuck");
  assert.equal(result.status, 1);
  assert(result.details.commands.some((entry) => entry[0] === "terminate"));
  assert(result.details.commands.some((entry) => entry[0] === "kill"));
  assert(result.details.socketPresent);
  assert(!result.details.actions.includes("runner-cleanup"));
  assert.equal(result.records.at(-1).failure, "teardown");
  assert.equal(result.records.at(-1).uncertain, true);
});

test("guardian does not send an exit command through a replaced control path", (t) => {
  const result = unit(t, "foreign-socket");
  assert.equal(result.status, 1);
  assert(result.details.commands.some((entry) => entry[0] === "terminate"));
  assert(
    !result.details.commands.some(
      (entry) => entry[0] === "run" && entry[1].includes("exit"),
    ),
  );
  assert(!result.details.actions.includes("runner-cleanup"));
  assert.equal(result.records.at(-1).uncertain, true);
});

test("guardian still tears down the owned process when its readiness reader is gone", (t) => {
  const result = unit(t, "broken-ready");
  assert.equal(result.status, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].closed, true);
  assert.equal(result.records[0].cleaned, true);
  assert.equal(result.details.socketPresent, false);
});

test("guardian handles TERM/INT and defers spawn interruption until it owns the child handle", (t) => {
  for (const mode of ["signal-term", "signal-int", "signal-during-spawn"]) {
    const result = unit(t, mode);
    assert.equal(result.status, 1);
    assert.equal(result.records.at(-1).cleaned, true);
    assert.equal(result.details.socketPresent, false);
    assert(result.details.commands.some((entry) => entry[0] === "terminate"));
  }
});

const liveHarness = `import importlib.util,json,os,pathlib,subprocess,sys,types
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('guardian',sys.argv[1])
g=importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
base=pathlib.Path(sys.argv[2])
request=json.loads(sys.argv[3])
lock=base/'route'
actions=[]
real_popen=subprocess.Popen
child=None
def save(path,value): path.write_text(json.dumps(value))
def runner_action(action,route):
    actions.append(action)
    if action=='runner-prepare':
        lock.mkdir()
        save(lock/'state.json',{'request':route,'status':'prepared'})
    else:
        value=json.loads((lock/'state.json').read_text())
        value['status']=action
        save(lock/'state.json',value)
    (base/'actions.json').write_text(json.dumps(actions))
    return {'status':action}
runner=types.SimpleNamespace(RUNNER_LOCK=lock,runner_perform=runner_action,read=lambda path:path.read_bytes(),save=save)
child_code="""import os,pathlib,signal,socket,sys,time
path=pathlib.Path(sys.argv[1])
sock=socket.socket(socket.AF_UNIX)
def stop(signum,frame):
    sock.close()
    path.unlink()
    raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
sock.bind(str(path))
while True: time.sleep(60)
"""
def popen(args,**options):
    global child
    assert args[0]=='/usr/bin/ssh' and '-f' not in args
    child=real_popen([sys.executable,'-c',child_code,str(lock/'ssh')],**options)
    return child
def run(args,**options):
    assert args[0]=='/usr/bin/ssh'
    action=args[args.index('-O')+1]
    if action=='exit': child.terminate()
    return types.SimpleNamespace(returncode=0)
g.subprocess.Popen=popen
g.subprocess.run=run
g.GUARDIAN_READY_SECONDS=3
g.GUARDIAN_STOP_SECONDS=1
sys.exit(g.guardian_main(runner,request))
`;
function bounded(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Synthetic guardian lifetime timed out")),
        10_000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

test("caller SIGKILL closes the stdin lifeline and guardian reaps its synthetic child before cleanup", async (t) => {
  const root = temporary(t);
  const script = join(root, "guardian-harness.py");
  writeFileSync(script, liveHarness);
  const parentCode = `const {spawn}=require('node:child_process');const child=spawn('python3',process.argv.slice(1),{stdio:['pipe','inherit','inherit']});process.stdout.write(JSON.stringify({guardianPid:child.pid})+'\\n');setInterval(()=>{},10000);`;
  const caller = spawn(
    process.execPath,
    ["-e", parentCode, script, guardianPath, root, JSON.stringify(request)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const iterator = createInterface({ input: caller.stdout })[
    Symbol.asyncIterator
  ]();
  let guardianPid;
  let stderr = "";
  caller.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => {
    caller.kill("SIGKILL");
    if (guardianPid) {
      try {
        process.kill(guardianPid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  });
  let ready = false;
  while (!ready || !guardianPid) {
    const line = await bounded(iterator.next());
    assert(!line.done);
    const value = JSON.parse(line.value);
    guardianPid = value.guardianPid ?? guardianPid;
    ready ||= value.ready === true;
  }
  const state = JSON.parse(readFileSync(join(root, "route", "state.json")));
  const exit = once(caller, "exit");
  caller.kill("SIGKILL");
  const closed = JSON.parse((await bounded(iterator.next())).value);
  if (closed.cleaned === true) guardianPid = undefined;
  assert.deepEqual(closed, {
    closed: true,
    operationNonce: request.route.operationNonce,
    cleaned: true,
    uncertain: false,
    failure: null,
  });
  assert.deepEqual(await bounded(exit), [null, "SIGKILL"]);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "actions.json"))), [
    "runner-prepare",
    "runner-ssh-pending",
    "runner-serving",
    "runner-cleanup",
  ]);
  assert.throws(() => process.kill(state.guardian.sshPid, 0), {
    code: "ESRCH",
  });
  assert.equal(stderr, "");
});
