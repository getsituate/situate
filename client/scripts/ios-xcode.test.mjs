import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import {
  sessionPaths,
  simulatorTarget,
  acquireSession,
  assertLocalPath,
  buildEnvironment,
  prepareProjectSpec,
  developmentTeam,
  syncAppIcons,
  checkPrerequisites,
  openIosXcode,
} from "./ios-xcode.mjs";
import { buildFromXcode, finishBuild } from "./ios-xcode-build.mjs";
import { acquireIosProject } from "./ios-project-lock.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-ios-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = sessionPaths(root);
  const catalog = join(paths.apple, "Assets.xcassets/AppIcon.appiconset");
  mkdirSync(catalog, { recursive: true });
  mkdirSync(join(paths.native, "icons/ios"), { recursive: true });
  writeFileSync(
    join(catalog, "Contents.json"),
    JSON.stringify({ images: [{ filename: "AppIcon-512@2x.png" }] }),
  );
  writeFileSync(
    join(paths.native, "icons/ios/AppIcon-512@2x.png"),
    "situate-icon",
  );
  writeFileSync(join(catalog, "AppIcon-512@2x.png"), "template-icon");
  return paths;
}

const spec = `name: situate-client
settingGroups:
  app:
    base:
      PRODUCT_NAME: Situate
targets:
  situate-client_iOS:
    scheme:
      environmentVariables:
        RUST_LOG: info
    sources:
      - path: Sources
      - path: Externals
    dependencies:
      - framework: libapp.a
        embed: false
      - sdk: UIKit.framework
    preBuildScripts:
      - script: |
          npm run -- tauri ios xcode-script -v
        name: Build Rust Code
        basedOnDependencyAnalysis: false
`;

