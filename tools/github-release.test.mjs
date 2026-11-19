import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { qualificationFixture } from "./release-qualification-fixture.mjs";
import {
  createEvidenceFromDirectory,
  createGitHubRelease,
  downloadGitHubRelease,
  inspectGitHubRelease,
  inspectGitHubOperation,
  readCompletedReleaseBaseline,
  readGitHubMigrationHistory,
  releaseHash,
  resolveWorkflowRunRelease,
} from "./github-release.mjs";
import {
  githubAdapter,
  readOnlyGitHubAdapter,
} from "../infrastructure/releases/github.mjs";

const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function fixture(t) {
  const {
    directory,
    manifest,
    artifact,
    receipt: qualification,
  } = qualificationFixture(t);
  writeFileSync(
    join(directory, "release-qualification.json"),
    json(qualification),
  );
  const identity = {
    repository: "getsituate/situate",
    tag: `v${manifest.version}`,
    sourceRevision: manifest.revision,
    version: manifest.version,
    operationId: "synthetic-release",
    inputSha256: manifest.releaseInputs.sha256,
  };
  const notes = "Reviewed English and German notes.";
  const producer = { runId: 301, runAttempt: 2, workflowId: 19 };
  const built = createEvidenceFromDirectory({
    identity,
    directory,
    producer,
  });
  const releases = [];
  const blobs = new Map();
  const effects = [];
  let nextAsset = 10;
  const tag = {
    tag: identity.tag,
    tagObject: "d".repeat(40),
    sourceRevision: identity.sourceRevision,
    message: JSON.stringify({
      schemaVersion: 1,
      kind: "situate-release-reservation",
      operationId: identity.operationId,
      sourceRevision: identity.sourceRevision,
      version: identity.version,
      generatedInputDigest: identity.inputSha256,
    }),
  };
  const github = {
    async getTag() {
      return structuredClone(tag);
    },
    async listReleases() {
      return structuredClone(releases);
    },
    async getRelease(repo, releaseId) {
      assert.equal(repo, identity.repository);
      return structuredClone(releases.find((item) => item.id === releaseId));
    },
    async downloadAsset(repo, releaseId, assetId) {
      assert.equal(repo, identity.repository);
      assert(
        releases
          .find((item) => item.id === releaseId)
          .assets.some((asset) => asset.id === assetId),
      );
      return blobs.get(assetId);
    },
    async createDraft(repo, body) {
      effects.push("create");
      const release = {
        ...body,
        id: 7,
        url: `https://api.github.com/repos/${repo}/releases/7`,
        html_url: `https://github.com/${repo}/releases/tag/untagged-${"e".repeat(20)}`,
        assets: [],
      };
      releases.push(release);
      return structuredClone(release);
    },
    async uploadAsset(repo, releaseId, name, bytes) {
      effects.push(`upload:${name}`);
      const asset = {
        id: nextAsset++,
        name,
        size: bytes.length,
        state: "uploaded",
      };
      blobs.set(asset.id, bytes);
      releases[0].assets.push(asset);
      return structuredClone(asset);
    },
    async finalize() {
      effects.push("finalize");
      releases[0].draft = false;
      releases[0].html_url = `https://github.com/${identity.repository}/releases/tag/${identity.tag}`;
      releases[0].published_at = "2026-11-13T00:00:00Z";
      return structuredClone(releases[0]);
    },
    async getRun() {
      return {
        id: producer.runId,
        run_attempt: producer.runAttempt,
        workflow_id: producer.workflowId,
        repository: { full_name: identity.repository },
        head_repository: { full_name: identity.repository },
        head_branch: "main",
        head_sha: identity.sourceRevision,
        event: "push",
        status: "completed",
        conclusion: "success",
      };
    },
    async getWorkflow() {
      return {
        id: producer.workflowId,
        state: "active",
        path: ".github/workflows/release-macos.yml",
      };
    },
  };
  const request = {
    identity,
    ...built,
    notes,
    journalPath: join(directory, "private", "operation.json"),
  };
  const authorize = async (value) => assert.deepEqual(value.identity, identity);
  const create = (options = {}) =>
    createGitHubRelease(request, { github, authorize, ...options });
  return {
    directory,
    identity,
    artifact,
    manifest,
    qualification,
    notes,
    producer,
    request,
    built,
    github,
    releases,
    blobs,
    effects,
    tag,
    create,
  };
}

