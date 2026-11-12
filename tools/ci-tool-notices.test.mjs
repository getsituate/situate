import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(
  new URL("../client/docker/ci-tool-notices.py", import.meta.url),
);
const read = (name) =>
  readFileSync(new URL(`../client/docker/${name}`, import.meta.url), "utf8");
const preamble = `
import importlib.util, hashlib, io, json, pathlib, tarfile, tempfile, zipfile
spec = importlib.util.spec_from_file_location('notices', ${JSON.stringify(helper)})
n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n)
def rejects(fn, message):
    try: fn()
    except (ValueError, FileNotFoundError, KeyError) as error:
        assert message in str(error), str(error)
    else: raise AssertionError('Expected failure: ' + message)
def tar(files):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:gz') as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    return out.getvalue()
`;
function python(code) {
  const result = spawnSync("python3", ["-B", "-c", preamble + code], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test("notice selection preserves nested copied-code terms and source-header notices", () => {
  python(`
files = {'pkg/LICENSE': b'MIT text', 'pkg/vendor/COPYING.txt': b'BSD copyright', 'pkg/legal/third-party.md': b'Apache notices', 'pkg/src/lib.rs': b'code'}
assert [x['path'] for x in n.notice_inventory(files)] == ['pkg/LICENSE', 'pkg/legal/third-party.md', 'pkg/vendor/COPYING.txt']
assert n.archive_files(tar(files)) == files
out = io.BytesIO()
with zipfile.ZipFile(out, 'w') as archive:
    for name, data in files.items(): archive.writestr(name, data)
assert n.archive_files(out.getvalue()) == files
assert n.notice_inventory({'NotNull.java': b'Copyright example. Licensed under Apache License 2.0'})[0]['path'] == 'NotNull.java'
`);
});

test("collection retains exact archives and texts and fails on missing or changed notices", () => {
  python(`
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    cache = root / 'cache'
    cache.mkdir()
    url = 'https://example.invalid/tool.tar.gz'
    files = {'pkg/LICENSE': b'BSD copyright and terms', '../NOTICE': b'Nested notice'}
    data = tar(files)
    (cache / n.digest(url.encode())).write_bytes(data)
    artifact = {'url': url, 'sha256': n.digest(data), 'notices': n.notice_inventory(files)}
    manifest = {'artifacts': {'tool': artifact}, 'tools': {}}
    n.collect(manifest, root, cache)
    n.verify_archives(manifest, root)
    assert not (root.parent / 'NOTICE').exists()
    text = root / 'tool-notices/texts' / n.digest(b'BSD copyright and terms')
    text.unlink()
    rejects(lambda: n.verify_archives(manifest, root), 'No such file')
    text.write_bytes(b'wrong')
    rejects(lambda: n.verify_archives(manifest, root), 'Retained notice checksum')
    artifact['notices'] = []
    rejects(lambda: n.verify_archives(manifest, root), 'Notice coverage changed')
    artifact['sha256'] = '0' * 64
    rejects(lambda: n.collect(manifest, root, cache), 'Archive checksum')
`);
});

test("dependency coverage is exact and refuses unreviewed Cargo and Go replacements", () => {
  python(String.raw`
lock = b'''version = 4
[[package]]
name = "example"
version = "1.2.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "0123456789"
'''
manifest = {'kind': 'cargo-lock', 'path': 'Cargo.lock', 'sha256': n.digest(lock)}
assert n.dependency_ids({'Cargo.lock': lock}, manifest) == [('crate:example@1.2.3', '0123456789')]
changed = lock.replace(b'registry+https://github.com/rust-lang/crates.io-index', b'git+https://example.invalid/source')
manifest['sha256'] = n.digest(changed)
rejects(lambda: n.dependency_ids({'Cargo.lock': changed}, manifest), 'Unreviewed Cargo source')
go = b'module example\nrequire (\n github.com/spf13/pflag v1.0.6\n)\n'
manifest = {'kind': 'go-mod', 'path': 'go.mod', 'sha256': n.digest(go)}
assert n.dependency_ids({'go.mod': go}, manifest) == [('go:github.com/spf13/pflag@v1.0.6', None)]
changed = go + b'replace github.com/spf13/pflag => ../local\n'
manifest['sha256'] = n.digest(changed)
rejects(lambda: n.dependency_ids({'go.mod': changed}, manifest), 'Unreviewed Go replacement')
`);
});

test("a valid source hash cannot conceal an omitted locked dependency or its checksum", () => {
  python(String.raw`
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    cache = root / 'cache'
    cache.mkdir()
    url = 'https://example.invalid/source.tar.gz'
    lock = b'[[package]]\nname="dep"\nversion="1"\nsource="registry+https://github.com/rust-lang/crates.io-index"\nchecksum="123"\n'
    files = {'LICENSE': b'License', 'Cargo.lock': lock}
    data = tar(files)
    (cache / n.digest(url.encode())).write_bytes(data)
    artifact = {'url': url, 'sha256': n.digest(data), 'notices': n.notice_inventory(files)}
    tool = {'source': 'tool', 'manifest': {'path': 'Cargo.lock', 'kind': 'cargo-lock', 'sha256': n.digest(lock)}, 'dependencies': []}
    manifest = {'artifacts': {'tool': artifact}, 'tools': {'tool': tool}}
    rejects(lambda: n.collect(manifest, root, cache), 'Incomplete dependency notice coverage')
    tool['dependencies'] = ['crate:dep@1']
    manifest['artifacts']['crate:dep@1'] = artifact
    rejects(lambda: n.verify_archives(manifest, root), 'Cargo checksum binding mismatch')
`);
});

test("Maven transitive edges and retained POM hashes fail closed", () => {
  python(`
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    cache = root / 'cache'
    cache.mkdir()
    url = 'https://example.invalid/dep.jar'
    pom_url = 'https://example.invalid/dep.pom'
    data = tar({'LICENSE': b'License'})
    pom = b'<project/>'
    for u, b in [(url, data), (pom_url, pom)]: (cache / n.digest(u.encode())).write_bytes(b)
    artifact = {'url': url, 'sha256': n.digest(data), 'notices': n.notice_inventory({'LICENSE': b'License'}), 'pom': {'url': pom_url, 'sha256': n.digest(pom), 'dependencies': ['maven:transitive@1']}}
    manifest = {'artifacts': {'dep': artifact}, 'tools': {'ktlint': {'source': 'other', 'dependencies': []}}}
    rejects(lambda: n.collect(manifest, root, cache), 'Missing transitive Maven dependency')
    manifest['tools']['ktlint']['dependencies'] = ['maven:transitive@1']
    n.verify_archives(manifest, root)
    (root / 'tool-notices' / (n.digest(pom) + '.pom')).write_bytes(b'changed')
    rejects(lambda: n.verify_archives(manifest, root), 'Retained POM checksum')
`);
});

test("notice inventory remains bound to exact tool bytes and embedded Go modules", () => {
  python(`
def string(data):
    value = len(data)
    length = bytearray()
    while value > 127:
        length.append((value & 127) | 128)
        value >>= 7
    return bytes(length + bytes([value])) + data
info = b'x' * 16 + b'path\\tmain\\ndep\\tgithub.com/spf13/pflag\\tv1.0.6\\th1:example\\n' + b'y' * 16
binary = b'\\xff Go buildinf:' + bytes([8, 2]) + b'\\0' * 16 + string(b'go1.24.1') + string(info)
assert n.go_build_info(binary) == ('go1.24.1', {'go:github.com/spf13/pflag@v1.0.6': 'h1:example'})
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    (root / 'gitleaks').mkdir()
    path = root / 'gitleaks/gitleaks'
    path.write_bytes(binary)
    tool = {'binaries': {'amd64': {'path': 'gitleaks/gitleaks', 'sha256': n.digest(binary)}}, 'dependencies': ['go:stdlib@go1.24.1']}
    manifest = {'tools': {'gitleaks': tool}, 'artifacts': {'go:github.com/spf13/pflag@v1.0.6': {'goChecksum': 'h1:example'}}}
    rejects(lambda: n.verify_binaries(manifest, root, 'amd64'), 'Missing Go binary dependency')
    tool['dependencies'].append('go:github.com/spf13/pflag@v1.0.6')
    n.verify_binaries(manifest, root, 'amd64')
    manifest['artifacts']['go:github.com/spf13/pflag@v1.0.6']['goChecksum'] = 'h1:wrong'
    rejects(lambda: n.verify_binaries(manifest, root, 'amd64'), 'Go binary/module checksum binding mismatch')
    path.write_bytes(b'changed binary')
    rejects(lambda: n.verify_binaries(manifest, root, 'amd64'), 'Notice/binary binding mismatch')
`);
});

const sourceBuildFixture = String.raw`
import os, sys

def build_fixture(root, mode='success'):
    lock = b'[[package]]\nname="cargo-llvm-cov"\nversion="0.9.1"\n'
    package = b'[package]\nname="cargo-llvm-cov"\nversion="0.9.1"\n'
    prefix = 'cargo-llvm-cov-0.9.1/'
    files = {prefix + 'Cargo.toml': package, prefix + 'Cargo.lock': lock, prefix + 'src/main.rs': b'fn main() {}'}
    data = tar(files)
    artifact = {'sha256': n.digest(data)}
    archive = root / 'tool-notices' / (artifact['sha256'] + '.archive')
    archive.parent.mkdir()
    archive.write_bytes(data)
    build = {'method': 'cargo-install-locked', 'rustVersion': '1.98.1', 'binaryPath': 'cargo-llvm-cov/cargo-llvm-cov', 'receiptPath': 'cargo-llvm-cov/source-build.json'}
    tool = {'version': '0.9.1', 'source': 'crate:cargo-llvm-cov@0.9.1', 'manifest': {'path': prefix + 'Cargo.lock', 'kind': 'cargo-lock', 'sha256': n.digest(lock)}, 'sourceBuild': build}
    manifest = {'tools': {'cargo-llvm-cov': tool}, 'artifacts': {tool['source']: artifact}}
    commands = root / 'commands'
    commands.mkdir()
    rustc = commands / 'rustc'
    rustc.write_text('#!' + sys.executable + '\nprint("rustc 1.98.1 (synthetic)\\nhost: synthetic-test")\n')
    cargo = commands / 'cargo'
    cargo.write_text('#!' + sys.executable + '\n' + '''
import os, pathlib, sys
if sys.argv[1:] == ['--version']:
    print('cargo 1.98.1 (synthetic)')
    sys.exit(0)
assert sys.argv[1:] == ['install', '--path', '.', '--locked', '--root', '../install']
assert 'CI_TOOL_TEST_SECRET' not in os.environ
assert 'RUSTFLAGS' not in os.environ
assert os.environ['RUSTUP_TOOLCHAIN'] == '1.98.1'
assert pathlib.Path(os.environ['HOME']).is_dir()
assert os.environ['CARGO_HOME'] != os.environ['RUSTUP_HOME']
''' + 'mode = ' + repr(mode) + '\n' + '''
if mode == 'fail': sys.exit(9)
if mode == 'mutate-lock': pathlib.Path('Cargo.lock').write_text('changed')
if mode == 'mutate-manifest': pathlib.Path('Cargo.toml').write_text('changed')
output = pathlib.Path('../install/bin/cargo-llvm-cov')
output.parent.mkdir(parents=True)
output.write_bytes(b'synthetic compiled tool')
''')
    for path in [cargo, rustc]: path.chmod(0o755)
    os.environ['PATH'] = str(commands)
    os.environ['RUSTUP_HOME'] = str(root / 'rustup')
    os.environ['CI_TOOL_TEST_SECRET'] = 'synthetic-secret'
    os.environ['RUSTFLAGS'] = '--unreviewed-flag'
    return manifest, archive, root / build['receiptPath']
`;

test("locked source build records verified crate, lock, compiler and output hashes", () => {
  python(
    sourceBuildFixture +
      String.raw`
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    manifest, archive, receipt_path = build_fixture(root)
    n.build_source_tool(manifest, root, 'cargo-llvm-cov', 'amd64')
    receipt = json.loads(receipt_path.read_text())
    assert receipt['sourceArchiveSha256'] == n.digest(archive.read_bytes())
    assert receipt['lockSha256'] == manifest['tools']['cargo-llvm-cov']['manifest']['sha256']
    assert receipt['command'] == ['cargo', 'install', '--path', '.', '--locked', '--root', '../install']
    assert receipt['binarySha256'] == n.digest(b'synthetic compiled tool')
    n.verify_binaries(manifest, root, 'amd64')
    rejects(lambda: n.verify_binaries(manifest, root, 'arm64'), 'Source build receipt mismatch: architecture')
    receipt['lockSha256'] = '0' * 64
    receipt_path.write_text(json.dumps(receipt))
    rejects(lambda: n.verify_binaries(manifest, root, 'amd64'), 'Source build receipt mismatch: lockSha256')
    receipt['lockSha256'] = manifest['tools']['cargo-llvm-cov']['manifest']['sha256']
    receipt_path.write_text(json.dumps(receipt))
    (root / 'cargo-llvm-cov/cargo-llvm-cov').write_bytes(b'changed')
    rejects(lambda: n.verify_binaries(manifest, root, 'amd64'), 'Source build binary checksum mismatch')
`,
  );
});

test("source build fails closed on bad archives, changed source manifests and Cargo failure", () => {
  python(
    sourceBuildFixture +
      String.raw`
for mode, expected in [('mutate-lock', 'Build changed Cargo.lock'), ('mutate-manifest', 'Build changed package manifest'), ('bad-archive', 'Build source archive checksum')]:
    with tempfile.TemporaryDirectory() as directory:
        root = pathlib.Path(directory)
        manifest, archive, receipt = build_fixture(root, mode)
        if mode == 'bad-archive': archive.write_bytes(b'corrupt')
        rejects(lambda: n.build_source_tool(manifest, root, 'cargo-llvm-cov', 'amd64'), expected)
        assert not receipt.exists()
        assert not (root / 'cargo-llvm-cov/cargo-llvm-cov').exists()
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    manifest, archive, receipt = build_fixture(root, 'fail')
    try: n.build_source_tool(manifest, root, 'cargo-llvm-cov', 'amd64')
    except n.subprocess.CalledProcessError as error: assert error.returncode == 9
    else: raise AssertionError('Expected Cargo failure')
    assert not receipt.exists()
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    manifest, archive, receipt = build_fixture(root)
    manifest['tools']['cargo-llvm-cov']['manifest']['sha256'] = '0' * 64
    rejects(lambda: n.build_source_tool(manifest, root, 'cargo-llvm-cov', 'amd64'), 'Dependency manifest hash mismatch')
    assert not receipt.exists()
`,
  );
});

test("secret scan exceptions only allow pinned Git reference lines in the tool inventory", () => {
  const config = readFileSync(
    new URL("../.gitleaks.toml", import.meta.url),
    "utf8",
  );
  const section = config.split('id = "sourcegraph-access-token"')[1];
  assert.ok(section);
  assert.ok(section.includes('condition = "AND"'));
  assert.ok(section.includes('regexTarget = "line"'));
  assert.ok(
    section.includes("paths = ['''^client/docker/ci-tool-notices\\.json$''']"),
  );
  const block = section.split("regexes = [\n")[1].split("\n]")[0];
  const patterns = [...block.matchAll(/'''(.*?)'''/g)].map(
    (match) => new RegExp(match[1]),
  );
  assert.equal(patterns.length, 3);
  const revision = createHash("sha256")
    .update("synthetic Git revision")
    .digest("hex")
    .slice(0, 40);
  const allowed = (line) => patterns.some((pattern) => pattern.test(line));
  for (const line of [
    `  "source:example/library@${revision}",`,
    `  "source:example/library@${revision}": {`,
    `  "noticeSource": "source:example/library@${revision}",`,
    `  "url": "https://codeload.github.com/example/library/tar.gz/${revision}",`,
  ])
    assert.ok(allowed(line), line);
  for (const line of [
    `  "accessToken": "${revision}",`,
    `  "url": "https://sourcegraph.example/${revision}",`,
    `  "url": "https://codeload.github.com/example/library/tar.gz/main?token=${revision}",`,
  ])
    assert.ok(!allowed(line), line);
});

test("committed inventory covers pflag and pins the source-free verifier inputs", () => {
  const manifestText = read("ci-tool-notices.json");
  const manifest = JSON.parse(manifestText);
  const llvm = manifest.tools["cargo-llvm-cov"];
  const source = JSON.parse(read("ci-assets.json"))["cargo-llvm-cov"].source;
  assert.equal(llvm.binaries, undefined);
  assert.equal(llvm.sourceBuild.method, "cargo-install-locked");
  assert.equal(
    source.sha256,
    "5e00647cc92940c4dd82249c480fe08fd3809767e89f056bcec46d8a7962ea5b",
  );
  assert.equal(
    source.lockSha256,
    "a2aa3c30f8038a315ea325abeed4a8535c820c23ef983391b6cd6f302b196377",
  );
  assert.equal(manifest.artifacts[llvm.source].sha256, source.sha256);
  assert.equal(llvm.manifest.sha256, source.lockSha256);
  const pflag = manifest.artifacts["go:github.com/spf13/pflag@v1.0.6"];
  assert.equal(
    pflag.url,
    "https://proxy.golang.org/github.com/spf13/pflag/@v/v1.0.6.zip",
  );
  assert.ok(pflag.notices.some((notice) => notice.path.endsWith("/LICENSE")));
  const verify = read("ci-verify.mjs");
  for (const [key, contents] of [
    ["manifest", manifestText],
    ["situate", readFileSync(new URL("../LICENSE", import.meta.url), "utf8")],
    ["verifier", read("ci-tool-notices.py")],
  ]) {
    const expected = createHash("sha256").update(contents).digest("hex");
    assert.ok(verify.includes(`${key}: "${expected}"`), key);
  }
  assert.match(verify, /execFileSync\("python3"/);
  assert.ok(read("Dockerfile").includes("COPY LICENSE /LICENSE"));
  assert.ok(read("Dockerfile.dockerignore").includes("!LICENSE"));
  assert.ok(verify.includes("/opt/ci-tools/LICENSE-Situate.txt"));
  for (const name of [
    "ci-tool-notices.py",
    "ci-tool-notices-update.py",
    "ci-tool-notices.json",
  ]) {
    assert.ok(read("Dockerfile").includes(`client/docker/${name}`));
    assert.ok(
      read("Dockerfile.dockerignore").includes(`!client/docker/${name}`),
    );
  }
  python(`
n.check_manifest(json.loads(pathlib.Path(${JSON.stringify(fileURLToPath(new URL("../client/docker/ci-tool-notices.json", import.meta.url)))}).read_text()), json.loads(pathlib.Path(${JSON.stringify(fileURLToPath(new URL("./toolchain.quality.json", import.meta.url)))}).read_text()))
`);
});
