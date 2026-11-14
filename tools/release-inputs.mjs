import fs from "node:fs";
import path from "node:path";
import {
  assert,
  canonical,
  digest,
  catalogDigest,
  compareVersions,
  productVersion,
  compileReleaseCatalog,
  git,
  revision,
  validateLocale,
  validDate,
} from "./release-catalog.mjs";
import { collectFragments, localesAt } from "./change-fragments.mjs";

export const releaseInputsFile = "release-inputs.json";
export const releaseCatalogFile = "situate-release-history.json";
const sha = /^[a-f0-9]{64}$/u;
function exactFields(value, keys) {
  assert(
    value &&
      canonical(Object.keys(value).sort()) === canonical([...keys].sort()),
    "Invalid sealed input fields",
  );
}
export function validateGeneratedCatalog(catalog, { version, locales } = {}) {
  exactFields(catalog, ["schemaVersion", "installedVersion", "releases"]);
  productVersion(catalog.installedVersion);
  assert(
    catalog.schemaVersion === 1 &&
      (!version || catalog.installedVersion === version) &&
      Array.isArray(catalog.releases),
    "Invalid generated release catalog",
  );
  assert(
    catalog.releases.length > 0 &&
      catalog.releases[0].version === catalog.installedVersion,
    "Catalog must include its installed version first",
  );
  const inventory = locales ?? Object.keys(catalog.releases[0].locales).sort();
  assert(inventory.includes("en"), "Catalog requires English source content");
  let prior;
  for (const release of catalog.releases) {
    exactFields(release, [
      "version",
      "locales",
      ...(Object.hasOwn(release, "date") ? ["date"] : []),
    ]);
    productVersion(release.version);
    assert(
      compareVersions(release.version, catalog.installedVersion) <= 0 &&
        (!prior || compareVersions(prior, release.version) > 0),
      "Catalog versions must be unique, descending and not newer than installed",
    );
    if (Object.hasOwn(release, "date")) validDate(release.date);
    exactFields(release.locales, inventory);
    for (const locale of inventory)
      validateLocale(
        release.locales[locale],
        locale === "en" ? undefined : release.locales.en,
      );
    prior = release.version;
  }
  return catalog;
}
export function verifyReleaseInputs(manifest, catalogBytes) {
  exactFields(manifest, [
    "schemaVersion",
    "kind",
    "source",
    "baseline",
    "version",
    "build",
    "tag",
    "fragments",
    "fragmentDigest",
    "history",
    "previous",
  ]);
  assert(
    manifest.schemaVersion === 1 &&
      manifest.kind === "situate-release-inputs" &&
      /^[a-f0-9]{40}$/u.test(manifest.source) &&
      /^[a-f0-9]{40}$/u.test(manifest.baseline),
    "Invalid release input source identity",
  );
  productVersion(manifest.version);
  const [year, month, sequence] = manifest.version.split(".").map(Number);
  assert(
    year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && sequence > 0,
    "Invalid candidate CalVer version",
  );
  assert(
    typeof manifest.build === "string" &&
      /^[1-9]\d{0,3}\.(?:0|[1-9]\d?)\.(?:0|[1-9]\d?)$/u.test(manifest.build) &&
      manifest.tag === `v${manifest.version}`,
    "Invalid release input build or tag identity",
  );
  assert(
    Array.isArray(manifest.fragments),
    "Missing release fragment inventory",
  );
  let prior;
  for (const fragment of manifest.fragments) {
    exactFields(fragment, ["id", "path", "sha256"]);
    assert(
      typeof fragment.id === "string" &&
        /^[a-z][a-z0-9-]{0,79}$/u.test(fragment.id) &&
        fragment.path === `changes/${fragment.id}.json` &&
        sha.test(fragment.sha256) &&
        (!prior || prior.localeCompare(fragment.id, "en") < 0),
      "Invalid release fragment inventory",
    );
    prior = fragment.id;
  }
  assert(
    manifest.fragmentDigest === digest(canonical(manifest.fragments)),
    "Fragment inventory digest differs",
  );
  exactFields(manifest.history, ["file", "sha256", "contentSha256"]);
  assert(
    typeof catalogBytes === "string" &&
      Buffer.byteLength(catalogBytes) <= 8 * 1024 * 1024 &&
      manifest.history.file === releaseCatalogFile &&
      sha.test(manifest.history.sha256) &&
      digest(catalogBytes) === manifest.history.sha256,
    "Sealed catalog bytes differ",
  );
  const catalog = validateGeneratedCatalog(JSON.parse(catalogBytes), {
    version: manifest.version,
  });
  assert(
    catalogBytes === `${canonical(catalog)}\n` &&
      manifest.history.contentSha256 === catalogDigest(catalog),
    "Sealed catalog content digest differs",
  );
  if (manifest.previous !== null) {
    exactFields(manifest.previous, ["source", "catalogSha256"]);
    assert(
      manifest.previous.source === manifest.baseline &&
        sha.test(manifest.previous.catalogSha256),
      "Invalid completed-history binding",
    );
  }
  return catalog;
}
export function assembleReleaseInputs(
  root,
  { source, baseline, version, build, tag, previous } = {},
) {
  revision(root, source);
  revision(root, baseline);
  productVersion(version);
  const selected = collectFragments(root, { base: baseline, head: source });
  const locales = localesAt(root, source);
  let history;
  if (previous) {
    assert(
      previous.source === baseline &&
        sha.test(previous.catalogSha256) &&
        digest(previous.catalogBytes) === previous.catalogSha256,
      "Previous completed history is missing or changed",
    );
    revision(root, previous.source);
    history = validateGeneratedCatalog(JSON.parse(previous.catalogBytes), {
      locales,
    });
    assert(
      previous.catalogBytes === `${canonical(history)}\n`,
      "Previous catalog must retain canonical sealed bytes",
    );
    assert(
      compareVersions(history.installedVersion, version) < 0,
      "Candidate must be newer than completed history",
    );
  } else {
    assert(
      git(root, ["rev-parse", "HEAD"]).trim() === source,
      "Legacy catalog assembly requires the selected source checkout",
    );
    history = compileReleaseCatalog(root, { version, verifyGit: true });
    assert(
      history.releases.every(
        (release) => compareVersions(release.version, version) < 0,
      ),
      "Candidate already has finalized historical content",
    );
    // Legacy metadata remains the authority for its original text and dates.
    for (const release of history.releases)
      git(root, [
        "merge-base",
        "--is-ancestor",
        JSON.parse(
          git(root, [
            "show",
            `${source}:releases/${release.version}/release.json`,
          ]),
        ).revision,
        source,
      ]);
  }
  const entries = Object.fromEntries(
    locales.map((locale) => [
      locale,
      selected.flatMap(({ fragment }) => fragment.locales[locale].entries),
    ]),
  );
  const ids = entries.en.map((entry) => entry.id);
  assert(
    new Set(ids).size === ids.length,
    "Release entries have colliding IDs across fragments",
  );
  const catalog = {
    schemaVersion: 1,
    installedVersion: version,
    releases: [
      {
        version,
        locales: Object.fromEntries(
          locales.map((locale) => [
            locale,
            {
              title:
                selected.find(
                  ({ fragment }) => fragment.locales[locale].entries.length,
                )?.fragment.locales[locale].title ??
                selected[0]?.fragment.locales[locale].title ??
                (locale === "de" ? "Änderungen" : "Changes"),
              entries: entries[locale],
            },
          ]),
        ),
      },
      ...history.releases,
    ],
  };
  validateGeneratedCatalog(catalog, { version, locales });
  const catalogBytes = `${canonical(catalog)}\n`;
  const fragments = selected.map(({ id, path: file, sha256 }) => ({
    id,
    path: file,
    sha256,
  }));
  const fragmentDigest = digest(canonical(fragments));
  const manifest = {
    schemaVersion: 1,
    kind: "situate-release-inputs",
    source,
    baseline,
    version,
    build,
    tag,
    fragments,
    fragmentDigest,
    history: {
      file: releaseCatalogFile,
      sha256: digest(catalogBytes),
      contentSha256: catalogDigest(catalog),
    },
    previous: previous
      ? { source: previous.source, catalogSha256: previous.catalogSha256 }
      : null,
  };
  verifyReleaseInputs(manifest, catalogBytes);
  return { manifest, catalog, catalogBytes, fragmentDigest };
}
export function writeReleaseInputs(
  directory,
  inputs,
  { repoRoot = process.cwd() } = {},
) {
  verifyReleaseInputs(inputs.manifest, inputs.catalogBytes);
  fs.mkdirSync(directory, { recursive: true });
  const destination = fs.realpathSync(directory);
  const root = fs.realpathSync(repoRoot);
  const relative = path.relative(root, destination);
  assert(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "Generated release inputs must be outside tracked source",
  );
  const manifestFile = path.join(destination, releaseInputsFile);
  const catalogFile = path.join(destination, releaseCatalogFile);
  for (const [file, bytes] of [
    [catalogFile, inputs.catalogBytes],
    [manifestFile, `${canonical(inputs.manifest)}\n`],
  ]) {
    try {
      fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o444 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = fs.lstatSync(file);
      assert(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          stat.nlink === 1 &&
          fs.readFileSync(file, "utf8") === bytes,
        "Existing generated inputs differ; do not overwrite them",
      );
    }
  }
  return {
    manifestFile,
    catalogFile,
    catalogSha256: inputs.manifest.history.sha256,
    environment: {
      SITUATE_RELEASE_VERSION: inputs.manifest.version,
      SITUATE_RELEASE_HISTORY_FILE: catalogFile,
      SITUATE_RELEASE_HISTORY_SHA256: inputs.manifest.history.contentSha256,
    },
  };
}
