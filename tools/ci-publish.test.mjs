import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  archiveDigest,
  anonymousManifest,
  platformContext,
  platforms,
  publishIndex,
  validateBuildSet,
  validateRemoteChild,
  validateRemoteIndex,
  candidateRevision,
  context,
  image,
  imageConfigDigest,
  main,
  maxArchiveBytes,
  maxExpandedArchiveBytes,
  validateExpandedArchiveSize,
  validateArchiveManifest,
  validateArtifactResponse,
  validateImage,
  validatePackage,
  validateProvenance,
} from "./ci-publish.mjs";

const env = {
  GITHUB_REPOSITORY: "getsituate/situate",
  GITHUB_ACTOR: "image-maintainer",
  GITHUB_REPOSITORY_ID: "42",
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  WORKFLOW_SHA: "a".repeat(40),
};
const expected = context(env);
const provenance = () => ({
  version: 1,
  ...expected,
  revision: "b".repeat(40),
  inputsSha256: "c".repeat(64),
  imageId: `sha256:${"d".repeat(64)}`,
  configDigest: `sha256:${"d".repeat(64)}`,
  bytes: 1024,
  archiveSha256: "e".repeat(64),
});
const pkg = () => ({
  name: "situate-ci-linux",
  package_type: "container",
  visibility: "public",
  repository: { full_name: expected.repository, id: 42 },
});
const inspected = () => ({
  Id: provenance().imageId,
  Os: "linux",
  Architecture: "amd64",
  RepoTags: [expected.localTag],
  RepoDigests: [`${image}@sha256:${"f".repeat(64)}`],
  Config: {
    Labels: {
      "org.opencontainers.image.source":
        "https://github.com/getsituate/situate",
      "org.opencontainers.image.revision": provenance().revision,
    },
  },
});
const manifest = () => [
  {
    Config: `blobs/sha256/${"d".repeat(64)}`,
    RepoTags: [expected.localTag],
    Layers: [`blobs/sha256/${"1".repeat(64)}`],
  },
];
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-ci-publish-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("publication accepts only the exact repository's main push or manual run", () => {
  assert.equal(expected.publishTag, `${image}:build-123-2`);
  assert.equal(
    context({ ...env, GITHUB_EVENT_NAME: "push" }).localTag,
    "situate-ci-build:123-2",
  );
  for (const [key, value] of [
    ["GITHUB_REPOSITORY", "other/situate"],
    ["GITHUB_REPOSITORY", "getsituate/other"],
    ["GITHUB_REPOSITORY", "marcus-held/situate"],
    ["GITHUB_REF", "refs/heads/feature"],
    ["GITHUB_EVENT_NAME", "pull_request"],
    ["GITHUB_EVENT_NAME", "pull_request_target"],
    ["GITHUB_RUN_ID", "123\nlatest"],
    ["WORKFLOW_SHA", "main"],
    ["GITHUB_REPOSITORY_ID", ""],
  ])
    assert.throws(() => context({ ...env, [key]: value }), /main-branch/);
  assert.equal(candidateRevision("", "a".repeat(40)), "a".repeat(40));
  assert.equal(
    candidateRevision("b".repeat(40), "a".repeat(40)),
    "b".repeat(40),
  );
  for (const value of [
    "main",
    "abc",
    "a".repeat(41),
    "a".repeat(40) + "\n",
    "$(id)",
  ])
    assert.throws(() => candidateRevision(value), /commit SHA/);
});

test("provenance binds the repository, run, attempt, workflow, tag and bounded archive", () => {
  assert.equal(
    validateProvenance(provenance(), expected).revision,
    "b".repeat(40),
  );
  for (const [key, value] of [
    ["repository", "other/repo"],
    ["repositoryId", "99"],
    ["runId", "124"],
    ["attempt", "1"],
    ["workflowSha", "c".repeat(40)],
    ["localTag", "latest"],
    ["publishTag", `${image}:latest`],
    ["bytes", maxArchiveBytes + 1],
    ["bytes", 0],
    ["bytes", 1.5],
    ["archiveSha256", "bad"],
    ["inputsSha256", "bad"],
    ["revision", "main"],
    ["imageId", "sha256:bad"],
  ])
    assert.throws(
      () => validateProvenance({ ...provenance(), [key]: value }, expected),
      /provenance/,
    );
});

