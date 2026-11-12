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
import { join } from "node:path";
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
    else if (stat.isFile() && stat.nlink === 1) hash.update(readFileSync(path));
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
  if (process.platform !== "darwin")
    throw new Error("Direct payload verification requires macOS.");
  const temporary = mkdtempSync(join(tmpdir(), "situate-release-verify-"));
  const archive = join(temporary, "archive");
  const mount = join(temporary, "image");
  mkdirSync(archive);
  mkdirSync(mount);
  const options = { env, signal, capture: true };
  let attached = false;
  try {
    await execute(
      "python3",
      [
        "-c",
        "import tarfile,sys\nwith tarfile.open(sys.argv[1], 'r:gz') as archive:\n for member in archive.getmembers():\n  if member.name.split('/')[0] != 'Situate.app' or member.islnk(): raise ValueError('Unexpected archive member')\n archive.extractall(sys.argv[2], filter='data')",
        join(directory, artifact.updater.path),
        archive,
      ],
      options,
    );
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
        !isDeepStrictEqual(identity, artifact.buildConfiguration)
      )
        throw new Error("Direct app identity does not match the manifest.");
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
  } finally {
    if (attached)
      await execute("hdiutil", ["detach", mount], {
        ...options,
        signal: undefined,
      });
    rmSync(temporary, { recursive: true, force: true });
  }
}
