import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("./pipeline-volumes.py", import.meta.url));
const setup = `import copy,importlib.util,json,os,tempfile,types
from pathlib import Path
spec=importlib.util.spec_from_file_location('volumes',${JSON.stringify(helper)})
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
image='ghcr.io/getsituate/situate-ci-linux@sha256:'+'a'*64
class Docker:
    def __init__(self):
        self.volumes={};self.calls=[];self.engine='engine-one';self.fail_init=False;self.initializers={};self.uncertain_init=False;self.after_run_uncertain=False
    def run(self,args,**kwargs):
        assert args[0]=='docker'
        assert kwargs['env']=={'PATH':'/synthetic/bin','HOME':'/synthetic/home','DOCKER_CONTEXT':'synthetic-engine'}
        assert kwargs['capture_output'] and kwargs['text'] and kwargs['timeout']==120
        args=args[1:];self.calls.append(args)
        if args[:1]==['info']:
            return types.SimpleNamespace(returncode=0,stdout=json.dumps(self.engine),stderr='')
        if args[:2]==['container','inspect']:
            if self.uncertain_init:
                return types.SimpleNamespace(returncode=1,stdout='',stderr='Docker daemon unavailable')
            sequence=self.initializers.get(args[2],[])
            value=sequence.pop(0) if sequence else None
            return types.SimpleNamespace(returncode=0 if value else 1,stdout=json.dumps([value]) if value else '',stderr='' if value else 'Error response from daemon: No such container: '+args[2])
        if args[:2]==['volume','inspect']:
            value=self.volumes.get(args[2])
            return types.SimpleNamespace(returncode=0 if value else 1,stdout=json.dumps([value]) if value else '',stderr='' if value else 'Error response from daemon: No such volume: '+args[2])
        if args[:2]==['volume','create']:
            labels={args[index+1].split('=',1)[0]:args[index+1].split('=',1)[1] for index,item in enumerate(args) if item=='--label'}
            name=args[-1]
            self.volumes[name]={'Name':name,'Driver':'local','Scope':'local','Options':None,'Labels':labels,'CreatedAt':'2026-01-01T00:00:00Z','Mountpoint':'/var/lib/docker/volumes/'+name+'/_data'}
            return types.SimpleNamespace(returncode=0,stdout=name,stderr='')
        assert args[0]=='run',args
        if self.after_run_uncertain:self.uncertain_init=True
        return types.SimpleNamespace(returncode=1 if self.fail_init else 0,stdout='',stderr='')
    def inits(self):return [args for args in self.calls if args[0]=='run']
docker=Docker();v.subprocess.run=docker.run
environment={'PATH':'/synthetic/bin','HOME':'/synthetic/home','DOCKER_CONTEXT':'synthetic-engine','OPENAI_API_KEY':'synthetic-private','GH_TOKEN':'synthetic-private','APPLE_SIGNING_KEY':'synthetic-private'}
def paths_at(root):
    paths={key:root/key for key in sorted(v.KEYS)}
    for path in paths.values():path.mkdir(mode=0o700)
    return paths
`;