test("image archive is one bounded regular file hashed as a stream", async (t) => {
  const directory = temporary(t);
  const file = join(directory, "image.tar");
  writeFileSync(file, "abc");
  assert.deepEqual(await archiveDigest(directory), {
    bytes: 3,
    archiveSha256:
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  });
  writeFileSync(join(directory, "unexpected"), "x");
  await assert.rejects(archiveDigest(directory), /only image.tar/);
  rmSync(join(directory, "unexpected"));
  truncateSync(file, maxArchiveBytes + 1);
  await assert.rejects(archiveDigest(directory), /at most 8 GiB/);
  rmSync(file);
  symlinkSync("missing", file);
  await assert.rejects(archiveDigest(directory), /regular file/);
});

test("archive and loaded metadata must match the sole approved image", () => {
  validateArchiveManifest(manifest(), provenance());
  validateImage(inspected(), provenance());
  for (const value of [
    [],
    [...manifest(), ...manifest()],
    [{ ...manifest()[0], RepoTags: ["foreign:latest"] }],
    [{ ...manifest()[0], Config: "../config.json" }],
    [{ ...manifest()[0], Layers: ["../../outside"] }],
  ])
    assert.throws(
      () => validateArchiveManifest(value, provenance()),
      /Archive/,
    );
  for (const value of [
    { ...inspected(), Id: `sha256:${"0".repeat(64)}` },
    { ...inspected(), Architecture: "arm64" },
    { ...inspected(), Os: "windows" },
    { ...inspected(), Config: { Labels: {} } },
  ])
    assert.throws(() => validateImage(value, provenance()), /provenance/);
});

test("existing packages must be public and linked by both repository name and ID", () => {
  validatePackage(pkg(), expected);
  for (const value of [
    { ...pkg(), visibility: "private" },
    { ...pkg(), visibility: "internal" },
    { ...pkg(), name: "other" },
    { ...pkg(), package_type: "npm" },
    { ...pkg(), repository: null },
    { ...pkg(), repository: { full_name: "other/situate", id: 42 } },
    { ...pkg(), repository: { full_name: expected.repository, id: 99 } },
  ])
    assert.throws(() => validatePackage(value, expected), /public and linked/);
});

test("same-run artifact metadata rejects missing, duplicate, expired and oversized archives", () => {
  const artifact = {
    name: "ci-image-123-2",
    size_in_bytes: 1024,
    expired: false,
  };
  validateArtifactResponse(
    { total_count: 1, artifacts: [artifact] },
    artifact.name,
  );
  for (const response of [
    { total_count: 0, artifacts: [] },
    { total_count: 2, artifacts: [artifact, artifact] },
    { total_count: 101, artifacts: [artifact] },
    { total_count: 1, artifacts: [{ ...artifact, expired: true }] },
    {
      total_count: 1,
      artifacts: [{ ...artifact, size_in_bytes: maxArchiveBytes + 1 }],
    },
    { total_count: 1, artifacts: [{ ...artifact, name: "ci-image-122-2" }] },
  ])
    assert.throws(
      () => validateArtifactResponse(response, artifact.name),
      /same-run/,
    );
});

async function publisherFixture(t) {
  const directory = temporary(t);
  const artifact = join(directory, "artifact");
  const data = join(directory, "data");
  mkdirSync(artifact);
  mkdirSync(data);
  writeFileSync(join(data, "manifest.json"), JSON.stringify(manifest()));
  execFileSync("tar", [
    "-cf",
    join(artifact, "image.tar"),
    "-C",
    data,
    "manifest.json",
  ]);
  const value = { ...provenance(), ...(await archiveDigest(artifact)) };
  const log = join(directory, "docker.log");
  const binary = join(directory, "docker");
  writeFileSync(
    binary,
    `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nconst args=process.argv.slice(2); if(args[0]==='--version') { console.log('fixture-docker'); process.exit(0); } appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n'); if(args[0]==='image') console.log(${JSON.stringify(JSON.stringify([inspected()]))});\n`,
    { mode: 0o755 },
  );
  const environment = {
    ...env,
    GH_TOKEN: "fixture-token",
    PROVENANCE: JSON.stringify(value),
    PATH: `${directory}:${process.env.PATH}`,
    GITHUB_OUTPUT: join(directory, "output"),
    GITHUB_STEP_SUMMARY: join(directory, "summary"),
  };
  const original = Object.fromEntries(
    Object.keys(environment).map((key) => [key, process.env[key]]),
  );
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  // Child processes use the native environment backing store in newer Node versions.
  Object.assign(process.env, environment);
  assert.equal(
    execFileSync("docker", ["--version"], { encoding: "utf8" }).trim(),
    "fixture-docker",
    "Publisher tests must resolve the Docker fixture before exercising write commands",
  );
  const calls = [];
  const responses = [
    new Response(JSON.stringify(pkg())),
    new Response(JSON.stringify(pkg())),
  ];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    const response = responses.shift();
    assert.ok(response, "unexpected API call");
    return response;
  });
  return { directory, artifact, calls, responses, log };
}

