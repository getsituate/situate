import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { canonical, digest } from "./release-catalog.mjs";
import {
  approveSource,
  acceptTranslation,
  behaviorDigest,
  fragmentHashes,
} from "./change-fragments.mjs";
import {
  assembleReleaseInputs,
  verifyReleaseInputs,
  writeReleaseInputs,
  validateGeneratedCatalog,
} from "./release-inputs.mjs";

function repository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "situate-inputs-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "source");
  fs.mkdirSync(root);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Test Author");
  git("config", "user.email", "test@example.invalid");
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), value);
  };
  write(
    "client/packages/localization/locales.json",
    JSON.stringify({ source: "en", locales: ["en", "de"] }),
  );
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "test: fixture");
    return git("rev-parse", "HEAD");
  };
  const base = commit();
  const add = (id, { empty = false } = {}) => {
    const entry = {
      id,
      type: "fixed",
      platforms: ["macos"],
      title: `Title ${id}`,
      paragraphs: ["Recent files open in the selected pane."],
    };
    let fragment = {
      schemaVersion: 1,
      id,
      behaviorDigest: behaviorDigest(root, git("rev-parse", "HEAD")),
      locales: {
        en: { title: "Changes", entries: empty ? [] : [entry] },
        de: {
          title: "Änderungen",
          entries: empty ? [] : [{ ...entry, title: `Titel ${id}` }],
        },
      },
      ...(empty ? { emptyReason: "PRIVATE INTERNAL REASON" } : {}),
      translationApprovals: {},
    };
    const options = { locales: ["en", "de"] };
    fragment = approveSource(
      fragment,
      fragmentHashes(fragment).sourceHash,
      options,
    );
    fragment = acceptTranslation(
      fragment,
      "de",
      fragment.locales.de,
      fragmentHashes(fragment).translations.de,
      options,
    );
    write(`changes/${id}.json`, JSON.stringify(fragment));
    return commit();
  };
  return { root, directory, git, write, commit, base, add };
}
const candidate = (source, baseline, version = "2026.11.1") => ({
  source,
  baseline,
  version,
  build: "2026.11.1",
  tag: `v${version}`,
});

test("assembly aggregates committed fragments without dates or private reasons and seals exact files outside source", (t) => {
  const repo = repository(t);
  repo.add("first");
  const source = repo.add("internal", { empty: true });
  const inputs = assembleReleaseInputs(repo.root, candidate(source, repo.base));
  assert.deepEqual(
    inputs.manifest.fragments.map((fragment) => fragment.id),
    ["first", "internal"],
  );
  assert.equal(
    inputs.catalog.releases[0].locales.en.entries[0].title,
    "Title first",
  );
  assert.equal(
    inputs.catalog.releases[0].locales.de.entries[0].title,
    "Titel first",
  );
  assert.equal(Object.hasOwn(inputs.catalog.releases[0], "date"), false);
  assert.equal(
    JSON.stringify(inputs).includes("PRIVATE INTERNAL REASON"),
    false,
  );
  const before = repo.git("status", "--porcelain");
  const output = writeReleaseInputs(
    path.join(repo.directory, "generated"),
    inputs,
    { repoRoot: repo.root },
  );
  assert.equal(path.basename(output.manifestFile), "release-inputs.json");
  assert.equal(
    path.basename(output.catalogFile),
    "situate-release-history.json",
  );
  assert.equal(
    digest(fs.readFileSync(output.catalogFile)),
    inputs.manifest.history.sha256,
  );
  assert.equal(
    fs.readFileSync(output.manifestFile, "utf8"),
    `${canonical(inputs.manifest)}\n`,
  );
  assert.deepEqual(
    verifyReleaseInputs(inputs.manifest, inputs.catalogBytes),
    inputs.catalog,
  );
  assert.deepEqual(
    writeReleaseInputs(path.dirname(output.catalogFile), inputs, {
      repoRoot: repo.root,
    }),
    output,
  );
  assert.throws(
    () =>
      writeReleaseInputs(path.join(repo.root, "build"), inputs, {
        repoRoot: repo.root,
      }),
    /outside tracked source/,
  );
  fs.rmSync(path.join(repo.root, "build"), { recursive: true });
  assert.equal(repo.git("status", "--porcelain"), before);
  const changed = structuredClone(inputs);
  changed.manifest.build = "2026.11.2";
  assert.throws(
    () =>
      writeReleaseInputs(path.dirname(output.catalogFile), changed, {
        repoRoot: repo.root,
      }),
    /differ/,
  );
});

