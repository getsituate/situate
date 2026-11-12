import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createUpdaterSignerFixture } from "./updater-signing-fixture.mjs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { applePosixFixture } from "./apple-posix-fixture.mjs";
import {
  appleEnvironment,
  applePlan,
  buildAppleRelease,
  runAppleRelease,
  loadAppleSettings,
  prepareDistributionProjectSpec,
} from "./apple-release.mjs";
import { uploadAppleRelease, uploadCredentials } from "./apple-upload.mjs";
import { combinedLicenseText } from "./native-licenses-frontend.mjs";

const generatedProject = `targets:
  example_iOS:
    sources:
      - path: Externals
    dependencies:
      - framework: libapp.a
        embed: false
    preBuildScripts:
      - script: |
          node tauri ios xcode-script -v --platform "\${PLATFORM_DISPLAY_NAME:?}" --sdk-root "\${SDKROOT:?}" \${FORCE_COLOR} \${ARCHS:?}
        name: Build Rust Code
        basedOnDependencyAnalysis: false
`;

function fixture(t) {
  applePosixFixture(t);
  const temporary = mkdtempSync(join(tmpdir(), "situate-apple-test-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, "repo/client");
  mkdirSync(join(root, "app/src-tauri"), { recursive: true });
  mkdirSync(join(root, "node_modules/@tauri-apps/cli"), { recursive: true });
  writeFileSync(join(root, "node_modules/@tauri-apps/cli/tauri.js"), "");
  writeFileSync(
    join(root, "app/src-tauri/tauri.conf.json"),
    JSON.stringify({ identifier: "dev.example.desktop", version: "1.2.3" }),
  );
  writeFileSync(
    join(root, "app/src-tauri/PrivacyInfo.xcprivacy"),
    "synthetic privacy manifest",
  );
  const key = join(temporary, "AuthKey_EXAMPLE123.p8");
  writeFileSync(key, "synthetic key", { mode: 0o600 });
  const settings = {
    teamId: "TEAM123456",
    macosSigningIdentity: "Developer ID Application: Example (TEAM123456)",
    notaryProfile: "example-notary",
    iosBundleIdentifier: "dev.example.ios",
    appStoreConnect: {
      appId: "1234567890",
      apiKeyId: "EXAMPLE1234",
      apiIssuerId: "11111111-2222-3333-4444-555555555555",
      apiKeyPath: key,
    },
  };
  writeFileSync(join(root, "../LICENSE"), "Synthetic Situate MIT license");
  mkdirSync(join(root, "../LICENSES"), { recursive: true });
  writeFileSync(
    join(root, "../LICENSES/CC-BY-4.0.txt"),
    "Synthetic artwork license",
  );
  mkdirSync(join(root, "app/public/licenses"), { recursive: true });
  mkdirSync(join(root, "app/src/ai/assets/providers"), { recursive: true });
  writeFileSync(
    join(root, "app/src/ai/assets/providers/SOURCES.md"),
    "Synthetic icon notice",
  );
  function buildFrontend(env) {
    const javascript = readFileSync(
      join(root, "app/dist/third-party-js-notices.txt"),
      "utf8",
    );
    writeFileSync(
      join(root, "app/dist/situate-licenses.txt"),
      state.staleDisclosure
        ? "Stale license disclosure"
        : combinedLicenseText(root, javascript, env),
    );
  }
  const calls = [];
  const state = {
    notaryStatus: "Accepted",
    missingIpa: false,
    profile: {},
    appInfo: {},
    entitlements: {},
  };
  let submission = 0;
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (state.fail?.(command, args)) throw new Error("Synthetic tool failure");
    if (command === "git")
      return args[0] === "rev-parse" ? `${"b".repeat(40)}\n` : "";
    if (command === "xcrun" && args.includes("--upload-package"))
      return (
        state.uploadResponse ??
        JSON.stringify({
          "delivery-id": "11111111-2222-3333-4444-555555555555",
          status: "PROCESSING",
        })
      );
    if (command === "rustup" && args[0] === "which")
      return "/example/project-rust/bin/rustc\n";
    if (command === "rustup")
      return "aarch64-apple-darwin\nx86_64-apple-darwin\naarch64-apple-ios\n";
    if (command === "security" && args[0] === "find-identity")
      return `1) ${"A".repeat(40)} "${settings.macosSigningIdentity}"\n2) ${"B".repeat(40)} "Apple Development: Example (OTHER12345)"`;
    if (command === process.execPath && args[1] === "build") {
      buildFrontend(options.env);
      const directory = join(
        options.env.CARGO_TARGET_DIR,
        "universal-apple-darwin/release/bundle/macos/Situate.app/Contents",
      );
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "Info.plist"), "synthetic mac app");
      const resources = JSON.parse(args[args.indexOf("--config") + 1]).bundle
        .resources;
      mkdirSync(join(directory, "Resources"), { recursive: true });
      for (const [source, destination] of Object.entries(resources)) {
        if (state.missingLicenses && destination.startsWith("licenses/"))
          continue;
        mkdirSync(dirname(join(directory, "Resources", destination)), {
          recursive: true,
        });
        cpSync(source, join(directory, "Resources", destination));
      }
      if (state.packagedTts)
        mkdirSync(join(directory, "Resources/FluidAudio_FluidAudio.bundle"));
    }
    if (
      command === process.execPath &&
      args[1] === "ios" &&
      args[2] === "init"
    ) {
      const apple = join(root, "app/src-tauri/gen/apple");
      const catalog = join(apple, "Assets.xcassets/AppIcon.appiconset");
      mkdirSync(catalog, { recursive: true });
      mkdirSync(join(root, "app/src-tauri/icons/ios"), { recursive: true });
      writeFileSync(join(apple, "project.yml"), generatedProject);
      mkdirSync(join(apple, "situate-client.xcodeproj"), { recursive: true });
      writeFileSync(
        join(apple, "situate-client.xcodeproj/project.pbxproj"),
        "original project",
      );
      writeFileSync(
        join(catalog, "Contents.json"),
        JSON.stringify({ images: [{ filename: "AppIcon-512@2x.png" }] }),
      );
      writeFileSync(
        join(root, "app/src-tauri/icons/ios/AppIcon-512@2x.png"),
        "canonical icon",
      );
    }
    if (command === "xcodegen" && args[0] === "generate")
      writeFileSync(
        join(
          root,
          "app/src-tauri/gen/apple/situate-client.xcodeproj/project.pbxproj",
        ),
        "release project",
      );
    if (
      command === process.execPath &&
      args[1] === "ios" &&
      args[2] === "build"
    ) {
      buildFrontend(options.env);
      state.iosResources = JSON.parse(
        args[args.indexOf("--config") + 1],
      ).bundle.resources;
      const apple = join(root, "app/src-tauri/gen/apple");
      const toolBin = options.env.PATH.split(delimiter)[0];
      assert.equal(readlinkSync(join(toolBin, "rsync")), "/usr/bin/rsync");
      assert.deepEqual(readdirSync(toolBin), ["rsync"]);
      assert.equal(
        options.env.CARGO_TARGET_DIR,
        join(root, "target/apple-release/cargo/ios"),
      );
      assert.ok(
        readFileSync(join(apple, "project.yml"), "utf8").includes(
          `'${join(root, "node_modules/@tauri-apps/cli/tauri.js")}' ios xcode-script`,
        ),
      );
      assert.equal(
        readFileSync(
          join(apple, "Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"),
          "utf8",
        ),
        "canonical icon",
      );
      const build = join(root, "app/src-tauri/gen/apple/build");
      assert.ok(
        !existsSync(build),
        "Previous iOS output must be removed before building",
      );
      mkdirSync(join(build, "arm64"), { recursive: true });
      mkdirSync(join(build, "situate-client_iOS.xcarchive/dSYMs"), {
        recursive: true,
      });
      writeFileSync(
        join(build, "situate-client_iOS.xcarchive/dSYMs/symbols"),
        "symbols",
      );
      if (!state.missingIpa)
        writeFileSync(join(build, "arm64/Situate.ipa"), "fresh signed ipa");
    }
    if (command === "ditto" && args[0] === "-x") {
      const app = join(args.at(-1), "Payload/Situate.app");
      mkdirSync(app, { recursive: true });
      writeFileSync(join(app, "Info.plist"), "synthetic device app");
      cpSync(
        options.env.SITUATE_RELEASE_HISTORY_FILE,
        join(app, "situate-release-history.json"),
      );
      for (const [source, destination] of Object.entries(state.iosResources)) {
        if (state.missingLicenses && destination.startsWith("licenses/"))
          continue;
        mkdirSync(dirname(join(app, destination)), { recursive: true });
        cpSync(source, join(app, destination));
      }
      if (state.packagedTts)
        mkdirSync(join(app, "FluidAudio_FluidAudio.bundle"));
      if (!state.missingPrivacy)
        writeFileSync(
          join(app, "PrivacyInfo.xcprivacy"),
          "synthetic privacy manifest",
        );
      writeFileSync(
        join(app, "embedded.mobileprovision"),
        "synthetic provision",
      );
    }
    if (command === "ditto" && args[0] === "-c")
      writeFileSync(args.at(-1), "signed zip");
    if (
      command === "codesign" &&
      args.some((arg) => arg.startsWith("--extract-certificates="))
    )
      writeFileSync(
        `${args.find((arg) => arg.startsWith("--extract-certificates=")).slice("--extract-certificates=".length)}0`,
        "",
      );
    if (command === "plutil" && args.at(-1).endsWith("entitlements.plist"))
      return JSON.stringify({
        "application-identifier": "TEAM123456.dev.example.ios",
        "com.apple.developer.team-identifier": "TEAM123456",
        "get-task-allow": false,
        ...state.entitlements,
      });
    if (command === "plutil")
      return JSON.stringify({
        CFBundleIdentifier: args.at(-1).includes("Contents")
          ? "dev.example.desktop"
          : "dev.example.ios",
        CFBundleShortVersionString: "1.2.3",
        CFBundleVersion: "42",
        DTPlatformName: "iphoneos",
        ...state.appInfo,
      });
    if (command === "python3" && args[0] === "-c")
      return JSON.stringify({
        Entitlements: {
          "application-identifier": "TEAM123456.dev.example.ios",
          "get-task-allow": false,
        },
        TeamIdentifier: ["TEAM123456"],
        ApplicationIdentifierPrefix: ["TEAM123456"],
        CertificateSha256: [
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        ],
        ExpirationDate: "2099-01-01T00:00:00Z",
        ...state.profile,
      });
    if (command === "xcrun" && args[0] === "notarytool") {
      if (args[1] === "submit")
        return JSON.stringify({ id: `submission-${++submission}` });
      if (args[1] === "wait")
        return JSON.stringify({ status: state.notaryStatus });
      return "{}";
    }
    if (
      command === "xcrun" &&
      args[0] === "stapler" &&
      args[1] === "staple" &&
      args[2].endsWith(".app")
    )
      writeFileSync(join(args[2], "stapled"), "ticket");
    if (command === "hdiutil") {
      const staging = args[args.indexOf("-srcfolder") + 1];
      assert.ok(
        existsSync(join(staging, "Situate.app/stapled")),
        "App ticket must be inside the disk image",
      );
      writeFileSync(args.at(-1), "signed disk image");
    }
    return "";
  };
  return {
    root,
    settings,
    collectLicenses({ output }) {
      mkdirSync(output, { recursive: true });
      const path = join(output, "third-party-native-notices.txt");
      writeFileSync(path, "Synthetic native notices");
      mkdirSync(join(root, "app/dist"), { recursive: true });
      writeFileSync(
        join(root, "app/dist/third-party-js-notices.txt"),
        "Third-party software notices\n\nSynthetic JS notices",
      );
      const runtime = join(output, "rust-runtime-notices.txt");
      writeFileSync(
        runtime,
        "Synthetic Rust standard library and Unicode notices",
      );
      return {
        [path]: "licenses/third-party-native-notices.txt",
        [runtime]: "licenses/rust-runtime-notices.txt",
      };
    },
    qualifyExternalMigrations(repoRoot) {
      assert.equal(repoRoot, dirname(root));
      return {
        publishedRevision: "b".repeat(40),
        releasedMigrations: 0,
        migrations: 0,
        legacyEvidence: {
          version: "0.1.5",
          manifestSha256: "c".repeat(64),
          evidenceSha256: "d".repeat(64),
        },
      };
    },
    qualifyMigrations(repoRoot) {
      assert.equal(repoRoot, dirname(root));
      return {
        schemaVersion: 1,
        source: "macos-direct-publication",
        releases: [],
        migrations: 0,
      };
    },
    compileHistory(repoRoot, version) {
      assert.equal(repoRoot, dirname(root));
      assert.equal(version, "1.2.3");
      return {
        schemaVersion: 1,
        installedVersion: version,
        releases: [
          {
            version,
            locales: {
              en: { title: "Release", entries: [] },
              de: { title: "Release", entries: [] },
            },
          },
        ],
      };
    },
    execute,
    state,
    calls,
    host: "darwin",
    platform: "all",
    buildNumber: "42",
    environment: {
      PATH: "/usr/bin",
      HOME: temporary,
      APPLE_PASSWORD: "not-forwarded",
      TAURI_CONFIG: "not-forwarded",
      IOS_CERTIFICATE: "not-forwarded",
      OTHER_SECRET: "not-forwarded",
    },
  };
}

