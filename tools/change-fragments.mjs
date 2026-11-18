import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  assert,
  canonical,
  digest,
  git,
  revision,
  requiredLocales,
  validateLocale,
  validateText,
  readJson,
  safePath,
  localeDefinitionPath,
  localeRoot,
} from "./release-catalog.mjs";
import { requiresChangelog } from "./test-inputs.mjs";

const idPattern = /^[a-z][a-z0-9-]{0,79}$/u;
const fragmentPath = (id) => `changes/${id}.json`;
const fragmentFields = ["schemaVersion", "id", "locales"];

function fields(value, allowed, required = allowed) {
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) => allowed.includes(key)) &&
      required.every((key) => Object.hasOwn(value, key)),
    "Unexpected fragment fields",
  );
}

export function validateFragment(fragment, { locales } = {}) {
  fields(fragment, [...fragmentFields, "emptyReason"], fragmentFields);
  assert(fragment.schemaVersion === 2, "Unsupported fragment schema version");
  assert(
    typeof fragment.id === "string" && idPattern.test(fragment.id),
    "Invalid fragment identity",
  );
  assert(
    Array.isArray(locales) && locales.includes("en"),
    "Missing locale inventory",
  );
  fields(fragment.locales, locales);
  const source = validateLocale(fragment.locales.en);
  for (const locale of locales) {
    validateLocale(
      fragment.locales[locale],
      locale === "en" ? undefined : source,
    );
    assert(
      fragment.locales[locale].entries.every(
        (entry) => canonical(entry.platforms) === '["macos"]',
      ),
      "New fragments target macOS only",
    );
  }
  if (!source.entries.length) validateText(fragment.emptyReason);
  else
    assert(
      fragment.emptyReason === undefined,
      "Nonempty fragments cannot have an empty reason",
    );
  return fragment;
}

function upgradeLegacyFragment(fragment) {
  const legacyFields = [
    "behaviorDigest",
    "sourceApproval",
    "translationApprovals",
  ];
  fields(
    fragment,
    [...fragmentFields, ...legacyFields, "emptyReason"],
    [...fragmentFields, ...legacyFields],
  );
  assert(
    fragment.schemaVersion === 1,
    "Unsupported legacy fragment schema version",
  );
  const upgraded = { ...fragment, schemaVersion: 2 };
  for (const key of legacyFields) delete upgraded[key];
  return upgraded;
}

export function localesAt(root, at) {
  const definition = JSON.parse(
    git(root, ["show", `${at}:${localeDefinitionPath}`]),
  );
  assert(
    definition.source === "en" &&
      Array.isArray(definition.locales) &&
      definition.locales[0] === "en" &&
      new Set(definition.locales).size === definition.locales.length &&
      definition.locales.every((locale) =>
        /^[a-z]{2}(?:-[A-Z]{2})?$/u.test(locale),
      ),
    "Invalid shared locale definition",
  );
  return definition.locales;
}

function treeFiles(root, at, directory) {
  return git(root, ["ls-tree", "-r", "-z", at, "--", directory])
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const [metadata, file] = record.split("\t");
      return { file, metadata };
    });
}

function readCommittedFragment(root, at, file) {
  const bytes = git(root, ["show", `${at}:${file}`]);
  assert(Buffer.byteLength(bytes) <= 4 * 1024 * 1024, "Fragment exceeds 4 MiB");
  return { bytes, fragment: JSON.parse(bytes) };
}

function regularFragment(file, metadata) {
  return (
    /^100644 blob /u.test(metadata ?? "") &&
    /^changes\/[a-z][a-z0-9-]{0,79}\.json$/u.test(file)
  );
}

function isLegacyUpgrade(root, base, head, file, before, after) {
  if (!regularFragment(file, before) || !regularFragment(file, after))
    return false;
  const previous = readCommittedFragment(root, base, file).fragment;
  const next = readCommittedFragment(root, head, file).fragment;
  return (
    previous?.schemaVersion === 1 &&
    next?.schemaVersion === 2 &&
    canonical(next) === canonical(upgradeLegacyFragment(previous))
  );
}