test("containerd manifests retain separate image and configuration identities", () => {
  const value = inspected();
  value.Id = `sha256:${"2".repeat(64)}`;
  value.Descriptor = {
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: value.Id,
    annotations: { "config.digest": provenance().configDigest },
  };
  const bound = { ...provenance(), imageId: value.Id };
  assert.equal(imageConfigDigest(value), bound.configDigest);
  validateImage(value, bound);
  validateArchiveManifest(manifest(), bound);
  assert.throws(() =>
    validateImage(value, {
      ...bound,
      configDigest: `sha256:${"3".repeat(64)}`,
    }),
  );
  value.Descriptor.mediaType = "application/vnd.oci.image.index.v1+json";
  assert.throws(() => validateImage(value, bound), /single-platform/u);
  value.Descriptor.mediaType = "application/vnd.oci.image.manifest.v1+json";
  delete value.Descriptor.annotations["config.digest"];
  assert.throws(() => validateImage(value, bound), /configuration digest/u);
});

test("expanded archive sizes remain bounded independently of compressed transport size", () => {
  validateExpandedArchiveSize(maxExpandedArchiveBytes);
  for (const bytes of [maxExpandedArchiveBytes + 1, -1, NaN, Infinity])
    assert.throws(
      () => validateExpandedArchiveSize(bytes),
      /Expanded image archive/u,
    );
});