function failedManifest(root) {
  const directory = join(
    root,
    "artifacts",
    readdirSync(join(root, "artifacts"))[0],
  );
  return JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
}

test("Xcode release build phase uses absolute quoted CLI paths and preserves SDK arguments", () => {
  const result = prepareDistributionProjectSpec(generatedProject, {
    cli: "/example with spaces/tauri.js",
    node: "/example node/bin/node",
    toolBin: "/example/ios tools",
  });
  assert.ok(
    result.includes(
      "exec '/example node/bin/node' '/example with spaces/tauri.js' ios xcode-script",
    ),
  );
  assert.ok(result.includes("export PATH='/example/ios tools':\"$PATH\""));
  assert.ok(result.includes('"${SDKROOT:?}" ${FORCE_COLOR:-} ${ARCHS:?}'));
  assert.ok(result.includes("basedOnDependencyAnalysis: false"));
  assert.ok(result.includes("- sdk: libz.tbd"));
  assert.ok(result.includes("- sdk: libiconv.tbd"));
  assert.ok(result.includes('excludes: ["**/*.a"]'));
  assert.throws(
    () =>
      prepareDistributionProjectSpec("targets: {}", {
        cli: "/cli",
        toolBin: "/tools",
      }),
    /Unexpected generated/,
  );
  assert.throws(
    () =>
      prepareDistributionProjectSpec(generatedProject + generatedProject, {
        cli: "/cli",
        toolBin: "/tools",
      }),
    /Unexpected generated/,
  );
});

test("Apple selection is explicit and iOS requires a stable identifier and build number", () => {
  const settings = {
    teamId: "TEAM123456",
    macosSigningIdentity: "Developer ID Application: Example",
    notaryProfile: "test",
    iosBundleIdentifier: "dev.example.app",
  };
  assert.deepEqual(applePlan({ settings, host: "darwin" }).rustTargets, [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
  ]);
  assert.deepEqual(
    applePlan({ settings, platform: "ios", buildNumber: "1", host: "darwin" })
      .rustTargets,
    ["aarch64-apple-ios"],
  );
  assert.equal(
    applePlan({
      settings,
      platform: "ios",
      distribution: "direct",
      buildNumber: "1",
      host: "darwin",
    }).distribution,
    "external",
  );
  for (const value of ["0", "-1", "1.0.0.1", "10000", undefined])
    assert.throws(
      () =>
        applePlan({
          settings,
          platform: "ios",
          buildNumber: value,
          host: "darwin",
        }),
      /build-number/,
    );
  assert.throws(() => applePlan({ settings, host: "linux" }), /require macOS/);
  assert.throws(
    () => applePlan({ settings, platform: "windows", host: "darwin" }),
    /platform/,
  );
  assert.throws(
    () =>
      applePlan({
        settings: { ...settings, macosSigningIdentity: "-" },
        host: "darwin",
      }),
    /Developer ID/,
  );
});

