import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  collectNativeLicenses,
  collectSwiftLicenses,
  crateComponent,
  githubNotices,
  javascriptLicensesPlugin,
  lockedCrates,
  noticeFiles,
  verifyLicenseResources,
} from "./native-licenses.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-licenses-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  return { root, write };
}

test("target graph collection packages own software and artwork notices without selecting unrelated crates", async (t) => {
  const { root, write } = fixture(t);
  write("LICENSE", "Synthetic Situate MIT notice");
  write("LICENSES/CC-BY-4.0.txt", "Synthetic artwork legal text");
  write("client/Cargo.lock", "");
  const calls = [];
  const resources = await collectNativeLicenses({
    root: join(root, "client"),
    collectRuntime: async () => {},
    targets: ["aarch64-apple-ios"],
    output: join(root, "output"),
    async execute(command, args) {
      calls.push({ command, args });
      return args[0] === "metadata"
        ? JSON.stringify({
            packages: [
              { name: "situate-client", version: "1.2.3", source: null },
              {
                name: "unselected-windows-component",
                version: "1.0.0",
                source: "unsupported",
              },
            ],
          })
        : "situate-client v1.2.3";
    },
  });
  assert.equal(
    readFileSync(join(root, "output/situate-software-license.txt"), "utf8"),
    "Synthetic Situate MIT notice",
  );
  assert.equal(
    readFileSync(join(root, "output/situate-artwork-license.txt"), "utf8"),
    "Synthetic artwork legal text",
  );
  assert.ok(
    Object.values(resources).includes(
      "licenses/situate-artwork-attribution.txt",
    ),
  );
  assert.match(
    readFileSync(join(root, "output/situate-artwork-attribution.txt"), "utf8"),
    /Source: https:\/\/github\.com\/getsituate\/situate\/tree\/main\/design\/brand/u,
  );
  assert.ok(
    !readFileSync(
      join(root, "output/third-party-native-notices.txt"),
      "utf8",
    ).includes(root),
  );
  assert.ok(
    calls.every(
      ({ args }) =>
        args.includes("--locked") && args.includes("aarch64-apple-ios"),
    ),
  );
});

test("retains compound and nested notices, not just declared SPDX terms", (t) => {
  const { root, write } = fixture(t);
  write("LICENSE-MIT", "Copyright example\nMIT permission");
  write("LICENSE-APACHE", "Apache terms");
  write("vendor/code/NOTICE", "Extra attribution");
  write("vendor/licenses/extra.txt", "Embedded code terms");
  write("node_modules/ignored/LICENSE", "Not part of this component");
  assert.deepEqual(
    noticeFiles(root)
      .map((file) => file.text)
      .sort(),
    [
      "Apache terms",
      "Copyright example\nMIT permission",
      "Embedded code terms",
      "Extra attribution",
    ].sort(),
  );
  rmSync(join(root, "LICENSE-MIT"));
  rmSync(join(root, "LICENSE-APACHE"));
  rmSync(join(root, "vendor/licenses/extra.txt"));
  assert.throws(() => noticeFiles(root), /Missing dependency license/);
});

test("merges notices from main, worker and auxiliary builds with locked identities", (t) => {
  const { root, write } = fixture(t);
  const packages = {};
  for (const name of ["main", "worker", "native"]) {
    write(
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version: "1.2.3", license: "MIT" }),
    );
    write(`node_modules/${name}/LICENSE`, `${name} copyright and terms`);
    packages[`node_modules/${name}`] = {
      version: "1.2.3",
      resolved: `https://registry.npmjs.org/${name}/-/${name}-1.2.3.tgz`,
    };
  }
  write("package-lock.json", JSON.stringify({ packages }));
  const components = new Map();
  let result;
  for (const name of ["worker", "native", "main"]) {
    const plugin = javascriptLicensesPlugin({ root, components });
    plugin.generateBundle.call(
      {
        emitFile(asset) {
          result = asset.source;
        },
      },
      {},
      {
        entry: {
          type: "chunk",
          moduleIds: [join(root, `node_modules/${name}/index.js`)],
        },
      },
    );
  }
  for (const name of ["main", "worker", "native"])
    assert.ok(result.includes(`${name} copyright and terms`));
  assert.ok(!result.includes(root));
  write(
    "node_modules/main/package.json",
    JSON.stringify({ name: "main", version: "2.0.0" }),
  );
  assert.throws(
    () =>
      javascriptLicensesPlugin({ root }).generateBundle.call(
        { emitFile() {} },
        {},
        {
          entry: {
            type: "chunk",
            moduleIds: [join(root, "node_modules/main/index.js")],
          },
        },
      ),
    /Unlocked/,
  );
});

