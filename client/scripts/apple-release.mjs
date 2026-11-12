import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { acquireIosProject, assertLocalPath } from "./ios-project-lock.mjs";
import { run, syncAppIcons } from "./ios-xcode.mjs";
import {
  notaryAuthentication,
  readAppleEnv,
  withAppleCredentials,
} from "./apple-credentials.mjs";

import {
  updaterSigningConfiguration,
  verifyUpdaterSignature,
} from "./updater-signing.mjs";
import {
  bundleDigest,
  verifyDirectPayloads,
} from "./direct-release-verification.mjs";

import {
  compileBuildReleaseHistory,
  releaseContent,
  releaseHistoryAsset,
  releaseHistoryBytes,
  verifyReleaseHistoryResource,
} from "./release-history.mjs";

import { qualifyPublishedMigrations } from "../../tools/published-migrations.mjs";
import { qualifyMigrationHistory } from "../../tools/migration-history.mjs";
import { assertNoDictationTtsResources } from "./dictation-resources.mjs";
import {
  collectNativeLicenses,
  verifyLicenseResources,
} from "./native-licenses.mjs";
import {
  bindNativeLicenses,
  frontendLicenseAsset,
  verifyFrontendLicenses,
} from "./native-licenses-frontend.mjs";

const macTargets = {
  arm64: "aarch64-apple-darwin",
  x64: "x86_64-apple-darwin",
  universal: "universal-apple-darwin",
};

export function applePlan({
  settings,
  platform = "macos",
  macosArch = "universal",
  buildNumber,
  distribution = "external",
  host = process.platform,
}) {
  if (!["direct", "external"].includes(distribution))
    throw new Error("Use --distribution direct or external.");
  if (host !== "darwin")
    throw new Error("Apple distribution builds require macOS.");
  const platforms = platform === "all" ? ["macos", "ios"] : [platform];
  if (!platforms.every((item) => ["macos", "ios"].includes(item)))
    throw new Error("Use --platform macos, ios or all.");
  if (!/^[A-Z0-9]{10}$/.test(settings.teamId ?? ""))
    throw new Error(
      "Configure APPLE_TEAM_ID in the repository-root .env or environment, or teamId in .apple-release.local.json.",
    );
  if (!macTargets[macosArch])
    throw new Error("Use --macos-arch universal, arm64 or x64.");
  if (platforms.includes("macos")) {
    if (!settings.macosSigningIdentity || settings.macosSigningIdentity === "-")
      throw new Error(
        "Configure APPLE_MACOS_SIGNING_IDENTITY with a Developer ID Application identity in the repository-root .env or environment, or macosSigningIdentity in .apple-release.local.json.",
      );
  }
  if (platforms.includes("ios")) {
    if (
      !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(
        settings.iosBundleIdentifier ?? "",
      )
    )
      throw new Error(
        "Configure the registered iosBundleIdentifier before building for TestFlight.",
      );
    if (!/^[1-9][0-9]{0,3}$/.test(buildNumber ?? ""))
      throw new Error(
        "iOS requires --build-number (1–9999), higher than previous uploads of this version.",
      );
  }
  const rustTargets = [];
  if (platforms.includes("macos"))
    rustTargets.push(
      ...(macosArch === "universal"
        ? [macTargets.arm64, macTargets.x64]
        : [macTargets[macosArch]]),
    );
  if (platforms.includes("ios")) rustTargets.push("aarch64-apple-ios");
  return {
    platforms,
    distribution: platforms.includes("macos") ? distribution : "external",
    macosArch,
    macosTarget: macTargets[macosArch],
    buildNumber,
    rustTargets,
  };
}

export function appleEnvironment(environment, root) {
  // Distribution builds use Keychain/Xcode accounts, never ambient signing overrides.
  const env = Object.fromEntries(
    [
      "HOME",
      "USER",
      "LOGNAME",
      "PATH",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "DEVELOPER_DIR",
      "RUSTUP_HOME",
      "CARGO_HOME",
    ]
      .filter((key) => environment[key] !== undefined)
      .map((key) => [key, environment[key]]),
  );
  env.PATH = [dirname(process.execPath), env.PATH]
    .filter(Boolean)
    .join(delimiter);
  env.CARGO_TARGET_DIR = join(root, "target/apple-release/cargo");
  return env;
}

function jsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadAppleSettings(
  root,
  path = join(root, ".apple-release.local.json"),
  environment = process.env,
) {
  const fields = {
    APPLE_TEAM_ID: "teamId",
    APPLE_MACOS_SIGNING_IDENTITY: "macosSigningIdentity",
  };
  const names = Object.keys(fields);
  const ci = environment.CI === "true";
  let settings = {};
  if (!ci && existsSync(path)) {
    try {
      settings = jsonFile(path);
      if (!settings || typeof settings !== "object" || Array.isArray(settings))
        throw new Error();
    } catch {
      throw new Error(
        "Cannot read Apple signing settings as a JSON object. Check .apple-release.local.json.",
      );
    }
  }
  const local =
    ci || names.every((name) => Object.hasOwn(environment, name))
      ? {}
      : readAppleEnv(root, names);
  for (const [name, field] of Object.entries(fields)) {
    if (Object.hasOwn(environment, name)) settings[field] = environment[name];
    else if (Object.hasOwn(local, name)) settings[field] = local[name];
  }
  if (!/^[A-Z0-9]{10}$/.test(settings.teamId ?? ""))
    throw new Error(
      "Configure APPLE_TEAM_ID in the repository-root .env or environment, or teamId in .apple-release.local.json. See Apple distribution in client/README.md.",
    );
  if (!Object.hasOwn(settings, "iosBundleIdentifier"))
    settings.iosBundleIdentifier = jsonFile(
      join(root, "app/src-tauri/tauri.conf.json"),
    ).identifier;
  return settings;
}

export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function onlyArtifact(directory, extension) {
  const find = (folder) =>
    existsSync(folder)
      ? readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
          const path = join(folder, entry.name);
          const isDirectory = [".app", ".xcarchive"].includes(extension);
          if (
            entry.name.endsWith(extension) &&
            (isDirectory ? entry.isDirectory() : entry.isFile())
          )
            return [path];
          return entry.isDirectory() ? find(path) : [];
        })
      : [];
  const matches = find(directory);
  if (matches.length !== 1)
    throw new Error(
      `Expected exactly one ${extension} artifact in ${directory}; found ${matches.length}.`,
    );
  return matches[0];
}