test("distribution environment excludes ambient secrets and build/signing overrides", () => {
  const env = appleEnvironment(
    {
      PATH: "/bin",
      HOME: "/example",
      DEVELOPER_DIR: "/xcode",
      APPLE_ID: "secret",
      TAURI_CONFIG: "override",
      RUSTFLAGS: "override",
      RUSTUP_TOOLCHAIN: "override",
      IOS_MOBILE_PROVISION: "secret",
      OTHER_SECRET: "secret",
    },
    "/client",
  );
  assert.deepEqual(Object.keys(env).sort(), [
    "CARGO_TARGET_DIR",
    "DEVELOPER_DIR",
    "HOME",
    "PATH",
  ]);
  assert.equal(
    env.CARGO_TARGET_DIR,
    join("/client", "target/apple-release/cargo"),
  );
  assert.deepEqual(env.PATH.split(delimiter), [
    dirname(process.execPath),
    "/bin",
  ]);
});

test("missing signing settings name the supported environment input", (t) => {
  assert.throws(
    () => loadAppleSettings(fixture(t).root, undefined, {}),
    /Configure APPLE_TEAM_ID/,
  );
});

test("dotenv signing settings work without creating a local JSON file", (t) => {
  const { root, settings } = fixture(t);
  const content = `APPLE_TEAM_ID=${settings.teamId}\nAPPLE_MACOS_SIGNING_IDENTITY="${settings.macosSigningIdentity}"\nAPPLE_API_PRIVATE_KEY=not-a-setting\nOTHER_SECRET=not-a-setting\nUNUSED=$(touch injected)\n`;
  const path = join(root, "../.env");
  writeFileSync(path, content, { mode: 0o600 });
  assert.deepEqual(loadAppleSettings(root, undefined, {}), {
    teamId: settings.teamId,
    macosSigningIdentity: settings.macosSigningIdentity,
    iosBundleIdentifier: "dev.example.desktop",
  });
  assert.equal(readFileSync(path, "utf8"), content);
  assert.ok(!existsSync(join(root, ".apple-release.local.json")));
  assert.ok(!existsSync(join(root, "../injected")));
});

test("legacy settings remain available and explicit environment values override dotenv and JSON", (t) => {
  const { root, settings } = fixture(t);
  const path = join(root, ".apple-release.local.json");
  writeFileSync(path, JSON.stringify(settings));
  assert.deepEqual(loadAppleSettings(root, path, {}), settings);
  const original = readFileSync(path, "utf8");
  writeFileSync(
    join(root, "../.env"),
    "APPLE_TEAM_ID=FILE123456\nAPPLE_MACOS_SIGNING_IDENTITY=from-file\n",
    { mode: 0o600 },
  );
  assert.deepEqual(loadAppleSettings(root, path, {}), {
    ...settings,
    teamId: "FILE123456",
    macosSigningIdentity: "from-file",
  });
  assert.deepEqual(
    loadAppleSettings(root, path, {
      APPLE_TEAM_ID: "ENVX123456",
      APPLE_MACOS_SIGNING_IDENTITY: "",
    }),
    { ...settings, teamId: "ENVX123456", macosSigningIdentity: "" },
  );
  assert.throws(
    () => loadAppleSettings(root, path, { APPLE_TEAM_ID: "" }),
    /Configure APPLE_TEAM_ID/,
  );
  assert.equal(readFileSync(path, "utf8"), original);
});

test("empty dotenv team settings do not fall back to a legacy account", (t) => {
  const { root, settings } = fixture(t);
  writeFileSync(
    join(root, ".apple-release.local.json"),
    JSON.stringify(settings),
  );
  writeFileSync(join(root, "../.env"), "APPLE_TEAM_ID=\n", { mode: 0o600 });
  assert.throws(
    () => loadAppleSettings(root, undefined, {}),
    /Configure APPLE_TEAM_ID/,
  );
});

test("invalid legacy configuration errors do not expose its contents", (t) => {
  const { root } = fixture(t);
  const path = join(root, ".apple-release.local.json");
  for (const content of [
    "private-value-invalid-json",
    '"private-value"',
    "null",
    "[]",
  ]) {
    writeFileSync(path, content);
    assert.throws(
      () => loadAppleSettings(root, path, {}),
      (error) => {
        assert.match(
          error.message,
          /Cannot read Apple signing settings as a JSON object/,
        );
        assert.ok(!error.message.includes("private-value"));
        return true;
      },
    );
  }
});

test("CI ignores local signing configuration and dotenv", (t) => {
  const { root, settings } = fixture(t);
  writeFileSync(join(root, ".apple-release.local.json"), "invalid local JSON");
  writeFileSync(join(root, "../.env"), "APPLE_TEAM_ID=FILE123456\n", {
    mode: 0o644,
  });
  assert.throws(
    () => loadAppleSettings(root, undefined, { CI: "true" }),
    /Configure APPLE_TEAM_ID/,
  );
  assert.deepEqual(
    loadAppleSettings(root, undefined, {
      CI: "true",
      APPLE_TEAM_ID: settings.teamId,
      APPLE_MACOS_SIGNING_IDENTITY: settings.macosSigningIdentity,
    }),
    {
      teamId: settings.teamId,
      macosSigningIdentity: settings.macosSigningIdentity,
      iosBundleIdentifier: "dev.example.desktop",
    },
  );
});

test("fully specified environment settings do not read dotenv, but local reads retain privacy checks", (t) => {
  const { root, settings } = fixture(t);
  writeFileSync(join(root, "../.env"), "APPLE_TEAM_ID=FILE123456\n", {
    mode: 0o644,
  });
  assert.deepEqual(
    loadAppleSettings(root, undefined, {
      APPLE_TEAM_ID: settings.teamId,
      APPLE_MACOS_SIGNING_IDENTITY: settings.macosSigningIdentity,
    }),
    {
      teamId: settings.teamId,
      macosSigningIdentity: settings.macosSigningIdentity,
      iosBundleIdentifier: "dev.example.desktop",
    },
  );
  assert.throws(
    () => loadAppleSettings(root, undefined, {}),
    /owned, private regular file/,
  );
});

test("dotenv signing settings and API credentials complete preflight without a JSON configuration", async (t) => {
  const options = fixture(t);
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  writeFileSync(
    join(options.root, "../.env"),
    `APPLE_TEAM_ID=${options.settings.teamId}\nAPPLE_MACOS_SIGNING_IDENTITY="${options.settings.macosSigningIdentity}"\nAPPLE_API_KEY=EXAMPLE1234\nAPPLE_API_ISSUER=11111111-2222-3333-4444-555555555555\nAPPLE_API_PRIVATE_KEY="${privateKey}"\n`,
    { mode: 0o600 },
  );
  const settings = loadAppleSettings(
    options.root,
    undefined,
    options.environment,
  );
  assert.equal(
    await buildAppleRelease({
      ...options,
      settings,
      platform: "macos",
      check: true,
    }),
    undefined,
  );
  assert.ok(!existsSync(join(options.root, ".apple-release.local.json")));
  assert.ok(!existsSync(join(options.root, "artifacts")));
  const notary = options.calls.find(({ args }) => args[0] === "notarytool");
  assert.ok(notary.args.includes("--key"));
  assert.ok(!existsSync(notary.args[notary.args.indexOf("--key") + 1]));
  for (const { options: callOptions } of options.calls) {
    for (const name of [
      "APPLE_TEAM_ID",
      "APPLE_MACOS_SIGNING_IDENTITY",
      "APPLE_API_KEY",
      "APPLE_API_PRIVATE_KEY",
    ])
      assert.equal(callOptions.env[name], undefined);
  }
});

