import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  rmSync,
  linkSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { qualificationFixture } from "../../tools/release-qualification-fixture.mjs";
import {
  bundleDigest,
  verifyDirectPayloads,
} from "./direct-release-verification.mjs";
import { releaseContent } from "./release-history.mjs";
import { createQualificationProcess } from "./final-artifact-process.mjs";

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

function payloadFixture(t) {
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
  return { directory, artifact, app };
}

test("direct payloads require the exact same final app and signed generated resources", async (t) => {
  const { directory, artifact, app } = payloadFixture(t);
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

function syntheticMac(t) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  t.after(() => Object.defineProperty(process, "platform", platform));
}

test("unknown attach retains the mount path and original bounded-call error without attempting removal or detach", async (t) => {
  syntheticMac(t);
  const { directory, artifact } = qualificationFixture(t);
  const timeout = new AbortController();
  const reason = new Error("synthetic attach timeout");
  let mount;
  let nativeFailure;
  let detaches = 0;
  const bounded = createQualificationProcess({
    deadline: () => timeout.signal,
    execute: async (command, args, { signal }) => {
      if (command !== "hdiutil") return "";
      if (args[0] === "detach") detaches++;
      else {
        mount = args[args.indexOf("-mountpoint") + 1];
        t.after(() => rmSync(dirname(mount), { recursive: true, force: true }));
        writeFileSync(
          join(mount, "mounted-data"),
          "retain synthetic mount contents",
        );
        timeout.abort(reason);
        signal.throwIfAborted();
      }
      return "";
    },
  });
  await assert.rejects(
    verifyDirectPayloads(directory, artifact, {
      execute: async (...args) => {
        try {
          return await bounded(...args);
        } catch (error) {
          nativeFailure = error;
          throw error;
        }
      },
    }),
    (error) => {
      assert.equal(error, nativeFailure);
      assert.equal(error.cause, reason);
      assert.equal(error.qualificationStatus, "timeout");
      assert.equal(error.qualificationCommand, "mount");
      assert.equal(error.uncertain, true);
      return true;
    },
  );
  assert.equal(detaches, 0);
  assert.equal(
    readFileSync(join(mount, "mounted-data"), "utf8"),
    "retain synthetic mount contents",
  );
  assert.equal(existsSync(dirname(mount)), true);
});

test("failed detach retains the temporary tree and preserves both primary and cleanup error identities", async (t) => {
  syntheticMac(t);
  const { directory, artifact, app } = payloadFixture(t);
  const abort = new AbortController();
  const primary = new Error("synthetic validation failure");
  const cleanup = new Error("synthetic detach failure");
  let mount;
  const failures = [];
  const budgets = [];
  const bounded = createQualificationProcess({
    deadline: (ms) => {
      budgets.push(ms);
      return AbortSignal.timeout(ms);
    },
    execute: async (command, args, options) => {
      if (command === "python3")
        cpSync(app, join(args.at(-1), "Situate.app"), { recursive: true });
      if (command === "hdiutil" && args[0] === "attach") {
        mount = args[args.indexOf("-mountpoint") + 1];
        t.after(() => rmSync(dirname(mount), { recursive: true, force: true }));
        cpSync(app, join(mount, "Situate.app"), { recursive: true });
      }
      if (command === "plutil") {
        abort.abort(primary);
        throw primary;
      }
      if (command === "hdiutil" && args[0] === "detach") {
        assert.equal(options.signal.aborted, false);
        throw cleanup;
      }
      return "";
    },
  });
  await assert.rejects(
    verifyDirectPayloads(directory, artifact, {
      signal: abort.signal,
      execute: async (...args) => {
        try {
          return await bounded(...args);
        } catch (error) {
          failures.push(error);
          throw error;
        }
      },
    }),
    (error) => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors, failures);
      assert.equal(error.cause, failures[0]);
      assert.equal(error.errors[0].cause, primary);
      assert.equal(error.errors[1].cause, cleanup);
      assert.equal(error.uncertain, true);
      return true;
    },
  );
  assert.equal(budgets.at(-1), 30_000);
  assert.equal(
    existsSync(join(mount, "Situate.app/Contents/MacOS/Situate")),
    true,
  );
  assert.equal(existsSync(join(dirname(mount), "archive/Situate.app")), true);
});

test("confirmed bounded detach removes the owned temporary tree after successful verification", async (t) => {
  syntheticMac(t);
  const { directory, artifact, app } = payloadFixture(t);
  let mount;
  let detaches = 0;
  const budgets = [];
  const execute = createQualificationProcess({
    deadline: (ms) => {
      budgets.push(ms);
      return AbortSignal.timeout(ms);
    },
    execute: async (command, args) => {
      if (command === "python3")
        cpSync(app, join(args.at(-1), "Situate.app"), { recursive: true });
      if (command === "hdiutil" && args[0] === "attach") {
        mount = args[args.indexOf("-mountpoint") + 1];
        t.after(() => rmSync(dirname(mount), { recursive: true, force: true }));
        cpSync(app, join(mount, "Situate.app"), { recursive: true });
      }
      if (command === "hdiutil" && args[0] === "detach") detaches++;
      if (command === "plutil")
        return readFileSync(join(app, "Contents/Info.plist"), "utf8");
      if (command === "lipo") return "x86_64 arm64";
      return "";
    },
  });
  await verifyDirectPayloads(directory, artifact, { execute });
  assert.equal(detaches, 1);
  assert.equal(budgets.at(-1), 30_000);
  assert.equal(existsSync(dirname(mount)), false);
});
