import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  emptyReleaseHistory,
  compileBuildReleaseHistory,
  releaseContent,
  releaseHistoryAsset,
  releaseHistoryBytes,
  releaseHistoryDigest,
  releaseHistoryPlugin,
  validateReleaseContent,
  verifyReleaseHistoryResource,
} from "./release-history.mjs";

const catalog = () => ({
  schemaVersion: 1,
  installedVersion: "1.2.3",
  releases: [
    {
      version: "1.2.3",
      locales: {
        en: {
          title: "Release",
          entries: [
            {
              id: "navigation",
              type: "changed",
              platforms: ["macos", "ios"],
              title: "Navigation",
              paragraphs: ["Open recent views."],
            },
          ],
        },
        de: {
          title: "Release",
          entries: [
            {
              id: "navigation",
              type: "changed",
              platforms: ["macos", "ios"],
              title: "Navigation",
              paragraphs: ["Open recent views."],
            },
          ],
        },
      },
    },
  ],
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-release-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "Situate.app");
  mkdirSync(join(app, "Contents/Resources"), { recursive: true });
  const resource = join(app, "Contents/Resources", releaseHistoryAsset);
  return { root, app, resource };
}

test("application windows can read the installed native version for release history", () => {
  const capability = JSON.parse(
    readFileSync(
      new URL("../app/src-tauri/capabilities/main.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(capability.permissions.includes("core:app:allow-version"));
});

test("catalog asset uses canonical bytes and the shared semantic digest excludes its newline", () => {
  const value = catalog();
  const bytes = releaseHistoryBytes(value);
  assert.equal(
    bytes,
    releaseHistoryBytes({
      releases: value.releases,
      installedVersion: "1.2.3",
      schemaVersion: 1,
    }),
  );
  assert.equal(
    releaseHistoryDigest(value),
    createHash("sha256").update(bytes.slice(0, -1)).digest("hex"),
  );
  assert.notEqual(
    releaseHistoryDigest(value),
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.deepEqual(releaseContent(value), {
    version: "1.2.3",
    sha256: releaseHistoryDigest(value),
    locales: ["de", "en"],
  });
});

test("Vite compiles against the repository root, defines data and emits the identical catalog", async () => {
  const value = catalog();
  const plugin = releaseHistoryPlugin({
    repoRoot: "/synthetic/repo",
    version: "1.2.3",
    environment: {},
    compile(root, version) {
      assert.equal(root, "/synthetic/repo");
      assert.equal(version, "1.2.3");
      return value;
    },
  });
  const config = await plugin.config({}, { command: "build" });
  assert.deepEqual(
    JSON.parse(config.define.__SITUATE_RELEASE_HISTORY__),
    value,
  );
  const emitted = [];
  plugin.generateBundle.call({ emitFile: (item) => emitted.push(item) });
  assert.deepEqual(emitted, [
    {
      type: "asset",
      fileName: releaseHistoryAsset,
      source: releaseHistoryBytes(value),
    },
  ]);
});

test("Vite reports malformed existing content instead of silently dropping it", async () => {
  const plugin = releaseHistoryPlugin({
    environment: {},
    compile() {
      throw new Error("Invalid release content");
    },
  });
  await assert.rejects(
    plugin.config({}, { command: "build" }),
    /Invalid release content/,
  );
  assert.deepEqual(emptyReleaseHistory("1.2.3"), {
    schemaVersion: 1,
    installedVersion: "1.2.3",
    releases: [],
  });
});

test("non-distribution builds and development accept unknown history without a Git checkout", async (t) => {
  const { root } = fixture(t);
  mkdirSync(join(root, "releases"));
  mkdirSync(join(root, "client/packages/localization"), { recursive: true });
  writeFileSync(
    join(root, "client/packages/localization/locales.json"),
    JSON.stringify({ source: "en", locales: ["en", "de"] }),
  );
  for (const command of ["serve", "build"]) {
    const plugin = releaseHistoryPlugin({
      repoRoot: root,
      version: "1.2.3",
      environment: {},
    });
    const config = await plugin.config({}, { command });
    assert.deepEqual(
      JSON.parse(config.define.__SITUATE_RELEASE_HISTORY__),
      emptyReleaseHistory("1.2.3"),
    );
  }
});

test("Apple frontend input is pinned by native version, digest and exact canonical bytes", async (t) => {
  const { root } = fixture(t);
  const path = join(root, releaseHistoryAsset);
  const value = catalog();
  const environment = {
    SITUATE_RELEASE_HISTORY_FILE: path,
    SITUATE_RELEASE_HISTORY_SHA256: releaseHistoryDigest(value),
  };
  writeFileSync(path, releaseHistoryBytes(value));
  const plugin = () =>
    releaseHistoryPlugin({
      environment,
      version: "1.2.3",
      compile() {
        assert.fail("Pinned input must not be recompiled");
      },
    });
  assert.deepEqual(
    JSON.parse(
      (await plugin().config({}, { command: "build" })).define
        .__SITUATE_RELEASE_HISTORY__,
    ),
    value,
  );
  for (const bytes of [
    JSON.stringify(value),
    releaseHistoryBytes({ ...value, installedVersion: "1.2.4" }),
    releaseHistoryBytes({ ...value, releases: [] }),
  ]) {
    writeFileSync(path, bytes);
    await assert.rejects(
      plugin().config({}, { command: "build" }),
      /does not match/,
    );
  }
});

test("signed macOS and iOS resources bind actual payload notes to metadata and native identity", (t) => {
  const { app, resource } = fixture(t);
  const value = catalog();
  const binding = releaseContent(value);
  writeFileSync(resource, releaseHistoryBytes(value));
  assert.deepEqual(
    verifyReleaseHistoryResource(app, binding, "1.2.3", {
      identity: { releaseContent: binding },
    }),
    value,
  );
  assert.throws(
    () => verifyReleaseHistoryResource(app, binding, "1.2.4"),
    /binding/,
  );
  assert.throws(
    () => verifyReleaseHistoryResource(app, undefined, "1.2.3"),
    /omits/,
  );
  assert.throws(
    () => verifyReleaseHistoryResource(app, binding, "1.2.3", { identity: {} }),
    /does not match/,
  );
  const changed = catalog();
  changed.releases[0].locales.en.title = "Changed after build";
  writeFileSync(resource, releaseHistoryBytes(changed));
  assert.throws(
    () => verifyReleaseHistoryResource(app, binding, "1.2.3"),
    /does not match/,
  );
  writeFileSync(join(app, releaseHistoryAsset), releaseHistoryBytes(value));
  assert.deepEqual(
    verifyReleaseHistoryResource(app, binding, "1.2.3", { macos: false }),
    value,
  );
});

test("only retained payloads without a resource or signed binding allow legacy absence", (t) => {
  const { app } = fixture(t);
  const binding = releaseContent(catalog());
  assert.equal(
    verifyReleaseHistoryResource(app, undefined, "0.1.1", {
      identity: { distribution: "direct" },
    }),
    undefined,
  );
  assert.throws(
    () => verifyReleaseHistoryResource(app, binding, "1.2.3"),
    /missing/,
  );
  assert.throws(
    () =>
      verifyReleaseHistoryResource(app, undefined, "1.2.3", {
        identity: { releaseContent: binding },
      }),
    /missing/,
  );
});

test("bundle resources cannot substitute symlinks to checkout content", (t) => {
  const { root, app, resource } = fixture(t);
  const value = catalog();
  const external = join(root, "checkout.json");
  writeFileSync(external, releaseHistoryBytes(value));
  symlinkSync(external, resource);
  assert.throws(
    () => verifyReleaseHistoryResource(app, releaseContent(value), "1.2.3"),
    /regular bundle resource/,
  );
  assert.equal(readFileSync(external, "utf8"), releaseHistoryBytes(value));
});

test("generated direct builds reuse the frontend catalog bytes without committed version pins", async (t) => {
  const { root } = fixture(t);
  const value = catalog();
  value.installedVersion = "2026.11.3";
  value.releases.unshift({
    version: "2026.11.3",
    locales: {
      en: { title: "Changes", entries: [] },
      de: { title: "Änderungen", entries: [] },
    },
  });
  const file = join(root, "generated.json");
  writeFileSync(file, releaseHistoryBytes(value));
  const environment = {
    SITUATE_RELEASE_VERSION: value.installedVersion,
    SITUATE_RELEASE_HISTORY_FILE: file,
    SITUATE_RELEASE_HISTORY_SHA256: releaseHistoryDigest(value),
  };
  assert.deepEqual(
    await compileBuildReleaseHistory(
      "/no/source/checkout",
      value.installedVersion,
      { distribution: "direct", environment },
    ),
    value,
  );
  const plugin = releaseHistoryPlugin({
    repoRoot: "/no/source/checkout",
    version: value.installedVersion,
    environment,
  });
  const result = await plugin.config();
  assert.deepEqual(
    JSON.parse(result.define.__SITUATE_RELEASE_HISTORY__),
    value,
  );
  const emitted = [];
  plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) });
  assert.equal(emitted[0].source, readFileSync(file, "utf8"));
  assert.equal(Object.hasOwn(value.releases[0], "date"), false);
  await assert.rejects(
    () =>
      releaseHistoryPlugin({
        version: value.installedVersion,
        environment: { SITUATE_RELEASE_VERSION: value.installedVersion },
      }).config(),
    /bound history/,
  );
  const future = structuredClone(value);
  future.releases.push({ ...future.releases[0], version: "2027.1.1" });
  writeFileSync(file, releaseHistoryBytes(future));
  await assert.rejects(
    () =>
      compileBuildReleaseHistory(root, value.installedVersion, {
        distribution: "direct",
        environment: {
          ...environment,
          SITUATE_RELEASE_HISTORY_SHA256: releaseHistoryDigest(future),
        },
      }),
    /not newer/,
  );
});

test("binding validators reject missing current notes and inconsistent locale inventories", () => {
  assert.throws(
    () => releaseContent(emptyReleaseHistory("1.2.3")),
    /installed version/,
  );
  const value = catalog();
  value.releases.push({
    version: "1.2.2",
    locales: { en: value.releases[0].locales.en },
  });
  assert.throws(() => releaseContent(value), /locale inventory/);
  for (const locales of [[], ["en", "de"], ["de", "de"], ["../en"], [null]])
    assert.throws(
      () =>
        validateReleaseContent(
          { version: "1.2.3", sha256: "a".repeat(64), locales },
          "1.2.3",
        ),
      /binding/,
    );
});
