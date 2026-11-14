import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  checkToolPins,
  imageInputs,
  inputDigest,
  validateLock,
} from "./ci-image.mjs";
import {
  sourceRequests,
  sourceArchiveNames,
  verifyJavaRelease,
} from "../client/docker/ci-sources.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const quality = JSON.parse(read("tools/toolchain.quality.json"));

test("CI helper and project-license changes invalidate image inputs and trigger publication", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "situate-ci-inputs-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of imageInputs()) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(new URL(`../${file}`, import.meta.url), target);
  }
  const before = inputDigest(directory);
  const helper = "client/docker/ci-input-probe.py";
  writeFileSync(join(directory, helper), "print(1)\n");
  assert.ok(imageInputs(directory).includes(helper));
  const added = inputDigest(directory);
  assert.notEqual(added, before);
  writeFileSync(join(directory, helper), "print(2)\n");
  assert.notEqual(inputDigest(directory), added);
  const changedHelper = inputDigest(directory);
  writeFileSync(join(directory, "LICENSE"), read("LICENSE") + "\n");
  assert.notEqual(inputDigest(directory), changedHelper);
  const workflow = read(".github/workflows/ci-tool-image.yml");
  assert.ok(workflow.includes("      - client/docker/ci-*\n"));
  assert.ok(workflow.includes("      - LICENSE\n"));
  assert.match(workflow, /run: node tools\/actions-adapter\.mjs image-build/);
  assert.match(workflow, /run: node tools\/actions-adapter\.mjs image-publish/);
});