test("published notes can be edited without changing the retained evidence or release history", async (t) => {
  const f = fixture(t);
  const { identity } = await f.create();
  const release = f.releases[0];
  const asset = release.assets.find(
    ({ name }) => name === "github-release.json",
  );
  const oldEvidence = json({
    ...JSON.parse(f.blobs.get(asset.id)),
    notesSha256: releaseHash(Buffer.from(f.notes)),
  });
  const evidenceSha256 = releaseHash(oldEvidence);
  f.blobs.set(asset.id, oldEvidence);
  asset.size = oldEvidence.length;
  const comment = /<!-- situate-release:([A-Za-z0-9+/=]+) -->/;
  const marker = JSON.parse(
    Buffer.from(comment.exec(release.body)[1], "base64"),
  );
  marker.evidenceSha256 = evidenceSha256;
  release.body = `## Fixes\n\nCorrected notes.\n\n<!-- situate-release:${Buffer.from(JSON.stringify(marker)).toString("base64")} -->`;

  const inputs = { identity, evidenceSha256 };
  const github = f.github;
  const verified = await inspectGitHubRelease(inputs, { github });
  assert.deepEqual(verified.evidenceBytes, oldEvidence);
  assert.equal(
    (await inspectGitHubOperation(inputs, { github })).state,
    "complete",
  );
  const baseline = await readCompletedReleaseBaseline(f.directory, {
    github,
    execute: () => identity.sourceRevision,
  });
  assert.equal(baseline.identity.releaseId, identity.releaseId);

  release.body = "Corrected notes without an identity marker.";
  await assert.rejects(
    inspectGitHubRelease(inputs, { github }),
    /release identity marker/,
  );
});

test("explicit draft recovery never creates another release and rejects mismatched or nonempty drafts", async (t) => {
  const f = fixture(t);
  const original = f.github.createDraft;
  f.github.createDraft = async (...args) => {
    await original(...args);
    throw new Error("lost draft response");
  };
  await assert.rejects(f.create(), /lost draft response/);
  const request = (expectedDraftId) =>
    f.create({ reconcile: true, expectedDraftId });
  await assert.rejects(request(8), /exact empty draft/);
  f.releases[0].assets.push({ name: "unverified" });
  await assert.rejects(request(7), /exact empty draft/);
  f.releases[0].assets.pop();
  f.releases[0].url = "https://api.github.com/repos/foreign/project/releases/7";
  await assert.rejects(request(7), /Release repository differs/);
  f.releases[0].url = `https://api.github.com/repos/${f.identity.repository}/releases/7`;
  assert.deepEqual(f.effects, ["create"]);
  assert.equal((await request(7)).identity.releaseId, 7);
  assert.equal(f.effects.filter((effect) => effect === "create").length, 1);
  assert.equal(f.effects.at(-1), "finalize");
});

test("an absent first upload can resume only against the recorded empty draft", async (t) => {
  const f = fixture(t);
  const upload = f.github.uploadAsset;
  f.github.uploadAsset = async () => {
    throw new Error("upload rejected");
  };
  await assert.rejects(f.create(), /upload rejected/);
  assert.equal(f.releases[0].assets.length, 0);
  f.github.uploadAsset = upload;
  await assert.rejects(
    f.create({ reconcile: true, expectedDraftId: 8 }),
    /exact empty draft/,
  );
  assert.equal(
    (await f.create({ reconcile: true, expectedDraftId: 7 })).identity
      .releaseId,
    7,
  );
  assert.deepEqual(f.effects.slice(0, 2), ["create", "upload:manifest.json"]);
});

test("creation seals exact reserved inputs and publisher downloads only public bytes", async (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.directory, "private-notary-journal.json"),
    "private synthetic state",
  );
  const result = await f.create();
  assert.equal(Object.hasOwn(result.evidence, "notesSha256"), false);
  assert.equal(result.identity.releaseId, 7);
  assert.equal(f.effects[0], "create");
  assert.equal(f.effects.at(-1), "finalize");
  assert.equal(f.releases[0].assets.length, 8);
  assert(!f.releases[0].assets.some((asset) => asset.name.includes("journal")));
  const destination = join(f.directory, "download");
  const download = await downloadGitHubRelease(
    {
      identity: result.identity,
      evidenceSha256: result.evidenceSha256,
      destination,
    },
    { github: f.github },
  );
  assert.equal(download.receipt.kind, "github-release-download");
  assert.equal(download.receipt.assets.length, 8);
  assert.deepEqual(
    JSON.parse(readFileSync(join(destination, "github-release-receipt.json"))),
    download.receipt,
  );
  for (const asset of download.receipt.assets)
    assert.equal(
      releaseHash(readFileSync(join(destination, asset.name))),
      asset.sha256,
    );
  assert.equal(
    JSON.parse(readFileSync(f.request.journalPath)).state,
    "complete",
  );
  const effects = [...f.effects];
  await f.create();
  assert.deepEqual(
    f.effects,
    effects,
    "Duplicate dispatch must inspect, not upload/finalize again",
  );
});