test("publisher accepts a checksum-bound gzip archive with the stable artifact filename", async (t) => {
  const f = await publisherFixture(t);
  const path = join(f.artifact, "image.tar");
  const raw = readFileSync(path);
  writeFileSync(path, gzipSync(raw));
  process.env.PROVENANCE = JSON.stringify({
    ...provenance(),
    ...(await archiveDigest(f.artifact)),
  });
  await main(["publish", f.artifact]);
  assert.match(readFileSync(f.log, "utf8"), /\["push",/u);
});

test("truncated gzip archives fail before Docker or registry access", async (t) => {
  const f = await publisherFixture(t);
  writeFileSync(join(f.artifact, "image.tar"), Buffer.from([0x1f, 0x8b, 0x08]));
  await assert.rejects(main(["publish", f.artifact]));
  assert.equal(f.calls.length, 0);
  assert.throws(() => readFileSync(f.log), { code: "ENOENT" });
});

test("publisher checks public access before login, never runs images, and publishes only the unique tag", async (t) => {
  const f = await publisherFixture(t);
  await main(["publish", f.artifact]);
  assert.equal(f.calls.length, 2);
  assert.ok(
    f.calls.every(
      (url) =>
        url ===
        "https://api.github.com/orgs/getsituate/packages/container/situate-ci-linux",
    ),
  );
  const commands = readFileSync(f.log, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.deepEqual(
    commands.map((args) => args[0]),
    ["load", "image", "tag", "login", "push", "image", "logout"],
  );
  assert.deepEqual(
    commands.find((args) => args[0] === "push"),
    ["push", `${image}:build-123-2`],
  );
  assert.deepEqual(
    commands.find((args) => args[0] === "login"),
    ["login", "ghcr.io", "--username", "image-maintainer", "--password-stdin"],
  );
  assert.doesNotMatch(readFileSync(f.log, "utf8"), /fixture-token|latest/);
  assert.match(
    readFileSync(join(f.directory, "summary"), "utf8"),
    /Inputs SHA-256/,
  );
  assert.match(
    readFileSync(join(f.directory, "output"), "utf8"),
    /digest=ghcr.io\/getsituate\/situate-ci-linux@sha256:/,
  );
});

test("private packages are rejected before Docker load or registry login", async (t) => {
  const f = await publisherFixture(t);
  f.responses[0] = new Response(
    JSON.stringify({ ...pkg(), visibility: "private" }),
  );
  await assert.rejects(main(["publish", f.artifact]), /public and linked/);
  assert.throws(() => readFileSync(f.log), { code: "ENOENT" });
});

test("publication logs out if post-push public visibility changes", async (t) => {
  const f = await publisherFixture(t);
  f.responses[1] = new Response(
    JSON.stringify({ ...pkg(), visibility: "private" }),
  );
  await assert.rejects(main(["publish", f.artifact]), /public and linked/);
  assert.match(readFileSync(f.log, "utf8"), /\["logout","ghcr.io"\]/);
  assert.throws(() => readFileSync(join(f.directory, "summary")), {
    code: "ENOENT",
  });
});

test("absent packages require explicit bootstrap before any Docker access", async (t) => {
  const f = await publisherFixture(t);
  f.responses[0] = new Response("", { status: 404 });
  await assert.rejects(
    main(["publish", f.artifact]),
    /reviewed manual bootstrap/,
  );
  assert.throws(() => readFileSync(f.log), { code: "ENOENT" });
});

test("manual bootstrap creates a linked private package without a pinnable output", async (t) => {
  const f = await publisherFixture(t);
  f.responses[0] = new Response("", { status: 404 });
  f.responses[1] = new Response(
    JSON.stringify({ ...pkg(), visibility: "private" }),
  );
  await main(["bootstrap", f.artifact]);
  assert.match(readFileSync(f.log, "utf8"), /\["push",/);
  assert.match(readFileSync(f.log, "utf8"), /\["logout","ghcr.io"\]/);
  assert.match(
    readFileSync(join(f.directory, "summary"), "utf8"),
    /explicitly make the package public/,
  );
  assert.throws(() => readFileSync(join(f.directory, "output")), {
    code: "ENOENT",
  });
});

test("bootstrap refuses an existing package without Docker access", async (t) => {
  const f = await publisherFixture(t);
  await assert.rejects(main(["bootstrap", f.artifact]), /absent GHCR package/);
  assert.throws(() => readFileSync(f.log), { code: "ENOENT" });
});

test("push cannot request bootstrap", async (t) => {
  const f = await publisherFixture(t);
  process.env.GITHUB_EVENT_NAME = "push";
  await assert.rejects(main(["bootstrap", f.artifact]), /reviewed manual run/);
  assert.equal(f.calls.length, 0);
  assert.throws(() => readFileSync(f.log), { code: "ENOENT" });
});

test("bootstrap rejects incorrect post-push repository linkage and logs out", async (t) => {
  const f = await publisherFixture(t);
  f.responses[0] = new Response("", { status: 404 });
  f.responses[1] = new Response(
    JSON.stringify({
      ...pkg(),
      visibility: "private",
      repository: { full_name: expected.repository, id: 99 },
    }),
  );
  await assert.rejects(main(["bootstrap", f.artifact]), /private and linked/);
  assert.match(readFileSync(f.log, "utf8"), /\["logout","ghcr.io"\]/);
  assert.throws(() => readFileSync(join(f.directory, "summary")), {
    code: "ENOENT",
  });
});

test("an API permission failure cannot be treated as a new package", async (t) => {
  const f = await publisherFixture(t);
  f.responses[0] = new Response("", { status: 403 });
  f.responses[1] = new Response("", { status: 403 });
  await assert.rejects(main(["publish", f.artifact]), /HTTP 403/);
  await assert.rejects(main(["bootstrap", f.artifact]), /HTTP 403/);
  assert.throws(() => readFileSync(f.log), { code: "ENOENT" });
});

test("changed archives cannot reach the registry or Docker", async (t) => {
  const f = await publisherFixture(t);
  writeFileSync(join(f.artifact, "image.tar"), "changed");
  await assert.rejects(main(["publish", f.artifact]), /checksum or size/);
  assert.equal(f.calls.length, 0);
  assert.throws(() => readFileSync(f.log), { code: "ENOENT" });
});

test("image script verifies a source-bound candidate without network or registry credentials", async (t) => {
  const { main: actions } = await import("./actions-adapter.mjs");
  const directory = temporary(t);
  const calls = [];
  const source = "b".repeat(40);
  const stopped = new Error("stop before archive transfer");
  await assert.rejects(
    actions(
      ["image-build"],
      {
        ...env,
        GITHUB_SHA: source,
        RUNNER_TEMP: directory,
        ACTIONS_RUNTIME_TOKEN: "synthetic-runtime-token",
        ACTIONS_RESULTS_URL: "https://results.actions.githubusercontent.com/",
      },
      (command, args) => {
        calls.push([command, args]);
        if (command === "git") return source;
        if (command === "docker" && args[0] === "info") return "linux/amd64";
        if (command === "docker" && args[0] === "save") throw stopped;
        return "";
      },
    ),
    (error) => error === stopped,
  );
  const build = calls.find(
    ([command, args]) => command === "docker" && args[0] === "build",
  )[1];
  assert.deepEqual(build.slice(0, 6), [
    "build",
    "--provenance=false",
    "--target",
    "ci",
    "--platform",
    "linux/amd64",
  ]);
  assert.ok(build.includes(`org.opencontainers.image.revision=${source}`));
  assert.ok(
    build.includes(
      "org.opencontainers.image.source=https://github.com/getsituate/situate",
    ),
  );
  const verify = calls.find(
    ([command, args]) => command === "docker" && args[0] === "run",
  )[1];
  for (const [flag, value] of [
    ["--user", "1000:1000"],
    ["--network", "none"],
    ["--cap-drop", "ALL"],
    ["--security-opt", "no-new-privileges"],
    ["--entrypoint", "/opt/volta/bin/node"],
  ])
    assert.equal(verify[verify.indexOf(flag) + 1], value, flag);
  assert.ok(verify.includes("--read-only"));
  assert.match(
    verify[verify.indexOf("--mount") + 1],
    /client\/docker\/ci-verify\.mjs,dst=\/ci-verify\.mjs,readonly$/,
  );
  assert.deepEqual(verify.slice(-2), [expected.localTag, "/ci-verify.mjs"]);
  assert.doesNotMatch(
    JSON.stringify(calls),
    /synthetic-runtime-token|docker.*(?:login|push)/,
  );
});

test("image script rejects another source before building and delegates publication as data only", async (t) => {
  const { main: actions } = await import("./actions-adapter.mjs");
  const directory = temporary(t);
  const calls = [];
  await assert.rejects(
    actions(
      ["image-build"],
      {
        ...env,
        GITHUB_SHA: "b".repeat(40),
        RUNNER_TEMP: directory,
        ACTIONS_RUNTIME_TOKEN: "synthetic-runtime-token",
        ACTIONS_RESULTS_URL: "https://results.actions.githubusercontent.com/",
      },
      (command, args) => {
        calls.push([command, args]);
        return "c".repeat(40);
      },
    ),
    /source differs/,
  );
  assert.deepEqual(calls, [["git", ["rev-parse", "HEAD"]]]);
  calls.length = 0;
  await actions(
    ["image-publish"],
    { ...env, RUNNER_TEMP: directory },
    (command, args) => {
      calls.push([command, args]);
      return "";
    },
  );
  assert.deepEqual(calls, [
    [
      process.execPath,
      ["tools/ci-publish.mjs", "publish-index", join(directory, "ci-image")],
    ],
  ]);
});

test("workflow separates read-only candidate building from privileged data-only publication", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci-tool-image.yml", import.meta.url),
    "utf8",
  );
  const [build, publish] = workflow.split("  publish:\n");
  assert.doesNotMatch(workflow, /pull_request|:latest|contents: write/);
  assert.equal(
    (workflow.match(/github.repository == 'getsituate\/situate'/g) ?? [])
      .length,
    2,
  );
  assert.match(build, /github.ref == 'refs\/heads\/main'/);
  assert.match(publish, /github.ref == 'refs\/heads\/main'/);
  assert.match(build, /run: node tools\/actions-adapter\.mjs image-build/);
  for (const [architecture, runner] of [
    ["amd64", "ubuntu-24.04"],
    ["arm64", "ubuntu-24.04-arm"],
  ]) {
    const job = build
      .split(`  build-${architecture}:\n`)[1]
      .split(/\n {2}[a-z]+-/)[0];
    assert.ok(job.includes(`runs-on: ${runner}\n`));
    assert.ok(job.includes(`CI_IMAGE_PLATFORM: linux/${architecture}`));
    const [buildSteps, transferStep] = job.split(
      "      - run: node tools/actions-adapter.mjs image-upload\n",
    );
    assert.doesNotMatch(buildSteps, /packages: write|GH_TOKEN:|secrets\./);
    assert.match(transferStep, /CI_IMAGE_TRANSFER_UPLOAD_SSH_PRIVATE_KEY/);
    assert.doesNotMatch(
      transferStep,
      /GH_TOKEN:|MACOS_(?:RELEASE|PUBLICATION)/,
    );
  }
  assert.match(publish, /needs: \[policy, build-amd64, build-arm64\]/);
  assert.match(publish, /run: node tools\/actions-adapter\.mjs image-publish/);
  assert.match(publish, /packages: write/);
  assert.doesNotMatch(publish, /actions: read/);
  assert.match(publish, /image-download/);
  assert.match(publish, /CI_IMAGE_TRANSFER_READ_SSH_PRIVATE_KEY/);
  assert.match(publish, /GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(
    publish,
    /PROVENANCES: .*needs.build-amd64.outputs.provenance, needs.build-arm64.outputs.provenance/,
  );
  assert.match(
    publish,
    /DOCKER_CONFIG: \$\{\{ runner.temp \}\}\/ci-registry-auth/,
  );
  assert.doesNotMatch(publish, /docker run|docker build|image-build/);
  assert.equal(
    (workflow.match(/ref: \$\{\{ github.sha \}\}/g) ?? []).length,
    4,
  );
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 4);
  for (const action of workflow.matchAll(/uses: (.+)/g))
    assert.match(action[1], /^actions\/checkout@[a-f0-9]{40}$/);
});

const buildReceipts = () =>
  platforms.map((platform, index) => ({
    ...provenance(),
    version: 2,
    ...platformContext(expected, platform),
    imageId: `sha256:${String(index + 1).repeat(64)}`,
    configDigest: `sha256:${String(index + 3).repeat(64)}`,
  }));
const childDigests = {
  "linux/amd64": `sha256:${"5".repeat(64)}`,
  "linux/arm64": `sha256:${"6".repeat(64)}`,
};
const remoteIndex = () => ({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: platforms.map((platform) => ({
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: childDigests[platform],
    platform: { os: "linux", architecture: platform.split("/")[1] },
  })),
});

test("two-platform provenance rejects mixed identities and missing, duplicate or unknown platforms", () => {
  const check = (receipts) =>
    validateBuildSet(
      receipts,
      expected,
      provenance().revision,
      provenance().inputsSha256,
    );
  assert.deepEqual(
    check(buildReceipts().reverse()).map((receipt) => receipt.platform),
    platforms,
  );
  for (const receipts of [
    [],
    buildReceipts().slice(0, 1),
    [...buildReceipts(), buildReceipts()[0]],
    [buildReceipts()[0], buildReceipts()[0]],
    [buildReceipts()[0], { ...buildReceipts()[1], platform: "linux/s390x" }],
  ])
    assert.throws(() => check(receipts));
  for (const [key, value] of [
    ["version", 1],
    ["repository", "other/repo"],
    ["repositoryId", "99"],
    ["runId", "124"],
    ["attempt", "1"],
    ["workflowSha", "c".repeat(40)],
    ["revision", "f".repeat(40)],
    ["inputsSha256", "f".repeat(64)],
    ["localTag", expected.localTag],
    ["publishTag", expected.publishTag],
    ["platform", undefined],
  ])
    assert.throws(
      () =>
        check([buildReceipts()[0], { ...buildReceipts()[1], [key]: value }]),
      key,
    );
  assert.throws(
    () => context({ ...env, CI_IMAGE_PLATFORM: "linux/s390x" }),
    /platform/,
  );
  assert.throws(
    () =>
      validateImage(
        { ...inspected(), Architecture: "amd64" },
        buildReceipts()[1],
      ),
    /provenance/,
  );
});

test("remote indexes require exactly the verified platform-to-digest correspondence", () => {
  validateRemoteIndex(remoteIndex(), childDigests);
  const dockerIndex = remoteIndex();
  dockerIndex.mediaType =
    "application/vnd.docker.distribution.manifest.list.v2+json";
  dockerIndex.manifests[1].platform.variant = "v8";
  validateRemoteIndex(dockerIndex, childDigests);
  for (const mutate of [
    (value) => value.manifests.pop(),
    (value) => value.manifests.push(value.manifests[0]),
    (value) => (value.manifests[1].platform.architecture = "amd64"),
    (value) => (value.manifests[1].platform.architecture = "s390x"),
    (value) => delete value.manifests[1].platform,
    (value) => (value.manifests[1].platform.variant = "v7"),
    (value) =>
      value.manifests
        .reverse()
        .forEach((entry, i) => (entry.digest = Object.values(childDigests)[i])),
    (value) => (value.manifests[1].digest = childDigests["linux/amd64"]),
    (value) => (value.mediaType = "application/vnd.oci.image.manifest.v1+json"),
  ]) {
    const value = remoteIndex();
    mutate(value);
    assert.throws(() => validateRemoteIndex(value, childDigests));
  }
  assert.throws(
    () =>
      validateRemoteChild(
        {
          schemaVersion: 2,
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          config: { digest: "sha256:wrong" },
        },
        buildReceipts()[0],
      ),
    /configuration/,
  );
});

async function indexFixture(t) {
  const f = await publisherFixture(t);
  const receipts = buildReceipts();
  const directories = {};
  for (const receipt of receipts) {
    const directory = join(f.directory, receipt.platform.split("/")[1]);
    mkdirSync(directory);
    writeFileSync(join(directory, "image.tar"), "synthetic archive");
    Object.assign(receipt, await archiveDigest(directory));
    directories[receipt.platform] = directory;
  }
  const calls = [];
  const indexDigest = `sha256:${"7".repeat(64)}`;
  const dependencies = {
    packageInfo: async () => pkg(),
    readArchiveManifest: (directory) => {
      const receipt = receipts.find(
        (receipt) => directories[receipt.platform] === directory,
      );
      return [
        {
          ...manifest()[0],
          RepoTags: [receipt.localTag],
          Config: `${receipt.configDigest.slice(7)}.json`,
        },
      ];
    },
    execute: (args) => {
      calls.push(args);
      if (args[0] === "image") {
        const receipt = receipts.find(
          (receipt) => receipt.localTag === args[2],
        );
        return JSON.stringify([
          {
            ...inspected(),
            Id: receipt.imageId,
            Descriptor: {
              mediaType: "application/vnd.oci.image.manifest.v1+json",
              annotations: { "config.digest": receipt.configDigest },
            },
            Architecture: receipt.platform.split("/")[1],
            RepoTags: [receipt.localTag],
          },
        ]);
      }
      if (args[0] === "push")
        return `digest: ${childDigests[receipts.find((receipt) => receipt.publishTag === args[1]).platform]} size: 1024`;
      if (args[0] === "manifest" && args[1] === "inspect")
        return JSON.stringify(remoteIndex());
      if (args[0] === "manifest" && args[1] === "push") return indexDigest;
      return "";
    },
    readManifest: async (digest) => {
      calls.push(["anonymous", digest]);
      if (digest === indexDigest) return remoteIndex();
      const receipt = receipts.find(
        (receipt) => childDigests[receipt.platform] === digest,
      );
      return {
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        config: { digest: receipt.configDigest },
      };
    },
  };
  return {
    ...f,
    calls,
    dependencies,
    receipts,
    directories,
    options: {
      receipts,
      directories,
      expected,
      source: provenance().revision,
      inputsSha256: provenance().inputsSha256,
    },
  };
}

test("publisher verifies both archives and images before pushing children and an anonymously verified immutable index", async (t) => {
  const f = await indexFixture(t);
  const candidate = await publishIndex(f.options, f.dependencies);
  assert.deepEqual(candidate, {
    version: 2,
    platforms: ["linux/amd64", "linux/arm64"],
    image: `${image}@sha256:${"7".repeat(64)}`,
    inputsSha256: provenance().inputsSha256,
    revision: provenance().revision,
    children: childDigests,
  });
  assert.deepEqual(
    f.calls.map((args) => args[0]),
    [
      "load",
      "image",
      "load",
      "image",
      "login",
      "tag",
      "push",
      "anonymous",
      "tag",
      "push",
      "anonymous",
      "manifest",
      "manifest",
      "manifest",
      "anonymous",
      "logout",
    ],
  );
  assert.deepEqual(
    f.calls.find((args) => args[0] === "manifest"),
    [
      "manifest",
      "create",
      expected.publishTag,
      `${image}@${childDigests["linux/amd64"]}`,
      `${image}@${childDigests["linux/arm64"]}`,
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(f.calls),
    /fixture-token|latest|\["run"|\["build"/,
  );
});

test("a corrupt second archive cannot load or publish even the first child", async (t) => {
  const f = await indexFixture(t);
  writeFileSync(join(f.directories["linux/arm64"], "image.tar"), "corrupt");
  await assert.rejects(
    publishIndex(f.options, f.dependencies),
    /checksum or size/,
  );
  assert.deepEqual(f.calls, []);
});

test("a wrong second architecture cannot log in or publish", async (t) => {
  const f = await indexFixture(t);
  const execute = f.dependencies.execute;
  f.dependencies.execute = (args) => {
    const result = execute(args);
    if (args[0] === "image" && args[2].endsWith("arm64")) {
      const value = JSON.parse(result);
      value[0].Architecture = "amd64";
      return JSON.stringify(value);
    }
    return result;
  };
  await assert.rejects(publishIndex(f.options, f.dependencies), /provenance/);
  assert.ok(
    f.calls.every((args) => !["login", "push", "manifest"].includes(args[0])),
  );
});

test("failed anonymous child verification prevents index creation and logs out", async (t) => {
  const f = await indexFixture(t);
  f.dependencies.readManifest = async () => {
    throw new Error("anonymous access denied");
  };
  await assert.rejects(
    publishIndex(f.options, f.dependencies),
    /anonymous access denied/,
  );
  assert.ok(f.calls.every((args) => args[0] !== "manifest"));
  assert.deepEqual(f.calls.at(-1), ["logout", "ghcr.io"]);
});

test("a remote index with switched platform digests cannot produce a candidate", async (t) => {
  const f = await indexFixture(t);
  const readManifest = f.dependencies.readManifest;
  f.dependencies.readManifest = async (digest) => {
    const result = await readManifest(digest);
    if (result.manifests)
      result.manifests[1].digest = childDigests["linux/amd64"];
    return result;
  };
  await assert.rejects(
    publishIndex(f.options, f.dependencies),
    /platform or digest/,
  );
  assert.deepEqual(f.calls.at(-1), ["logout", "ghcr.io"]);
});

test("anonymous manifest reads use only an anonymous pull token and bind exact response bytes", async () => {
  const raw = JSON.stringify(remoteIndex());
  const digest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  const calls = [];
  const request = async (url, options) => {
    calls.push([url, options]);
    return new Response(
      url.includes("/token?")
        ? JSON.stringify({ token: "anonymous-pull" })
        : raw,
    );
  };
  assert.deepEqual(await anonymousManifest(digest, request), remoteIndex());
  assert.equal(calls[0][1].headers, undefined);
  assert.equal(calls[1][1].headers.Authorization, "Bearer anonymous-pull");
  assert.equal(
    calls[1][0],
    `https://ghcr.io/v2/getsituate/situate-ci-linux/manifests/${digest}`,
  );
  assert.ok(calls.every(([, options]) => options.redirect === "error"));
  await assert.rejects(
    anonymousManifest(`sha256:${"0".repeat(64)}`, request),
    /digest differs/,
  );
  await assert.rejects(
    anonymousManifest(digest, async () => new Response("", { status: 401 })),
    /HTTP 401/,
  );
});