test("expected app version rejects stale release requests before prerequisites or uploads", async (t) => {
  const options = fixture(t);
  await assert.rejects(
    buildAppleRelease({ ...options, expectedVersion: "1.2.4" }),
    /differs from --expected-version/,
  );
  await assert.rejects(
    runAppleRelease({
      ...options,
      platform: "ios",
      uploadTestFlight: true,
      expectedVersion: "1.2.4",
    }),
    /differs from --expected-version/,
  );
  assert.equal(options.calls.length, 0);
  assert.ok(!existsSync(join(options.root, "artifacts")));
  assert.equal(
    await buildAppleRelease({
      ...options,
      expectedVersion: "1.2.3",
      check: true,
    }),
    undefined,
  );
});

test("preflight never builds, uploads or creates output", async (t) => {
  const options = fixture(t);
  assert.equal(await buildAppleRelease({ ...options, check: true }), undefined);
  assert.ok(!existsSync(join(options.root, "artifacts")));
  assert.ok(!options.calls.some(({ command }) => command === process.execPath));
  assert.ok(
    !options.calls.some(
      ({ args }) =>
        args.includes("submit") || args.includes("--upload-package"),
    ),
  );
});

test("missing notarization authentication prevents any build", async (t) => {
  const options = fixture(t);
  options.state.fail = (command, args) =>
    command === "xcrun" && args[1] === "history";
  await assert.rejects(buildAppleRelease(options), /Notarization credentials/);
  assert.ok(!options.calls.some(({ command }) => command === process.execPath));
  assert.ok(!existsSync(join(options.root, "target")));
});

test("both Apple targets reject incomplete notes before building or signing", async (t) => {
  for (const platform of ["macos", "ios"]) {
    const options = fixture(t);
    await assert.rejects(
      buildAppleRelease({
        ...options,
        platform,
        compileHistory() {
          throw new Error("Source approval is stale");
        },
      }),
      /approval is stale/,
    );
    assert.ok(
      !options.calls.some(
        ({ command, args }) =>
          (command === process.execPath &&
            (args[1] === "build" || args[1] === "ios")) ||
          command === "codesign",
      ),
    );
  }
});

test("both Apple targets require an unchanged clean revision throughout the build", async (t) => {
  for (const platform of ["macos", "ios"]) {
    for (const when of ["before", "after"]) {
      const options = fixture(t);
      let reads = 0;
      await assert.rejects(
        buildAppleRelease({
          ...options,
          platform,
          execute(command, args, config) {
            if (command === "git" && args[0] === "status")
              return Promise.resolve(
                (++reads === 1 && when === "before") || reads === 2
                  ? " M source.mjs"
                  : "",
              );
            return options.execute(command, args, config);
          },
        }),
        when === "before" ? /clean committed source/ : /same clean revision/,
      );
    }
  }
});

test("both Apple targets reject missing catalog resources from the exported payload", async (t) => {
  for (const platform of ["macos", "ios"]) {
    const options = fixture(t);
    await assert.rejects(
      buildAppleRelease({
        ...options,
        platform,
        async execute(command, args, config) {
          const result = await options.execute(command, args, config);
          if (command === process.execPath && args[1] === "build")
            rmSync(
              join(
                config.env.CARGO_TARGET_DIR,
                "universal-apple-darwin/release/bundle/macos/Situate.app/Contents/Resources/situate-release-history.json",
              ),
            );
          if (command === "ditto" && args[0] === "-x")
            rmSync(
              join(
                args.at(-1),
                "Payload/Situate.app/situate-release-history.json",
              ),
            );
          return result;
        },
      }),
      /missing its release-history resource/,
    );
  }
});

test("both Apple targets reject changed signed migration qualification", async (t) => {
  for (const platform of ["macos", "ios"]) {
    const options = fixture(t);
    await assert.rejects(
      buildAppleRelease({
        ...options,
        platform,
        async execute(command, args, config) {
          const result = await options.execute(command, args, config);
          let identity;
          if (command === process.execPath && args[1] === "build")
            identity = join(
              config.env.CARGO_TARGET_DIR,
              "universal-apple-darwin/release/bundle/macos/Situate.app/Contents/Resources/situate-distribution.json",
            );
          if (command === "ditto" && args[0] === "-x")
            identity = join(
              args.at(-1),
              "Payload/Situate.app/situate-distribution.json",
            );
          if (identity) {
            const value = JSON.parse(readFileSync(identity, "utf8"));
            value.migrationQualification.legacyEvidence.manifestSha256 =
              "e".repeat(64);
            writeFileSync(identity, JSON.stringify(value));
          }
          return result;
        },
      }),
      /Signed (?:macOS|iOS) build configuration does not match/u,
    );
    assert.ok(
      !options.calls.some(
        ({ args }) =>
          args.includes("submit") || args.includes("--upload-package"),
      ),
    );
  }
});

test("both Apple targets reject stale frontend disclosure before distribution", async (t) => {
  for (const platform of ["macos", "ios"]) {
    const options = fixture(t);
    options.state.staleDisclosure = true;
    await assert.rejects(
      buildAppleRelease({ ...options, platform }),
      /Frontend license disclosure does not match/,
    );
    assert.ok(
      !options.calls.some(
        ({ args }) =>
          args.includes("submit") || args.includes("--upload-package"),
      ),
    );
  }
});

test("both Apple targets reject missing third-party material before distribution", async (t) => {
  for (const platform of ["macos", "ios"]) {
    const options = fixture(t);
    options.state.missingLicenses = true;
    await assert.rejects(
      buildAppleRelease({ ...options, platform }),
      /Packaged third-party material missing or changed/,
    );
    assert.ok(
      !options.calls.some(
        ({ args }) =>
          args.includes("submit") || args.includes("--upload-package"),
      ),
    );
  }
});

test("both Apple targets reject TTS resources before notarization or upload", async (t) => {
  for (const platform of ["macos", "ios"]) {
    const options = fixture(t);
    options.state.packagedTts = true;
    await assert.rejects(
      buildAppleRelease({ ...options, platform }),
      /Unqualified dictation resource:/,
    );
    assert.ok(
      !options.calls.some(
        ({ args }) =>
          args.includes("submit") || args.includes("--upload-package"),
      ),
    );
  }
});

test("external builds retain the selected publication evidence and fail before compiling when it is unavailable", async (t) => {
  const options = fixture(t);
  const environment = {
    ...options.environment,
    SITUATE_MIGRATIONS_PUBLISHED_REVISION: "b".repeat(40),
  };
  await assert.rejects(
    buildAppleRelease({
      ...options,
      environment,
      qualifyExternalMigrations(repoRoot, selected) {
        assert.equal(repoRoot, dirname(options.root));
        assert.equal(selected.environment, environment);
        throw new Error("Missing local migration history commit");
      },
    }),
    /Missing local migration history commit/u,
  );
  assert.ok(
    !options.calls.some(
      ({ command, args }) =>
        command === process.execPath && ["build", "ios"].includes(args[1]),
    ),
  );
});

