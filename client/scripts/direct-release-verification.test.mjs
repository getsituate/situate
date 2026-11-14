import assert from "node:assert/strict";
import {
  cpSync,
  linkSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { qualificationFixture } from "../../tools/release-qualification-fixture.mjs";
import {
  bundleDigest,
  verifyDirectPayloads,
} from "./direct-release-verification.mjs";
import { releaseContent } from "./release-history.mjs";

test("bundle identity covers bytes, modes and links and rejects hard-linked data", (t) => {
  const { directory } = qualificationFixture(t);
  const app = join(directory, "Situate.app");
  mkdirSync(app);
  const path = join(app, "data");
  writeFileSync(path, "original");
  const original = bundleDigest(app);
  writeFileSync(path, "modified");
  assert.notEqual(bundleDigest(app), original);
  symlinkSync("data", join(app, "alias"));
  const linked = bundleDigest(app);
  assert.notEqual(linked, original);
  linkSync(path, join(app, "hard-link"));
  assert.throws(() => bundleDigest(app), /hard link/);
});

test("direct payload validation rejects modified package bytes before any native commands", async (t) => {
  const { directory, artifact } = qualificationFixture(t);
  writeFileSync(join(directory, artifact.updater.path), "changed");
  let calls = 0;
  await assert.rejects(
    verifyDirectPayloads(directory, artifact, {
      execute: async () => {
        calls++;
      },
    }),
    /hash does not match/,
  );
  assert.equal(calls, 0);
});

test("direct payloads require the exact same final app and signed generated resources", async (t) => {
  const { directory, artifact, releaseInputs } = qualificationFixture(t);
  const app = join(directory, "source/Situate.app");
  mkdirSync(join(app, "Contents/Resources"), { recursive: true });
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  artifact.releaseContent = releaseContent(releaseInputs.catalog);
  artifact.buildConfiguration.releaseContent = artifact.releaseContent;
  const info = {
    CFBundleIdentifier: artifact.identifier,
    CFBundleShortVersionString: artifact.version,
    CFBundleVersion: artifact.buildNumber,
    LSMinimumSystemVersion: artifact.minimumSystemVersion,
    CFBundleExecutable: "Situate",
  };
  writeFileSync(join(app, "Contents/Info.plist"), JSON.stringify(info));
  writeFileSync(join(app, "Contents/MacOS/Situate"), "synthetic Mach-O");
  for (const name of ["release-inputs.json", "situate-release-history.json"])
    cpSync(join(directory, name), join(app, "Contents/Resources", name));
  writeFileSync(
    join(app, "Contents/Resources/situate-distribution.json"),
    JSON.stringify(artifact.buildConfiguration),
  );
  artifact.bundleSha256 = bundleDigest(app);
  let detach = 0;
  let changed = false;
  const execute = async (command, args) => {
    if (command === "python3") {
      cpSync(app, join(args.at(-1), "Situate.app"), { recursive: true });
      if (changed)
        writeFileSync(
          join(args.at(-1), "Situate.app/Contents/MacOS/Situate"),
          "different final app",
        );
    }
    if (command === "hdiutil" && args[0] === "attach")
      cpSync(app, join(args[args.indexOf("-mountpoint") + 1], "Situate.app"), {
        recursive: true,
      });
    if (command === "hdiutil" && args[0] === "detach") detach++;
    if (command === "plutil")
      return readFileSync(join(app, "Contents/Info.plist"), "utf8");
    if (command === "lipo") return "x86_64 arm64";
    return "";
  };
  if (process.platform !== "darwin") {
    await assert.rejects(
      verifyDirectPayloads(directory, artifact, { execute }),
      /requires macOS/,
    );
    return;
  }
  await verifyDirectPayloads(directory, artifact, { execute });
  assert.equal(detach, 1);
  changed = true;
  await assert.rejects(
    verifyDirectPayloads(directory, artifact, { execute }),
    /same final app/,
  );
  assert.equal(detach, 2);
});