test("MPL source archives bind to the exact locked crate and packaged bytes", async (t) => {
  const { root, write } = fixture(t);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const source = "registry+https://github.com/rust-lang/crates.io-index";
  const archive = "synthetic exact source archive";
  const checksum = hash(archive);
  const lock = lockedCrates(
    `[[package]]\nname = "example"\nversion = "1.2.3"\nsource = "${source}"\nchecksum = "${checksum}"\n`,
  );
  write("registry/src/index/example-1.2.3/Cargo.toml", "");
  write("registry/src/index/example-1.2.3/src/lib.rs", "original source");
  write(
    "registry/src/index/example-1.2.3/LICENSE",
    "MPL license and copyright",
  );
  write("registry/cache/index/example-1.2.3.crate", archive);
  mkdirSync(join(root, "output"));
  const pkg = {
    name: "example",
    version: "1.2.3",
    source,
    license: "MPL-2.0",
    manifest_path: join(root, "registry/src/index/example-1.2.3/Cargo.toml"),
  };
  const execute = async () =>
    JSON.stringify({
      LICENSE: "MPL license and copyright",
      ".manifest-sha256": hash(""),
      ".source-sha256": {
        LICENSE: hash("MPL license and copyright"),
        "Cargo.toml": hash(""),
        "src/lib.rs": hash("original source"),
      },
    });
  const component = await crateComponent(
    pkg,
    lock,
    join(root, "output"),
    execute,
  );
  assert.equal(
    component.sourceUrl,
    "https://static.crates.io/crates/example/example-1.2.3.crate",
  );
  assert.equal(component.sourceSha256, checksum);
  assert.equal(component.sourceArchive, "example-1.2.3.tar.gz");
  const archivePath = join(root, "output", component.sourceArchive);
  assert.equal(readFileSync(archivePath, "utf8"), archive);
  const resources = { [archivePath]: `licenses/${component.sourceArchive}` };
  for (const macos of [true, false]) {
    const app = join(root, macos ? "mac.app" : "ios.app");
    const destination = join(
      app,
      macos ? "Contents/Resources" : "",
      "licenses",
      component.sourceArchive,
    );
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(archivePath, destination);
    verifyLicenseResources(app, resources, { macos });
    writeFileSync(destination, "wrong source");
    assert.throws(
      () => verifyLicenseResources(app, resources, { macos }),
      /missing or changed/,
    );
  }
  write("registry/src/index/example-1.2.3/src/lib.rs", "modified MPL source");
  await assert.rejects(
    crateComponent(pkg, lock, join(root, "output"), execute),
    /MPL source differs/,
  );
  write("registry/src/index/example-1.2.3/src/lib.rs", "original source");
  write("registry/cache/index/example-1.2.3.crate", "other version");
  await assert.rejects(
    crateComponent(pkg, lock, join(root, "output"), execute),
    /source checksum mismatch/,
  );
  write("registry/cache/index/example-1.2.3.crate", archive);
  write("registry/src/index/example-1.2.3/LICENSE", "changed notice");
  await assert.rejects(
    crateComponent(pkg, lock, join(root, "output"), execute),
    /notice checksum mismatch/,
  );
});