test("builds verified universal DMG and device IPA with symbols, checksums and no upload", async (t) => {
  const options = fixture(t);
  const output = await buildAppleRelease(options);
  const manifest = JSON.parse(
    readFileSync(join(output, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.status, "complete");
  assert.equal(manifest.revision, "b".repeat(40));
  assert.equal(manifest.dirty, false);
  assert.deepEqual(
    manifest.migrationQualification,
    options.qualifyExternalMigrations(dirname(options.root)),
  );
  for (const artifact of manifest.artifacts)
    assert.deepEqual(
      artifact.buildConfiguration.migrationQualification,
      manifest.migrationQualification,
    );
  assert.equal(manifest.releaseContent.version, "1.2.3");
  assert.deepEqual(manifest.releaseContent.locales, ["de", "en"]);
  for (const artifact of manifest.artifacts)
    assert.deepEqual(artifact.releaseContent, manifest.releaseContent);
  const frontendInputs = options.calls.filter(
    ({ command, args }) =>
      command === process.execPath &&
      (args[1] === "build" || args[1] === "ios"),
  );
  assert.equal(
    new Set(
      frontendInputs.map(
        ({ options }) => options.env.SITUATE_RELEASE_HISTORY_FILE,
      ),
    ).size,
    1,
  );
  assert.ok(
    frontendInputs.every(
      ({ options }) =>
        options.env.SITUATE_RELEASE_HISTORY_SHA256 ===
        manifest.releaseContent.sha256,
    ),
  );
  assert.deepEqual(
    manifest.artifacts.map((artifact) => artifact.path),
    ["Situate-1.2.3-macos-universal.dmg", "Situate-1.2.3-42-ios.ipa"],
  );
  assert.ok(
    manifest.artifacts.every((artifact) =>
      /^[a-f0-9]{64}$/.test(artifact.sha256),
    ),
  );
  assert.equal(manifest.artifacts[0].notarized, true);
  const signatureChecks = options.calls.filter(
    ({ command, args }) =>
      command === "codesign" && args.includes("--test-requirement"),
  );
  assert.equal(signatureChecks.length, 2);
  assert.equal(
    signatureChecks[0].args[
      signatureChecks[0].args.indexOf("--test-requirement") + 1
    ],
    '=anchor apple generic and certificate leaf[subject.OU] = "TEAM123456" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
  );
  assert.equal(manifest.artifacts[1].exportMethod, "app-store-connect");
  assert.equal(manifest.artifacts[1].swiftBuildSystem, undefined);
  const apple = join(options.root, "app/src-tauri/gen/apple");
  assert.equal(
    readFileSync(join(apple, "project.yml"), "utf8"),
    generatedProject,
  );
  assert.equal(
    readFileSync(
      join(apple, "situate-client.xcodeproj/project.pbxproj"),
      "utf8",
    ),
    "original project",
  );
  assert.equal(
    readFileSync(join(output, "Situate.xcarchive/dSYMs/symbols"), "utf8"),
    "symbols",
  );
  assert.equal(
    readFileSync(join(output, "SHA256SUMS"), "utf8").trim().split("\n").length,
    2,
  );
  assert.deepEqual(
    manifest.notarization.map((item) => item.status),
    ["Accepted", "Accepted"],
  );
  const ios = options.calls.find(
    ({ command, args }) =>
      command === process.execPath && args[1] === "ios" && args[2] === "build",
  );
  assert.equal(ios.args[ios.args.indexOf("--target") + 1], "aarch64");
  assert.equal(
    ios.args[ios.args.indexOf("--export-method") + 1],
    "app-store-connect",
  );
  const iosOverlay = JSON.parse(ios.args[ios.args.indexOf("--config") + 1]);
  assert.deepEqual(Object.values(iosOverlay.bundle.resources), [
    "situate-release-history.json",
    "situate-distribution.json",
    "licenses/third-party-native-notices.txt",
    "licenses/rust-runtime-notices.txt",
    "licenses/third-party-js-notices.txt",
    "licenses/situate-licenses.txt",
  ]);
  delete iosOverlay.bundle.resources;
  assert.deepEqual(iosOverlay, {
    identifier: "dev.example.ios",
    bundle: { iOS: { developmentTeam: "TEAM123456", bundleVersion: "42" } },
  });
  assert.ok(ios.args.includes("--locked"));
  assert.ok(!ios.args.includes("--no-sign"));
  assert.ok(!ios.args.includes("--debug"));
  assert.equal(ios.options.env.CARGO_PROFILE_RELEASE_DEBUG, undefined);
  assert.ok(
    !options.calls.some(({ args }) => args.includes("--upload-package")),
  );
  for (const { options: callOptions } of options.calls) {
    assert.equal(
      callOptions.env.PATH.split(delimiter)[
        callOptions.env.CARGO_TARGET_DIR.endsWith(join("cargo", "ios")) ? 1 : 0
      ],
      "/example/project-rust/bin",
    );
    assert.equal(callOptions.env.APPLE_PASSWORD, undefined);
    assert.equal(callOptions.env.IOS_CERTIFICATE, undefined);
    assert.equal(callOptions.env.OTHER_SECRET, undefined);
    assert.equal(callOptions.env.TAURI_CONFIG, undefined);
  }
  assert.ok(!existsSync(join(options.root, "target/local-release/build.lock")));
  assert.ok(!existsSync(join(options.root, "target/ios-xcode/session.lock")));
  assert.ok(!JSON.stringify(manifest).includes(options.settings.notaryProfile));
});

test("dotenv credentials reach Apple tools without entering build environments", async (t) => {
  const options = fixture(t);
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  writeFileSync(
    join(options.root, "../.env"),
    `APPLE_API_KEY=EXAMPLE1234\nAPPLE_API_ISSUER=11111111-2222-3333-4444-555555555555\nAPPLE_API_PRIVATE_KEY="${privateKey}"\nAPPLE_APP_ID=1234567890\nOTHER_SECRET=unrelated\n`,
    { mode: 0o600 },
  );
  const directory = await buildAppleRelease(options);
  const notarization = options.calls.filter(
    ({ args }) => args[0] === "notarytool",
  );
  assert.equal(notarization.length, 5);
  const keyPath =
    notarization[0].args[notarization[0].args.indexOf("--key") + 1];
  assert.ok(keyPath.endsWith(".p8"));
  assert.ok(!existsSync(keyPath));
  for (const { args, options: callOptions } of options.calls) {
    assert.ok(!args.includes(privateKey));
    assert.equal(callOptions.env.APPLE_API_PRIVATE_KEY, undefined);
    assert.equal(callOptions.env.APPLE_API_KEY, undefined);
    assert.equal(callOptions.env.OTHER_SECRET, undefined);
  }
  await uploadAppleRelease({ ...options, directory });
  const upload = options.calls.find(({ args }) =>
    args.includes("--upload-package"),
  );
  assert.ok(upload.args.includes("EXAMPLE1234"));
  assert.ok(
    !existsSync(upload.args[upload.args.indexOf("--p8-file-path") + 1]),
  );
  assert.ok(!options.calls.some(({ command }) => command === "op"));
});

test("notarization rejection retains submission evidence and never produces a complete release", async (t) => {
  const options = fixture(t);
  options.state.notaryStatus = "Invalid";
  await assert.rejects(buildAppleRelease(options), /not accepted/);
  const manifest = failedManifest(options.root);
  assert.equal(manifest.status, "failed");
  assert.equal(manifest.notarization.length, 1);
  assert.equal(manifest.notarization[0].file, "Situate.zip");
  assert.equal(manifest.notarization[0].id, "submission-1");
  assert.equal(manifest.notarization[0].status, "Invalid");
  assert.deepEqual(manifest.artifacts, []);
  assert.ok(!options.calls.some(({ command }) => command === "hdiutil"));
});

test("notarization timeout keeps the submission ID and does not resubmit", async (t) => {
  const options = fixture(t);
  options.state.fail = (command, args) =>
    command === "xcrun" && args[1] === "wait";
  await assert.rejects(buildAppleRelease(options), /Synthetic tool failure/);
  assert.equal(
    failedManifest(options.root).notarization[0].status,
    "submitted",
  );
  assert.equal(
    options.calls.filter(({ args }) => args[1] === "submit").length,
    1,
  );
});

test("an unknown notarization submission blocks a new build until reconciled", async (t) => {
  const options = fixture(t);
  options.state.fail = (command, args) =>
    command === "xcrun" && args[1] === "submit";
  await assert.rejects(buildAppleRelease(options), /Synthetic tool failure/);
  const entry = failedManifest(options.root).notarization[0];
  assert.equal(entry.status, "unknown");
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  const calls = options.calls.length;
  await assert.rejects(
    buildAppleRelease(options),
    /notarization attempt remains unresolved/,
  );
  assert.equal(options.calls.length, calls);
});

test("signature verification failure cannot be downgraded to an unsigned package", async (t) => {
  const options = fixture(t);
  options.state.fail = (command, args) =>
    command === "codesign" && args.includes("--verify");
  await assert.rejects(buildAppleRelease(options), /Synthetic tool failure/);
  assert.equal(failedManifest(options.root).status, "failed");
  assert.ok(!options.calls.some(({ args }) => args[1] === "submit"));
});

test("iOS generation and build failures restore generated project files", async (t) => {
  for (const stage of ["xcodegen", "build"]) {
    const options = fixture(t);
    options.state.fail = (command, args) =>
      stage === "xcodegen"
        ? command === "xcodegen" && args[0] === "generate"
        : command === process.execPath &&
          args[1] === "ios" &&
          args[2] === "build";
    await assert.rejects(
      buildAppleRelease({ ...options, platform: "ios" }),
      /Synthetic tool failure/,
    );
    const apple = join(options.root, "app/src-tauri/gen/apple");
    assert.equal(
      readFileSync(join(apple, "project.yml"), "utf8"),
      generatedProject,
    );
    assert.equal(
      readFileSync(
        join(apple, "situate-client.xcodeproj/project.pbxproj"),
        "utf8",
      ),
      "original project",
    );
  }
});

test("missing new IPA fails despite a successful compiler and stale output", async (t) => {
  const options = fixture(t);
  options.platform = "ios";
  const previous = join(options.root, "app/src-tauri/gen/apple/build/arm64");
  mkdirSync(previous, { recursive: true });
  writeFileSync(join(previous, "old.ipa"), "old");
  options.state.missingIpa = true;
  await assert.rejects(buildAppleRelease(options), /exactly one .ipa/);
  assert.equal(failedManifest(options.root).status, "failed");
});

test("device exports reject unexpected app identity, expired profiles and ad-hoc signing", async (t) => {
  for (const change of [
    { appInfo: { CFBundleIdentifier: "dev.wrong.app" } },
    { appInfo: { DTPlatformName: "iphonesimulator" } },
    { appInfo: { CFBundleVersion: "41" } },
    { profile: { ExpirationDate: "2000-01-01T00:00:00Z" } },
    { profile: { ProvisionedDevices: true } },
    { profile: { TeamIdentifier: ["WRONG12345"] } },
    { profile: { CertificateSha256: [] } },
    { entitlements: { "get-task-allow": true } },
    { entitlements: { "application-identifier": "TEAM123456.dev.other.app" } },
    {
      profile: {
        Entitlements: {
          "application-identifier": "TEAM123456.dev.example.ios",
          "get-task-allow": true,
        },
      },
    },
  ]) {
    const options = fixture(t);
    Object.assign(options.state, change);
    await assert.rejects(
      buildAppleRelease({ ...options, platform: "ios" }),
      /does not match|provisioning profile/,
    );
    assert.deepEqual(failedManifest(options.root).artifacts, []);
  }
});

test("historical App ID prefixes remain valid when signing team and entitlements match", async (t) => {
  const options = fixture(t);
  options.state.profile = {
    ApplicationIdentifierPrefix: ["LEGACY1234"],
    Entitlements: {
      "application-identifier": "LEGACY1234.dev.example.ios",
      "get-task-allow": false,
    },
  };
  options.state.entitlements = {
    "application-identifier": "LEGACY1234.dev.example.ios",
  };
  const output = await buildAppleRelease({ ...options, platform: "ios" });
  assert.equal(
    JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")).status,
    "complete",
  );
});

test("a missing bundled privacy manifest fails the iOS release", async (t) => {
  const options = fixture(t);
  options.state.missingPrivacy = true;
  await assert.rejects(
    buildAppleRelease({ ...options, platform: "ios" }),
    /privacy manifest/,
  );
  assert.equal(failedManifest(options.root).status, "failed");
});

test("existing release locks and iOS session locks are preserved", async (t) => {
  for (const path of [
    "target/local-release/build.lock",
    "target/ios-xcode/session.lock",
  ]) {
    const options = fixture(t);
    const lock = join(options.root, path);
    mkdirSync(join(lock, ".."), { recursive: true });
    writeFileSync(lock, "owned by another process");
    await assert.rejects(buildAppleRelease(options), /lock exists/);
    assert.equal(readFileSync(lock, "utf8"), "owned by another process");
    assert.ok(
      !options.calls.some(({ command }) => command === process.execPath),
    );
  }
});

test("output symlinks cannot redirect builds outside the checkout", async (t) => {
  const options = fixture(t);
  const external = fixture(t).root;
  symlinkSync(external, join(options.root, "target"), "junction");
  await assert.rejects(buildAppleRelease(options), /symbolic link/);
  assert.ok(!existsSync(join(external, "apple-release")));
});

test("combined release uploads exactly its new iOS artifact after building all selected platforms", async (t) => {
  for (const platform of ["ios", "all"]) {
    const options = fixture(t);
    const output = await runAppleRelease({
      ...options,
      platform,
      uploadTestFlight: true,
    });
    const manifest = JSON.parse(
      readFileSync(join(output, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.status, "complete");
    assert.deepEqual(
      manifest.artifacts.map((a) => a.platform),
      platform === "all" ? ["macos", "ios"] : ["ios"],
    );
    const uploads = options.calls.filter(({ args }) =>
      args.includes("--upload-package"),
    );
    assert.equal(uploads.length, 1);
    assert.equal(
      uploads[0].args[uploads[0].args.indexOf("--upload-package") + 1],
      join(output, "Situate-1.2.3-42-ios.ipa"),
    );
    assert.equal(
      JSON.parse(readFileSync(join(output, "upload.json"), "utf8")).status,
      "processing",
    );
    const validation = options.calls.findIndex(({ args }) =>
      args.includes("--validate-app"),
    );
    const signing = options.calls.findIndex(({ args }) =>
      args.some((arg) => arg.startsWith("--extract-certificates=")),
    );
    assert.ok(validation > signing && signing >= 0);
  }
});

test("build-only and check modes do not upload, and macOS-only uploads are rejected", async (t) => {
  for (const platform of ["macos", "ios"]) {
    const options = fixture(t);
    await runAppleRelease({ ...options, platform });
    assert.ok(
      !options.calls.some(({ args }) => args.includes("--upload-package")),
    );
  }
  const options = fixture(t);
  assert.equal(
    await runAppleRelease({ ...options, uploadTestFlight: true, check: true }),
    undefined,
  );
  assert.ok(!existsSync(join(options.root, "artifacts")));
  assert.ok(
    !options.calls.some(
      ({ args }) =>
        args.includes("--validate-app") || args.includes("--upload-package"),
    ),
  );
  await assert.rejects(
    runAppleRelease({ ...options, platform: "macos", uploadTestFlight: true }),
    /requires --platform ios or all/,
  );
});

test("combined release refuses missing upload prerequisites before building", async (t) => {
  for (const failure of ["credentials", "tool"]) {
    const options = fixture(t);
    if (failure === "credentials") delete options.settings.appStoreConnect;
    else
      options.state.fail = (command, args) =>
        command === "xcrun" && args[0] === "--find" && args[1] === "altool";
    await assert.rejects(
      runAppleRelease({ ...options, platform: "ios", uploadTestFlight: true }),
      failure === "credentials"
        ? /Configure appStoreConnect/
        : /Synthetic tool failure/,
    );
    assert.ok(!existsSync(join(options.root, "artifacts")));
    assert.ok(
      !options.calls.some(({ command }) => command === process.execPath),
    );
  }
});

test("failed builds never upload an older complete package", async (t) => {
  const options = fixture(t);
  const previous = await buildAppleRelease({ ...options, platform: "ios" });
  options.calls.length = 0;
  options.state.missingIpa = true;
  await assert.rejects(
    runAppleRelease({ ...options, uploadTestFlight: true }),
    /Expected exactly one/,
  );
  assert.ok(!existsSync(join(previous, "upload.json")));
  assert.ok(
    !options.calls.some(
      ({ args }) =>
        args.includes("--validate-app") || args.includes("--upload-package"),
    ),
  );
});

test("cancellation before upload preserves the finished package without submitting it", async (t) => {
  const options = fixture(t);
  const controller = new AbortController();
  const execute = async (command, args, config) => {
    const result = await options.execute(command, args, config);
    if (
      command === "codesign" &&
      args.some((arg) => arg.startsWith("--extract-certificates="))
    )
      controller.abort(new Error("Release cancelled"));
    return result;
  };
  await assert.rejects(
    runAppleRelease({
      ...options,
      platform: "ios",
      uploadTestFlight: true,
      execute,
      signal: controller.signal,
    }),
    /Release cancelled/,
  );
  assert.equal(failedManifest(options.root).status, "complete");
  assert.ok(
    !options.calls.some(
      ({ args }) =>
        args.includes("--validate-app") || args.includes("--upload-package"),
    ),
  );
});

test("combined release propagates upload failures without retrying or invalidating the build", async (t) => {
  for (const stage of ["--validate-app", "--upload-package"]) {
    const options = fixture(t);
    options.state.fail = (_command, args) => args.includes(stage);
    await assert.rejects(
      runAppleRelease({ ...options, platform: "ios", uploadTestFlight: true }),
      /Synthetic tool failure/,
    );
    const output = join(
      options.root,
      "artifacts",
      readdirSync(join(options.root, "artifacts"))[0],
    );
    assert.equal(
      JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")).status,
      "complete",
    );
    assert.equal(
      JSON.parse(readFileSync(join(output, "upload.json"), "utf8")).status,
      stage === "--validate-app" ? "validation-failed" : "unknown",
    );
    assert.equal(
      options.calls.filter(({ args }) => args.includes("--upload-package"))
        .length,
      stage === "--validate-app" ? 0 : 1,
    );
  }
});

test("TestFlight upload is separate, validates first and stores no credentials in its receipt", async (t) => {
  const options = fixture(t);
  const directory = await buildAppleRelease({ ...options, platform: "ios" });
  options.calls.length = 0;
  await uploadAppleRelease({ ...options, directory });
  const actions = options.calls.filter(({ args }) => args[0] === "altool");
  assert.equal(actions.length, 2);
  assert.ok(actions[0].args.includes("--validate-app"));
  assert.ok(actions[1].args.includes("--upload-package"));
  assert.ok(actions[1].args.includes("dev.example.ios"));
  assert.ok(actions[1].args.includes("1234567890"));
  assert.ok(!actions[1].args.includes("synthetic key"));
  const receipt = readFileSync(join(directory, "upload.json"), "utf8");
  assert.equal(JSON.parse(receipt).status, "processing");
  assert.equal(
    JSON.parse(readFileSync(join(directory, "upload-response.json"), "utf8"))
      .stdout,
    JSON.stringify({
      "delivery-id": "11111111-2222-3333-4444-555555555555",
      status: "PROCESSING",
    }),
  );
  assert.ok(actions[1].args.includes("--wait"));
  assert.ok(actions[1].args.includes("--output-format"));
  assert.ok(!receipt.includes(options.settings.appStoreConnect.apiKeyPath));
  assert.ok(!receipt.includes(options.settings.appStoreConnect.apiKeyId));
  await assert.rejects(
    uploadAppleRelease({ ...options, directory }),
    /receipt already exists/,
  );
});

test("successful upload preserves multiple tool response documents without resubmission", async (t) => {
  const options = fixture(t);
  options.state.uploadResponse =
    '{"delivery-id":"example-delivery"}\n{"processing-state":"VALID"}\n';
  const directory = await buildAppleRelease({ ...options, platform: "ios" });
  await uploadAppleRelease({ ...options, directory });
  assert.equal(
    JSON.parse(readFileSync(join(directory, "upload.json"), "utf8")).status,
    "processing",
  );
  assert.equal(
    JSON.parse(readFileSync(join(directory, "upload-response.json"), "utf8"))
      .stdout,
    options.state.uploadResponse,
  );
  await assert.rejects(
    uploadAppleRelease({ ...options, directory }),
    /receipt already exists/,
  );
  assert.equal(
    options.calls.filter(({ args }) => args.includes("--upload-package"))
      .length,
    1,
  );
});

test("an uncertain upload cannot be automatically submitted again", async (t) => {
  const options = fixture(t);
  const directory = await buildAppleRelease({ ...options, platform: "ios" });
  options.state.fail = (_command, args) => args.includes("--upload-package");
  await assert.rejects(
    uploadAppleRelease({ ...options, directory }),
    /Synthetic tool failure/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(directory, "upload.json"), "utf8")).status,
    "unknown",
  );
  await assert.rejects(
    uploadAppleRelease({ ...options, directory }),
    /receipt already exists/,
  );
  assert.equal(
    options.calls.filter(({ args }) => args.includes("--upload-package"))
      .length,
    1,
  );
});

test("a failed validation never attempts upload", async (t) => {
  const options = fixture(t);
  const directory = await buildAppleRelease({ ...options, platform: "ios" });
  options.state.fail = (_command, args) => args.includes("--validate-app");
  await assert.rejects(
    uploadAppleRelease({ ...options, directory }),
    /Synthetic tool failure/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(directory, "upload.json"), "utf8")).status,
    "validation-failed",
  );
  assert.ok(
    !options.calls.some(({ args }) => args.includes("--upload-package")),
  );
});