test("completed history assigns fragments once, retains skipped releases and sealed historical records byte-identically", (t) => {
  const repo = repository(t);
  const first = repo.add("first");
  const a = assembleReleaseInputs(repo.root, candidate(first, repo.base));
  const second = repo.add("second", { empty: true });
  const previous = {
    source: first,
    catalogBytes: a.catalogBytes,
    catalogSha256: a.manifest.history.sha256,
  };
  const options = { ...candidate(second, first, "2026.11.3"), previous };
  const b = assembleReleaseInputs(repo.root, options);
  assert.deepEqual(
    b.catalog.releases.map((release) => release.version),
    ["2026.11.3", "2026.11.1"],
  );
  assert.equal(b.catalog.releases[0].locales.en.entries.length, 0);
  assert.equal(
    canonical(b.catalog.releases[1]),
    canonical(a.catalog.releases[0]),
  );
  assert.deepEqual(
    b.manifest.fragments.map((fragment) => fragment.id),
    ["second"],
  );
  assert.equal(b.manifest.previous.catalogSha256, digest(a.catalogBytes));
  assert.deepEqual(assembleReleaseInputs(repo.root, options), b);
  assert.throws(
    () =>
      assembleReleaseInputs(repo.root, {
        ...options,
        previous: { ...previous, catalogBytes: `${previous.catalogBytes} ` },
      }),
    /missing or changed/,
  );
  assert.throws(
    () =>
      assembleReleaseInputs(repo.root, {
        ...options,
        version: "2026.10.1",
        tag: "v2026.10.1",
      }),
    /newer/,
  );
  assert.throws(
    () =>
      assembleReleaseInputs(repo.root, {
        ...options,
        previous: { ...previous, source: repo.base },
      }),
    /missing or changed/,
  );
});

test("uncompleted candidates do not consume declarations and empty candidates remain valid", (t) => {
  const repo = repository(t);
  const source = repo.add("empty", { empty: true });
  const first = assembleReleaseInputs(repo.root, candidate(source, repo.base));
  const retry = assembleReleaseInputs(
    repo.root,
    candidate(source, repo.base, "2026.11.2"),
  );
  assert.deepEqual(first.manifest.fragments, retry.manifest.fragments);
  assert.equal(retry.catalog.releases.length, 1);
  assert.equal(retry.catalog.releases[0].locales.de.entries.length, 0);
});

test("seal validation rejects altered bytes, malformed identity, extra private fields and future history", (t) => {
  const repo = repository(t);
  const source = repo.add("first");
  const inputs = assembleReleaseInputs(repo.root, candidate(source, repo.base));
  assert.throws(
    () => verifyReleaseInputs(inputs.manifest, `${inputs.catalogBytes} `),
    /bytes differ/,
  );
  for (const mutate of [
    (copy) => {
      copy.source = "HEAD";
    },
    ...[
      "not-a-build",
      "10000.0.0",
      "1.100.0",
      "1.0.100",
      "0.0.1",
      "01.0.1",
      "1.2",
    ].map((build) => (copy) => {
      copy.build = build;
    }),
    (copy) => {
      copy.tag = "v2026.11.2";
    },
    (copy) => {
      copy.emptyReason = "private";
    },
    (copy) => {
      copy.fragments[0].sha256 = "0".repeat(64);
    },
    (copy) => {
      copy.history.contentSha256 = "0".repeat(64);
    },
  ]) {
    const manifest = structuredClone(inputs.manifest);
    mutate(manifest);
    assert.throws(() => verifyReleaseInputs(manifest, inputs.catalogBytes));
  }
  const future = structuredClone(inputs.catalog);
  future.releases.push({ ...future.releases[0], version: "2027.1.1" });
  assert.throws(() => validateGeneratedCatalog(future), /not newer/);
  const missing = structuredClone(inputs.catalog);
  delete missing.releases[0].locales.de;
  assert.throws(
    () => validateGeneratedCatalog(missing, { locales: ["en", "de"] }),
    /fields/,
  );
});

test("legacy committed catalog text, platform metadata and dates are retained without rewriting", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const inputs = assembleReleaseInputs(root, candidate(source, source));
  const record = inputs.catalog.releases.find(
    (release) => release.version === "0.1.6",
  );
  assert.ok(record);
  for (const locale of ["en", "de"]) {
    const bytes = fs.readFileSync(
      path.join(
        root,
        `client/packages/localization/src/catalogs/releases/0.1.6/${locale}.json`,
      ),
      "utf8",
    );
    assert.equal(
      canonical(record.locales[locale]),
      canonical(JSON.parse(bytes)),
    );
  }
});