test("CI tool pins bind prebuilt binaries or locked source builds to the quality toolchain", () => {
  const assets = JSON.parse(read("client/docker/ci-assets.json"));
  assert.deepEqual(Object.keys(assets).sort(), [
    "cargo-deny",
    "cargo-llvm-cov",
    "gh",
    "gitleaks",
  ]);
  for (const [name, tool] of Object.entries(assets)) {
    assert.equal(tool.version, quality[name].version);
    if (tool.sourceBuild) {
      assert.equal(name, "cargo-llvm-cov");
      assert.equal(tool.sourceBuild, "cargo-install-locked");
      assert.equal(
        tool.source.url,
        `https://static.crates.io/crates/${name}/${name}-${tool.version}.crate`,
      );
      assert.match(tool.source.sha256, /^[a-f0-9]{64}$/);
      assert.match(tool.source.lockSha256, /^[a-f0-9]{64}$/);
      assert.ok(!tool.amd64 && !tool.arm64);
      const notices = JSON.parse(read("client/docker/ci-tool-notices.json"));
      const component = notices.tools[name];
      assert.equal(
        notices.artifacts[component.source].sha256,
        tool.source.sha256,
      );
      assert.equal(component.manifest.sha256, tool.source.lockSha256);
      continue;
    }
    for (const architecture of ["arm64", "amd64"]) {
      assert.match(tool[architecture].sha256, /^[a-f0-9]{64}$/);
      assert.ok(tool[architecture].url.startsWith("https://github.com/"));
      assert.ok(tool[architecture].url.includes(tool.version));
    }
    assert.notEqual(tool.arm64.sha256, tool.amd64.sha256);
  }
  const npm = JSON.parse(read("client/docker/ci-npm.json"));
  assert.equal(npm.version, quality.npm.version);
  assert.equal(
    npm.url,
    `https://registry.npmjs.org/npm/-/npm-${quality.npm.version}.tgz`,
  );
  assert.match(npm.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
});

test("Volta distributions retain verified architecture pins and license", () => {
  const pin = JSON.parse(read("client/docker/ci-volta.json"));
  assert.equal(pin.version, "2.0.2");
  for (const arch of ["arm64", "x64"]) {
    assert.match(pin[arch].sha256, /^[a-f0-9]{64}$/);
    assert.ok(pin[arch].url.includes(`/v${pin.version}/`));
  }
  assert.notEqual(pin.arm64.sha256, pin.x64.sha256);
  assert.match(pin.license.sha256, /^[a-f0-9]{64}$/);
  const dockerfile = read("client/docker/Dockerfile");
  assert.match(dockerfile, /COPY package.json \/workspace\/package.json/);
  for (const path of dockerfile.matchAll(/\bPATH=([^\n]+)/g))
    assert.ok(
      path[1].startsWith("/opt/volta/bin:"),
      "Volta shims must precede other tools",
    );
});

test("CI stage is separate from project installs and release targets", () => {
  const dockerfile = read("client/docker/Dockerfile");
  const stage = dockerfile
    .split("FROM toolchain AS ci\n")[1]
    .split("FROM toolchain AS dependencies")[0];
  assert.ok(stage);
  assert.match(stage, /PLAYWRIGHT_BROWSERS_PATH=\/ci-cache\/browsers/);
  assert.match(stage, /chmod -R a\+rX \/usr\/local\/rustup/);
  assert.match(stage, /USER builder\nCMD \["bash"\]/);
  assert.doesNotMatch(
    stage,
    /npm ci|COPY client\/|windows-toolchain|ENTRYPOINT/,
  );
  assert.match(stage, /from=ci-inputs,target=\/ci-input,readonly/);
  const installer = read("client/docker/ci-install.mjs");
  assert.match(installer, /"install-deps"/);
  assert.doesNotMatch(
    installer,
    /"--with-deps"|"--only-shell"|package-lock\.json/,
  );
});

test("CI exposes Debian NSS wrapper through a stable architecture-independent path", () => {
  const dockerfile = read("client/docker/Dockerfile");
  const stage = dockerfile
    .split("FROM toolchain AS ci\n")[1]
    .split("FROM toolchain AS dependencies")[0];
  assert.match(
    stage,
    /apt-get install -y --no-install-recommends python3 bash git libnss-wrapper/,
  );
  assert.ok(
    stage.includes(
      'ln -s "/usr/lib/$(gcc -dumpmachine)/libnss_wrapper.so" /opt/ci-tools/libnss_wrapper.so',
    ),
  );
  assert.match(stage, /test -r \/opt\/ci-tools\/libnss_wrapper\.so/);
  assert.ok(
    stage.includes(
      "cp /ci-input/client/docker/ci-user.sh /opt/ci-tools/ci-user.sh",
    ),
  );
  assert.ok(
    stage.indexOf("libnss-wrapper") < stage.indexOf("ci-install.mjs"),
    "NSS package must precede the installed-package inventory",
  );
  assert.deepEqual(
    sourceRequests(
      "libnss-wrapper:arm64\t1.1.12-1+b1\tnss-wrapper\t1.1.12-1\n",
    ),
    ["nss-wrapper=1.1.12-1"],
  );
});

test("Docker context includes the exact CI installer inputs", () => {
  const ignore = read("client/docker/Dockerfile.dockerignore").split("\n");
  for (const path of [
    "LICENSE",
    "package.json",
    "client/docker/ci-volta-install.mjs",
    "client/docker/ci-volta.json",
    "client/docker/ci-install.mjs",
    "client/docker/ci-user.sh",
    "client/docker/ci-sources.mjs",
    "client/docker/ci-sources.json",
    "client/docker/ci-swift-tools.py",
    "client/docker/ci-swift-tools.json",
    "client/docker/ci-swift-format.resolved.json",
    "client/docker/ci-swiftlint.resolved.json",
    "client/docker/ci-assets.json",
    "client/docker/ci-npm.json",
    "client/docker/ci-browsers.json",
    "client/docker/ci-NOTICES.md",
    "tools/toolchain.quality.json",
  ]) {
    assert.ok(ignore.includes(`!${path}`), `${path} must reach the build`);
  }
});

test("both browser locks provide integrity-pinned Playwright distributions", () => {
  const browsers = JSON.parse(read("client/docker/ci-browsers.json"));
  for (const project of ["client", "requirements"]) {
    const lock = JSON.parse(read(`${project}/package-lock.json`));
    const core = lock.packages["node_modules/playwright-core"];
    const { version, resolved, integrity } = core;
    assert.deepEqual(browsers[project], { version, resolved, integrity });
    assert.match(core.integrity, /^sha512-/);
    assert.equal(
      core.resolved,
      `https://registry.npmjs.org/playwright-core/-/playwright-core-${core.version}.tgz`,
    );
    assert.equal(
      core.version,
      lock.packages["node_modules/@playwright/test"].version,
    );
  }
});

test("Debian source requests use exact source versions and deduplicate binary packages", () => {
  assert.deepEqual(
    sourceRequests(
      "libexample:arm64\t2.0-1+b2\texample\t2.0-1\nexample-dev\t2.0-1+b2\texample\t2.0-1\nbash\t5.2-1\tbash\t5.2-1\n",
    ),
    ["bash=5.2-1", "example=2.0-1"],
  );
  assert.throws(() => sourceRequests("example\t1.0\t\t"));
  assert.throws(() => sourceRequests("example\t1.0\texample\t"));
});

test("Debian archive selection excludes notices and rejects paths outside snapshot archives", () => {
  assert.deepEqual(
    sourceArchiveNames(
      "Reading package lists...\n'https://snapshot.debian.org/archive/debian/20260919T000000Z/pool/main/e/example/example_1.0.dsc' example_1.0.dsc 100 SHA256:abc\n",
    ),
    ["example_1.0.dsc"],
  );
  assert.throws(() => sourceArchiveNames("Reading package lists..."));
  assert.throws(() =>
    sourceArchiveNames(
      "'https://other.example/archive' example.dsc 100 SHA256:abc",
    ),
  );
  assert.throws(() =>
    sourceArchiveNames(
      "'https://snapshot.debian.org/archive' ../escape.dsc 100 SHA256:abc",
    ),
  );
});

test("Temurin source provenance rejects mismatched binary releases", () => {
  const pin = {
    javaVersion: "21.0.1",
    sourceCommit: "a".repeat(40),
    buildCommit: "b".repeat(40),
  };
  const release = `JAVA_VERSION="21.0.1"\nSOURCE_REPO="https://github.com/adoptium/jdk21u.git"\nBUILD_SOURCE_REPO="https://github.com/adoptium/temurin-build.git"\nSOURCE=".:git:aaaaaaaaaaaa"\nBUILD_SOURCE="git:${"b".repeat(40)}"\n`;
  assert.doesNotThrow(() => verifyJavaRelease(release, pin));
  assert.throws(() =>
    verifyJavaRelease(release.replace("21.0.1", "21.0.2"), pin),
  );
  assert.throws(() =>
    verifyJavaRelease(release.replace("aaaaaaaaaaaa", "cccccccccccc"), pin),
  );
  assert.throws(() =>
    verifyJavaRelease(release, { ...pin, buildCommit: "c".repeat(40) }),
  );
});

test("Swift source tools bind reviewed locks and a narrow Debian runtime export", (t) => {
  checkToolPins();
  const dockerfile = read("client/docker/Dockerfile");
  const manifest = JSON.parse(read("client/docker/ci-swift-tools.json"));
  assert.ok(dockerfile.includes(`FROM ${manifest.compiler.image} AS ci-swift`));
  assert.ok(
    dockerfile.includes(
      "COPY --from=ci-swift /export/opt/ci-tools/ /opt/ci-tools/",
    ),
  );
  assert.doesNotMatch(dockerfile, /COPY --from=ci-swift \/(?: |$)/m);
  assert.deepEqual(Object.keys(manifest.tools).sort(), [
    "swift-format",
    "swiftlint",
  ]);
  for (const name of Object.keys(manifest.tools)) {
    assert.equal(manifest.tools[name].version, quality[name].version);
    assert.ok(
      imageInputs().includes(`client/docker/${manifest.tools[name].lock}`),
    );
  }
  const temporary = mkdtempSync(join(tmpdir(), "situate-swift-image-pins-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  for (const file of imageInputs()) {
    const target = join(temporary, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(new URL(`../${file}`, import.meta.url), target);
  }
  const before = inputDigest(temporary);
  const lock = join(temporary, "client/docker/ci-swift-format.resolved.json");
  writeFileSync(lock, readFileSync(lock, "utf8") + "\n");
  assert.throws(() => checkToolPins(temporary), /build lock changed/);
  assert.notEqual(inputDigest(temporary), before);
  const published = JSON.parse(read("tools/ci-image.lock.json"));
  assert.throws(
    () => validateLock(published, "0".repeat(64)),
    /Build and verify a new image/,
  );
});

test("source-free verifier pins Swift inventories and exercises SourceKit rather than skipping rules", () => {
  const verify = read("client/docker/ci-verify.mjs");
  for (const [key, file] of [
    ["swiftManifest", "ci-swift-tools.json"],
    ["swiftVerifier", "ci-swift-tools.py"],
  ]) {
    const checksum = createHash("sha256")
      .update(read(`client/docker/${file}`))
      .digest("hex");
    assert.ok(
      verify.replaceAll(/\s/g, "").includes(`${key}:"${checksum}"`),
      file,
    );
  }
  assert.ok(verify.includes('output("gh", ["api", "--help"])'));
  assert.match(verify, /--slurp/);
  assert.match(verify, /statement_position/);
  assert.match(verify, /SourceKit-dependent lint must detect/);
  assert.match(verify, /skipping\|prohibited\|could not load/);
});

test("Swift source extraction rejects traversal, escaping links and unexpected runtime libraries", () => {
  const helper = fileURLToPath(
    new URL("../client/docker/ci-swift-tools.py", import.meta.url),
  );
  execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util, io, pathlib, tarfile, tempfile
spec = importlib.util.spec_from_file_location("swift_tools", ${JSON.stringify(helper)})
n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n)
def rejected(action):
    try: action()
    except ValueError: return
    raise AssertionError("unsafe input accepted")
with tempfile.TemporaryDirectory() as temporary:
    root = pathlib.Path(temporary)
    for index, name in enumerate(["../escaped", "/escaped", "source/link"]):
        archive = root / (str(index) + ".tar.gz")
        with tarfile.open(archive, "w:gz") as output:
            entry = tarfile.TarInfo(name)
            if index == 2:
                entry.type = tarfile.SYMTYPE
                entry.linkname = "../../escaped"
                output.addfile(entry)
            else:
                entry.size = 4
                output.addfile(entry, io.BytesIO(b"data"))
        destination = root / ("tree" + str(index))
        destination.mkdir()
        rejected(lambda: n.extract_tree(archive, destination))
    archive = root / "valid.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        entry = tarfile.TarInfo("source/example.swift")
        entry.size = 4
        output.addfile(entry, io.BytesIO(b"data"))
    destination = root / "valid"
    destination.mkdir()
    n.extract_tree(archive, destination)
    n.tree_matches(archive, destination / "source")
    (destination / "source/example.swift").write_bytes(b"changed")
    rejected(lambda: n.tree_matches(archive, destination / "source"))
closure = n.runtime_closure(["tool"], lambda _: "libswiftCore.so => /usr/lib/swift/linux/libswiftCore.so (0x0)\\nlibc.so.6 => /lib/aarch64-linux-gnu/libc.so.6 (0x0)")
assert pathlib.Path("/usr/lib/swift/linux/libswiftCore.so") in closure
assert not any(path.name == "libc.so.6" for path in closure)
rejected(lambda: n.runtime_closure(["tool"], lambda _: "library => /tmp/foreign.so (0x0)"))
rejected(lambda: n.runtime_closure(["tool"], lambda _: "library => not found"))
`,
    ],
    {
      stdio: "pipe",
      env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
});

test("Swift source-build receipts reject changed outputs, aliases and compiler identity", () => {
  const helper = fileURLToPath(
    new URL("../client/docker/ci-swift-tools.py", import.meta.url),
  );
  execFileSync(
    "python3",
    [
      "-c",
      `
import importlib.util, io, json, pathlib, platform, tarfile, tempfile
spec = importlib.util.spec_from_file_location("swift_tools", ${JSON.stringify(helper)})
n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(n)
def rejected(action):
    try: action()
    except ValueError: return
    raise AssertionError("tampered source build accepted")
with tempfile.TemporaryDirectory() as temporary:
    root = pathlib.Path(temporary)
    source = root / "swift-sources"
    source.mkdir()
    archive = source / "input.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        entry = tarfile.TarInfo("source/LICENSE")
        entry.size = 15
        output.addfile(entry, io.BytesIO(b"synthetic terms"))
    archive_sha = n.file_digest(archive)
    pinned = source / (archive_sha + ".tar.gz")
    archive.rename(pinned)
    notices = n.notice_inventory(pinned)
    (source / "notices").mkdir()
    (source / "notices" / notices[0]["sha256"]).write_bytes(b"synthetic terms")
    runtime = root / "swift-runtime/usr/lib"
    runtime.mkdir(parents=True)
    (runtime / "libsourcekitdInProc.so").write_bytes(b"synthetic runtime")
    (root / "swift-runtime/LICENSE.txt").write_bytes(b"synthetic terms")
    selected = {}
    quality = {}
    for name, version in [("swift-format", "600.0.0"), ("swiftlint", "0.65.1")]:
        (root / name).mkdir()
        (root / name / name).write_bytes(b"synthetic tool")
        lock = root / ("ci-" + name + ".resolved.json")
        lock.write_text(json.dumps({"version": 2, "pins": []}))
        selected[name] = {"version": version, "source": "fixture", "lock": lock.name, "lockSha256": n.file_digest(lock), "dependencies": {}}
        quality[name] = {"version": version}
    (root / "toolchain.quality.json").write_text(json.dumps(quality))
    repository = "https://github.com/example/tool"
    revision = "a" * 40
    manifest = {"schemaVersion": 1, "tools": selected, "compiler": {"image": "swift:6.2.4-bookworm@sha256:" + "b" * 64, "version": "6.2.4", "sources": ["fixture"], "licenseSha256": n.digest(b"synthetic terms")}, "artifacts": {"fixture": {"repository": repository, "revision": revision, "url": "https://codeload.github.com/example/tool/tar.gz/" + revision, "sha256": archive_sha, "notices": notices}}}
    manifest_path = root / "ci-swift-tools.json"
    manifest_path.write_text(json.dumps(manifest))
    files = {str(path.relative_to(root)): n.file_digest(path) for path in root.rglob("*") if path.is_file()}
    receipt = {"schemaVersion": 1, "method": "swift-build-locked", "arguments": n.BUILD_ARGS, "manifestSha256": n.file_digest(manifest_path), "builderSha256": n.file_digest(${JSON.stringify(helper)}), "compilerImage": manifest["compiler"]["image"], "architecture": platform.machine(), "compiler": "Swift version 6.2.4 (swift-6.2.4-RELEASE)", "files": files}
    receipt_path = root / "swift-source-build.json"
    receipt_path.write_text(json.dumps(receipt))
    n.verify(manifest, manifest_path, root)
    for path in [root / "swiftlint/swiftlint", runtime / "libsourcekitdInProc.so"]:
        original = path.read_bytes()
        path.write_bytes(b"changed")
        rejected(lambda: n.verify(manifest, manifest_path, root))
        path.write_bytes(original)
    tool = root / "swiftlint/swiftlint"
    tool.rename(root / "aliased-tool")
    tool.symlink_to(root / "aliased-tool")
    rejected(lambda: n.verify(manifest, manifest_path, root))
    tool.unlink()
    (root / "aliased-tool").rename(tool)
    receipt["compilerImage"] = "unreviewed"
    receipt_path.write_text(json.dumps(receipt))
    rejected(lambda: n.verify(manifest, manifest_path, root))
`,
    ],
    {
      stdio: "pipe",
      env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
});