test("release and upload run with simulated POSIX file metadata", async (t) => {
  applePosixFixture(t, "win32");
  const options = fixture(t);
  const directory = await runAppleRelease({
    ...options,
    platform: "all",
    uploadTestFlight: true,
  });
  assert.equal(
    JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")).status,
    "complete",
  );
  assert.equal(
    options.calls.filter(({ args }) => args.includes("--upload-package"))
      .length,
    1,
  );
});

test("upload credentials reject foreign owners and multiply linked keys", (t) => {
  const { root, settings } = fixture(t);
  const original = fs.lstatSync;
  const mocked = t.mock.method(fs, "lstatSync", (...args) => {
    const stat = original(...args);
    stat.uid = process.getuid() + 1;
    return stat;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => uploadCredentials(settings, root),
      /owned, private regular file/,
    );
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  const key = settings.appStoreConnect.apiKeyPath;
  linkSync(key, `${key}.link`);
  assert.throws(
    () => uploadCredentials(settings, root),
    /owned, private regular file/,
  );
});

test("direct release refuses missing signing configuration before invoking external tools", async (t) => {
  const options = fixture(t);
  await assert.rejects(
    buildAppleRelease({ ...options, distribution: "direct", check: true }),
    /Direct releases require/,
  );
  assert.equal(options.calls.length, 0);
});

test("direct release checks live publication migrations before building or notarizing", async (t) => {
  const options = fixture(t);
  let checked = false;
  await assert.rejects(
    buildAppleRelease({
      ...options,
      platform: "macos",
      distribution: "direct",
      qualifyMigrations(repoRoot, { environment }) {
        assert.equal(repoRoot, dirname(options.root));
        assert.equal(
          environment.WEBSITE_DEPLOY_HOST,
          "release.example.invalid",
        );
        checked = true;
        throw new Error("Published migration changed or disappeared");
      },
      environment: {
        ...options.environment,
        WEBSITE_DEPLOY_HOST: "release.example.invalid",
        SITUATE_UPDATER_PUBLIC_KEY: "synthetic-public-input",
        TAURI_SIGNING_PRIVATE_KEY: "synthetic-private-input",
      },
    }),
    /Published migration changed/u,
  );
  assert.equal(checked, true);
  assert.ok(
    !options.calls.some(
      (call) => call.command === process.execPath && call.args[1] === "build",
    ),
  );
  assert.ok(
    !options.calls.some(
      (call) => call.command === "xcrun" && call.args[1] === "submit",
    ),
  );
});

test("direct release pins migration qualification and rejects a checkout change before building", async (t) => {
  const options = fixture(t);
  let current = "b".repeat(40);
  await assert.rejects(
    buildAppleRelease({
      ...options,
      platform: "macos",
      distribution: "direct",
      execute(command, args, config) {
        if (command === "git" && args[0] === "rev-parse") return current;
        return options.execute(command, args, config);
      },
      qualifyMigrations(repoRoot, { revision }) {
        assert.equal(revision, "b".repeat(40));
        current = "c".repeat(40);
        return options.qualifyMigrations(repoRoot);
      },
      environment: {
        ...options.environment,
        SITUATE_UPDATER_PUBLIC_KEY: "synthetic-public-input",
        TAURI_SIGNING_PRIVATE_KEY: "synthetic-private-input",
      },
    }),
    /same clean revision during qualification/u,
  );
  assert.ok(
    !options.calls.some(
      (call) => call.command === process.execPath && call.args[1] === "build",
    ),
  );
});

test("direct release rejects an uncommitted source before building or notarizing", async (t) => {
  const options = fixture(t);
  const execute = async (command, args, config) =>
    command === "git"
      ? args[0] === "rev-parse"
        ? "b".repeat(40)
        : " M source.mjs"
      : options.execute(command, args, config);
  await assert.rejects(
    buildAppleRelease({
      ...options,
      platform: "macos",
      distribution: "direct",
      execute,
      environment: {
        ...options.environment,
        SITUATE_UPDATER_PUBLIC_KEY: "synthetic-public-input",
        TAURI_SIGNING_PRIVATE_KEY: "synthetic-private-input",
      },
    }),
    /clean committed source/,
  );
  assert.ok(
    !options.calls.some(
      (call) => call.command === process.execPath && call.args[1] === "build",
    ),
  );
  assert.ok(
    !options.calls.some(
      (call) => call.command === "xcrun" && call.args[1] === "submit",
    ),
  );
});

test(
  "direct archive and DMG use the same stapled app and signing secrets reach only the signer",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const options = fixture(t);
    const signer = createUpdaterSignerFixture();
    options.state.appInfo = {
      LSMinimumSystemVersion: "13.0",
      CFBundleExecutable: "situate",
    };
    let staging;
    let archivePath;
    const calls = [];
    const execute = async (command, args, config) => {
      calls.push({ command, args, config });
      if (command === "git")
        return args[0] === "rev-parse" ? "b".repeat(40) : "";
      if (command === process.execPath && args[1] === "signer") {
        assert.deepEqual(args.slice(1, 5), [
          "signer",
          "sign",
          "--app-version",
          "1.2.3",
        ]);
        assert.equal(
          config.env.TAURI_SIGNING_PRIVATE_KEY,
          "synthetic-private-input",
        );
        writeFileSync(
          `${args.at(-1)}.sig`,
          signer.sign(readFileSync(args.at(-1))),
        );
        return "";
      }
      assert.equal(config.env.TAURI_SIGNING_PRIVATE_KEY, undefined);
      assert.equal(config.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, undefined);
      if (command === "tar") {
        staging = args[args.indexOf("-C") + 1];
        archivePath = args[1];
        return execFileSync(command, args, {
          encoding: "utf8",
          env: config.env,
        });
      }
      if (command === "python3" && args[1]?.startsWith("import tarfile"))
        return execFileSync(command, args, { encoding: "utf8" });
      if (command === "hdiutil" && args[0] === "attach") {
        cpSync(
          join(staging, "Situate.app"),
          join(args[args.indexOf("-mountpoint") + 1], "Situate.app"),
          { recursive: true, verbatimSymlinks: true },
        );
        return "";
      }
      if (command === "hdiutil" && args[0] === "detach") return "";
      if (command === "lipo") return "x86_64 arm64";
      if (command === process.execPath && args[1] === "ios") {
        assert.equal(config.env.SITUATE_DISTRIBUTION, "external");
        assert.equal(config.env.SITUATE_UPDATER_PUBLIC_KEY, undefined);
        assert.equal(config.env.SITUATE_UPDATER_ENDPOINT, undefined);
      }
      const result = await options.execute(command, args, config);
      if (command === process.execPath && args[1] === "build") {
        assert.equal(config.env.SITUATE_DISTRIBUTION, "direct");
        assert.equal(config.env.SITUATE_UPDATER_PUBLIC_KEY, signer.publicKey);
        const resource = JSON.parse(args[args.indexOf("--config") + 1]).bundle
          .resources;
        const app = join(
          config.env.CARGO_TARGET_DIR,
          "universal-apple-darwin/release/bundle/macos/Situate.app",
        );
        mkdirSync(join(app, "Contents/Resources"), { recursive: true });
        cpSync(
          Object.keys(resource)[0],
          join(app, "Contents/Resources/situate-distribution.json"),
        );
        symlinkSync("Info.plist", join(app, "Contents/info-link"));
      }
      return result;
    };
    const output = await buildAppleRelease({
      ...options,
      platform: "all",
      distribution: "direct",
      execute,
      environment: {
        ...options.environment,
        SITUATE_UPDATER_PUBLIC_KEY: signer.publicKey,
        TAURI_SIGNING_PRIVATE_KEY: "synthetic-private-input",
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "synthetic-password",
      },
    });
    const manifest = JSON.parse(
      readFileSync(join(output, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.status, "complete");
    assert.equal(manifest.artifacts[0].distribution, "direct");
    assert.deepEqual(
      manifest.migrationQualification,
      options.qualifyMigrations(dirname(options.root)),
    );
    assert.deepEqual(
      manifest.artifacts[0].buildConfiguration.migrationQualification,
      manifest.migrationQualification,
    );
    assert.equal(manifest.artifacts[1].distribution, "external");
    assert.ok(archivePath.endsWith("-direct.app.tar.gz"));
    assert.equal(
      readFileSync(join(output, "SHA256SUMS"), "utf8").trim().split("\n")
        .length,
      4,
    );
    assert.ok(!JSON.stringify(manifest).includes("synthetic-private-input"));
    const tarIndex = calls.findIndex((call) => call.command === "tar");
    assert.ok(
      calls
        .slice(0, tarIndex)
        .some(
          (call) =>
            call.command === "xcrun" &&
            call.args[0] === "stapler" &&
            call.args[1] === "staple" &&
            call.args[2].endsWith(".app"),
        ),
    );
  },
);

test("upload rejects modified packages, foreign identities and public private-key files before contacting Apple", async (t) => {
  for (const failure of [
    "checksum",
    "identifier",
    "key-permissions",
    "manifest",
  ]) {
    const options = fixture(t);
    const directory = await buildAppleRelease({ ...options, platform: "ios" });
    if (failure === "checksum")
      writeFileSync(join(directory, "Situate-1.2.3-42-ios.ipa"), "modified");
    if (failure === "identifier")
      options.settings.iosBundleIdentifier = "dev.wrong.app";
    if (failure === "key-permissions")
      chmodSync(options.settings.appStoreConnect.apiKeyPath, 0o644);
    if (failure === "manifest") {
      const path = join(directory, "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.status = "failed";
      writeFileSync(path, JSON.stringify(manifest));
    }
    options.calls.length = 0;
    await assert.rejects(
      uploadAppleRelease({ ...options, directory }),
      /IPA is missing|complete Apple release|private regular file/,
    );
    assert.equal(options.calls.length, 0);
  }
});