export function validateFragmentRange(
  root,
  {
    base,
    head,
    requireForClientChanges = true,
    allowLegacyFragments = false,
    allowMigrationMetadata = false,
  } = {},
) {
  revision(root, base);
  revision(root, head);
  assert(
    git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "false",
    "Complete Git history is required",
  );
  git(root, ["merge-base", "--is-ancestor", base, head]);
  const before = new Map(
    treeFiles(root, base, "changes").map(({ file, metadata }) => [
      file,
      metadata,
    ]),
  );
  const after = treeFiles(root, head, "changes");
  const afterMap = new Map(after.map(({ file, metadata }) => [file, metadata]));
  for (const [file, metadata] of before) {
    const next = afterMap.get(file);
    assert(
      next === metadata ||
        isLegacyUpgrade(root, base, head, file, metadata, next),
      "Existing declarations are immutable",
    );
  }
  const immutable = git(root, [
    "diff",
    "--name-only",
    "-z",
    base,
    head,
    "--",
    "releases",
    localeRoot,
  ])
    .split("\0")
    .filter(
      (file) =>
        file &&
        (!allowMigrationMetadata ||
          ![
            "releases/legacy-migration-evidence.json",
            "releases/migration-checkpoint.json",
          ].includes(file)),
    );
  assert(!immutable.length, "Finalized historical catalogs are immutable");
  const locales = localesAt(root, head);
  const fragments = after
    .filter(({ file }) => !before.has(file))
    .map(({ file, metadata }) => {
      assert(
        regularFragment(file, metadata),
        "Invalid declaration path or file type",
      );
      const { bytes, fragment } = readCommittedFragment(root, head, file);
      const content = validateFragment(
        allowLegacyFragments && fragment?.schemaVersion === 1
          ? upgradeLegacyFragment(fragment)
          : fragment,
        { locales },
      );
      assert(
        file === fragmentPath(content.id),
        "Fragment filename and ID differ",
      );
      // Historical reservations bind the original committed bytes, not the upgraded content.
      return {
        id: content.id,
        path: file,
        sha256: digest(bytes),
        fragment: content,
      };
    });
  if (!fragments.length && requireForClientChanges) {
    const clientChange = git(root, [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      base,
      head,
      "--",
    ])
      .split("\0")
      .find(requiresChangelog);
    assert(
      !clientChange,
      `Client changes require a new declaration in changes/ (changed input: ${JSON.stringify(clientChange)})`,
    );
  }
  return fragments.sort((a, b) => a.id.localeCompare(b.id, "en"));
}

export function collectFragments(root, options) {
  return validateFragmentRange(root, {
    ...options,
    requireForClientChanges: false,
    allowLegacyFragments: true,
    // Published source baselines may precede the migration-ledger replacement.
    allowMigrationMetadata: true,
  });
}

export function runFragmentCli(
  args = process.argv.slice(2),
  root = process.cwd(),
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries(
      ["id", "input", "reason", "base", "head"].map((name) => [
        name,
        { type: "string" },
      ]),
    ),
  });
  const [command] = positionals;
  assert(
    positionals.length === 1 && ["author", "validate"].includes(command),
    "Expected author or validate",
  );
  if (command === "validate" && values.base)
    return validateFragmentRange(root, {
      base: values.base,
      head: values.head ?? git(root, ["rev-parse", "HEAD"]).trim(),
    }).map(({ id, sha256 }) => ({ id, sha256 }));

  const locales = requiredLocales(root);
  if (command === "validate") {
    assert(idPattern.test(values.id ?? ""), "Provide --id");
    const fragment = readJson(root, fragmentPath(values.id));
    validateFragment(fragment, { locales });
    assert(values.id === fragment.id, "Fragment filename and ID differ");
    return { id: fragment.id };
  }

  const id = values.id ?? `change-${randomUUID()}`;
  assert(idPattern.test(id), "Invalid fragment ID");
  assert(
    Boolean(values.input) !== Boolean(values.reason),
    "Provide either --input localized content or --reason",
  );
  const fragment = {
    schemaVersion: 2,
    id,
    locales: values.input
      ? JSON.parse(fs.readFileSync(values.input, "utf8"))
      : Object.fromEntries(
          locales.map((locale) => [
            locale,
            { title: locale === "de" ? "Änderungen" : "Changes", entries: [] },
          ]),
        ),
    ...(values.reason ? { emptyReason: values.reason } : {}),
  };
  validateFragment(fragment, { locales });
  fs.mkdirSync(path.join(root, "changes"), { recursive: true });
  fs.writeFileSync(
    safePath(root, fragmentPath(id)),
    `${JSON.stringify(fragment, null, 2)}\n`,
    { flag: "wx" },
  );
  return { id };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    console.log(JSON.stringify(runFragmentCli(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