test("no effect without exact authorization, source, input and complete qualification", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.create({ authorize: undefined }), /authorization/);
  f.tag.sourceRevision = "e".repeat(40);
  await assert.rejects(f.create(), /source differs/);
  f.tag.sourceRevision = f.identity.sourceRevision;
  f.tag.message = JSON.stringify({
    ...JSON.parse(f.tag.message),
    generatedInputDigest: "e".repeat(64),
  });
  await assert.rejects(f.create(), /Reserved inputs differ/);
  const qualificationPath = join(f.directory, "release-qualification.json");
  writeFileSync(
    qualificationPath,
    json({
      ...f.qualification,
      checks: { ...f.qualification.checks, installation: false },
    }),
  );
  assert.throws(
    () =>
      createEvidenceFromDirectory({
        identity: f.identity,
        directory: f.directory,
      }),
    /installation/,
  );
  assert.deepEqual(f.effects, []);
});

for (const stage of ["createDraft", "uploadAsset", "finalize"])
  test(`uncertain ${stage} is inspected before explicit reconciliation`, async (t) => {
    const f = fixture(t);
    const original = f.github[stage];
    let once = true;
    f.github[stage] = async (...args) => {
      const result = await original(...args);
      if (once) {
        once = false;
        throw new Error("Lost response");
      }
      return result;
    };
    await assert.rejects(f.create(), /Lost response/);
    const effects = [...f.effects];
    await assert.rejects(f.create(), /Inspect existing/);
    assert.deepEqual(f.effects, effects);
    await f.create({ reconcile: true });
    assert.equal(f.effects.filter((effect) => effect === "create").length, 1);
    assert.equal(f.effects.filter((effect) => effect === "finalize").length, 1);
    assert.equal(f.releases[0].assets.length, 8);
  });

for (const mutation of [
  "repository",
  "releaseId",
  "tag",
  "draft",
  "asset",
  "extraAsset",
  "evidence",
])
  test(`publisher rejects changed ${mutation}`, async (t) => {
    const f = fixture(t);
    const result = await f.create();
    const identity = { ...result.identity };
    if (mutation === "repository") identity.repository = "someone/else";
    if (mutation === "releaseId") identity.releaseId = 9;
    if (mutation === "tag") f.tag.sourceRevision = "f".repeat(40);
    if (mutation === "draft") f.releases[0].draft = true;
    if (mutation === "asset")
      f.blobs.set(f.releases[0].assets[0].id, Buffer.from("modified"));
    if (mutation === "extraAsset")
      f.releases[0].assets.push({
        id: 999,
        name: "journal.json",
        size: 1,
        state: "uploaded",
      });
    if (mutation === "evidence")
      f.blobs.set(
        f.releases[0].assets.find(
          (asset) => asset.name === "github-release.json",
        ).id,
        Buffer.from("{}"),
      );
    await assert.rejects(
      inspectGitHubRelease(
        { identity, evidenceSha256: result.evidenceSha256 },
        { github: f.github },
      ),
    );
  });

