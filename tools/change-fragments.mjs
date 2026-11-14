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

const idPattern = /^[a-z][a-z0-9-]{0,79}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;
const fragmentPath = (id) => `changes/${id}.json`;
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
export function fragmentHashes(fragment) {
  const sourceHash = digest(
    canonical({
      schemaVersion: fragment.schemaVersion,
      id: fragment.id,
      behaviorDigest: fragment.behaviorDigest,
      locales: Object.keys(fragment.locales).sort(),
      source: fragment.locales.en,
      ...(fragment.emptyReason === undefined
        ? {}
        : { emptyReason: fragment.emptyReason }),
    }),
  );
  return {
    sourceHash,
    translations: Object.fromEntries(
      Object.entries(fragment.locales)
        .filter(([locale]) => locale !== "en")
        .map(([locale, content]) => [
          locale,
          digest(canonical({ sourceHash, locale, content })),
        ]),
    ),
  };
}
export function validateFragment(
  fragment,
  { locales, behaviorDigest: expectedBehavior, requireApprovals = true } = {},
) {
  fields(
    fragment,
    [
      "schemaVersion",
      "id",
      "behaviorDigest",
      "locales",
      "emptyReason",
      "sourceApproval",
      "translationApprovals",
    ],
    [
      "schemaVersion",
      "id",
      "behaviorDigest",
      "locales",
      "translationApprovals",
    ],
  );
  assert(
    fragment.schemaVersion === 1 &&
      typeof fragment.id === "string" &&
      idPattern.test(fragment.id) &&
      hashPattern.test(fragment.behaviorDigest),
    "Invalid fragment identity or behavior digest",
  );
  assert(
    !expectedBehavior || expectedBehavior === fragment.behaviorDigest,
    "Behavior changed after content review",
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
  fields(
    fragment.translationApprovals,
    locales.filter((locale) => locale !== "en"),
    [],
  );
  const hashes = fragmentHashes(fragment);
  if (requireApprovals) {
    fields(fragment.sourceApproval, ["action", "sourceHash"]);
    assert(
      fragment.sourceApproval.action === "approve" &&
        fragment.sourceApproval.sourceHash === hashes.sourceHash,
      "Source approval is missing or stale",
    );
  }
  for (const locale of locales.filter((item) => item !== "en")) {
    const approval = fragment.translationApprovals[locale];
    if (requireApprovals) {
      fields(approval, ["sourceHash", "translationHash"]);
      assert(
        fragment.sourceApproval?.sourceHash === hashes.sourceHash &&
          approval.sourceHash === hashes.sourceHash &&
          approval.translationHash === hashes.translations[locale],
        "Translation approval is missing or stale",
      );
    }
  }
  return fragment;
}
export function behaviorDigest(root, at) {
  revision(root, at);
  return digest(
    git(root, ["ls-tree", "-r", "-z", at])
      .split("\0")
      .filter((item) => item && !item.split("\t")[1].startsWith("changes/"))
      .join("\0"),
  );
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
export function validateFragmentRange(
  root,
  { base, head, requireNew = true, checkBehavior = true } = {},
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
  for (const [file, metadata] of before)
    assert(
      afterMap.get(file) === metadata,
      "Existing declarations are immutable",
    );
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
    .filter(Boolean);
  assert(!immutable.length, "Finalized historical catalogs are immutable");
  const locales = localesAt(root, head);
  const expectedBehavior = checkBehavior
    ? behaviorDigest(root, head)
    : undefined;
  const fragments = after
    .filter(({ file }) => !before.has(file))
    .map(({ file, metadata }) => {
      assert(
        /^100644 blob /u.test(metadata) &&
          /^changes\/[a-z][a-z0-9-]{0,79}\.json$/u.test(file),
        "Invalid declaration path or file type",
      );
      const bytes = git(root, ["show", `${head}:${file}`]);
      assert(
        Buffer.byteLength(bytes) <= 4 * 1024 * 1024,
        "Fragment exceeds 4 MiB",
      );
      const fragment = validateFragment(JSON.parse(bytes), {
        locales,
        behaviorDigest: expectedBehavior,
      });
      assert(
        file === fragmentPath(fragment.id),
        "Fragment filename and ID differ",
      );
      return { id: fragment.id, path: file, sha256: digest(bytes), fragment };
    });
  assert(
    !requireNew || fragments.length > 0,
    "Every pull request requires a new declaration",
  );
  return fragments.sort((a, b) => a.id.localeCompare(b.id, "en"));
}
export function collectFragments(root, options) {
  return validateFragmentRange(root, {
    ...options,
    requireNew: false,
    checkBehavior: false,
  });
}
export function approveSource(fragment, expectedHash, options) {
  fragment = {
    ...fragment,
    behaviorDigest: options?.behaviorDigest ?? fragment.behaviorDigest,
  };
  validateFragment(fragment, { ...options, requireApprovals: false });
  const { sourceHash } = fragmentHashes(fragment);
  assert(
    expectedHash === sourceHash,
    "Inspect the current source hash before approval",
  );
  return {
    ...fragment,
    sourceApproval: { action: "approve", sourceHash },
    translationApprovals: {},
  };
}
export function acceptTranslation(
  fragment,
  locale,
  content,
  expectedHash,
  options,
) {
  assert(
    locale !== "en" && options.locales.includes(locale),
    "Invalid translation locale",
  );
  const next = {
    ...fragment,
    locales: { ...fragment.locales, [locale]: content },
    translationApprovals: { ...fragment.translationApprovals },
  };
  const hashes = fragmentHashes(next);
  assert(
    next.sourceApproval?.sourceHash === hashes.sourceHash,
    "Approve English before accepting translations",
  );
  assert(
    hashes.translations[locale] === expectedHash,
    "Inspect the current translation hash before acceptance",
  );
  next.translationApprovals[locale] = {
    sourceHash: hashes.sourceHash,
    translationHash: expectedHash,
  };
  validateFragment(next, { ...options, requireApprovals: false });
  return next;
}
export function runFragmentCli(
  args = process.argv.slice(2),
  root = process.cwd(),
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries([
      ...[
        "id",
        "input",
        "reason",
        "source",
        "base",
        "head",
        "hash",
        "locale",
      ].map((name) => [name, { type: "string" }]),
      ["draft", { type: "boolean" }],
    ]),
  });
  const [command] = positionals;
  assert(
    positionals.length === 1,
    "Expected author, validate, source-approve or translation-accept",
  );
  const source = values.source ?? git(root, ["rev-parse", "HEAD"]).trim();
  const options = {
    locales: requiredLocales(root),
    behaviorDigest: behaviorDigest(root, source),
  };
  if (command === "validate" && values.base)
    return validateFragmentRange(root, {
      base: values.base,
      head: values.head ?? source,
    }).map(({ id, sha256 }) => ({ id, sha256 }));
  let fragment;
  if (command === "author") {
    const id = values.id ?? `change-${randomUUID()}`;
    assert(idPattern.test(id), "Invalid fragment ID");
    assert(
      Boolean(values.input) !== Boolean(values.reason),
      "Provide either --input localized content or --reason",
    );
    const locales = values.input
      ? JSON.parse(fs.readFileSync(values.input, "utf8"))
      : Object.fromEntries(
          options.locales.map((locale) => [
            locale,
            {
              title:
                locale === "en"
                  ? "Changes"
                  : locale === "de"
                    ? "Änderungen"
                    : "Changes",
              entries: [],
            },
          ]),
        );
    fragment = {
      schemaVersion: 1,
      id,
      behaviorDigest: options.behaviorDigest,
      locales,
      ...(values.reason ? { emptyReason: values.reason } : {}),
      translationApprovals: {},
    };
    validateFragment(fragment, { ...options, requireApprovals: false });
    fs.mkdirSync(path.join(root, "changes"), { recursive: true });
    fs.writeFileSync(
      safePath(root, fragmentPath(id)),
      `${JSON.stringify(fragment, null, 2)}\n`,
      { flag: "wx" },
    );
  } else {
    assert(idPattern.test(values.id ?? ""), "Provide --id");
    fragment = readJson(root, fragmentPath(values.id));
    if (command === "source-approve")
      fragment = approveSource(fragment, values.hash, options);
    else if (command === "translation-accept") {
      const content = values.input
        ? JSON.parse(fs.readFileSync(values.input, "utf8"))
        : fragment.locales[values.locale];
      fragment = acceptTranslation(
        fragment,
        values.locale,
        content,
        values.hash,
        options,
      );
    } else assert(command === "validate", "Unknown fragment command");
    if (command === "validate" && values.draft)
      fragment = { ...fragment, behaviorDigest: options.behaviorDigest };
    if (command === "validate")
      validateFragment(fragment, {
        ...options,
        requireApprovals: !values.draft,
      });
    else
      fs.writeFileSync(
        safePath(root, fragmentPath(values.id)),
        `${JSON.stringify(fragment, null, 2)}\n`,
      );
  }
  return {
    id: fragment.id,
    source,
    behaviorDigest: fragment.behaviorDigest,
    ...fragmentHashes(fragment),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(JSON.stringify(runFragmentCli(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
