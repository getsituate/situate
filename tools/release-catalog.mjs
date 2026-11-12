import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { versionPaths, withoutProductVersion } from "./release-version.mjs";
import { qualifyMigrationHistory } from "./migration-history.mjs";

export const localeDefinitionPath = "client/packages/localization/locales.json";
export const localeRoot = "client/packages/localization/src/catalogs/releases";
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function productVersion(version) {
  assert(
    typeof version === "string" &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version),
    "Version must be numeric major.minor.patch",
  );
  assert(
    version.split(".").every((n) => Number.isSafeInteger(Number(n))),
    "Version component is too large",
  );
  return version;
}
export function compareVersions(a, b) {
  productVersion(a);
  productVersion(b);
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
export function catalogDigest(catalog) {
  return digest(canonical(catalog));
}
export function safePath(root, relative) {
  assert(
    typeof relative === "string" &&
      relative.length > 0 &&
      !path.isAbsolute(relative) &&
      !relative
        .split(/[\\/]/u)
        .some((part) => part === ".." || part === "" || part === "."),
    "Unsafe release path",
  );
  let current = fs.realpathSync(root);
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      assert(
        !fs.lstatSync(current).isSymbolicLink(),
        `Symlink not allowed: ${relative}`,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return current;
}
export function readText(root, relative) {
  const file = safePath(root, relative),
    stat = fs.lstatSync(file);
  assert(
    stat.isFile() && stat.nlink === 1 && stat.size <= 4 * 1024 * 1024,
    `Release input must be a regular, unlinked file under 4 MiB: ${relative}`,
  );
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    assert(
      opened.ino === stat.ino && opened.dev === stat.dev && opened.nlink === 1,
      "Release input changed while opening",
    );
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}
export function readJson(root, relative) {
  return JSON.parse(readText(root, relative));
}
export function git(root, args) {
  const workingTree = ["status", "ls-files"].includes(args[0]);
  return execFileSync("git", ["--no-pager", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // Working-tree checks need the same ignore rules as interactive Git.
      ...(workingTree
        ? {
            XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
            GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
            GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
            GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
          }
        : { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }),
      GIT_OPTIONAL_LOCKS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}
export function revision(root, sha) {
  assert(
    typeof sha === "string" && /^[a-f0-9]{40}$/u.test(sha),
    "Revision must be a full 40-character commit SHA",
  );
  assert(
    git(root, ["rev-parse", "--verify", `${sha}^{commit}`]).trim() === sha,
    "Revision is not a commit",
  );
  return sha;
}
export function requiredLocales(root) {
  const definition = readJson(root, localeDefinitionPath);
  assert(
    definition.source === "en" &&
      Array.isArray(definition.locales) &&
      definition.locales[0] === "en" &&
      definition.locales.length > 0 &&
      new Set(definition.locales).size === definition.locales.length &&
      definition.locales.every((locale) =>
        /^[a-z]{2}(?:-[A-Z]{2})?$/u.test(locale),
      ),
    "Invalid shared locale definition",
  );
  return definition.locales;
}
export function localePath(version, locale) {
  return `${localeRoot}/${productVersion(version)}/${locale}.json`;
}
export function releasePath(version) {
  return `releases/${productVersion(version)}/release.json`;
}
export function validateText(text) {
  assert(
    typeof text === "string" &&
      text.trim().length > 0 &&
      text.length <= 12000 &&
      !/[<>]/u.test(text) &&
      ![...text].some(
        (character) =>
          character.codePointAt(0) < 32 &&
          ![9, 10, 13].includes(character.codePointAt(0)),
      ),
    "Release text must be nonempty plain text (no HTML)",
  );
}
function keys(object, expected) {
  assert(
    object &&
      typeof object === "object" &&
      !Array.isArray(object) &&
      Object.keys(object).sort().join() === [...expected].sort().join(),
    "Unexpected release content fields",
  );
}
export function validateLocale(value, source) {
  keys(value, ["title", "entries"]);
  validateText(value.title);
  assert(
    Array.isArray(value.entries) && value.entries.length <= 200,
    "Invalid release entries",
  );
  const ids = new Set();
  for (const entry of value.entries) {
    keys(entry, ["id", "type", "platforms", "title", "paragraphs"]);
    assert(
      typeof entry.id === "string" &&
        /^[a-z][a-z0-9-]{0,79}$/u.test(entry.id) &&
        !ids.has(entry.id),
      "Invalid or duplicate entry ID",
    );
    ids.add(entry.id);
    assert(
      ["new", "changed", "fixed", "important"].includes(entry.type),
      "Invalid release entry type",
    );
    assert(
      Array.isArray(entry.platforms) &&
        entry.platforms.length > 0 &&
        new Set(entry.platforms).size === entry.platforms.length &&
        entry.platforms.every((p) => ["macos", "ios"].includes(p)),
      "Invalid release platforms",
    );
    validateText(entry.title);
    assert(
      Array.isArray(entry.paragraphs) &&
        entry.paragraphs.length > 0 &&
        entry.paragraphs.length <= 40,
      "Invalid release paragraphs",
    );
    entry.paragraphs.forEach(validateText);
  }
  if (source)
    assert(
      canonical(
        value.entries.map(({ id, type, platforms }) => ({
          id,
          type,
          platforms,
        })),
      ) ===
        canonical(
          source.entries.map(({ id, type, platforms }) => ({
            id,
            type,
            platforms,
          })),
        ),
      "Translation must preserve entry order, IDs, types and platforms",
    );
  return value;
}
export function sourceHash(record, sourceBytes) {
  return digest(
    canonical({
      version: record.version,
      baseline: record.baseline,
      revision: record.revision,
      locales: record.locales,
      sourceBytes,
    }),
  );
}
export function finalizedVersions(root) {
  const directory = safePath(root, "releases");
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(name))
    .filter((version) => fs.existsSync(safePath(root, releasePath(version))))
    .sort((a, b) => compareVersions(b, a));
}
export function validDate(date) {
  assert(
    typeof date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/u.test(date) &&
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date,
    "Invalid release date",
  );
}
export function contentDigest(metadata, locales) {
  const { finalDigest: _finalDigest, ...binding } = metadata;
  return catalogDigest({ metadata: binding, locales });
}
export function loadRelease(root, version, { verifyGit = true } = {}) {
  const metadata = readJson(root, releasePath(version));
  keys(metadata, [
    "schemaVersion",
    "version",
    "baseline",
    "revision",
    "locales",
    "sourceApproval",
    "localeHashes",
    "finalDigest",
    ...(Object.hasOwn(metadata, "date") ? ["date"] : []),
  ]);
  const locales = requiredLocales(root);
  assert(
    metadata.schemaVersion === 1 &&
      metadata.version === version &&
      canonical(metadata.locales) === canonical(locales),
    "Release version or locale mismatch",
  );
  assert(
    /^[a-f0-9]{40}$/u.test(metadata.baseline) &&
      /^[a-f0-9]{40}$/u.test(metadata.revision),
    "Invalid release revisions",
  );
  if (metadata.date) validDate(metadata.date);
  const texts = {},
    hashes = {};
  for (const locale of locales) {
    const bytes = readText(root, localePath(version, locale));
    texts[locale] = validateLocale(
      JSON.parse(bytes),
      locale === "en" ? undefined : texts.en,
    );
    hashes[locale] = digest(bytes);
  }
  assert(
    canonical(hashes) === canonical(metadata.localeHashes),
    "Release locale content changed; finalize reviewed translations again",
  );
  keys(metadata.sourceApproval, ["action", "sourceHash"]);
  assert(
    metadata.sourceApproval?.sourceHash ===
      sourceHash(metadata, readText(root, localePath(version, "en"))) &&
      metadata.sourceApproval?.action === "approve",
    "Source approval is missing or stale",
  );
  assert(
    metadata.finalDigest === contentDigest(metadata, texts),
    "Final release digest mismatch",
  );
  if (verifyGit) {
    revision(root, metadata.baseline);
    revision(root, metadata.revision);
    git(root, [
      "merge-base",
      "--is-ancestor",
      metadata.baseline,
      metadata.revision,
    ]);
  }
  return { metadata, locales: texts };
}
export function verifyBuildBinding(root, metadata) {
  verifySourceBinding(root, metadata, "HEAD", true);
}
export function verifySourceBinding(root, metadata, target, working = false) {
  git(root, ["merge-base", "--is-ancestor", metadata.revision, target]);
  const readAt = (at, file) =>
    at === null ? readText(root, file) : git(root, ["show", `${at}:${file}`]);
  const cargo = readAt(metadata.revision, "client/Cargo.toml");
  const members = [...cargo.matchAll(/"((?:crates\/|app\/)[^"]+)"/gu)].map(
    (match) =>
      /^name = "([^"]+)"/mu.exec(
        readAt(metadata.revision, `client/${match[1]}/Cargo.toml`),
      )?.[1],
  );
  const versionOnly = (file, before, after) => {
    if (!versionPaths.includes(file)) return false;
    try {
      return (
        withoutProductVersion(file, readAt(before, file), members) ===
        withoutProductVersion(file, readAt(after, file), members)
      );
    } catch {
      return false;
    }
  };
  const allowed = new Set([
    releasePath(metadata.version),
    ...metadata.locales.map((locale) => localePath(metadata.version, locale)),
  ]);
  const changed = git(root, [
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    metadata.revision,
    ...(working ? [] : [target]),
    "--",
  ])
    .split("\0")
    .filter(Boolean)
    .filter(
      (file) => !versionOnly(file, metadata.revision, working ? null : target),
    );
  const committed = git(root, ["rev-list", `${metadata.revision}..${target}`])
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((sha) =>
      git(root, [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        `${sha}^`,
        sha,
        "--",
      ])
        .split("\0")
        .filter(Boolean)
        .filter((file) => !versionOnly(file, `${sha}^`, sha)),
    );
  const untracked = working
    ? git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean)
    : [];
  assert(
    [...committed, ...changed, ...untracked].every((file) => allowed.has(file)),
    "Application source changed after analysis; prepare and approve against a new committed revision",
  );
}
export function compileReleaseCatalog(
  root,
  { version, requireCurrent = false, verifyGit = true },
) {
  productVersion(version);
  const versions = finalizedVersions(root).filter(
    (candidate) => compareVersions(candidate, version) <= 0,
  );
  assert(
    !requireCurrent || versions.includes(version),
    `Release ${version} is not finalized; prepare, approve, translate and finalize first`,
  );
  const releases = versions.map((v) => {
    const { metadata, locales } = loadRelease(root, v, { verifyGit });
    if (verifyGit) {
      for (const file of [
        releasePath(v),
        ...metadata.locales.map((locale) => localePath(v, locale)),
      ])
        assert(
          git(root, ["show", `HEAD:${file}`]) === readText(root, file),
          "Finalized release notes must match the committed files",
        );
      if (v === version && requireCurrent) verifyBuildBinding(root, metadata);
    }
    return {
      version: v,
      ...(metadata.date ? { date: metadata.date } : {}),
      locales,
    };
  });
  return { schemaVersion: 1, installedVersion: version, releases };
}
export function validateVersionPins(root, version, atRevision) {
  const read = (file) =>
    atRevision
      ? git(root, ["show", `${atRevision}:${file}`])
      : readText(root, file);
  const packageJson = JSON.parse(read("client/package.json")),
    appPackage = JSON.parse(read("client/app/package.json")),
    lock = JSON.parse(read("client/package-lock.json")),
    tauri = JSON.parse(read("client/app/src-tauri/tauri.conf.json"));
  assert(
    packageJson.version === version &&
      appPackage.version === version &&
      lock.version === version &&
      lock.packages?.[""]?.version === version &&
      lock.packages?.app?.version === version &&
      tauri.version === version,
    "Product version mismatch in npm, lockfile or Tauri configuration",
  );
  const cargo = read("client/Cargo.toml"),
    cargoLock = read("client/Cargo.lock");
  assert(
    /^\[workspace\.package\][\s\S]*?^version = "([^"]+)"/mu.exec(cargo)?.[1] ===
      version,
    "Cargo workspace version mismatch",
  );
  const members = [...cargo.matchAll(/"((?:crates\/|app\/)[^"]+)"/gu)].map(
    (match) => match[1],
  );
  assert(members.length > 0, "Missing Cargo workspace members");
  for (const member of members) {
    const manifest = read(`client/${member}/Cargo.toml`),
      name = /^name = "([^"]+)"/mu.exec(manifest)?.[1];
    assert(
      name && /^version\.workspace = true$/mu.test(manifest),
      "Cargo member must inherit workspace version",
    );
    const packages = cargoLock
      .split("[[package]]")
      .filter((block) => new RegExp(`^name = "${name}"$`, "mu").test(block));
    assert(
      packages.length === 1 &&
        /^version = "([^"]+)"/mu.exec(packages[0])?.[1] === version,
      `Cargo lock version mismatch: ${name}`,
    );
  }
}
export function validatePreparedRelease(root, version) {
  validateVersionPins(root, version);
  assert(
    git(root, ["status", "--porcelain", "--untracked-files=all"]).trim() === "",
    "Finalized release content must be committed in a clean checkout before a distribution build",
  );
  return compileReleaseCatalog(root, {
    version,
    requireCurrent: true,
    verifyGit: true,
  });
}

export function validateReleaseForBuild(
  root,
  version,
  { environment = process.env } = {},
) {
  const catalog = validatePreparedRelease(root, version);
  qualifyMigrationHistory(root, { environment });
  return catalog;
}
