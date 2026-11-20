import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  hashReleaseFileDescriptor,
  readReleaseFileDescriptor,
  updateReleaseFileDigest,
  verifyUpdaterSignature,
  withReleaseFile,
} from "./updater-signing.mjs";
import { isDeepStrictEqual } from "node:util";
import { run } from "./ios-xcode.mjs";
import { verifyReleaseHistoryResource } from "./release-history.mjs";

export function bundleDigest(app) {
  const hash = createHash("sha256");
  function visit(path, relative) {
    const stat = lstatSync(path);
    hash.update(
      JSON.stringify([
        relative,
        stat.isFile() || stat.isSymbolicLink() ? stat.size : null,
        stat.mode & 0o777,
        stat.isSymbolicLink()
          ? "link"
          : stat.isDirectory()
            ? "directory"
            : "file",
      ]),
    );
    if (stat.isSymbolicLink()) hash.update(readlinkSync(path));
    else if (stat.isDirectory())
      for (const name of readdirSync(path).sort())
        visit(join(path, name), `${relative}/${name}`);
    else if (stat.isFile() && stat.nlink === 1)
      withReleaseFile(path, (fd, opened) => {
        if (
          opened.dev !== stat.dev ||
          opened.ino !== stat.ino ||
          opened.size !== stat.size ||
          opened.mode !== stat.mode
        )
          throw new Error("Bundle file changed while opening.");
        updateReleaseFileDigest(hash, fd, opened.size);
      });
    else throw new Error("Unsupported bundle file or hard link.");
  }
  visit(app, "Situate.app");
  return hash.digest("hex");
}

export async function verifyDirectPayloads(
  directory,
  artifact,
  { execute = run, env, signal } = {},
) {
  let signature;
  for (const item of [
    artifact,
    artifact.updater,
    {
      path: artifact.updater.signaturePath,
      sha256: artifact.updater.signatureSha256,
    },
  ]) {
    if (typeof item.path !== "string" || basename(item.path) !== item.path)
      throw new Error("Invalid direct package path.");
    const path = join(directory, item.path);
    withReleaseFile(path, (fd, stat) => {
      const sidecar =
        item.path === artifact.updater.signaturePath
          ? readReleaseFileDescriptor(fd, stat.size, 1024 * 1024)
          : undefined;
      const digest = sidecar
        ? createHash("sha256").update(sidecar).digest()
        : hashReleaseFileDescriptor(fd, stat.size);
      if (digest.toString("hex") !== item.sha256)
        throw new Error(
          "Final direct package hash does not match the manifest.",
        );
      if (sidecar) signature = sidecar.toString("utf8").trim();
    });
  }
  if (signature !== artifact.updater.signature)
    throw new Error("Updater signature asset differs from the manifest.");
  verifyUpdaterSignature(
    join(directory, artifact.updater.path),
    signature,
    artifact.buildConfiguration.publicKey,
    artifact.version,
  );
  if (process.platform !== "darwin")
    throw new Error("Direct payload verification requires macOS.");
  const temporary = mkdtempSync(join(tmpdir(), "situate-release-verify-"));
  const archive = join(temporary, "archive");
  const mount = join(temporary, "image");
  mkdirSync(archive);
  mkdirSync(mount);
  const options = { env, signal, capture: true };
  let attached = false;
  let mountUncertain = false;
  let failure;
  let cleanupFailure;
  try {
    await execute(
      "python3",
      [
        "-c",
        "import tarfile,sys\nwith tarfile.open(sys.argv[1], 'r:gz') as archive:\n for member in archive.getmembers():\n  if member.name.split('/')[0] != 'Situate.app' or '..' in member.name.split('/') or member.islnk(): raise ValueError('Unexpected archive member')\n archive.extractall(sys.argv[2], filter='data')",
        join(directory, artifact.updater.path),
        archive,
      ],
      options,
    );
    mountUncertain = true;
    await execute(
      "hdiutil",
      [
        "attach",
        "-readonly",
        "-nobrowse",
        "-mountpoint",
        mount,
        join(directory, artifact.path),
      ],
      options,
    );
    attached = true;
    for (const app of [
      join(archive, "Situate.app"),
      join(mount, "Situate.app"),
    ]) {
      if (bundleDigest(app) !== artifact.bundleSha256)
        throw new Error(
          "DMG and updater archive do not contain the same final app.",
        );
      const info = JSON.parse(
        await execute(
          "plutil",
          ["-convert", "json", "-o", "-", join(app, "Contents/Info.plist")],
          options,
        ),
      );
      const identity = JSON.parse(
        readFileSync(
          join(app, "Contents/Resources/situate-distribution.json"),
          "utf8",
        ),
      );
      if (
        info.CFBundleIdentifier !== artifact.identifier ||
        info.CFBundleShortVersionString !== artifact.version ||
        info.LSMinimumSystemVersion !== artifact.minimumSystemVersion ||
        (artifact.buildNumber &&
          info.CFBundleVersion !== artifact.buildNumber) ||
        !isDeepStrictEqual(identity, artifact.buildConfiguration)
      )
        throw new Error("Direct app identity does not match the manifest.");
      const inputs = identity.releaseInputs;
      if (
        inputs &&
        (createHash("sha256")
          .update(
            readFileSync(join(app, "Contents/Resources/release-inputs.json")),
          )
          .digest("hex") !== inputs.sha256 ||
          createHash("sha256")
            .update(
              readFileSync(
                join(app, "Contents/Resources/situate-release-history.json"),
              ),
            )
            .digest("hex") !== inputs.catalogSha256)
      )
        throw new Error(
          "Signed generated release input resources differ from the manifest.",
        );
      verifyReleaseHistoryResource(
        app,
        artifact.releaseContent,
        artifact.version,
        { identity },
      );
      const architectures = (
        await execute(
          "lipo",
          ["-archs", join(app, "Contents/MacOS", info.CFBundleExecutable)],
          options,
        )
      )
        .trim()
        .split(/\s+/)
        .sort();
      if (!isDeepStrictEqual(architectures, [...artifact.architectures].sort()))
        throw new Error("App architectures do not match the manifest.");
      await execute(
        "codesign",
        [
          "--verify",
          "--deep",
          "--strict",
          "--test-requirement",
          `=anchor apple generic and certificate leaf[subject.OU] = "${artifact.teamId}" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists`,
          app,
        ],
        options,
      );
      await execute("xcrun", ["stapler", "validate", app], options);
      await execute("spctl", ["--assess", "--type", "execute", app], options);
    }
    await execute(
      "codesign",
      ["--verify", "--strict", join(directory, artifact.path)],
      options,
    );
    await execute(
      "xcrun",
      ["stapler", "validate", join(directory, artifact.path)],
      options,
    );
    await execute(
      "spctl",
      [
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        join(directory, artifact.path),
      ],
      options,
    );
  } catch (error) {
    failure = error;
    if (mountUncertain && !attached) error.uncertain = true;
  } finally {
    if (attached) {
      try {
        await execute("hdiutil", ["detach", mount], {
          ...options,
          signal: undefined,
        });
        mountUncertain = false;
      } catch (error) {
        error.uncertain = true;
        cleanupFailure = error;
      }
    }
    if (!mountUncertain) rmSync(temporary, { recursive: true, force: true });
  }
  if (failure && cleanupFailure) {
    const error = new AggregateError(
      [failure, cleanupFailure],
      "Direct payload verification and mount cleanup failed",
      { cause: failure },
    );
    error.uncertain = true;
    throw error;
  }
  if (failure) throw failure;
  if (cleanupFailure) throw cleanupFailure;
}