function saveManifest(output, manifest) {
  writeFileSync(
    join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function pendingNotarization(root) {
  const path = join(root, "target/apple-release/notary-pending.json");
  assertLocalPath(root, path);
  return path;
}

export async function checkApplePrerequisites({
  root,
  settings,
  plan,
  execute = run,
  environment = process.env,
  signal,
}) {
  const env = appleEnvironment(environment, root);
  if (plan.platforms.includes("macos") && existsSync(pendingNotarization(root)))
    throw new Error(
      "A notarization attempt remains unresolved in target/apple-release/notary-pending.json. Reconcile it with Apple before removing the journal and starting another build.",
    );
  const options = { cwd: root, env, signal, capture: true };
  const cli = join(root, "node_modules/@tauri-apps/cli/tauri.js");
  if (!existsSync(cli))
    throw new Error(
      "Install client dependencies with npm ci --include=dev first.",
    );
  const rustc = (await execute("rustup", ["which", "rustc"], options)).trim();
  if (!isAbsolute(rustc) || basename(rustc) !== "rustc")
    throw new Error("rustup did not resolve the project Rust compiler.");
  // A system Cargo/Rust installation may precede rustup's toolchain on PATH.
  env.PATH = [dirname(rustc), env.PATH].join(delimiter);
  await execute("xcode-select", ["-p"], options);
  await execute("xcrun", ["--find", "xcodebuild"], options);
  const installed = (
    await execute("rustup", ["target", "list", "--installed"], options)
  ).split(/\s+/);
  const missing = plan.rustTargets.filter(
    (target) => !installed.includes(target),
  );
  if (missing.length)
    throw new Error(
      `Missing Rust targets. Run in client/: rustup target add ${missing.join(" ")}`,
    );
  const identities = await execute(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    options,
  );
  if (plan.platforms.includes("macos")) {
    if (!settings.appleApiKey && !settings.notaryProfile?.trim())
      throw new Error(
        "Configure Apple API credentials in the repository-root .env or explicitly select a notaryProfile.",
      );
    const matching = [
      ...identities.matchAll(/\b([A-Fa-f0-9]{40}) "([^"]+)"/g),
    ].some(
      ([, hash, name]) =>
        (hash === settings.macosSigningIdentity ||
          name === settings.macosSigningIdentity) &&
        name.startsWith("Developer ID Application:") &&
        name.endsWith(`(${settings.teamId})`),
    );
    if (!matching)
      throw new Error(
        "The selected Developer ID Application identity is not valid for teamId in this Keychain.",
      );
    await execute("xcrun", ["--find", "stapler"], options);
    try {
      await execute(
        "xcrun",
        [
          "notarytool",
          "history",
          ...notaryAuthentication(settings),
          "--output-format",
          "json",
        ],
        options,
      );
    } catch {
      throw new Error(
        "Notarization credentials are unavailable or rejected. Check the configured Apple API credentials or selected Keychain profile.",
      );
    }
  }
  if (plan.platforms.includes("ios")) {
    await execute("xcodegen", ["--version"], options);
    await execute("pod", ["--version"], options);
    await execute("python3", ["--version"], options);
    if (!/Apple (Development|Distribution):/.test(identities))
      throw new Error(
        "Configure an Apple signing identity in Xcode Accounts first. Xcode must also have access to teamId.",
      );
  }
  return { cli, env };
}

async function readPlist(path, execute, options) {
  return JSON.parse(
    await execute("plutil", ["-convert", "json", "-o", "-", path], {
      ...options,
      capture: true,
    }),
  );
}

async function verifyApp(
  app,
  { identifier, version, buildNumber, teamId, macos },
  execute,
  options,
) {
  const info = await readPlist(
    join(app, macos ? "Contents/Info.plist" : "Info.plist"),
    execute,
    options,
  );
  if (
    info.CFBundleIdentifier !== identifier ||
    info.CFBundleShortVersionString !== version ||
    (buildNumber && info.CFBundleVersion !== buildNumber) ||
    (!macos && info.DTPlatformName !== "iphoneos")
  )
    throw new Error(
      "Built app identity, version or device platform does not match the requested release.",
    );
  const requirement =
    `=anchor apple generic and certificate leaf[subject.OU] = "${teamId}"` +
    (macos
      ? " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
      : " and certificate leaf[field.1.2.840.113635.100.6.1.4] exists");
  await execute(
    "codesign",
    ["--verify", "--deep", "--strict", "--test-requirement", requirement, app],
    options,
  );
}

async function notarize(path, settings, execute, options, report) {
  // A journal exists before submission, including when Apple's response never arrives.
  const journal = pendingNotarization(options.cwd);
  const entry = {
    file: basename(path),
    sha256: sha256(path),
    status: "submitting",
  };
  const handle = openSync(journal, "wx", 0o600);
  const save = () => {
    writeFileSync(journal, `${JSON.stringify(entry, null, 2)}\n`);
    fsyncSync(handle);
    report({ ...entry });
  };
  try {
    save();
    const submission = JSON.parse(
      await execute(
        "xcrun",
        [
          "notarytool",
          "submit",
          path,
          ...notaryAuthentication(settings),
          "--output-format",
          "json",
        ],
        { ...options, capture: true },
      ),
    );
    if (!submission.id)
      throw new Error(
        "Notary service returned no submission ID; inspect submission history before retrying.",
      );
    entry.id = submission.id;
    entry.status = "submitted";
    save();
    const result = JSON.parse(
      await execute(
        "xcrun",
        [
          "notarytool",
          "wait",
          submission.id,
          ...notaryAuthentication(settings),
          "--timeout",
          "30m",
          "--output-format",
          "json",
        ],
        { ...options, capture: true },
      ),
    );
    entry.status = result.status ?? "unknown";
    save();
    if (entry.status !== "Accepted")
      throw new Error(
        `Notarization is not accepted (${entry.status}). Inspect the recorded submission before retrying.`,
      );
    rmSync(journal);
  } catch (error) {
    if (!entry.id) {
      entry.status = "unknown";
      save();
    }
    throw error;
  } finally {
    closeSync(handle);
  }
}

async function buildMac({
  root,
  output,
  scratch,
  plan,
  settings,
  config,
  cli,
  execute,
  options,
  report,
  updater,
  provenance,
  historyFile,
  historyBinding,
  licenseResources,
}) {
  const buildConfiguration = updater
    ? { ...updater.public, ...provenance }
    : { distribution: "external", ...provenance };
  const identityFile = join(scratch, "situate-distribution.json");
  writeFileSync(identityFile, JSON.stringify(buildConfiguration));
  options = {
    ...options,
    env: {
      ...options.env,
      SITUATE_DISTRIBUTION: plan.distribution,
      ...(updater
        ? {
            SITUATE_UPDATER_PUBLIC_KEY: updater.public.publicKey,
            SITUATE_UPDATER_ENDPOINT: updater.public.endpoint,
          }
        : {}),
    },
  };
  const source = join(
    options.env.CARGO_TARGET_DIR,
    plan.macosTarget,
    "release/bundle",
  );
  assertLocalPath(root, source);
  rmSync(source, { recursive: true, force: true });
  await execute(
    process.execPath,
    [
      cli,
      "build",
      "--ci",
      "--target",
      plan.macosTarget,
      "--bundles",
      "app",
      "--config",
      JSON.stringify({
        bundle: {
          resources: {
            [identityFile]: "situate-distribution.json",
            [historyFile]: releaseHistoryAsset,
            ...licenseResources,
          },
          macOS: {
            signingIdentity: settings.macosSigningIdentity,
            hardenedRuntime: true,
          },
        },
      }),
      "--",
      "--locked",
    ],
    { ...options, cwd: join(root, "app") },
  );
  verifyFrontendLicenses(root, options.env);
  const staging = join(scratch, "dmg");
  mkdirSync(staging);
  const app = join(staging, "Situate.app");
  cpSync(onlyArtifact(source, ".app"), app, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await verifyApp(
    app,
    {
      identifier: config.identifier,
      version: config.version,
      teamId: settings.teamId,
      macos: true,
    },
    execute,
    options,
  );
  verifyReleaseHistoryResource(app, historyBinding, config.version);
  if (
    !isDeepStrictEqual(
      jsonFile(join(app, "Contents/Resources/situate-distribution.json")),
      buildConfiguration,
    )
  )
    throw new Error(
      "Signed macOS build configuration does not match the build input.",
    );
  verifyLicenseResources(app, licenseResources);
  await assertNoDictationTtsResources(app);
  const zip = join(scratch, "Situate.zip");
  await execute("ditto", ["-c", "-k", "--keepParent", app, zip], options);
  await notarize(zip, settings, execute, options, report);
  await execute("xcrun", ["stapler", "staple", app], options);
  await execute("xcrun", ["stapler", "validate", app], options);
  await execute("spctl", ["--assess", "--type", "execute", app], options);
  symlinkSync("/Applications", join(staging, "Applications"));
  const dmg = join(
    output,
    `Situate-${config.version}-macos-${plan.macosArch}${updater ? "-direct" : ""}.dmg`,
  );
  await execute(
    "hdiutil",
    [
      "create",
      "-volname",
      "Situate",
      "-srcfolder",
      staging,
      "-format",
      "UDZO",
      dmg,
    ],
    options,
  );
  await execute(
    "codesign",
    ["--sign", settings.macosSigningIdentity, "--timestamp", dmg],
    options,
  );
  await notarize(dmg, settings, execute, options, report);
  await execute("xcrun", ["stapler", "staple", dmg], options);
  await execute("xcrun", ["stapler", "validate", dmg], options);
  await execute("codesign", ["--verify", "--strict", dmg], options);
  await execute(
    "spctl",
    [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      dmg,
    ],
    options,
  );
  const artifact = {
    platform: "macos",
    distribution: plan.distribution,
    path: basename(dmg),
    sha256: sha256(dmg),
    size: statSync(dmg).size,
    architecture: plan.macosArch,
    notarized: true,
    buildConfiguration,
  };
  if (updater) {
    const info = await readPlist(
      join(app, "Contents/Info.plist"),
      execute,
      options,
    );
    if (
      !/^\d+\.\d+(?:\.\d+)?$/.test(info.LSMinimumSystemVersion ?? "") ||
      !info.CFBundleExecutable
    )
      throw new Error(
        "Direct releases require a declared minimum macOS version and executable.",
      );
    const archive = join(
      output,
      `Situate-${config.version}-macos-${plan.macosArch}-direct.app.tar.gz`,
    );
    await execute("tar", ["-czf", archive, "-C", staging, "Situate.app"], {
      ...options,
      env: { ...options.env, COPYFILE_DISABLE: "1" },
    });
    try {
      await execute(
        process.execPath,
        [cli, "signer", "sign", "--app-version", config.version, archive],
        {
          ...options,
          capture: true,
          env: { ...options.env, ...updater.signer },
        },
      );
    } catch {
      throw new Error(
        "Updater signing failed. Check the dedicated signing key and password.",
      );
    }
    const signature = readFileSync(`${archive}.sig`, "utf8").trim();
    verifyUpdaterSignature(
      archive,
      signature,
      updater.public.publicKey,
      config.version,
    );
    Object.assign(artifact, {
      version: config.version,
      identifier: config.identifier,
      teamId: settings.teamId,
      architectures:
        plan.macosArch === "universal"
          ? ["arm64", "x86_64"]
          : [plan.macosArch === "arm64" ? "arm64" : "x86_64"],
      minimumSystemVersion: info.LSMinimumSystemVersion,
      buildConfiguration,
      releaseContent: historyBinding,
      bundleSha256: bundleDigest(app),
      updater: {
        path: basename(archive),
        sha256: sha256(archive),
        size: statSync(archive).size,
        signature,
        signaturePath: basename(`${archive}.sig`),
        signatureSha256: sha256(`${archive}.sig`),
        signatureSize: statSync(`${archive}.sig`).size,
      },
    });
    await verifyDirectPayloads(output, artifact, {
      execute,
      env: options.env,
      signal: options.signal,
    });
  }
  return artifact;
}

export async function readProvisioningProfile(
  path,
  execute = run,
  options = {},
) {
  // Provisioning profiles contain dates and certificates, which plutil cannot convert to JSON.
  return JSON.parse(
    await execute(
      "python3",
      [
        "-c",
        `import hashlib, json, plistlib, sys
with open(sys.argv[1], 'rb') as source:
    profile = plistlib.load(source)
print(json.dumps({
    'Entitlements': profile.get('Entitlements', {}),
    'TeamIdentifier': profile.get('TeamIdentifier', []),
    'ApplicationIdentifierPrefix': profile.get('ApplicationIdentifierPrefix', []),
    'CertificateSha256': [hashlib.sha256(cert).hexdigest() for cert in profile.get('DeveloperCertificates', [])],
    'ProvisionedDevices': 'ProvisionedDevices' in profile,
    'ProvisionsAllDevices': profile.get('ProvisionsAllDevices', False),
    'ExpirationDate': profile['ExpirationDate'].isoformat() + 'Z'
}))`,
        path,
      ],
      { ...options, capture: true },
    ),
  );
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function prepareDistributionProjectSpec(
  source,
  { cli, toolBin, node = process.execPath },
) {
  const phase =
    /^( +)- script: \|\n\1 {4}[^\n]*\bios xcode-script ([^\n]+)\n\1 {2}name: Build Rust Code$/gm;
  const dependencies = /^( +)dependencies:$/gm;
  if (
    [...source.matchAll(phase)].length !== 1 ||
    [...source.matchAll(dependencies)].length !== 1
  )
    throw new Error(
      "Unexpected generated iOS build phase. Check the pinned Tauri CLI and project.yml.",
    );
  // Rust's static archive still needs libgit2's dynamic system libraries at the final link.
  source = source.replace(
    dependencies,
    "$&\n$1  - sdk: libz.tbd\n$1  - sdk: libiconv.tbd",
  );
  source = source.replace(
    /^( +)- path: Externals\n(?:\1 {2}excludes:.*\n)?/m,
    '$1- path: Externals\n$1  excludes: ["**/*.a"]\n',
  );
  // Tauri's generated command can resolve a relative CLI entry point inside gen/apple.
  return source.replace(
    phase,
    (_match, indent, args) =>
      `${indent}- script: |\n${indent}    export PATH=${shellQuote(toolBin)}:"$PATH"\n${indent}    exec ${shellQuote(node)} ${shellQuote(cli)} ios xcode-script ${args.replace("${FORCE_COLOR}", "${FORCE_COLOR:-}")}\n${indent}  name: Build Rust Code`,
  );
}

async function buildIos({
  provenance,
  licenseResources,
  historyFile,
  historyBinding,
  root,
  output,
  scratch,
  plan,
  settings,
  config,
  cli,
  execute,
  options,
}) {
  const apple = join(root, "app/src-tauri/gen/apple");
  assertLocalPath(root, apple);
  const privacySource = join(root, "app/src-tauri/PrivacyInfo.xcprivacy");
  const generatedPrivacy = join(
    apple,
    "situate-client_iOS/PrivacyInfo.xcprivacy",
  );
  assertLocalPath(root, generatedPrivacy);
  mkdirSync(dirname(generatedPrivacy), { recursive: true });
  // The stock XcodeGen template discovers resources here during ios init.
  cpSync(privacySource, generatedPrivacy);
  const buildConfiguration = { distribution: "external", ...provenance };
  const identityFile = join(scratch, "ios-distribution.json");
  writeFileSync(identityFile, JSON.stringify(buildConfiguration));
  const overlay = JSON.stringify({
    identifier: settings.iosBundleIdentifier,
    bundle: {
      resources: {
        [historyFile]: releaseHistoryAsset,
        [identityFile]: "situate-distribution.json",
        ...licenseResources,
      },
      iOS: {
        developmentTeam: settings.teamId,
        bundleVersion: plan.buildNumber,
      },
    },
  });
  const toolBin = join(scratch, "ios-tools");
  mkdirSync(toolBin, { mode: 0o700 });
  // Xcode's Apple rsync client must not start a Homebrew rsync server via PATH.
  symlinkSync("/usr/bin/rsync", join(toolBin, "rsync"));
  const iosOptions = {
    ...options,
    cwd: join(root, "app"),
    env: {
      ...options.env,
      APPLE_DEVELOPMENT_TEAM: settings.teamId,
      PATH: `${toolBin}${delimiter}${options.env.PATH}`,
      CARGO_TARGET_DIR: join(options.env.CARGO_TARGET_DIR, "ios"),
    },
  };
  assertLocalPath(root, iosOptions.env.CARGO_TARGET_DIR);
  await execute(
    process.execPath,
    [cli, "ios", "init", "--ci", "--skip-targets-install", "--config", overlay],
    iosOptions,
  );
  const spec = join(apple, "project.yml");
  const project = join(apple, "situate-client.xcodeproj/project.pbxproj");
  const build = join(apple, "build");
  for (const path of [spec, project, build]) assertLocalPath(root, path);
  const originalSpec = readFileSync(spec, "utf8");
  const originalProject = readFileSync(project);
  try {
    writeFileSync(
      spec,
      prepareDistributionProjectSpec(originalSpec, { cli, toolBin }),
    );
    syncAppIcons({ root, apple, native: join(root, "app/src-tauri") });
    await execute("xcodegen", ["generate", "--spec", spec], {
      ...iosOptions,
      cwd: apple,
    });
    rmSync(build, { recursive: true, force: true });
    await execute(
      process.execPath,
      [
        cli,
        "ios",
        "build",
        "--ci",
        "--target",
        "aarch64",
        "--export-method",
        "app-store-connect",
        "--config",
        overlay,
        "--",
        "--locked",
      ],
      iosOptions,
    );
  } finally {
    // Do not leave generated Xcode projects pointing at a temporary launcher.
    for (const path of [spec, project]) assertLocalPath(root, path);
    writeFileSync(spec, originalSpec);
    writeFileSync(project, originalProject);
  }
  verifyFrontendLicenses(root, iosOptions.env);
  const ipa = onlyArtifact(build, ".ipa");
  const unpacked = join(scratch, "ipa");
  await execute("ditto", ["-x", "-k", ipa, unpacked], options);
  const app = onlyArtifact(join(unpacked, "Payload"), ".app");
  await verifyApp(
    app,
    {
      identifier: settings.iosBundleIdentifier,
      version: config.version,
      buildNumber: plan.buildNumber,
      teamId: settings.teamId,
      macos: false,
    },
    execute,
    options,
  );
  verifyReleaseHistoryResource(app, historyBinding, config.version, {
    macos: false,
  });
  if (
    !isDeepStrictEqual(
      jsonFile(join(app, "situate-distribution.json")),
      buildConfiguration,
    )
  )
    throw new Error(
      "Signed iOS build configuration does not match the build input.",
    );
  verifyLicenseResources(app, licenseResources, { macos: false });
  await assertNoDictationTtsResources(app);
  if (
    !existsSync(join(app, "PrivacyInfo.xcprivacy")) ||
    !isDeepStrictEqual(
      await readPlist(join(app, "PrivacyInfo.xcprivacy"), execute, options),
      await readPlist(privacySource, execute, options),
    )
  )
    throw new Error(
      "The exported IPA is missing the expected privacy manifest.",
    );
  const profilePath = join(scratch, "profile.plist");
  writeFileSync(
    profilePath,
    await execute(
      "security",
      ["cms", "-D", "-i", join(app, "embedded.mobileprovision")],
      { ...options, capture: true },
    ),
    { mode: 0o600 },
  );
  const profile = await readProvisioningProfile(profilePath, execute, options);
  const entitlementsPath = join(scratch, "entitlements.plist");
  writeFileSync(
    entitlementsPath,
    await execute("codesign", ["--display", "--entitlements", ":-", app], {
      ...options,
      capture: true,
    }),
    { mode: 0o600 },
  );
  const entitlements = await readPlist(entitlementsPath, execute, options);
  const certificatePrefix = join(scratch, "signing-certificate-");
  await execute(
    "codesign",
    ["--display", `--extract-certificates=${certificatePrefix}`, app],
    options,
  );
  const identifier = profile.Entitlements?.["application-identifier"];
  if (
    !profile.TeamIdentifier?.includes(settings.teamId) ||
    !profile.ApplicationIdentifierPrefix?.some(
      (prefix) => identifier === `${prefix}.${settings.iosBundleIdentifier}`,
    ) ||
    entitlements["application-identifier"] !== identifier ||
    entitlements["com.apple.developer.team-identifier"] !== settings.teamId ||
    (entitlements["get-task-allow"] !== undefined &&
      entitlements["get-task-allow"] !== false) ||
    !profile.CertificateSha256?.includes(sha256(`${certificatePrefix}0`)) ||
    profile.Entitlements?.["get-task-allow"] !== false ||
    profile.ProvisionedDevices ||
    profile.ProvisionsAllDevices ||
    !(Date.parse(profile.ExpirationDate) > Date.now())
  )
    throw new Error(
      "Exported IPA does not have a valid App Store provisioning profile for the requested app.",
    );
  const destination = join(
    output,
    `Situate-${config.version}-${plan.buildNumber}-ios.ipa`,
  );
  cpSync(ipa, destination);
  const archive = onlyArtifact(build, ".xcarchive");
  cpSync(archive, join(output, "Situate.xcarchive"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  return {
    platform: "ios",
    distribution: "external",
    buildConfiguration,
    path: basename(destination),
    sha256: sha256(destination),
    size: statSync(destination).size,
    identifier: settings.iosBundleIdentifier,
    buildNumber: plan.buildNumber,
    archive: "Situate.xcarchive",
    exportMethod: "app-store-connect",
  };
}

function assertExpectedVersion({ root, expectedVersion }) {
  if (
    expectedVersion !== undefined &&
    jsonFile(join(root, "app/src-tauri/tauri.conf.json")).version !==
      expectedVersion
  )
    throw new Error(
      "The configured app version differs from --expected-version. Start the release again.",
    );
}

export async function runAppleRelease(options) {
  options.signal?.throwIfAborted();
  assertExpectedVersion(options);
  if (!options.uploadTestFlight) return buildAppleRelease(options);
  if (!applePlan(options).platforms.includes("ios"))
    throw new Error("--upload-testflight requires --platform ios or all.");
  const { checkAppleUploadPrerequisites, uploadAppleRelease } =
    await import("./apple-upload.mjs");
  await checkAppleUploadPrerequisites(options);
  options.signal?.throwIfAborted();
  const directory = await buildAppleRelease(options);
  options.signal?.throwIfAborted();
  if (!options.check) await uploadAppleRelease({ ...options, directory });
  return directory;
}

export async function buildAppleRelease(options) {
  assertExpectedVersion(options);
  const plan = applePlan(options);
  if (plan.platforms.includes("macos") && plan.distribution === "direct")
    updaterSigningConfiguration(options.root, options.environment);
  if (!plan.platforms.includes("macos"))
    return buildResolvedAppleRelease(options);
  return withAppleCredentials(options, (settings) =>
    buildResolvedAppleRelease({ ...options, settings }),
  );
}

async function buildResolvedAppleRelease({
  root,
  settings,
  platform,
  macosArch,
  buildNumber,
  distribution = "external",
  expectedVersion,
  check = false,
  host = process.platform,
  environment = process.env,
  execute = run,
  compileHistory = compileBuildReleaseHistory,
  qualifyMigrations = qualifyPublishedMigrations,
  qualifyExternalMigrations = qualifyMigrationHistory,
  collectLicenses = collectNativeLicenses,
  signal,
}) {
  const plan = applePlan({
    settings,
    platform,
    macosArch,
    buildNumber,
    distribution,
    host,
  });
  const updater =
    plan.platforms.includes("macos") && distribution === "direct"
      ? updaterSigningConfiguration(root, environment)
      : undefined;
  const config = jsonFile(join(root, "app/src-tauri/tauri.conf.json"));
  if (expectedVersion !== undefined && config.version !== expectedVersion)
    throw new Error(
      "The configured app version differs from --expected-version. Start the release again.",
    );
  if (
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(
      config.version,
    ) ||
    config.version.trim() !== config.version
  )
    throw new Error(
      "Apple distribution requires a numeric major.minor.patch app version.",
    );
  const { cli, env } = await checkApplePrerequisites({
    root,
    settings,
    plan,
    environment,
    execute,
    signal,
  });
  if (check) return undefined;
  const cache = join(root, "target/apple-release");
  const locks = join(root, "target/local-release");
  const artifacts = join(root, "artifacts");
  for (const path of [cache, locks, artifacts]) {
    assertLocalPath(root, path);
    mkdirSync(path, { recursive: true });
  }
  // Share the local release lock: both builders also write the frontend output.
  const lock = join(locks, "build.lock");
  let handle;
  try {
    handle = openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(
      "A release build lock exists. Check its owner and child processes before removing it.",
      { cause: error },
    );
  }
  let unlockIos;
  let output;
  let scratch;
  const manifest = {
    schemaVersion: 1,
    status: "building",
    version: config.version,
    distribution: plan.distribution,
    requested: plan.platforms,
    artifacts: [],
    notarization: [],
  };
  try {
    writeFileSync(
      handle,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        kind: "apple-distribution",
      }),
    );
    if (plan.platforms.includes("ios"))
      unlockIos = acquireIosProject(root, "apple-distribution");
    output = mkdtempSync(join(artifacts, "apple-"));
    scratch = mkdtempSync(join(cache, "staging-"));
    const sourceOptions = { cwd: root, env, signal, capture: true };
    manifest.revision = (
      await execute("git", ["rev-parse", "HEAD"], sourceOptions)
    ).trim();
    manifest.dirty = Boolean(
      (await execute("git", ["status", "--porcelain"], sourceOptions)).trim(),
    );
    if (manifest.dirty || !/^[a-f0-9]{40}$/.test(manifest.revision))
      throw new Error(
        "Apple releases require a clean committed source revision.",
      );
    const direct = Boolean(updater);
    const catalog = await compileHistory(resolve(root, ".."), config.version, {
      distribution: direct ? "direct" : "external",
      environment,
    });
    manifest.migrationQualification = direct
      ? await qualifyMigrations(resolve(root, ".."), {
          environment,
          revision: manifest.revision,
        })
      : await qualifyExternalMigrations(resolve(root, ".."), { environment });
    const historyBinding = releaseContent(catalog);
    if (historyBinding.version !== config.version)
      throw new Error(
        "Release history version does not match the native app version.",
      );
    const historyFile = join(scratch, releaseHistoryAsset);
    writeFileSync(historyFile, releaseHistoryBytes(catalog));
    manifest.releaseContent = historyBinding;
    const options = {
      cwd: root,
      env: {
        ...env,
        SITUATE_RELEASE_HISTORY_FILE: historyFile,
        SITUATE_RELEASE_HISTORY_SHA256: historyBinding.sha256,
      },
      signal,
    };
    if (
      (await execute("git", ["rev-parse", "HEAD"], sourceOptions)).trim() !==
        manifest.revision ||
      (await execute("git", ["status", "--porcelain"], sourceOptions)).trim()
    )
      throw new Error(
        "Apple releases must use the same clean revision during qualification and building.",
      );
    saveManifest(output, manifest);
    const report = (entry) => {
      const previous = manifest.notarization.findIndex(
        (item) => item.file === entry.file,
      );
      if (previous === -1) manifest.notarization.push(entry);
      else manifest.notarization[previous] = entry;
      saveManifest(output, manifest);
    };
    for (const target of plan.platforms) {
      const build = target === "macos" ? buildMac : buildIos;
      const licenseTargets = plan.rustTargets.filter((triple) =>
        target === "ios" ? triple.endsWith("-ios") : triple.endsWith("-darwin"),
      );
      const licenseDirectory = join(scratch, `licenses-${target}`);
      const licenseResources = await collectLicenses({
        root,
        targets: licenseTargets,
        output: licenseDirectory,
        execute,
        options: { cwd: root, env, signal },
      });
      const licenseEnvironment = bindNativeLicenses(
        licenseDirectory,
        licenseResources,
        licenseTargets,
      );
      licenseResources[join(root, "app/dist/third-party-js-notices.txt")] =
        "licenses/third-party-js-notices.txt";
      licenseResources[join(root, "app/dist", frontendLicenseAsset)] =
        `licenses/${frontendLicenseAsset}`;
      console.log(`Building Apple distribution package: ${target}`);
      manifest.artifacts.push({
        ...(await build({
          root,
          output,
          scratch,
          historyFile,
          historyBinding,
          licenseResources,
          plan,
          settings,
          config,
          cli,
          execute,
          options:
            target === "ios"
              ? {
                  ...options,
                  env: {
                    ...options.env,
                    ...licenseEnvironment,
                    SITUATE_DISTRIBUTION: "external",
                  },
                }
              : { ...options, env: { ...options.env, ...licenseEnvironment } },
          report,
          updater: target === "macos" ? updater : undefined,
          provenance: {
            sourceRevision: manifest.revision,
            sourceDirty: manifest.dirty,
            releaseContent: historyBinding,
            ...(manifest.migrationQualification
              ? { migrationQualification: manifest.migrationQualification }
              : {}),
          },
        })),
        releaseContent: historyBinding,
      });
      saveManifest(output, manifest);
    }
    writeFileSync(
      join(output, "SHA256SUMS"),
      manifest.artifacts
        .flatMap((item) => [
          `${item.sha256}  ${item.path}\n`,
          ...(item.updater
            ? [
                `${item.updater.sha256}  ${item.updater.path}\n`,
                `${item.updater.signatureSha256}  ${item.updater.signaturePath}\n`,
              ]
            : []),
        ])
        .join(""),
    );
    {
      const revision = (
        await execute("git", ["rev-parse", "HEAD"], {
          cwd: root,
          env,
          signal,
          capture: true,
        })
      ).trim();
      const dirty = Boolean(
        (
          await execute("git", ["status", "--porcelain"], {
            cwd: root,
            env,
            signal,
            capture: true,
          })
        ).trim(),
      );
      if (revision !== manifest.revision || dirty !== manifest.dirty || dirty)
        throw new Error(
          "Apple release source must remain at the same clean revision throughout the build.",
        );
    }
    manifest.status = "complete";
    saveManifest(output, manifest);
    console.log(`Apple distribution packages: ${output}`);
    return output;
  } catch (error) {
    if (output) {
      manifest.status = "failed";
      saveManifest(output, manifest);
      console.error(
        `Incomplete Apple build: ${output}. Do not distribute its contents.`,
      );
    }
    throw error;
  } finally {
    if (scratch && manifest.status === "complete")
      rmSync(scratch, { recursive: true, force: true });
    else if (scratch)
      console.error(`Build recovery files retained: ${scratch}`);
    unlockIos?.();
    closeSync(handle);
    rmSync(lock);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const { values } = parseArgs({
      options: {
        platform: { type: "string", default: "macos" },
        "macos-arch": { type: "string", default: "universal" },
        distribution: { type: "string", default: "external" },
        "build-number": { type: "string" },
        "expected-version": { type: "string" },
        "upload-testflight": { type: "boolean" },
        check: { type: "boolean" },
        help: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(`Usage: npm run release:apple -- [--platform macos|ios|all] [--macos-arch universal|arm64|x64] [--distribution direct|external] [--build-number N] [--expected-version X.Y.Z] [--upload-testflight] [--check]
Reads Apple signing settings and credentials from the repository-root .env or environment. The legacy client/.apple-release.local.json is optional.
macOS builds are signed, notarized and stapled. --distribution direct additionally requires updater signing inputs and produces the updater archive; the default external variant has no built-in updater.
iOS uses Xcode automatic signing to export an App Store Connect IPA and archive.
--upload-testflight uploads the new iOS package after the entire build succeeds; no public App Store release is submitted.
--expected-version refuses a build if the configured app version differs from the selected version.
--check checks prerequisites without building, uploading or changing signing assets.
See client/README.md for local credentials, provisioning and TestFlight setup.`);
    else {
      const root = fileURLToPath(new URL("../", import.meta.url));
      const result = await runAppleRelease({
        root,
        settings: loadAppleSettings(root),
        platform: values.platform,
        macosArch: values["macos-arch"],
        distribution: values.distribution,
        buildNumber: values["build-number"],
        expectedVersion: values["expected-version"],
        uploadTestFlight: values["upload-testflight"],
        check: values.check,
        signal: controller.signal,
      });
      if (!result)
        console.log(
          "Apple build prerequisites passed. Provisioning and device compatibility still require a real build and installation.",
        );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
