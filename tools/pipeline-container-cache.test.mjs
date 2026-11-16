import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const launcher = fileURLToPath(new URL("./pipeline-container.py", import.meta.url));
function python(source) {
  const result = spawnSync("python3", ["-B", "-c", `import importlib.util, json, os, tempfile\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('launcher',${JSON.stringify(launcher)})\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\n${source}`], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
}

test("v1 stays AMD64 while v2 selects only supported native architectures", () => {
  python(`image='ghcr.io/getsituate/situate-ci-linux@sha256:'+'a'*64
v1={'version':1,'platform':'linux/amd64','image':image,'inputsSha256':'b'*64}
assert m.image_platform(v1,'arm64')=='linux/amd64'
v2={key:value for key,value in v1.items() if key!='platform'}
v2.update(version=2,platforms=['linux/amd64','linux/arm64'])
for machine,expected in [('arm64','linux/arm64'),('aarch64','linux/arm64'),('x86_64','linux/amd64')]:
    assert m.image_platform(v2,machine)==expected
for lock,machine in [(v2,'riscv64'),({**v2,'platforms':['linux/arm64']},'arm64'),({**v1,'extra':True},'x86_64')]:
    try:m.image_platform(lock,machine)
    except ValueError:pass
    else:raise AssertionError('unsupported image contract accepted')`);
});

test("retained caches reuse downloads but isolate architectures, images and worktree targets", () => {
  python(`c=m.cache_module()
with tempfile.TemporaryDirectory() as temporary:
    base=Path(temporary).resolve()
    checkout=base/'checkout';checkout.mkdir()
    other=base/'other';other.mkdir()
    environment={'SITUATE_CONTAINER_CACHE_DIR':str(base/'cache')}
    root=c.cache_root(environment,checkout)
    first=c.layout(root,'linux/arm64','image-one',checkout)
    (first['client-target']/'retained').write_text('object')
    (first['npm']/'retained').write_text('download')
    again=c.layout(c.cache_root(environment,checkout),'linux/arm64','image-one',checkout)
    assert (again['client-target']/'retained').read_text()=='object'
    second=c.layout(root,'linux/arm64','image-one',other)
    assert first['npm']==second['npm'] and first['browsers']==second['browsers']
    assert first['client-target']!=second['client-target']
    assert first['cargo-registry']!=second['cargo-registry']
    for platform,image in [('linux/amd64','image-one'),('linux/arm64','image-two')]:
        separate=c.layout(root,platform,image,checkout)
        assert all(separate[key]!=first[key] for key in first)
    assert not any(key in first for key in ('home','credentials','reports','node_modules'))
    (root/'unknown').write_text('preserve')
    assert c.cache_root(environment,checkout)==root
    assert (root/'unknown').read_text()=='preserve'
    for ci in ({'CI':'true'},{'GITHUB_ACTIONS':'true'},{'BUILD_ID':'123'}):
        assert c.cache_root({**environment,**ci},checkout) is None
    assert c.cache_root({**environment,'SITUATE_CONTAINER_CACHE':'0'},checkout) is None`);
});

test("local defaults use system cache locations without adopting a host Cargo home", () => {
  python(`c=m.cache_module()
with tempfile.TemporaryDirectory() as temporary:
    base=Path(temporary).resolve();home=base/'home';home.mkdir()
    checkout=base/'checkout';checkout.mkdir()
    environment={'HOME':str(home)}
    c.sys.platform='darwin'
    assert c.cache_root(environment,checkout)==home/'Library/Caches/situate/container-v1'
    c.sys.platform='linux'
    assert c.cache_root(environment,checkout)==home/'.cache/situate/container-v1'
    assert c.cache_root({**environment,'XDG_CACHE_HOME':str(home/'xdg')},checkout)==home/'xdg/situate/container-v1'
    for path in (home,home/'.cargo',home/'.cargo/nested'):
        try:c.cache_root({**environment,'SITUATE_CONTAINER_CACHE_DIR':str(path)},checkout)
        except ValueError:pass
        else:raise AssertionError('host home accepted')`);
});

test("cache roots reject aliases, unmarked data, public permissions and checkout boundaries", () => {
  python(`c=m.cache_module()
with tempfile.TemporaryDirectory() as temporary:
    base=Path(temporary).resolve()
    checkout=base/'checkout';checkout.mkdir()
    def rejected(path):
        try:c.cache_root({'SITUATE_CONTAINER_CACHE_DIR':str(path)},checkout)
        except (ValueError,OSError):return
        raise AssertionError('unsafe cache accepted: '+str(path))
    rejected(checkout/'cache')
    rejected(base)
    rejected(Path('relative'))
    root=base/'unmarked';root.mkdir(mode=0o700);(root/'unknown').write_text('retain')
    rejected(root);assert (root/'unknown').read_text()=='retain'
    root=base/'public';root.mkdir(mode=0o755);rejected(root)
    owned=c.cache_root({'SITUATE_CONTAINER_CACHE_DIR':str(base/'owned')},checkout)
    alias=base/'alias';alias.symlink_to(owned,target_is_directory=True);rejected(alias)
    rejected(alias/'nested')
    marker=owned/'.situate-container-cache'
    marker.chmod(0o644);rejected(owned);marker.chmod(0o600)
    marker.unlink();marker.symlink_to(root/'unknown');rejected(owned)
    assert not (root/'unknown').exists()
    marker.unlink();marker.write_text(c.MARKER);marker.chmod(0o600)
    os.link(marker,owned/'marker-alias');rejected(owned)`);
});

test("simultaneous worktrees initialize one complete ownership marker", () => {
  python(`import subprocess,sys
with tempfile.TemporaryDirectory() as temporary:
    base=Path(temporary).resolve();checkout=base/'checkout';checkout.mkdir()
    environment={'SITUATE_CONTAINER_CACHE_DIR':str(base/'cache')}
    program='import runpy;from pathlib import Path;c=runpy.run_path('+repr(str(m.ROOT/'tools/pipeline-cache.py'))+');c["cache_root"]('+repr(environment)+',Path('+repr(str(checkout))+'))'
    jobs=[subprocess.Popen([sys.executable,'-B','-c',program],stderr=subprocess.PIPE,text=True) for _ in range(8)]
    for job in jobs:
        _,error=job.communicate(timeout=3)
        assert job.returncode==0,error
    assert (base/'cache/.situate-container-cache').read_text()==m.cache_module().MARKER`);
});

test("browser preparation locks cover installer lifetime and disable destructive garbage collection", () => {
  python(`import subprocess,sys,time
with tempfile.TemporaryDirectory() as temporary:
    base=Path(temporary).resolve()
    environment={**os.environ,'PLAYWRIGHT_BROWSERS_PATH':str(base)}
    helper=str(m.ROOT/'tools/container-browser-install.py')
    first_code='import os,time;from pathlib import Path;root=Path('+repr(str(base))+');assert os.environ["PLAYWRIGHT_SKIP_BROWSER_GC"]=="1";(root/"first").touch();\\nwhile not (root/"release").exists():time.sleep(.01)'
    first=subprocess.Popen([sys.executable,'-B',helper,sys.executable,'-c',first_code],env=environment)
    second=None
    def until(predicate):
        end=time.monotonic()+2
        while not predicate():
            assert time.monotonic()<end,'installer did not advance'
            time.sleep(.01)
    try:
        until(lambda:(base/'first').exists())
        second=subprocess.Popen([sys.executable,'-B',helper,sys.executable,'-c','from pathlib import Path;Path('+repr(str(base/'second'))+').touch()'],env=environment)
        first.kill();first.wait(timeout=2)
        time.sleep(.1)
        assert not (base/'second').exists()
        (base/'release').touch()
        assert second.wait(timeout=2)==0
        assert (base/'second').exists()
    finally:
        (base/'release').touch()
        if first.poll() is None:first.kill()
        first.wait()
        if second is not None:
            if second.poll() is None:second.kill()
            second.wait()`);
});

test("container arguments mount only dedicated caches and keep Cargo home disposable", () => {
  python(`with tempfile.TemporaryDirectory() as temporary:
    base=Path(temporary).resolve()
    root=base/'checkout';(root/'client').mkdir(parents=True)
    (root/'client/rust-toolchain.toml').write_text('channel = "1.98.1"')
    state=base/'state';state.mkdir()
    env={'SITUATE_CONTAINER_CACHE_DIR':str(base/'cache')}
    args=m.arguments(root,state,'ghcr.io/getsituate/situate-ci-linux@sha256:'+'a'*64,[],env,'fixture','fixture',platform='linux/arm64')
    mounts=[item for item in args if item.startswith('type=bind')]
    assert 'linux/arm64' in args
    assert any('dst=/ci-cache/cargo/registry' in item for item in mounts)
    assert any('dst=/ci-cache/cargo/git' in item for item in mounts)
    assert not any(item.endswith('dst=/ci-cache/cargo') for item in mounts)
    assert any('worktrees/' in item and 'dst='+str(root/'client/target') in item for item in mounts)
    assert not any('node_modules' in item or '/.cargo' in item for item in mounts)
    disposable=m.arguments(root,state,'ghcr.io/getsituate/situate-ci-linux@sha256:'+'a'*64,[],{**env,'GITHUB_ACTIONS':'true'},'fixture','fixture')
    assert not any(str(base/'cache') in item for item in disposable)`);
});