test("recovery inspection reports authoritative absence and partial draft inventory without relaxing publication", async (t) => {
  const f = fixture(t);
  const request = { identity: f.identity, evidence: f.built.evidence };
  const absent = await inspectGitHubOperation(request, { github: f.github });
  assert.equal(absent.state, "absent");
  assert.equal(absent.missing.length, 8);
  const original = f.github.uploadAsset;
  f.github.uploadAsset = async (...args) => {
    await original(...args);
    throw new Error("Lost upload response");
  };
  await assert.rejects(f.create(), /Lost upload response/);
  const partial = await inspectGitHubOperation(request, { github: f.github });
  assert.equal(partial.state, "draft");
  assert.equal(partial.present.length, 1);
  assert.equal(partial.missing.length, 7);
  assert.equal(partial.releaseId, 7);
  assert.equal(partial.files, undefined);
  await assert.rejects(
    inspectGitHubRelease(
      { identity: partial.identity, evidence: f.built.evidence },
      { github: f.github },
    ),
    /not complete/,
  );
  f.blobs.set(partial.present[0].id, Buffer.from("tampered"));
  await assert.rejects(
    inspectGitHubOperation(request, { github: f.github }),
    /differs/,
  );
  f.github.listReleases = async () => {
    throw new Error("Offline listing");
  };
  await assert.rejects(
    inspectGitHubOperation(request, { github: f.github }),
    /Offline listing/,
  );
});

test("reconciliation never overwrites differing draft bytes", async (t) => {
  const f = fixture(t);
  f.github.finalize = async () => {
    throw new Error("Interrupted");
  };
  await assert.rejects(f.create(), /Interrupted/);
  const release = f.releases[0];
  const body = release.body;
  const effects = [...f.effects];
  release.body = `Edited before publishing\n\n${body}`;
  await assert.rejects(
    f.create({ reconcile: true }),
    /Draft notes or identity changed/,
  );
  assert.deepEqual(f.effects, effects);
  release.body = body;
  f.blobs.set(release.assets[0].id, Buffer.from("different"));
  await assert.rejects(f.create({ reconcile: true }), /differs/);
  assert.deepEqual(f.effects, effects);
});

test("workflow_run resolver uses trusted producer identity, not latest or release events", async (t) => {
  const f = fixture(t);
  const result = await f.create();
  const request = {
    repository: f.identity.repository,
    runId: 301,
    workflowId: 19,
    workflowPath: ".github/workflows/release-macos.yml",
  };
  assert.deepEqual(
    await resolveWorkflowRunRelease(request, { github: f.github }),
    { identity: result.identity, evidenceSha256: result.evidenceSha256 },
  );
  const original = f.github.getRun;
  for (const patch of [
    { head_repository: { full_name: "fork/situate" } },
    { workflow_id: 99 },
    { head_sha: "b".repeat(40) },
    { head_branch: "feature" },
    { conclusion: "failure" },
    { event: "pull_request" },
    { run_attempt: 1 },
  ]) {
    f.github.getRun = async () => ({ ...(await original()), ...patch });
    await assert.rejects(
      resolveWorkflowRunRelease(request, { github: f.github }),
    );
  }
});

test("baseline Git reads use the supplied environment without signing or authentication secrets", async (t) => {
  const f = fixture(t);
  let calls = 0;
  const environment = {
    PATH: "/scoped/bin",
    HOME: "/scoped/home",
    GH_TOKEN: "synthetic-token",
    APPLE_API_PRIVATE_KEY: "synthetic-apple",
    TAURI_SIGNING_PRIVATE_KEY: "synthetic-updater",
    SITUATE_RELEASE_SSH_PRIVATE_KEY: "synthetic-ssh",
  };
  assert.equal(
    await readCompletedReleaseBaseline(f.directory, {
      environment,
      github: f.github,
      execute: (_command, _args, options) => {
        calls++;
        assert(options.env.PATH === environment.PATH);
        assert(options.env.HOME === environment.HOME);
        for (const name of [
          "GH_TOKEN",
          "APPLE_API_PRIVATE_KEY",
          "TAURI_SIGNING_PRIVATE_KEY",
          "SITUATE_RELEASE_SSH_PRIVATE_KEY",
        ])
          assert.equal(Object.hasOwn(options.env, name), false);
        return f.identity.sourceRevision;
      },
    }),
    null,
  );
  assert.equal(calls, 1);
});