test("libgit2-sys source must match its locked archive without bundling that archive", async (t) => {
  const { root, write } = fixture(t);
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const source = "registry+https://github.com/rust-lang/crates.io-index";
  const archive = "Synthetic exact libgit2-sys archive";
  const notice = "Synthetic libgit2 linking exception notice";
  const directory = "registry/src/index/libgit2-sys-1.2.3";
  write(`${directory}/Cargo.toml`, "Synthetic wrapper manifest");
  write(`${directory}/libgit2/COPYING`, notice);
  write(`${directory}/libgit2/src/example.c`, "Original vendored C source");
  write("registry/cache/index/libgit2-sys-1.2.3.crate", archive);
  mkdirSync(join(root, "output"));
  const checksums = new Map([[`libgit2-sys@1.2.3@${source}`, hash(archive)]]);
  const pkg = {
    name: "libgit2-sys",
    version: "1.2.3",
    source,
    license: "MIT OR Apache-2.0",
    manifest_path: join(root, directory, "Cargo.toml"),
  };
  const execute = async () =>
    JSON.stringify({
      ".manifest-sha256": hash("Synthetic wrapper manifest"),
      "libgit2/COPYING": notice,
      ".source-sha256": {
        "Cargo.toml": hash("Synthetic wrapper manifest"),
        "libgit2/COPYING": hash(notice),
        "libgit2/src/example.c": hash("Original vendored C source"),
      },
    });
  const component = await crateComponent(
    pkg,
    checksums,
    join(root, "output"),
    execute,
  );
  assert.equal(component.sourceArchive, undefined);
  assert.deepEqual(readdirSync(join(root, "output")), []);
  assert.equal(component.notices[0].text, notice);
  write(`${directory}/libgit2/src/example.c`, "Modified vendored C source");
  await assert.rejects(
    crateComponent(pkg, checksums, join(root, "output"), execute),
    /Rust source differs from the locked archive: libgit2-sys/,
  );
  write(`${directory}/libgit2/src/example.c`, "Original vendored C source");
  write(`${directory}/libgit2/src/extra.c`, "Additional vendored source");
  await assert.rejects(
    crateComponent(pkg, checksums, join(root, "output"), execute),
    /Rust source has unrecognized files: libgit2-sys/,
  );
});

test("fresh Swift collection requires reviewed pin and notice bindings, not build caches", (t) => {
  const { root, write } = fixture(t);
  const notice = "Synthetic runtime license and nested attribution";
  const pin = {
    identity: "example",
    kind: "remoteSourceControl",
    location: "https://github.com/example/runtime.git",
    state: { revision: "a".repeat(40), version: "1.2.3" },
  };
  const reviewed = {
    example: {
      ...pin.state,
      location: pin.location,
      noticeFile: "NOTICES.txt",
      noticeSha256: createHash("sha256").update(notice).digest("hex"),
    },
  };
  write("Package.resolved", JSON.stringify({ pins: [pin] }));
  write("NOTICES.txt", notice);
  const components = collectSwiftLicenses(root, reviewed);
  assert.equal(components.length, 1);
  assert.equal(components[0].notices[0].text, notice);
  assert.equal(
    components[0].source,
    `https://github.com/example/runtime/tree/${"a".repeat(40)}`,
  );
  assert.equal(components[0].sourceArchive, undefined);
  pin.state.revision = "b".repeat(40);
  write("Package.resolved", JSON.stringify({ pins: [pin] }));
  assert.throws(() => collectSwiftLicenses(root, reviewed), /Unreviewed Swift/);
  pin.state.revision = "a".repeat(40);
  write("Package.resolved", JSON.stringify({ pins: [pin] }));
  write("NOTICES.txt", "Changed attribution");
  assert.throws(
    () => collectSwiftLicenses(root, reviewed),
    /notice binding changed/,
  );
  write("Package.resolved", JSON.stringify({ pins: [] }));
  assert.throws(
    () => collectSwiftLicenses(root, reviewed),
    /Missing or duplicate/,
  );
});

test("upstream supplements use archive-bound revisions and retain root and nested license files", async () => {
  const urls = [];
  const notices = await githubNotices(
    "https://github.com/synthetic/licenses",
    { git: { sha1: "c".repeat(40) }, path_in_vcs: "crates/example" },
    async (url) => {
      urls.push(url);
      return {
        ok: true,
        json: async () => ({
          tree: [
            { type: "blob", path: "LICENSE" },
            { type: "blob", path: "crates/example/vendor/NOTICE" },
            { type: "blob", path: "LICENSES/MIT.txt" },
            { type: "blob", path: "crates/legal/terms.txt" },
            { type: "blob", path: "unrelated/LICENSE" },
          ],
        }),
        text: async () => "Exact upstream attribution",
      };
    },
  );
  assert.equal(notices.length, 4);
  assert.ok(urls.every((url) => url.includes("c".repeat(40))));
  assert.ok(!urls.some((url) => url.includes("unrelated")));
  await assert.rejects(
    githubNotices("https://github.com/synthetic/licenses", {
      git: { sha1: "main" },
    }),
    /exact upstream/,
  );
});