test("app icons replace stale generated copies and refresh after source changes", (t) => {
  const paths = fixture(t);
  const source = join(paths.native, "icons/ios/AppIcon-512@2x.png");
  const destination = join(
    paths.apple,
    "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  );
  const manifest = join(
    paths.apple,
    "Assets.xcassets/AppIcon.appiconset/Contents.json",
  );
  const before = readFileSync(manifest, "utf8");
  syncAppIcons(paths);
  assert.equal(readFileSync(destination, "utf8"), "situate-icon");
  syncAppIcons(paths);
  assert.equal(readFileSync(manifest, "utf8"), before);
  writeFileSync(source, "updated-icon");
  syncAppIcons(paths);
  assert.equal(readFileSync(destination, "utf8"), "updated-icon");
  rmSync(source);
  assert.throws(() => syncAppIcons(paths), /ENOENT/);
});

test("app icon catalogs reject empty lists and paths outside the catalog", (t) => {
  const paths = fixture(t);
  const manifest = join(
    paths.apple,
    "Assets.xcassets/AppIcon.appiconset/Contents.json",
  );
  for (const images of [[], [{ filename: "../outside.png" }], [{}]]) {
    writeFileSync(manifest, JSON.stringify({ images }));
    assert.throws(() => syncAppIcons(paths), /icon catalog/);
  }
});

test(
  "app icon synchronization rejects symlink destinations",
  { skip: process.platform === "win32" },
  (t) => {
    const paths = fixture(t);
    const destination = join(
      paths.apple,
      "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
    );
    rmSync(destination);
    symlinkSync(join(paths.root, "outside.png"), destination);
    assert.throws(() => syncAppIcons(paths), /symbolic link/);
  },
);

test("canonical checkout identity is stable, distinct, and independent of cwd", (t) => {
  const one = fixture(t);
  const two = fixture(t);
  assert.equal(sessionPaths(join(one.root, ".")).id, one.id);
  assert.notEqual(two.id, one.id);
  assert.equal(one.output, join(one.root, "target/ios-xcode"));
});

test("simulator targets follow the Rust host, not the Node architecture", () => {
  assert.equal(
    simulatorTarget("aarch64-apple-darwin"),
    "aarch64-apple-ios-sim",
  );
  assert.equal(simulatorTarget("x86_64-apple-darwin"), "x86_64-apple-ios");
  assert.throws(
    () => simulatorTarget("aarch64-unknown-linux-gnu"),
    /Unsupported Rust host/,
  );
});

test("session locks reject duplicate and stale sessions without deleting their owner", (t) => {
  const paths = fixture(t);
  const release = acquireSession(paths);
  const owner = join(paths.output, "session.lock/owner.json");
  const before = readFileSync(owner, "utf8");
  assert.throws(() => acquireSession(paths), /session lock exists/);
  assert.equal(readFileSync(owner, "utf8"), before);
  release();
  acquireSession(paths)();
});

test(
  "generated outputs reject outside paths, symlinks and dangling symlinks",
  { skip: process.platform === "win32" },
  (t) => {
    const paths = fixture(t);
    assert.throws(
      () => assertLocalPath(paths.root, join(paths.root, "../elsewhere")),
      /inside/,
    );
    symlinkSync(join(paths.root, "missing"), join(paths.root, "target"));
    assert.throws(() => acquireSession(paths), /symbolic link/);
    assert.throws(
      () => assertLocalPath(paths.root, join(paths.root, "target/more")),
      /symbolic link/,
    );
  },
);

test("build environment isolates target output and clears inherited mobile configuration", (t) => {
  const paths = fixture(t);
  const env = buildEnvironment(
    {
      PATH: "/usr/bin",
      TAURI_CONFIG: "old",
      TAURI_DEV_HOST: "remote",
      APPLE_SIGNING_IDENTITY: "old",
      RUSTUP_TOOLCHAIN: "nightly",
      CARGO_BUILD_TARGET: "wrong",
      CARGO_TARGET_DIR: "/shared",
      CARGO_PROFILE_DEV_DEBUG: "0",
    },
    paths,
    "/pinned/bin",
  );
  assert.ok(env.PATH.startsWith("/pinned/bin:"));
  assert.equal(env.CARGO_TARGET_DIR, join(paths.output, "cargo"));
  assert.equal(env.CARGO_PROFILE_DEV_DEBUG, "0");
  for (const key of [
    "TAURI_CONFIG",
    "TAURI_DEV_HOST",
    "APPLE_SIGNING_IDENTITY",
    "RUSTUP_TOOLCHAIN",
    "CARGO_BUILD_TARGET",
  ])
    assert.equal(env[key], undefined);
});

test("generated Xcode integration is deterministic and quotes executable paths", (t) => {
  const paths = {
    ...fixture(t),
    root: join("/tmp", "work tree's", "client"),
  };
  const node = "/node with spaces' and quotes/node";
  const prepared = prepareProjectSpec(spec, paths, node);
  assert.equal(prepareProjectSpec(spec, paths, node), prepared);
  assert.match(prepared, /runPostActionsOnFailure: true/);
  assert.match(prepared, /--finish-build/);
  assert.doesNotMatch(prepared, /^ {4}scheme:/m);
  assert.match(prepared, /excludes: \["\*\*\/\*\.a"\]/);
  const quotedNode = "'/node with spaces'\\'' and quotes/node'";
  const quotedScript = [
    "'",
    "tmp",
    "work tree'\\''s",
    "client",
    "scripts",
    "ios-xcode-build.mjs'",
  ].join(sep);
  assert.ok(
    prepared.includes(`exec ${quotedNode} ${quotedScript} --scheme-build `),
  );
  assert.ok(
    prepared.includes(
      `${quotedNode} ${quotedScript} --finish-build ${process.pid}\n`,
    ),
  );
  assert.match(prepared, /CODE_SIGNING_ALLOWED\[sdk=iphonesimulator\*\]/);
  assert.throws(
    () => prepareProjectSpec("name: unexpected", paths),
    /Unexpected generated/,
  );
});

test("generated iOS targets link SDK libraries needed by the Rust static archive", (t) => {
  const prepared = prepareProjectSpec(spec, fixture(t));
  assert.match(
    prepared,
    / {4}dependencies:\n {6}- framework: libapp\.a\n {8}embed: false\n {6}- sdk: UIKit\.framework\n {6}- sdk: libz\.tbd\n {6}- sdk: libiconv\.tbd\n/,
  );
  assert.doesNotMatch(prepared, /(?:libz|libiconv)\.framework/);
});

test("SDK library dependencies are not duplicated and unrelated targets stay unchanged", (t) => {
  const paths = fixture(t);
  for (const entries of [
    '      - sdk: "libz.tbd"\n',
    "      - sdk: libiconv.tbd\n",
    "      - sdk: 'usr/lib/libz.tbd' # SDK library\n      - sdk: libiconv.tbd\n",
  ]) {
    const existing = spec.replace(
      "      - sdk: UIKit.framework\n",
      `      - sdk: UIKit.framework\n${entries}`,
    );
    const prepared = prepareProjectSpec(existing, paths);
    assert.ok(prepared.includes(entries));
    assert.equal((prepared.match(/libz\.tbd/g) ?? []).length, 1);
    assert.equal((prepared.match(/libiconv\.tbd/g) ?? []).length, 1);
    assert.equal(prepareProjectSpec(existing, paths), prepared);
  }
  const other =
    "  OtherTarget:\n    dependencies:\n      - sdk: libz.tbd\n      - sdk: libiconv.tbd\n";
  const multiple = prepareProjectSpec(spec + other, paths);
  assert.ok(multiple.includes(other));
  assert.equal((multiple.match(/libz\.tbd/g) ?? []).length, 2);
  assert.equal((multiple.match(/libiconv\.tbd/g) ?? []).length, 2);
});

test("unknown iOS target and dependency formats fail before generation", (t) => {
  const paths = fixture(t);
  for (const changed of [
    spec.replace("  situate-client_iOS:", "  OtherTarget:"),
    spec + "  situate-client_iOS:\n",
    spec.replace(/ {4}dependencies:\n(?: {6}.*\n)*/, "    dependencies:\n"),
    spec.replace("    dependencies:", "    libraries:"),
    spec.replace("    dependencies:\n", "    dependencies: []\n"),
    spec.replace(
      "    dependencies:\n",
      "    dependencies:\n    dependencies:\n",
    ),
  ])
    assert.throws(
      () => prepareProjectSpec(changed, paths),
      /Unexpected generated/,
    );
});

test("patching the Rust phase preserves neighboring build phases", (t) => {
  const before =
    "      - script: |\n          echo before\n        name: Before Rust\n";
  const after =
    "      - script: |\n          echo after\n        name: After Rust\n";
  const source =
    spec.replace("    preBuildScripts:\n", `    preBuildScripts:\n${before}`) +
    after;
  const result = prepareProjectSpec(source, fixture(t));
  assert.ok(result.includes(before));
  assert.ok(result.includes(after));
});

test("preflight fails on non-macOS and missing npm dependencies before invoking tools", async (t) => {
  const paths = fixture(t);
  const execute = () => assert.fail("No tool should run");
  await assert.rejects(
    checkPrerequisites(paths, { host: "linux", execute }),
    /macOS/,
  );
  await assert.rejects(
    checkPrerequisites(paths, { host: "darwin", execute }),
    /npm ci/,
  );
});

test("preflight reports the exact missing Rust simulator target", async (t) => {
  const paths = fixture(t);
  mkdirSync(join(paths.root, "node_modules/@tauri-apps/cli"), {
    recursive: true,
  });
  writeFileSync(paths.cli, "");
  const execute = async (cmd, args) => {
    if (args[0] === "which") return "/rust/bin/rustc";
    if (cmd === "rustc") return "host: aarch64-apple-darwin";
    return "aarch64-apple-darwin";
  };
  await assert.rejects(
    checkPrerequisites(paths, { host: "darwin", execute }),
    /rustup target add aarch64-apple-ios-sim/,
  );
});

test("Tauri receives the owned frontend URL and worktree identifier; failure closes resources", async (t) => {
  const paths = fixture(t);
  mkdirSync(paths.apple, { recursive: true });
  writeFileSync(join(paths.apple, "project.yml"), spec);
  writeFileSync(
    join(paths.native, "tauri.conf.json"),
    JSON.stringify({
      productName: "Situate",
      identifier: "dev.situate.client",
    }),
  );
  let closed = false;
  const calls = [];
  await assert.rejects(
    openIosXcode(paths, {
      prerequisites: async () => ({ env: {} }),
      frontend: async () => ({
        url: "http://127.0.0.1:32123",
        server: {
          close: async () => {
            closed = true;
          },
        },
      }),
      execute: async (cmd, args) => {
        calls.push([cmd, args]);
        if (args.includes("--open")) throw new Error("Tauri stopped");
      },
    }),
    /Tauri stopped/,
  );
  const args = calls.at(-1)[1];
  const config = JSON.parse(args.at(-1));
  assert.equal(config.build.devUrl, "http://127.0.0.1:32123");
  assert.equal(config.build.beforeDevCommand, "");
  assert.equal(config.identifier, `dev.situate.client.dev.w${paths.id}`);
  assert.ok(args.includes("--no-watch"));
  assert.ok(closed);
  assert.ok(!existsSync(join(paths.output, "session.lock")));
});

test("release and development sessions share exclusive project ownership", (t) => {
  const paths = fixture(t);
  const release = acquireIosProject(paths.root, "release");
  assert.throws(() => acquireSession(paths), /session lock exists/);
  release();
  const session = acquireSession(paths);
  assert.throws(
    () => acquireIosProject(paths.root, "release"),
    /session lock exists/,
  );
  session();
});

test("Xcode builds clear npm markers, keep ownership through linking, and reject foreign cleanup", async (t) => {
  const paths = fixture(t);
  const unlock = acquireSession(paths);
  let called = false;
  await buildFromXcode(paths, ["--configuration", "debug"], {
    environment: {
      PLATFORM_NAME: "iphonesimulator",
      npm_lifecycle_event: "wrong",
      PNPM_PACKAGE_NAME: "wrong",
      TAURI_CONFIG: "wrong",
    },
    schemeBuild: true,
    execute: async (_cmd, args, options) => {
      called = true;
      assert.equal(options.cwd, paths.apple);
      assert.equal(options.env.npm_lifecycle_event, undefined);
      assert.equal(options.env.PNPM_PACKAGE_NAME, undefined);
      assert.equal(options.env.TAURI_CONFIG, undefined);
      assert.deepEqual(args.slice(1), [
        "ios",
        "xcode-script",
        "--configuration",
        "debug",
      ]);
    },
  });
  assert.ok(called);
  assert.ok(existsSync(join(paths.output, "build.lock")));
  assert.throws(
    () => acquireIosProject(paths.root, "release"),
    /Xcode build lock exists/,
  );
  assert.throws(
    () => finishBuild(paths, process.pid + 1),
    /different iOS session/,
  );
  finishBuild(paths, process.pid);
  assert.ok(!existsSync(join(paths.output, "build.lock")));
  unlock();
});

test("failed Rust builds retain ownership until the scheme failure post-action", async (t) => {
  const paths = fixture(t);
  const unlock = acquireSession(paths);
  await assert.rejects(
    buildFromXcode(paths, [], {
      environment: { PLATFORM_NAME: "iphonesimulator" },
      schemeBuild: true,
      execute: async () => {
        throw new Error("Rust compilation failed");
      },
    }),
    /Rust compilation failed/,
  );
  assert.ok(existsSync(join(paths.output, "build.lock")));
  finishBuild(paths, process.pid);
  assert.ok(!existsSync(join(paths.output, "build.lock")));
  unlock();
});

test("session release forwards a caller logger without weakening the active-build guard", async (t) => {
  const paths = fixture(t);
  const notices = [];
  const unlock = acquireSession(paths, false, () =>
    notices.push("build-lock-retained"),
  );
  await buildFromXcode(paths, [], {
    environment: { PLATFORM_NAME: "iphonesimulator" },
    schemeBuild: true,
    execute: async () => {},
  });
  unlock();
  assert.deepEqual(notices, ["build-lock-retained"]);
  assert.ok(existsSync(join(paths.output, "session.lock")));
  assert.ok(existsSync(join(paths.output, "build.lock")));
  finishBuild(paths, process.pid);
  unlock();
  assert.ok(!existsSync(join(paths.output, "session.lock")));
});

test("closing the session during a build conservatively retains its lock", async (t) => {
  const paths = fixture(t);
  const unlock = acquireSession(paths);
  await buildFromXcode(paths, [], {
    environment: { PLATFORM_NAME: "iphonesimulator" },
    schemeBuild: true,
    execute: async () => {},
  });
  unlock();
  assert.ok(existsSync(join(paths.output, "session.lock")));
  finishBuild(paths, process.pid);
  assert.throws(() => acquireSession(paths), /session lock exists/);
});

test("Xcode helper rejects mismatched destinations and release owners without running a compiler", async (t) => {
  const paths = fixture(t);
  const execute = () => assert.fail("Compiler must not run");
  const unlock = acquireSession(paths);
  await assert.rejects(
    buildFromXcode(paths, [], {
      environment: { PLATFORM_NAME: "iphoneos" },
      execute,
    }),
    /--device/,
  );
  unlock();
  const deviceUnlock = acquireSession(paths, true);
  await assert.rejects(
    buildFromXcode(paths, [], {
      environment: { PLATFORM_NAME: "iphonesimulator" },
      execute,
    }),
    /physical iPhone/,
  );
  deviceUnlock();
  const release = acquireIosProject(paths.root, "release");
  await assert.rejects(
    buildFromXcode(paths, [], {
      environment: { PLATFORM_NAME: "iphonesimulator" },
      execute,
    }),
    /release build/,
  );
  assert.ok(!existsSync(join(paths.output, "build.lock")));
  release();
});

test("device preflight requests the device Rust target rather than a simulator target", async (t) => {
  const paths = fixture(t);
  mkdirSync(join(paths.root, "node_modules/@tauri-apps/cli"), {
    recursive: true,
  });
  writeFileSync(paths.cli, "");
  const execute = async (cmd, args) => {
    if (args[0] === "which") return "/rust/bin/rustc";
    if (cmd === "rustc") return "host: aarch64-apple-darwin";
    return "aarch64-apple-ios-sim";
  };
  await assert.rejects(
    checkPrerequisites(paths, { host: "darwin", device: true, execute }),
    /rustup target add aarch64-apple-ios in/,
  );
});

test("session modes preserve icons and signing, and omit the checkout name only on main", async (t) => {
  const paths = fixture(t);
  mkdirSync(join(paths.apple, "situate-client.xcodeproj"), { recursive: true });
  writeFileSync(join(paths.apple, "project.yml"), spec);
  writeFileSync(
    join(paths.apple, "situate-client.xcodeproj/project.pbxproj"),
    "DEVELOPMENT_TEAM = ABC1234567;",
  );
  writeFileSync(
    join(paths.native, "tauri.conf.json"),
    JSON.stringify({
      identifier: "dev.situate.client",
      productName: "Situate",
    }),
  );
  const identifiers = [];
  for (const [device, branch] of [
    [true, "main"],
    [false, "main"],
    [true, "feature/ios"],
    [false, "feature/ios"],
    [true, ""],
    [false, ""],
  ]) {
    let frontendCalls = 0;
    let closed = false;
    await openIosXcode(paths, {
      device,
      prerequisites: async (_paths, options) => {
        assert.equal(options.device, device);
        return { env: {} };
      },
      frontend: async () => {
        frontendCalls++;
        return {
          url: "http://127.0.0.1:32123",
          server: {
            close: async () => {
              closed = true;
            },
          },
        };
      },
      execute: async (cmd, args, options) => {
        if (cmd === "git") {
          assert.deepEqual(args, ["branch", "--show-current"]);
          assert.equal(options.cwd, paths.root);
          assert.equal(options.capture, true);
          return branch;
        }
        if (!args.includes("--open")) return;
        assert.equal(
          readFileSync(
            join(
              paths.apple,
              "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
            ),
            "utf8",
          ),
          "situate-icon",
        );
        const config = JSON.parse(args.at(-1));
        identifiers.push(config.identifier);
        assert.equal(
          config.productName,
          branch === "main"
            ? "Situate"
            : `Situate (${basename(dirname(paths.root))})`,
        );
        assert.equal(config.bundle.iOS.developmentTeam, "ABC1234567");
        assert.equal(
          config.build.devUrl,
          device ? null : "http://127.0.0.1:32123",
        );
        assert.equal(config.build.beforeDevCommand, "");
        assert.equal(args[2], device ? "build" : "dev");
        assert.equal(args.includes("--debug"), device);
        assert.equal(args.includes("aarch64"), device);
        assert.equal(args.includes("--no-watch"), !device);
        assert.ok(!args.includes("--no-sign"));
        const owner = JSON.parse(
          readFileSync(join(paths.output, "session.lock/owner.json"), "utf8"),
        );
        assert.equal(owner.mode, device ? "device" : "simulator");
        const generated = readFileSync(
          join(paths.apple, "project.ios-xcode.yml"),
          "utf8",
        );
        assert.match(generated, /DEVELOPMENT_TEAM: "ABC1234567"/);
        assert.match(generated, /- sdk: libz\.tbd/);
        assert.match(generated, /- sdk: libiconv\.tbd/);
      },
    });
    assert.equal(frontendCalls, device ? 0 : 1);
    assert.equal(closed, !device);
    assert.ok(!existsSync(join(paths.output, "session.lock")));
  }
  assert.equal(new Set(identifiers).size, 1);
});

test("device builds refresh the frontend before each Rust build and retain the scheme lock on failure", async (t) => {
  const paths = fixture(t);
  const unlock = acquireSession(paths, true);
  const commands = [];
  for (let index = 0; index < 2; index++) {
    await buildFromXcode(paths, [], {
      environment: { PLATFORM_NAME: "iphoneos" },
      schemeBuild: true,
      execute: async (cmd, args, options) => {
        assert.equal(
          readFileSync(
            join(
              paths.apple,
              "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
            ),
            "utf8",
          ),
          "situate-icon",
        );
        commands.push(cmd === "npm" ? "frontend" : "rust");
        if (cmd === "npm") {
          assert.deepEqual(args, ["run", "build"]);
          assert.equal(options.cwd, paths.root);
        }
      },
    });
    finishBuild(paths, process.pid);
  }
  assert.deepEqual(commands, ["frontend", "rust", "frontend", "rust"]);
  await assert.rejects(
    buildFromXcode(paths, [], {
      environment: { PLATFORM_NAME: "iphoneos" },
      schemeBuild: true,
      execute: async (cmd) => {
        assert.equal(cmd, "npm");
        throw new Error("frontend failed");
      },
    }),
    /frontend failed/,
  );
  assert.ok(existsSync(join(paths.output, "build.lock")));
  finishBuild(paths, process.pid);
  unlock();
});

test("simulator ad-hoc signing stays in the app group and preserves device signing", (t) => {
  const paths = fixture(t);
  const simulator = `      "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": YES
      "CODE_SIGNING_REQUIRED[sdk=iphonesimulator*]": YES
      "CODE_SIGN_IDENTITY[sdk=iphonesimulator*]": "-"
      "AD_HOC_CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": YES
      "CODE_SIGN_STYLE[sdk=iphonesimulator*]": Manual
      "DEVELOPMENT_TEAM[sdk=iphonesimulator*]": ""
`;
  const otherGroup = `  helper:
    base:
      PRODUCT_NAME: NativeHelper
      "CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]": NO
`;
  const manual = `      DEVELOPMENT_TEAM: ABC1234567
      CODE_SIGN_STYLE: Manual
      CODE_SIGN_IDENTITY: "iPhone Developer"
      PROVISIONING_PROFILE: fixture-profile
      PROVISIONING_PROFILE_SPECIFIER: FixtureProfile
      "CODE_SIGN_IDENTITY[sdk=iphoneos*]": "Apple Development"
      "CODE_SIGNING_ALLOWED[sdk=iphoneos*]": YES
`;
  for (const deviceSettings of ["", manual]) {
    const input = spec
      .replace("settingGroups:\n", "settingGroups:\n" + otherGroup)
      .replace(
        "      PRODUCT_NAME: Situate",
        deviceSettings + "      PRODUCT_NAME: Situate",
      );
    const prepared = prepareProjectSpec(input, paths);
    assert.ok(prepared.includes(otherGroup));
    assert.ok(
      prepared.includes(
        "  app:\n    base:\n" +
          simulator +
          deviceSettings +
          "      PRODUCT_NAME: Situate",
      ),
    );
    if (!deviceSettings)
      assert.doesNotMatch(prepared, /^ {6}DEVELOPMENT_TEAM:/m);
    for (const previous of [
      simulator,
      simulator.replace(
        'ALLOWED[sdk=iphonesimulator*]": YES',
        'ALLOWED[sdk=iphonesimulator*]": NO',
      ),
    ]) {
      assert.equal(
        prepareProjectSpec(
          input.replace(
            "      PRODUCT_NAME: Situate",
            previous + "      PRODUCT_NAME: Situate",
          ),
          paths,
        ),
        prepared,
      );
    }
  }
});

test("local signing team survives project generation without disabling device signing", (t) => {
  const team = developmentTeam(
    'DEVELOPMENT_TEAM = ABC1234567; DEVELOPMENT_TEAM = "ABC1234567";',
  );
  assert.equal(team, "ABC1234567");
  assert.equal(developmentTeam('DEVELOPMENT_TEAM = "";'), undefined);
  assert.throws(
    () =>
      developmentTeam(
        "DEVELOPMENT_TEAM = ABC1234567; DEVELOPMENT_TEAM = DEF1234567;",
      ),
    /Multiple signing teams/,
  );
  const prepared = prepareProjectSpec(spec, fixture(t), process.execPath, team);
  assert.match(prepared, /CODE_SIGN_STYLE: Automatic/);
  const previousTeam = spec.replace(
    "      PRODUCT_NAME:",
    '      DEVELOPMENT_TEAM: "DEF1234567"\n      CODE_SIGN_STYLE: Manual\n      PRODUCT_NAME:',
  );
  const updated = prepareProjectSpec(
    previousTeam,
    fixture(t),
    process.execPath,
    team,
  );
  assert.equal((updated.match(/DEVELOPMENT_TEAM:/g) || []).length, 1);
  assert.doesNotMatch(updated, /DEF1234567|CODE_SIGN_STYLE: Manual/);
  assert.doesNotMatch(prepared, /CODE_SIGNING_ALLOWED\[sdk=iphoneos/);
  assert.throws(
    () => prepareProjectSpec(spec, fixture(t), process.execPath, "bad\nteam"),
    /Invalid Apple/,
  );
});

test("failed project generation is retried and never changes the base template", async (t) => {
  const paths = fixture(t);
  mkdirSync(paths.apple, { recursive: true });
  const base = join(paths.apple, "project.yml");
  writeFileSync(base, spec);
  let attempts = 0;
  for (let index = 0; index < 2; index++) {
    await assert.rejects(
      openIosXcode(paths, {
        prerequisites: async () => ({ env: {} }),
        execute: async () => {
          attempts++;
          throw new Error("generation failed");
        },
      }),
      /generation failed/,
    );
  }
  assert.equal(attempts, 2);
  assert.equal(readFileSync(base, "utf8"), spec);
  assert.ok(!existsSync(join(paths.output, "session.lock")));
});
