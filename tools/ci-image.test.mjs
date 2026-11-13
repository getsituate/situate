import assert from "node:assert/strict";
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
import { imageInputs, inputDigest } from "./ci-image.mjs";
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
