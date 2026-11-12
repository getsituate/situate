import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { validateManifest } from "../../infrastructure/releases/publish.mjs";
import { appleEnvironment } from "./apple-release.mjs";
import {
  bundleDigest,
  verifyDirectPayloads,
} from "./direct-release-verification.mjs";

const identifier = JSON.parse(
  readFileSync(new URL("../app/src-tauri/tauri.conf.json", import.meta.url)),
).identifier;
const marker = ".situate-release-fixture";
const fixtures = {
  "release-sentinel.md":
    "# Release fixture\n\n- [ ] Preserve this synthetic task\n",
  "release-attachment.bin": Buffer.from([0, 1, 2, 128, 255]),
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function regularFile(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 1024 * 1024
  )
    throw new Error(
      "Expected a regular qualification file without links, at most 1 MiB.",
    );
  return readFileSync(path);
}

function canonicalDirectory(path) {
  const absolute = resolve(path);
  if (realpathSync(absolute) !== absolute || !lstatSync(absolute).isDirectory())
    throw new Error("Use a canonical directory without symlink components.");
  return absolute;
}

export function createReleaseFixture(path) {
  const directory = resolve(path);
  canonicalDirectory(resolve(directory, ".."));
  mkdirSync(directory, { mode: 0o700 });
  mkdirSync(join(directory, ".situate"), { mode: 0o700 });
  writeFileSync(join(directory, marker), randomUUID(), {
    flag: "wx",
    mode: 0o600,
  });
  for (const [name, bytes] of Object.entries(fixtures))
    writeFileSync(join(directory, name), bytes, { flag: "wx", mode: 0o600 });
}

export function fixtureSnapshot(path) {
  const directory = canonicalDirectory(path);
  const owner = regularFile(join(directory, marker)).toString("utf8");
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner))
    throw new Error("Workspace is not an owned release fixture.");
  readdirSync(canonicalDirectory(join(directory, ".situate")));
  const files = Object.fromEntries(
    Object.entries(fixtures).map(([name, bytes]) => {
      const actual = regularFile(join(directory, name));
      if (!actual.equals(Buffer.from(bytes)))
        throw new Error("Synthetic workspace content changed.");
      return [name, digest(actual)];
    }),
  );
  return { owner, files };
}

export async function releasePair(
  options,
  { verify = verifyDirectPayloads } = {},
) {
  const releases = [];
  for (const kind of ["from", "to"]) {
    const directory = canonicalDirectory(options[kind]);
    const bytes = regularFile(join(directory, "manifest.json"));
    const manifest = JSON.parse(bytes);
    const artifact = validateManifest(directory, manifest, {
      revision: options[`${kind}Revision`],
      identifier,
      teamId: options.teamId,
      publicKey: options.publicKey,
    });
    await verify(directory, artifact, {
      env: appleEnvironment(
        process.env,
        fileURLToPath(new URL("../", import.meta.url)),
      ),
    });
    releases.push({
      version: manifest.version,
      revision: manifest.revision,
      manifestSha256: digest(bytes),
      bundleSha256: artifact.bundleSha256,
      archiveSha256: artifact.updater.sha256,
    });
  }
  const [from, to] = releases;
  const a = from.version.split(".").map(BigInt);
  const b = to.version.split(".").map(BigInt);
  const difference = b.findIndex((value, index) => value !== a[index]);
  if (difference < 0 || b[difference] < a[difference])
    throw new Error("The target release must have a strictly higher version.");
  return { from, to };
}

