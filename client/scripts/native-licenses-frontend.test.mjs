import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  bindNativeLicenses,
  combinedLicenseText,
  frontendLicensesPlugin,
  verifyFrontendLicenses,
} from "./native-licenses-frontend.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "situate-license-disclosure-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "client");
  const write = (path, text) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), text);
  };
  write("LICENSE", "Synthetic own MIT notice");
  write("LICENSES/CC-BY-4.0.txt", "Synthetic CC BY license");
  write(
    "client/app/public/licenses/adapted.txt",
    "Adapted component copyright and terms",
  );
  write(
    "client/app/src/ai/assets/providers/SOURCES.md",
    "Icon copyright and terms",
  );
  write(
    "native/third-party-native-notices.txt",
    "Rust and Swift notices\nhttps://static.crates.io/crates/example/example-1.2.3.crate\nSHA-256: synthetic",
  );
  write(
    "native/rust-runtime-notices.txt",
    "Synthetic Rust standard library and Unicode notice",
  );
  const resources = {
    [join(directory, "native/third-party-native-notices.txt")]:
      "licenses/third-party-native-notices.txt",
    [join(directory, "native/rust-runtime-notices.txt")]:
      "licenses/rust-runtime-notices.txt",
  };
  const env = bindNativeLicenses(join(directory, "native"), resources, [
    "aarch64-apple-ios",
  ]);
  const javascript =
    "Third-party software notices\nMain, worker and auxiliary script copyright and terms";
  return { root, write, directory, env, javascript };
}

test("Vite emits a combined plain-text asset with source access and original notices", (t) => {
  const { root, env, javascript, directory } = fixture(t);
  const plugin = frontendLicensesPlugin({ root, environment: env });
  let asset;
  plugin.generateBundle.call(
    {
      emitFile(value) {
        asset = value;
      },
    },
    {},
    { "third-party-js-notices.txt": { type: "asset", source: javascript } },
  );
  assert.equal(asset.fileName, "situate-licenses.txt");
  for (const text of [
    "Synthetic own MIT notice",
    "Synthetic CC BY license",
    "Situate contributors",
    "https://github.com/getsituate/situate/tree/main/design/brand",
    "Adapted component copyright",
    "Icon copyright",
    "Main, worker and auxiliary",
    "Rust and Swift",
    "https://static.crates.io/crates/example/example-1.2.3.crate",
    "SHA-256: synthetic",
  ])
    assert.ok(asset.source.includes(text), text);
  assert.ok(!asset.source.includes(directory));
});

test("Apple frontend rejects missing, changed and wrong-target material", (t) => {
  const { root, env, javascript, write } = fixture(t);
  assert.throws(
    () =>
      combinedLicenseText(root, javascript, {
        SITUATE_DISTRIBUTION: "external",
      }),
    /requires bound/,
  );
  assert.throws(
    () =>
      combinedLicenseText(root, javascript, {
        ...env,
        SITUATE_LICENSE_TARGETS: '["x86_64-apple-darwin"]',
      }),
    /targets do not match/,
  );
  assert.throws(
    () =>
      combinedLicenseText(root, javascript, {
        ...env,
        SITUATE_NATIVE_LICENSE_SHA256: "changed",
      }),
    /binding changed/,
  );
  write("native/third-party-native-notices.txt", "Changed attribution");
  assert.throws(
    () => combinedLicenseText(root, javascript, env),
    /material changed/,
  );
  assert.throws(
    () => combinedLicenseText(root, ""),
    /Missing bundled JavaScript/,
  );
});

test("release validation binds the frontend copy to the native and JavaScript resources", (t) => {
  const { root, env, javascript, write } = fixture(t);
  const text = combinedLicenseText(root, javascript, env);
  write("client/app/dist/third-party-js-notices.txt", javascript);
  write("client/app/dist/situate-licenses.txt", text);
  verifyFrontendLicenses(root, env);
  write(
    "client/app/dist/situate-licenses.txt",
    "Stale disclosure from another target",
  );
  assert.throws(
    () => verifyFrontendLicenses(root, env),
    /does not match this build/,
  );
  write("client/app/dist/situate-licenses.txt", text);
  write(
    "client/app/dist/third-party-js-notices.txt",
    javascript + "\nAnother bundled component",
  );
  assert.throws(
    () => verifyFrontendLicenses(root, env),
    /does not match this build/,
  );
  assert.equal(
    readFileSync(join(root, "app/dist/situate-licenses.txt"), "utf8"),
    text,
  );
});