function python(source) {
  const result = spawnSync("python3", ["-B", "-c", setup + source], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
}

test("owned local volumes initialize once and warm reuse never changes ownership", () => {
  python(`with tempfile.TemporaryDirectory() as temporary:
    paths=paths_at(Path(temporary).resolve())
    first=v.prepare_volumes(paths,'linux/arm64',image,environment)
    assert set(first)==v.KEYS and len(set(first.values()))==6
    assert len(docker.inits())==6
    second=v.prepare_volumes(paths,'linux/arm64',image,environment)
    assert second==first and len(docker.inits())==6
    for key,path in paths.items():
        receipt=v.receipt(path/'.docker-volume.json')
        assert receipt['engine']=='engine-one'
        assert receipt['volume']['Name']==first[key]
        assert (path/'.docker-volume.json').stat().st_mode&0o777==0o600
    for args in docker.inits():
        assert args[args.index('--platform')+1]=='linux/arm64'
        assert args[args.index('--network')+1]=='none'
        assert '--read-only' in args
        assert args[args.index('--cap-drop')+1]=='ALL'
        assert args[args.index('--cap-add')+1]=='CHOWN'
        assert args[args.index('--entrypoint')+1]=='/bin/sh'
        assert args.count('--mount')==1
        assert args[args.index('--mount')+1].startswith('type=volume,src=situate-cache-')
        assert args[args.index('--mount')+1].endswith(',dst=/cache,volume-nocopy')
        assert args[-4:]==[v.INIT_SCRIPT,'cache-init',str(os.getuid()),str(os.getgid())]
        assert 'chmod 0700 /cache' in args[-4] and '-R' not in args[-4]
        assert not any('synthetic-private' in arg or 'type=bind' in arg or 'docker.sock' in arg or arg=='--env' for arg in args)
    assert not any(args[:2]==['volume','rm'] for args in docker.calls)
`);
});

test("concurrent preparations share host locks and never reinitialize warm shared caches", () => {
  python(`import concurrent.futures,threading,time
with tempfile.TemporaryDirectory() as temporary:
    paths=paths_at(Path(temporary).resolve())
    started=threading.Event();release=threading.Event()
    original=docker.run
    def blocking(args,**kwargs):
        if args[1]=='run' and not started.is_set():
            started.set()
            assert release.wait(timeout=2)
        return original(args,**kwargs)
    v.subprocess.run=blocking
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
        first=workers.submit(v.prepare_volumes,paths,'linux/arm64',image,environment)
        try:
            assert started.wait(timeout=2)
            second=workers.submit(v.prepare_volumes,paths,'linux/arm64',image,environment)
            time.sleep(.05)
            assert not second.done()
        finally:release.set()
        assert first.result(timeout=2)==second.result(timeout=2)
    assert len(docker.inits())==6
`);
});

test("engine changes and recreated volume identities invalidate initialization receipts", () => {
  python(`with tempfile.TemporaryDirectory() as temporary:
    paths=paths_at(Path(temporary).resolve())
    names=v.prepare_volumes(paths,'linux/amd64',image,environment)
    docker.engine='engine-two'
    assert v.prepare_volumes(paths,'linux/amd64',image,environment)==names
    assert len(docker.inits())==12
    name=next(iter(names.values()))
    docker.volumes[name]['CreatedAt']='2026-01-02T00:00:00Z'
    v.prepare_volumes(paths,'linux/amd64',image,environment)
    assert len(docker.inits())==13
    assert v.prepare_volumes(paths,'linux/arm64',image,environment)!=names
    other_image='ghcr.io/getsituate/situate-ci-linux@sha256:'+'b'*64
    assert v.prepare_volumes(paths,'linux/amd64',other_image,environment)!=names
    other=Path(temporary).resolve()/'other';other.mkdir(mode=0o700)
    assert v.prepare_volumes(paths_at(other),'linux/amd64',image,environment)!=names
`);
});

test("unknown ownership, nonlocal drivers and driver options are never adopted", () => {
  python(`with tempfile.TemporaryDirectory() as temporary:
    paths=paths_at(Path(temporary).resolve())
    names=v.prepare_volumes(paths,'linux/amd64',image,environment)
    name=next(iter(names.values()));original=copy.deepcopy(docker.volumes[name])
    variants=[{'Driver':'nfs'},{'Scope':'global'},{'Options':{'device':'/host/private'}},{'Labels':{}},{'Labels':{**original['Labels'],'unknown':'retain'}},{'Name':'unrelated'},{'CreatedAt':''}]
    for variant in variants:
        docker.volumes[name]={**copy.deepcopy(original),**variant}
        try:v.prepare_volumes(paths,'linux/amd64',image,environment)
        except ValueError:pass
        else:raise AssertionError('unknown volume adopted')
        assert len(docker.inits())==6
    assert not any(args[:2]==['volume','rm'] for args in docker.calls)
`);
});

test("cache and receipt aliases, public files and hardlinks are rejected", () => {
  python(`with tempfile.TemporaryDirectory() as temporary:
    root=Path(temporary).resolve();paths=paths_at(root)
    key=next(iter(paths));path=paths[key]
    def rejected(candidate):
        try:v.prepare_volumes(candidate,'linux/amd64',image,environment)
        except (OSError,ValueError):return
        raise AssertionError('unsafe cache metadata accepted')
    path.chmod(0o755);rejected(paths);path.chmod(0o700)
    alias=root/'alias';alias.symlink_to(path,target_is_directory=True)
    rejected({**paths,key:alias})
    rejected({**paths,key:path/'..'/path.name})
    rejected({**paths,key:Path('relative')})
    other=next(value for value in paths.values() if value!=path)
    rejected({**paths,key:other})
    v.prepare_volumes(paths,'linux/amd64',image,environment)
    receipt=path/'.docker-volume.json'
    receipt.chmod(0o644);rejected(paths);receipt.chmod(0o600)
    retained=path/'retained';os.link(receipt,retained);rejected(paths);retained.unlink()
    saved=receipt.read_text();receipt.unlink();retained.write_text(saved);retained.chmod(0o600)
    receipt.symlink_to(retained);rejected(paths)
    assert retained.read_text()==saved
    receipt.unlink();receipt.write_text(saved);receipt.chmod(0o600)
    lock=path/'.docker-volume.lock';lock.unlink();lock.symlink_to(retained);rejected(paths)
    assert len(docker.inits())==6
`);
});

test("initializer ownership and verified absence gate receipts and recover interrupted clients", () => {
  python(`with tempfile.TemporaryDirectory() as temporary:
    paths=paths_at(Path(temporary).resolve())
    docker.after_run_uncertain=True
    try:v.prepare_volumes(paths,'linux/arm64',image,environment)
    except RuntimeError:pass
    else:raise AssertionError('CLI exit substituted for absence verification')
    assert not any((path/'.docker-volume.json').exists() for path in paths.values())
    args=docker.inits()[0];name=args[args.index('--name')+1]
    labels={args[index+1].split('=',1)[0]:args[index+1].split('=',1)[1] for index,item in enumerate(args) if item=='--label'}
    owned={'Name':'/'+name,'Id':'c'*64,'Config':{'Labels':labels}}
    docker.after_run_uncertain=False;docker.uncertain_init=False
    docker.initializers[name]=[owned,None]
    v.prepare_volumes(paths,'linux/arm64',image,environment)
    assert len(docker.inits())==7
    docker.initializers[name]=[{**owned,'Config':{'Labels':{}}}]
    try:v.prepare_volumes(paths,'linux/arm64',image,environment)
    except ValueError:pass
    else:raise AssertionError('unknown initializer adopted')
    assert len(docker.inits())==7
    docker.initializers[name]=[owned]*3
    original=v.time.monotonic
    clock=[0]
    def advancing():clock[0]+=20;return clock[0]
    v.time.monotonic=advancing
    try:
        try:v.prepare_volumes(paths,'linux/arm64',image,environment)
        except RuntimeError:pass
        else:raise AssertionError('live initializer ignored')
    finally:v.time.monotonic=original
    assert len(docker.inits())==7
    assert not any(args[:2]==['container','rm'] for args in docker.calls)
`);
});

test("failed or interrupted initialization cannot publish success and can be retried", () => {
  python(`with tempfile.TemporaryDirectory() as temporary:
    paths=paths_at(Path(temporary).resolve())
    docker.fail_init=True
    try:v.prepare_volumes(paths,'linux/arm64',image,environment)
    except RuntimeError:pass
    else:raise AssertionError('failed initialization passed')
    assert not any((path/'.docker-volume.json').exists() for path in paths.values())
    assert len(docker.volumes)==1
    docker.fail_init=False
    original=v.save_receipt
    def interrupted(*args):raise InterruptedError('synthetic interruption')
    v.save_receipt=interrupted
    try:v.prepare_volumes(paths,'linux/arm64',image,environment)
    except InterruptedError:pass
    else:raise AssertionError('interruption not reported')
    assert not any((path/'.docker-volume.json').exists() for path in paths.values())
    v.save_receipt=original
    names=v.prepare_volumes(paths,'linux/arm64',image,environment)
    assert len(names)==6
    assert len(docker.inits())==8
    assert not any(args[:2]==['volume','rm'] for args in docker.calls)
`);
});
