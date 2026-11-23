import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import fixture from "./fixtures/upgrade-016/workspace.mjs";

const { directories, files: workspace } = fixture;

export const upgradeWorkspaceName = "Upgrade workspace";
export const upgradeNote = "Field notes.md";
export const upgradeNoteBefore = "# Field notes\n\nStation A: light rain.\n";
export const upgradeNoteAfter =
  "# Field notes\n\nStation A: light rain.\n\nStation B: clear.\n";
const histories = [
  ".situate/conversations/21111111-1111-4111-8111-111111111111/history.jsonl",
  ".situate/conversations/22222222-2222-4222-8222-222222222222/history.jsonl",
];
const pluginPackage = ".situate/plugins/upgrade-fixture";
const pluginState = `${pluginPackage}/.runtime/runtime-state.json`;
const pluginManifest = `${pluginPackage}/code/plugin.json`;
const retained = [
  "Checklist.md",
  ".situate/working-method.md",
  ...histories,
  ".situate/plugins/upgrade-fixture/code/service.js",
  ...Object.keys(workspace).filter((relative) =>
    relative.includes("/history.git/objects/"),
  ),
];

function bytes(relative) {
  const value = Buffer.from(workspace[relative], "base64");
  assert(
    value.length <= 128 * 1024 &&
      value.toString("base64") === workspace[relative],
    "Invalid upgrade fixture bytes",
  );
  return value;
}

export function materializeUpgradeWorkspace(parent) {
  const root = join(parent, upgradeWorkspaceName);
  assert(
    lstatSync(parent).isDirectory() && realpathSync(parent) === parent,
    "Upgrade fixture parent is not owned storage",
  );
  const paths = Object.keys(workspace);
  assert(
    paths.length + directories.length <= 256 &&
      [...directories, ...paths].every((path) =>
        path
          .split("/")
          .every(
            (part) =>
              /^[a-zA-Z0-9._ -]+$/.test(part) && part !== "." && part !== "..",
          ),
      ),
    "Invalid upgrade fixture paths",
  );
  const directoriesByPath = new Set(directories);
  assert(
    paths.every(
      (path) => dirname(path) === "." || directoriesByPath.has(dirname(path)),
    ),
    "Missing fixture directory",
  );
  mkdirSync(root, { mode: 0o700 });
  for (const relative of directories)
    mkdirSync(join(root, relative), { mode: 0o700 });
  for (const relative of paths) {
    const path = join(root, relative);
    writeFileSync(path, bytes(relative), { flag: "wx", mode: 0o600 });
  }
  return root;
}

function retainedBytes(root, relative) {
  const path = join(root, relative);
  assert.equal(
    realpathSync(path),
    path,
    "Retained upgrade fixture path is linked",
  );
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    assert(
      stat.isFile() && stat.nlink === 1 && stat.size <= 128 * 1024,
      "Invalid retained upgrade fixture file",
    );
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function verifyUpgradeDraft(root, expectedDraft) {
  const name = createHash("sha1")
    .update(`blob ${Buffer.byteLength(upgradeNote)}\0${upgradeNote}`)
    .digest("hex");
  const { version, draft } = JSON.parse(
    retainedBytes(root, `.situate/drafts/${name}.json`),
  );
  assert(
    version === 1 &&
      draft?.path === upgradeNote &&
      draft.base?.text === upgradeNoteAfter &&
      draft.text === expectedDraft,
    "Cancelled upgrade did not retain the exact draft",
  );
}

export function verifyUpgradeWorkspace(
  root,
  expectedNote,
  { allowManifestMigration = false } = {},
) {
  assert(
    retainedBytes(root, upgradeNote).equals(Buffer.from(expectedNote)),
    "Upgrade note differs from the expected saved content",
  );
  for (const relative of retained) {
    assert(
      retainedBytes(root, relative).equals(bytes(relative)),
      `Upgrade fixture lost retained state: ${relative}`,
    );
  }
  const state = JSON.parse(retainedBytes(root, pluginState));
  const baseline = JSON.parse(bytes(pluginState));
  const [plugin] = state.plugins;
  const [original] = baseline.plugins;
  const manifest = retainedBytes(root, pluginManifest);
  if (allowManifestMigration && !manifest.equals(bytes(pluginManifest))) {
    assert.deepEqual(
      JSON.parse(manifest),
      {
        ...JSON.parse(bytes(pluginManifest)),
        schemaVersion: 3,
        kind: "tool",
      },
      "Unexpected plugin manifest migration",
    );
    const migratedRef = `${pluginPackage}/.situate/history.git/refs/situate/migrations/plugin-manifests/${original.revision}`;
    assert(
      /^[a-f0-9]{40}$/.test(plugin?.revision) &&
        plugin.revision !== original.revision &&
        retainedBytes(root, migratedRef).toString().trim() === plugin.revision,
      "Enabled plugin revision does not match the retained migration revision",
    );
    original.revision = plugin.revision;
  } else {
    assert(
      manifest.equals(bytes(pluginManifest)),
      "Upgrade plugin manifest changed",
    );
  }
  assert.deepEqual(
    state,
    baseline,
    "Upgrade fixture lost the enabled source revision",
  );
}