test("completed baseline and compatibility history fail closed on unavailable or non-ancestral releases", async (t) => {
  const f = fixture(t);
  const execute = () => f.identity.sourceRevision;
  assert.equal(
    await readCompletedReleaseBaseline(f.directory, {
      github: f.github,
      execute,
    }),
    null,
  );
  await f.create();
  const baseline = await readCompletedReleaseBaseline(f.directory, {
    github: f.github,
    execute,
  });
  assert.equal(baseline.source, f.identity.sourceRevision);
  assert.equal(baseline.catalogSha256, releaseHash(baseline.catalogBytes));
  assert.equal(
    (await readGitHubMigrationHistory(f.directory, { github: f.github }))
      .releases.length,
    1,
  );
  await assert.rejects(
    readCompletedReleaseBaseline(f.directory, {
      github: f.github,
      execute: (...args) => {
        if (args[1][0] === "merge-base") throw new Error("Not ancestral");
        return f.identity.sourceRevision;
      },
    }),
    /Not ancestral/,
  );
  f.github.listReleases = async () => {
    throw new Error("Offline");
  };
  await assert.rejects(
    readCompletedReleaseBaseline(f.directory, { github: f.github, execute }),
    /Offline/,
  );
  await assert.rejects(
    readGitHubMigrationHistory(f.directory, { github: f.github }),
    /Offline/,
  );
});

test("planning and migration history fetch sealed metadata but never historical packages", async (t) => {
  const f = fixture(t);
  const result = await f.create();
  const download = f.github.downloadAsset;
  f.github.downloadAsset = async (repo, releaseId, assetId) => {
    const name = f.releases[0].assets.find(
      (asset) => asset.id === assetId,
    ).name;
    assert(
      !name.endsWith(".dmg") &&
        !name.endsWith(".app.tar.gz") &&
        !name.endsWith(".sig"),
      "Planner must not download packages",
    );
    return download(repo, releaseId, assetId);
  };
  const baseline = await readCompletedReleaseBaseline(f.directory, {
    github: f.github,
    execute: () => f.identity.sourceRevision,
  });
  assert.equal(baseline.source, f.identity.sourceRevision);
  const history = await readGitHubMigrationHistory(f.directory, {
    github: f.github,
    includeBuilds: true,
  });
  assert.deepEqual(history.builds, [f.manifest.buildNumber]);
  assert.equal(
    history.releases[0].manifestSha256,
    releaseHash(f.built.files["manifest.json"]),
  );
  await assert.rejects(
    inspectGitHubRelease(
      { identity: result.identity, evidenceSha256: result.evidenceSha256 },
      { github: f.github, metadataOnly: true },
    ),
    /Planner must not download packages/,
    "Publisher cannot opt out of package verification",
  );
});

test("gh boundary uses exact repository API and isolates credentials; publisher exposes no writes", async () => {
  const calls = [];
  const adapter = githubAdapter({
    environment: {
      PATH: "/synthetic",
      GH_TOKEN: "synthetic-token",
      SIGNING_KEY: "must-not-propagate",
      GH_HOST: "attacker.invalid",
    },
    execute: (command, args, options) => {
      calls.push({ command, args, options });
      return "[]";
    },
  });
  await adapter.listReleases("getsituate/situate");
  assert.equal(calls[0].command, "gh");
  assert.equal(
    calls[0].args[calls[0].args.indexOf("--hostname") + 1],
    "github.com",
  );
  assert(calls[0].args.includes("--paginate"));
  assert.equal(calls[0].options.env.SIGNING_KEY, undefined);
  assert.equal(calls[0].options.env.GH_HOST, undefined);
  await assert.rejects(adapter.listReleases("other/repo"));
  await adapter.uploadAsset(
    "getsituate/situate",
    42,
    "app bundle.tar.gz",
    Buffer.from("synthetic"),
  );
  const upload = calls.at(-1);
  assert.equal(
    upload.args[upload.args.indexOf("--hostname") + 1],
    "github.com",
  );
  assert(
    upload.args.includes(
      "https://uploads.github.com/repos/getsituate/situate/releases/42/assets?name=app%20bundle.tar.gz",
    ),
  );
  assert.equal(upload.options.input.toString(), "synthetic");
  assert(upload.args.includes("Content-Length: 9"));
  const count = calls.length;
  await assert.rejects(
    adapter.finalize("getsituate/situate", "../other"),
    /GitHub ID/,
  );
  await assert.rejects(
    adapter.uploadAsset(
      "getsituate/situate",
      0,
      "manifest.json",
      Buffer.from("{}"),
    ),
    /GitHub ID/,
  );
  await assert.rejects(
    adapter.getRelease("getsituate/situate", -1),
    /GitHub ID/,
  );
  assert.equal(calls.length, count, "Invalid IDs must not reach gh");
  assert.deepEqual(Object.keys(readOnlyGitHubAdapter()).sort(), [
    "downloadAsset",
    "getRelease",
    "getRun",
    "getTag",
    "getWorkflow",
    "listReleases",
  ]);
});