export async function observeUpdate(
  action,
  options,
  {
    pair = releasePair,
    snapshot = fixtureSnapshot,
    bundle = bundleDigest,
  } = {},
) {
  if (!["begin", "finish"].includes(action))
    throw new Error("Use begin or finish.");
  const previousBytes =
    action === "finish" ? regularFile(options.receipt) : undefined;
  const previous = previousBytes ? JSON.parse(previousBytes) : undefined;
  if (
    previous &&
    (previous.schemaVersion !== 1 || previous.observation !== "before")
  )
    throw new Error("Expected a before-update receipt.");
  const inputs = previous
    ? { ...previous.inputs, publicKey: options.publicKey }
    : options;
  for (const name of ["from", "to", "app", "workspace"])
    inputs[name] = canonicalDirectory(inputs[name]);
  if (!inputs.app.endsWith("/Situate.app"))
    throw new Error("Select the installed Situate.app.");
  const output = resolve(
    action === "begin" ? options.receipt : `${options.receipt}.after.json`,
  );
  canonicalDirectory(dirname(output));
  if (
    [inputs.from, inputs.to, inputs.app, inputs.workspace].some(
      (directory) =>
        output === directory || output.startsWith(`${directory}${sep}`),
    )
  )
    throw new Error(
      "Keep receipts outside release, app and workspace directories.",
    );
  const releases = await pair(inputs);
  const workspace = snapshot(inputs.workspace);
  if (
    previous &&
    (!isDeepStrictEqual(previous.releases, releases) ||
      !isDeepStrictEqual(previous.workspace, workspace))
  )
    throw new Error(
      "Release inputs or workspace ownership changed since begin.",
    );
  const expected = action === "begin" ? releases.from : releases.to;
  if (bundle(inputs.app) !== expected.bundleSha256)
    throw new Error(
      "Installed app does not match the exact expected release bundle.",
    );
  const {
    from,
    to,
    fromRevision,
    toRevision,
    teamId,
    app,
    workspace: workspacePath,
  } = inputs;
  if (previousBytes && !regularFile(options.receipt).equals(previousBytes))
    throw new Error("Before-update receipt changed during observation.");
  const receipt = {
    schemaVersion: 1,
    observation: action === "begin" ? "before" : "after",
    observedAt: new Date().toISOString(),
    inputs: {
      from,
      to,
      fromRevision,
      toRevision,
      teamId,
      app,
      workspace: workspacePath,
    },
    releases,
    workspace,
    ...(previousBytes ? { beforeReceiptSha256: digest(previousBytes) } : {}),
  };
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return output;
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries(
      [
        "from",
        "to",
        "from-revision",
        "to-revision",
        "team-id",
        "app",
        "workspace",
        "receipt",
      ]
        .map((name) => [name, { type: "string" }])
        .concat([["help", { type: "boolean" }]]),
    ),
  });
  if (values.help) {
    console.log(
      "Usage: node client/scripts/qualify-direct-update.mjs fixture --workspace NEW_DIR | begin --from DIR --to DIR --from-revision SHA --to-revision SHA --team-id TEAM --app PATH/Situate.app --workspace DIR --receipt NEW_FILE | finish --receipt FILE\nBegin/finish require macOS and environment-only SITUATE_UPDATER_PUBLIC_KEY. Does not launch, install or publish an app.",
    );
    return;
  }
  const [action] = positionals;
  if (
    positionals.length !== 1 ||
    !["fixture", "begin", "finish"].includes(action)
  )
    throw new Error("Choose fixture, begin or finish.");
  if (action === "fixture") {
    if (!values.workspace)
      throw new Error("Provide a new --workspace directory.");
    createReleaseFixture(values.workspace);
    return;
  }
  if (process.platform !== "darwin")
    throw new Error("Native update observations require macOS.");
  if (!values.receipt || !process.env.SITUATE_UPDATER_PUBLIC_KEY?.trim())
    throw new Error(
      "Provide --receipt and environment-only SITUATE_UPDATER_PUBLIC_KEY.",
    );
  if (
    action === "begin" &&
    [
      "from",
      "to",
      "from-revision",
      "to-revision",
      "team-id",
      "app",
      "workspace",
    ].some((name) => !values[name])
  )
    throw new Error(
      "Begin requires both releases/revisions, team, installed app and synthetic workspace.",
    );
  console.log(
    await observeUpdate(action, {
      ...values,
      fromRevision: values["from-revision"],
      toRevision: values["to-revision"],
      teamId: values["team-id"],
      publicKey: process.env.SITUATE_UPDATER_PUBLIC_KEY,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
