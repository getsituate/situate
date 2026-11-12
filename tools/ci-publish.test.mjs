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
import {
  archiveDigest,
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

test("workflow separates read-only candidate building from privileged data-only publication", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci-image.yml", import.meta.url),
    "utf8",
  );
  const [build, publish] = workflow.split("  publish:\n");
  assert.doesNotMatch(workflow, /pull_request|:latest|contents: write/);
  assert.equal(
    (workflow.match(/github.repository == 'getsituate\/situate'/g) ?? [])
      .length,
    2,
  );
  assert.match(
    publish,
    /github.event_name == 'workflow_dispatch' && inputs.bootstrap/,
  );
  assert.match(publish, /PUBLISH_COMMAND/);
  assert.match(build, /docker save .*\| gzip -1 > .*image\.tar/u);
  const live = readFileSync(
    new URL("../.github/workflows/agent-live.yml", import.meta.url),
    "utf8",
  );
  assert.match(live, /github.repository == 'getsituate\/situate'/);
  assert.doesNotMatch(live, /pull_request_target/);
  assert.doesNotMatch(build, /packages: write|GH_TOKEN:|node source\//);
  assert.match(build, /--target ci --platform linux\/amd64/);
  assert.match(
    build,
    /--network none --cap-drop ALL --security-opt no-new-privileges/,
  );
  assert.match(build, /--user 1000:1000/);
  assert.match(build, /harness\/client\/docker\/ci-verify.mjs/);
  assert.match(
    build,
    /harness\/tools\/ci-image.mjs --inputs --directory source/,
  );
  assert.match(publish, /packages: write/);
  assert.doesNotMatch(publish, /docker run|docker build|path: source/);
  assert.equal(
    (workflow.match(/ref: \$\{\{ github.workflow_sha \}\}/g) ?? []).length,
    2,
  );
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 3);
  assert.match(
    workflow,
    /actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9/,
  );
  assert.match(
    workflow,
    /actions\/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333/,
  );
});
