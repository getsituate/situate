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
import { assertLocalPath } from "./ios-project-lock.mjs";
import { run } from "./ios-xcode.mjs";
import {
  notaryAuthentication,
  readAppleEnv,
  withAppleCredentials,
  withSigningKeychain,
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
  releaseContent,
  releaseHistoryAsset,
  verifyReleaseHistoryResource,
} from "./release-history.mjs";

import { verifyReleaseInputs } from "../../tools/release-inputs.mjs";
import { qualifyPublishedMigrations } from "../../tools/published-migrations.mjs";
import { canonical } from "../../tools/release-catalog.mjs";
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
  distribution = "direct",
  host = process.platform,
}) {
  if (host !== "darwin")
    throw new Error("Apple distribution builds require macOS.");
  if (
    platform !== "macos" ||
    macosArch !== "universal" ||
    distribution !== "direct"
  )
    throw new Error("Release creation requires macOS/direct/universal.");
  if (!/^[A-Z0-9]{10}$/.test(settings.teamId ?? ""))
    throw new Error("Configure APPLE_TEAM_ID for the Developer ID team.");
  if (!settings.macosSigningIdentity || settings.macosSigningIdentity === "-")
    throw new Error("Configure a Developer ID Application signing identity.");
  return {
    platforms: ["macos"],
    distribution: "direct",
    macosArch: "universal",
    macosTarget: macTargets.universal,
    buildNumber,
    rustTargets: [macTargets.arm64, macTargets.x64],
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
  if (!settings.notaryJournal?.operationId)
    throw new Error(
      "Blocked: a controlled-host durable notarization journal is required.",
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
  if (!settings.signingKeychain)
    throw new Error("An isolated temporary Developer ID keychain is required.");
  const identities = await execute(
    "security",
    ["find-identity", "-v", "-p", "codesigning", settings.signingKeychain],
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

export async function inspectNotarization(
  entry,
  { settings, execute = run, env, signal } = {},
) {
  if (!entry?.operationId || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? ""))
    throw new Error("Invalid notarization operation identity.");
  if (!entry.id)
    return { ...entry, status: "unknown", inspectionRequired: true };
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.id))
    throw new Error("Invalid notarization submission ID.");
  const result = JSON.parse(
    await execute(
      "xcrun",
      [
        "notarytool",
        "info",
        entry.id,
        ...notaryAuthentication(settings),
        "--output-format",
        "json",
      ],
      { env, signal, capture: true },
    ),
  );
  if (
    result.id !== entry.id ||
    !["Accepted", "Invalid", "In Progress", "Rejected"].includes(result.status)
  )
    throw new Error(
      "Notarization inspection returned a different or unknown operation.",
    );
  return { ...entry, status: result.status, inspectionRequired: false };
}

export async function notarize(
  path,
  settings,
  execute,
  options,
  report = () => {},
) {
  const durable = settings.notaryJournal;
  if (
    !durable?.operationId ||
    typeof durable.persist !== "function" ||
    typeof durable.complete !== "function"
  )
    throw new Error(
      "Blocked: a controlled-host durable notarization journal is required.",
    );
  const acknowledge = async (method, value) => {
    const ack = await durable[method](value);
    if (ack?.durable !== true || ack.operationId !== durable.operationId)
      throw new Error(
        "Durable notarization journal did not acknowledge this operation.",
      );
  };
  // A journal exists before submission, including when Apple's response never arrives.
  const journal = pendingNotarization(options.cwd);
  const entry = {
    operationId: durable.operationId,
    file: basename(path),
    sha256: sha256(path),
    status: "submitting",
  };
  const handle = openSync(journal, "wx", 0o600);
  const save = async () => {
    writeFileSync(journal, `${JSON.stringify(entry, null, 2)}\n`);
    fsyncSync(handle);
    await acknowledge("persist", { ...entry });
    report({ ...entry });
  };
  try {
    await save();
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
    if (
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        submission.id ?? "",
      )
    )
      throw new Error(
        "Notary service returned no submission ID; inspect submission history before retrying.",
      );
    entry.id = submission.id;
    entry.status = "submitted";
    await save();
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
    if (result.id !== submission.id)
      throw new Error("Notarization wait returned a different submission ID.");
    entry.status = result.status ?? "unknown";
    await save();
    if (entry.status !== "Accepted")
      throw new Error(
        `Notarization is not accepted (${entry.status}). Inspect the recorded submission before retrying.`,
      );
    await acknowledge("complete", { ...entry });
    rmSync(journal);
  } catch (error) {
    if (!entry.id) {
      entry.status = "unknown";
      await save();
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
        version: config.version,
        bundle: {
          resources: {
            [identityFile]: "situate-distribution.json",
            [historyFile]: releaseHistoryAsset,
            [join(output, "release-inputs.json")]: "release-inputs.json",
            ...licenseResources,
          },
          macOS: {
            bundleVersion: plan.buildNumber,
            signingIdentity: "-",
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
  await execute(
    "codesign",
    [
      "--force",
      "--deep",
      "--options",
      "runtime",
      "--timestamp",
      "--keychain",
      settings.signingKeychain,
      "--sign",
      settings.macosSigningIdentity,
      "--entitlements",
      join(root, "app/src-tauri/Entitlements.macos.plist"),
      app,
    ],
    options,
  );
  await verifyApp(
    app,
    {
      identifier: config.identifier,
      version: config.version,
      buildNumber: plan.buildNumber,
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
    [
      "--keychain",
      settings.signingKeychain,
      "--sign",
      settings.macosSigningIdentity,
      "--timestamp",
      dmg,
    ],
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
    buildNumber: plan.buildNumber,
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

function assertExpectedVersion({ releaseInputs, expectedVersion }) {
  if (!releaseInputs?.manifest)
    throw new Error("Immutable generated release inputs are required.");
  if (
    expectedVersion !== undefined &&
    releaseInputs.manifest.version !== expectedVersion
  )
    throw new Error(
      "Generated release version differs from --expected-version.",
    );
}

export async function runAppleRelease(options) {
  options.signal?.throwIfAborted();
  if (options.uploadTestFlight)
    throw new Error(
      "TestFlight uploads are outside macOS direct release creation.",
    );
  return buildAppleRelease(options);
}

export async function buildAppleRelease(options) {
  assertExpectedVersion(options);
  applePlan(options);
  verifyReleaseInputs(
    options.releaseInputs.manifest,
    options.releaseInputs.catalogBytes,
  );
  updaterSigningConfiguration(options.root, options.environment);
  const journal = options.notaryJournal;
  if (
    !journal?.operationId ||
    typeof journal.persist !== "function" ||
    typeof journal.complete !== "function"
  )
    throw new Error(
      "Blocked: a controlled-host durable notarization journal is required.",
    );
  return withAppleCredentials(options, (settings) =>
    withSigningKeychain(options, (signingKeychain) =>
      buildResolvedAppleRelease({
        ...options,
        settings: { ...settings, signingKeychain, notaryJournal: journal },
      }),
    ),
  );
}

async function buildResolvedAppleRelease({
  root,
  settings,
  platform,
  macosArch,
  distribution = "direct",
  releaseInputs,
  publicCompatibility,
  sourceVerification,
  expectedVersion,
  check = false,
  host = process.platform,
  environment = process.env,
  execute = run,
  qualifyMigrations = qualifyPublishedMigrations,
  collectLicenses = collectNativeLicenses,
  signal,
}) {
  const plan = applePlan({
    settings,
    platform,
    macosArch,
    buildNumber: releaseInputs.manifest.build,
    distribution,
    host,
  });
  const updater =
    plan.platforms.includes("macos") && distribution === "direct"
      ? updaterSigningConfiguration(root, environment)
      : undefined;
  const config = {
    ...jsonFile(join(root, "app/src-tauri/tauri.conf.json")),
    version: releaseInputs.manifest.version,
  };
  if (
    !/^(?:[1-9][0-9]{0,3})(?:\.(?:0|[1-9][0-9]{0,1})){0,2}$/.test(
      plan.buildNumber,
    )
  )
    throw new Error(
      "Apple build identity must use a 1–9999 first component and optional 0–99 components.",
    );
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
    if (releaseInputs.manifest.source !== manifest.revision)
      throw new Error(
        "Generated release source differs from the clean checkout.",
      );
    const catalog = verifyReleaseInputs(
      releaseInputs.manifest,
      releaseInputs.catalogBytes,
    );
    manifest.migrationQualification = await qualifyMigrations(
      resolve(root, ".."),
      {
        environment,
        revision: manifest.revision,
      },
    );
    const image = {
      os: environment.ImageOS,
      version: environment.ImageVersion,
    };
    if (
      Object.values(image).some((value) => value !== undefined) &&
      !Object.values(image).every(
        (value) =>
          typeof value === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value),
      )
    )
      throw new Error(
        "Runner image identity must contain safe ImageOS and ImageVersion values.",
      );
    const tools = [
      [
        "node",
        process.execPath,
        ["--version"],
        /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/,
      ],
      [
        "npm",
        "npm",
        ["--version"],
        /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/,
      ],
      [
        "rustc",
        "rustc",
        ["--version"],
        /^rustc [0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9 .()+_-]*$/,
      ],
      [
        "cargo",
        "cargo",
        ["--version"],
        /^cargo [0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9 .()+_-]*$/,
      ],
      [
        "xcodebuild",
        "xcodebuild",
        ["-version"],
        /^Xcode [0-9]+(?:\.[0-9]+)*\nBuild version [A-Za-z0-9]+$/,
      ],
      [
        "swift",
        "swift",
        ["--version"],
        /^(?:swift-driver version: [0-9]+(?:\.[0-9]+)* )?(?:Apple )?Swift version [0-9]+(?:\.[0-9]+)*[A-Za-z0-9 .()+_-]*(?:\nTarget: [A-Za-z0-9._-]+)?$/,
      ],
    ];
    manifest.verificationHost = {
      platform: process.platform,
      architecture: process.arch,
      runnerImage: image.os ? image : { kind: "local" },
      toolchains: Object.fromEntries(
        await Promise.all(
          tools.map(async ([name, command, args, pattern]) => {
            const version = (
              await execute(command, args, sourceOptions)
            ).trim();
            if (!pattern.test(version))
              throw new Error(
                `Cannot record a safe ${name} toolchain version.`,
              );
            return [name, version];
          }),
        ),
      ),
    };
    const historyBinding = releaseContent(catalog);
    if (historyBinding.version !== config.version)
      throw new Error(
        "Generated history version differs from the native app version.",
      );
    const historyFile = join(output, releaseHistoryAsset);
    writeFileSync(historyFile, releaseInputs.catalogBytes, { flag: "wx" });
    const inputsFile = join(output, "release-inputs.json");
    writeFileSync(inputsFile, `${canonical(releaseInputs.manifest)}\n`, {
      flag: "wx",
    });
    manifest.releaseInputs = {
      path: basename(inputsFile),
      sha256: sha256(inputsFile),
      catalogPath: basename(historyFile),
      catalogSha256: sha256(historyFile),
    };
    if (publicCompatibility !== undefined) {
      const proof = publicCompatibility?.qualification;
      const releaseIdentity = (release) =>
        release &&
        isDeepStrictEqual(Object.keys(release).sort(), [
          "manifestSha256",
          "revision",
          "version",
        ]) &&
        /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(
          release.version,
        ) &&
        /^[a-f0-9]{40}$/.test(release.revision) &&
        /^[a-f0-9]{64}$/.test(release.manifestSha256);
      if (
        !isDeepStrictEqual(Object.keys(publicCompatibility ?? {}).sort(), [
          "qualification",
          "schemaVersion",
          "source",
        ]) ||
        publicCompatibility.schemaVersion !== 1 ||
        publicCompatibility.source !== manifest.revision ||
        proof?.schemaVersion !== 1 ||
        proof.source !== "macos-direct-publication" ||
        !isDeepStrictEqual(
          Object.keys(proof).sort(),
          [
            "migrations",
            "releases",
            "schemaVersion",
            "source",
            ...(Object.hasOwn(proof, "checkpoint") ? ["checkpoint"] : []),
          ].sort(),
        ) ||
        !Number.isSafeInteger(proof.migrations) ||
        proof.migrations < 0 ||
        !Array.isArray(proof.releases) ||
        !proof.releases.every(releaseIdentity) ||
        (Object.hasOwn(proof, "checkpoint") &&
          !releaseIdentity(proof.checkpoint))
      )
        throw new Error(
          "Public compatibility evidence must bind the clean release source and verified public release identities.",
        );
      manifest.publicCompatibility = structuredClone(publicCompatibility);
    }
    if (sourceVerification !== undefined) {
      const verification = sourceVerification;
      const lanes = verification?.lanes;
      if (
        !isDeepStrictEqual(Object.keys(verification ?? {}).sort(), [
          "lanes",
          "planDigest",
          "results",
          "schemaVersion",
          "source",
          "status",
        ]) ||
        verification.schemaVersion !== 1 ||
        verification.status !== "passed" ||
        verification.source !== manifest.revision ||
        !/^[a-f0-9]{64}$/.test(verification.planDigest) ||
        !Array.isArray(lanes) ||
        !lanes.length ||
        lanes.some(
          (id) => typeof id !== "string" || !/^[a-z][a-z0-9-]{0,127}$/.test(id),
        ) ||
        new Set(lanes).size !== lanes.length ||
        !Array.isArray(verification.results) ||
        !isDeepStrictEqual(
          verification.results.map((result) => result?.id).sort(),
          [...lanes].sort(),
        ) ||
        verification.results.some(
          (result) =>
            !isDeepStrictEqual(Object.keys(result ?? {}).sort(), [
              "exitCode",
              "id",
              "status",
            ]) ||
            result.status !== "passed" ||
            result.exitCode !== 0,
        )
      )
        throw new Error(
          "Source verification must contain successful sanitized results for every selected lane at the clean release source.",
        );
      manifest.sourceVerification = {
        ...structuredClone(verification),
        releaseInputsSha256: manifest.releaseInputs.sha256,
      };
    }
    manifest.qualification = { path: "release-qualification.json" };
    manifest.releaseContent = historyBinding;
    manifest.buildNumber = plan.buildNumber;
    const options = {
      cwd: root,
      env: {
        ...env,
        SITUATE_RELEASE_VERSION: config.version,
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
      const build = buildMac;
      const licenseTargets = plan.rustTargets;
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
          options: {
            ...options,
            env: { ...options.env, ...licenseEnvironment },
          },
          report,
          updater,
          provenance: {
            sourceRevision: manifest.revision,
            sourceDirty: manifest.dirty,
            releaseInputs: manifest.releaseInputs,
            ...(manifest.publicCompatibility
              ? { publicCompatibility: manifest.publicCompatibility }
              : {}),
            ...(manifest.sourceVerification
              ? { sourceVerification: manifest.sourceVerification }
              : {}),
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
        distribution: { type: "string", default: "direct" },
        "release-inputs": { type: "string" },
        "build-number": { type: "string" },
        "expected-version": { type: "string" },
        "upload-testflight": { type: "boolean" },
        check: { type: "boolean" },
        help: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(
        `Usage: npm run release:apple -- --release-inputs DIRECTORY [--expected-version X.Y.Z] [--check]\nBuilds only macOS/direct/universal from immutable generated inputs.\nSigning requires an isolated temporary Developer ID keychain and a controlled-host durable notarization journal supplied through buildAppleRelease.\nUse the shared pipeline for creation and recovery.`,
      );
    else {
      const root = fileURLToPath(new URL("../", import.meta.url));
      const result = await runAppleRelease({
        root,
        settings: loadAppleSettings(root),
        releaseInputs: values["release-inputs"]
          ? {
              manifest: jsonFile(
                join(values["release-inputs"], "release-inputs.json"),
              ),
              catalogBytes: readFileSync(
                join(values["release-inputs"], releaseHistoryAsset),
                "utf8",
              ),
            }
          : undefined,
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
