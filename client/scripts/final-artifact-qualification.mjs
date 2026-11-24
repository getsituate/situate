import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:https";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  bundleDigest,
  verifyDirectPayloads,
} from "./direct-release-verification.mjs";
import { createQualificationProcess } from "./final-artifact-process.mjs";
import { requireNativeDesktop } from "./native-desktop-session.mjs";
import {
  createQualificationRouting,
  validateQualificationRouting,
} from "./final-artifact-routing.mjs";
import {
  startAgentProvider,
  PINNED_AGENT_MODEL,
} from "./agent-e2e-provider.mjs";

import {
  finalArtifactJourneys,
  startFinalArtifactProvider,
} from "./final-artifact-journeys.mjs";
import {
  materializeUpgradeWorkspace,
  upgradeNoteAfter,
  upgradeWorkspaceName,
  verifyUpgradeDraft,
  verifyUpgradeWorkspace,
} from "./upgrade-workspace-fixture.mjs";
import { upgradeWorkspaceJourney } from "./upgrade-workspace-journey.mjs";
import { observeUpdater } from "./qualification-updater-observation.mjs";
import {
  accessibilityFailureCode,
  checkAccessibilityAction,
  validateAction,
} from "./qualification-accessibility.mjs";
export {
  accessibilityFailureCode,
  accessibilityScript,
  checkAccessibilityAction,
} from "./qualification-accessibility.mjs";
import { qualificationProgressReporter } from "../../tools/qualification-progress.mjs";

const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const quote = (value) => JSON.stringify(value);
const journeyNames = ["workspace", "onboarding", "plugins"];

export function captureQualificationDeviceState({ home, identifier, uid }) {
  assert(
    /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(identifier),
    "Invalid signed application identifier",
  );
  home = realpathSync(home);
  assert(
    lstatSync(home).isDirectory() && lstatSync(home).uid === uid,
    "Invalid disposable account home ownership",
  );
  const paths = [
    join("Library", "Application Support", identifier),
    join("Library", "Containers", identifier),
    join("Library", "Preferences", `${identifier}.plist`),
    join("Library", "WebKit", identifier),
    join("Library", "Saved Application State", `${identifier}.savedState`),
  ];
  function statIfPresent(path) {
    try {
      return lstatSync(path);
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  function parents(path) {
    let current = home;
    for (const segment of dirname(path).split("/")) {
      current = join(current, segment);
      const stat = statIfPresent(current);
      if (!stat) break;
      assert(
        stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === uid,
        "Unsafe application data parent",
      );
    }
  }
  for (const path of paths) {
    parents(path);
    assert(
      !statIfPresent(join(home, path)),
      "Qualification account retains prior app data; inspect it before using a fresh disposable account",
    );
  }
  let archived = false;
  return function archiveCandidateDeviceState(owned) {
    assert(!archived, "Candidate device state was already archived");
    const owner = lstatSync(owned);
    assert(
      owner.isDirectory() &&
        !owner.isSymbolicLink() &&
        owner.uid === uid &&
        relative(home, realpathSync(owned)) !== "" &&
        !relative(home, realpathSync(owned)).startsWith(".."),
      "Invalid owned qualification directory",
    );
    const destination = join(owned, "candidate-device-state");
    assert(
      !statIfPresent(destination),
      "Candidate device-state archive already exists",
    );
    function inspect(path) {
      const stat = lstatSync(path);
      assert(
        stat.uid === uid &&
          !stat.isSymbolicLink() &&
          (stat.isDirectory() || (stat.isFile() && stat.nlink === 1)),
        "Unsafe or foreign application data",
      );
      if (stat.isDirectory())
        for (const child of readdirSync(path)) inspect(join(path, child));
      return stat;
    }
    const present = [];
    for (const path of paths) {
      parents(path);
      const source = join(home, path);
      if (statIfPresent(source))
        present.push({ path, source, stat: inspect(source) });
    }
    mkdirSync(destination, { mode: 0o700 });
    for (const { path, source, stat } of present) {
      const current = lstatSync(source);
      assert(
        current.ino === stat.ino && current.dev === stat.dev,
        "Application data changed before archiving",
      );
      const target = join(destination, path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      renameSync(source, target);
    }
    for (const path of paths)
      assert(
        !statIfPresent(join(home, path)),
        "Application data reappeared during isolation",
      );
    archived = true;
    return destination;
  };
}

export async function qualifyPredecessorUpdate({
  install,
  author,
  report,
  update,
  reopen,
  restart,
}) {
  await install();
  await author();
  const retained = report();
  await update();
  await reopen(retained);
  await restart();
  await reopen(retained);
}

export async function verifyQualificationFeed(
  endpoint,
  manifest,
  { request = get, signal } = {},
) {
  const origin = new URL(endpoint);
  assert(
    origin.protocol === "https:" && !origin.username && !origin.password,
    "Qualification must retain production HTTPS",
  );
  async function download(url, maximum, collect) {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      let size = 0;
      const chunks = [];
      const req = request(
        url,
        { signal, rejectUnauthorized: true, timeout: 60_000 },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(
              new Error("Qualification HTTPS response was not successful"),
            );
            return;
          }
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > maximum)
              response.destroy(
                new Error("Qualification HTTPS response exceeds expected size"),
              );
            else {
              hash.update(chunk);
              if (collect) chunks.push(chunk);
            }
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              size,
              sha256: hash.digest("hex"),
              bytes: collect ? Buffer.concat(chunks) : undefined,
            }),
          );
        },
      );
      req.on("timeout", () =>
        req.destroy(new Error("Qualification HTTPS request timed out")),
      );
      req.on("error", reject);
    });
  }
  const feed = JSON.parse((await download(origin, 1024 * 1024, true)).bytes);
  const artifact = manifest.artifacts[0];
  assert(
    feed.version === manifest.version,
    "Isolated production feed advertises a different version",
  );
  for (const target of ["darwin-aarch64", "darwin-x86_64"]) {
    const platform = feed.platforms?.[target];
    assert(
      platform?.signature === artifact.updater.signature,
      "Isolated production feed signature differs",
    );
    const url = new URL(platform.url);
    assert(
      url.protocol === "https:" &&
        url.origin === origin.origin &&
        !url.username &&
        !url.password,
      "Qualification download must retain production HTTPS origin",
    );
    const downloaded = await download(url, artifact.updater.size, false);
    assert(
      downloaded.size === artifact.updater.size &&
        downloaded.sha256 === artifact.updater.sha256,
      "Isolated production download differs from the sealed updater archive",
    );
  }
  return true;
}

export function validateFinalArtifactConfiguration(configuration) {
  assert(
    ["ephemeral-host", "dedicated-account"].includes(
      configuration?.account?.mode,
    ) &&
      configuration.account.uid > 500 &&
      typeof configuration.account.name === "string" &&
      configuration.account.name.length > 0 &&
      isAbsolute(configuration.account.home),
    "Blocked: an explicitly trusted ephemeral host or dedicated disposable account is required",
  );
  assert(
    configuration.routing,
    "Blocked: controlled production-HTTPS isolated routing is required",
  );
  validateQualificationRouting(configuration.routing);
  assert(
    configuration.predecessor?.directory &&
      configuration.predecessor?.manifest?.status === "complete",
    "Blocked: an exact verified host-channel predecessor package is required",
  );
  assert(
    typeof configuration.runnerImage === "string" &&
      configuration.runnerImage.length > 0,
    "Blocked: resolved runner image identity is required",
  );
  if (
    !configuration.journeys &&
    !configuration.lifecycle &&
    !configuration.updateActions
  ) {
    assert(
      configuration.profile === "macos-direct-v1",
      "Blocked: a reviewed final-artifact profile is required",
    );
    return configuration;
  }
  for (const name of journeyNames) {
    const journey = configuration.journeys?.[name];
    assert(
      journey?.actions?.length &&
        journey.reopen?.length &&
        journey.files?.length,
      `Blocked: native ${name} actions, restart assertions and synthetic retained-file expectations are required`,
    );
    assert(
      journey.actions.some((action) => action.assert) &&
        journey.reopen.every((action) => action.assert),
      "Native journey must assert initial and reopened product state",
    );
    for (const action of [...journey.actions, ...journey.reopen])
      validateAction(action);
    for (const file of journey.files)
      assert(
        typeof file.path === "string" &&
          !isAbsolute(file.path) &&
          !file.path.split("/").includes("..") &&
          /^[a-f0-9]{64}$/.test(file.sha256),
        "Invalid synthetic retained-file expectation",
      );
  }
  for (const name of [
    "multiwindow",
    "unsavedCancellation",
    "replacement",
    "relaunch",
    "recovery",
  ]) {
    const scenario = configuration.lifecycle?.[name];
    assert(
      scenario?.before?.length &&
        scenario.actions?.length &&
        scenario.after?.length &&
        [...scenario.before, ...scenario.after].every(
          (action) => action.assert,
        ),
      `Blocked: native lifecycle assertions are required for ${name}`,
    );
    for (const action of [
      ...scenario.before,
      ...scenario.actions,
      ...scenario.after,
    ])
      validateAction(action);
  }
  assert(
    configuration.updateActions?.length &&
      configuration.updateActions.some(
        (action) => action.click?.name === "Install and restart",
      ),
    "Blocked: native production updater actions are required",
  );
  for (const action of configuration.updateActions) validateAction(action);
  return configuration;
}

const translocatedExecutable = (path) =>
  /^(\/(?:private\/)?var\/folders\/[^/\n]+\/[^/\n]+\/T\/AppTranslocation\/[\da-fA-F]{8}(?:-[\da-fA-F]{4}){3}-[\da-fA-F]{12})\/d\/Situate\.app\/Contents\/MacOS\/([^/\n]+)$/.exec(
    path,
  );

export function isOwnedTranslocatedExecutable(
  executable,
  installed,
  mounts,
  stat = lstatSync,
) {
  const match = translocatedExecutable(executable);
  if (!match || /[\r\n]/.test(installed)) return false;
  const [, root, name] = match;
  if (name === "." || name === "..") return false;
  const mountpoint = root.startsWith("/var/") ? `/private${root}` : root;
  const entries = mounts
    .split("\n")
    .filter((line) => line.includes(` on ${mountpoint} (`));
  const prefix = `${installed} on ${mountpoint} (nullfs, `;
  if (
    entries.length !== 1 ||
    !entries[0].startsWith(prefix) ||
    !entries[0].endsWith(")") ||
    !entries[0].slice(prefix.length, -1).split(", ").includes("read-only")
  )
    return false;
  try {
    const source = stat(join(installed, "Contents", "MacOS", name), {
      bigint: true,
    });
    const view = stat(executable, { bigint: true });
    return (
      source.isFile() &&
      view.isFile() &&
      source.ino === view.ino &&
      source.dev !== view.dev
    );
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function createFinalArtifactQualificationHost(configuration, options) {
  validateFinalArtifactConfiguration(configuration);
  return createNativeQualificationHost(configuration, options);
}

export function createSignedFirstLaunchDiagnostic(account, options) {
  assert.equal(account.mode, "ephemeral-host");
  return createNativeQualificationHost({ account }, options, true);
}

function createNativeQualificationHost(
  configuration,
  {
    execute = createQualificationProcess(),
    environment = process.env,
    signal,
    progress = () => {},
  } = {},
  launchDiagnostic = false,
) {
  const reporter = qualificationProgressReporter(progress);
  const safeEnv = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL"]
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
  const options = { env: safeEnv, signal, capture: true };
  const routing = launchDiagnostic
    ? null
    : createQualificationRouting(configuration.routing, {
        execute,
        environment: safeEnv,
        signal,
      });
  let app;
  let pid;
  let identifier;
  let launchPending = false;
  let owned;
  let session;
  let provider;
  let stateRoot;
  let productJourneys;
  let archiveCandidateDeviceState;
  let deviceStateIsolationPending = false;
  let mountUncertain = false;
  let placementUncertain = false;
  const defaultProfile = !configuration.journeys;
  async function processPath(id) {
    return (
      await execute("ps", ["-p", String(id), "-o", "comm="], {
        ...options,
        signal: undefined,
      })
    ).trim();
  }
  async function applicationPids() {
    const output = await execute(
      "osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        `(() => {
      ObjC.import("AppKit");
      const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(${quote(identifier)});
      if (apps.count > 16) throw new Error("Too many application instances");
      const ids = [];
      for (let index = 0; index < apps.count; index++)
        ids.push(apps.objectAtIndex(index).processIdentifier);
      return JSON.stringify(ids);
    })()`,
      ],
      options,
    );
    const ids = JSON.parse(output);
    assert(
      Array.isArray(ids) &&
        ids.length <= 16 &&
        ids.every((id) => Number.isSafeInteger(id) && id > 0) &&
        new Set(ids).size === ids.length,
      "Invalid application process inventory",
    );
    return ids;
  }
  async function ownsProcess(id) {
    const executable = await processPath(id);
    if (executable.startsWith(`${app}/Contents/MacOS/`)) return true;
    if (!translocatedExecutable(executable)) return false;
    const mounts = await execute("/sbin/mount", ["-t", "nullfs"], {
      ...options,
      signal: undefined,
    });
    return isOwnedTranslocatedExecutable(executable, app, mounts);
  }
  async function waitFor(check, description, cleanup = false) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (!cleanup) signal?.throwIfAborted();
      if (await check()) return;
      await setTimeout(250, undefined, {
        signal: cleanup ? undefined : signal,
      });
    }
    throw new Error(`Native qualification timed out: ${description}`);
  }
  async function launch(start = true, previousPid, confirmFirstLaunch = false) {
    launchPending = true;
    if (start) {
      try {
        await execute(
          "open",
          ["-n", app],
          confirmFirstLaunch ? { ...options, confirmFirstLaunch } : options,
        );
      } catch (error) {
        if (error?.qualificationLaunchNotStarted) launchPending = false;
        throw error;
      }
    }
    await waitFor(async () => {
      const matching = [];
      for (const id of await applicationPids()) {
        if (id !== previousPid && (await ownsProcess(id))) matching.push(id);
      }
      assert(
        matching.length <= 1,
        "Multiple qualification application processes",
      );
      if (matching.length === 0) return false;
      [pid] = matching;
      launchPending = false;
      return true;
    }, "signed app launch");
    await execute(
      "osascript",
      [
        "-e",
        `tell application "System Events" to if not UI elements enabled then error "Accessibility permission is required"`,
      ],
      options,
    );
  }
  async function quit() {
    if (!pid) return;
    assert(await ownsProcess(pid), "Owned application PID changed");
    await execute("kill", ["-TERM", String(pid)], {
      ...options,
      signal: undefined,
    });
    await waitFor(
      async () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          if (error.code === "ESRCH") return true;
          throw error;
        }
      },
      "owned app exit",
      true,
    );
    pid = undefined;
  }
  async function installDmg(directory, artifact, { updater = false } = {}) {
    assert(
      !existsSync(app),
      "Qualification application destination already exists",
    );
    const image = join(owned, "mount");
    const downloaded = updater
      ? join(mkdtempSync(join(owned, "downloaded-")), "Situate.app")
      : app;
    mkdirSync(image, { recursive: true });
    let mounted = false;
    try {
      assert(
        hash(join(directory, artifact.path)) === artifact.sha256,
        "DMG changed before installation",
      );
      mountUncertain = true;
      await execute(
        "hdiutil",
        [
          "attach",
          "-readonly",
          "-nobrowse",
          "-mountpoint",
          image,
          join(directory, artifact.path),
        ],
        options,
      );
      mounted = true;
      mountUncertain = false;
      assert(
        bundleDigest(join(image, "Situate.app")) === artifact.bundleSha256,
        "Mounted installation bundle changed",
      );
      await execute("ditto", [join(image, "Situate.app"), downloaded], options);
    } finally {
      if (mounted) {
        mountUncertain = true;
        await execute("hdiutil", ["detach", image], {
          ...options,
          signal: undefined,
        });
        mountUncertain = false;
      }
    }
    assert(
      bundleDigest(downloaded) === artifact.bundleSha256,
      "Copied app differs from the final package",
    );
    await execute(
      "xattr",
      [
        "-w",
        "com.apple.quarantine",
        "0083;00000000;SituateQualification;",
        downloaded,
      ],
      options,
    );
    if (updater) {
      const before = lstatSync(downloaded);
      const finderInstall = new URL(
        "./qualification-finder-install.swift",
        import.meta.url,
      );
      placementUncertain = true;
      assert.equal(
        await execute(
          "/usr/bin/swift",
          [fileURLToPath(finderInstall), downloaded, owned],
          options,
        ),
        "moved",
        "Finder did not confirm the predecessor install",
      );
      const after = lstatSync(app);
      assert(
        !existsSync(downloaded) &&
          after.isDirectory() &&
          after.uid === configuration.account.uid &&
          after.dev === before.dev &&
          after.ino === before.ino &&
          bundleDigest(app) === artifact.bundleSha256,
        "Finder did not move the exact predecessor bundle",
      );
      placementUncertain = false;
      assert(
        await execute("xattr", ["-p", "com.apple.quarantine", app], options),
        "Finder-installed predecessor lost quarantine",
      );
    }
    await execute("spctl", ["--assess", "--type", "execute", app], options);
    await execute("xcrun", ["stapler", "validate", app], options);
    await launch(
      true,
      undefined,
      configuration.account.mode === "ephemeral-host",
    );
  }
  async function actions(items, phase) {
    for (const original of items) {
      const action = structuredClone(original);
      if (action.type !== undefined)
        action.type = action.type
          .replaceAll("{{workspace}}", join(stateRoot, "workspace"))
          .replaceAll(
            "{{upgradeWorkspace}}",
            join(stateRoot, "workspace", upgradeWorkspaceName),
          )
          .replaceAll("{{fixture.baseUrl}}", provider.baseUrl)
          .replaceAll("{{fixture.token}}", provider.token)
          .replaceAll("{{fixture.model}}", PINNED_AGENT_MODEL);
      if (action.folderField === "{{workspace}}")
        action.folderField = join(stateRoot, "workspace");
      else if (action.folderField === "{{upgradeWorkspace}}")
        action.folderField = join(stateRoot, "workspace", upgradeWorkspaceName);
      let lastPending;
      try {
        await waitFor(
          () =>
            checkAccessibilityAction(pid, action, {
              execute,
              options,
              pending: (error) => {
                lastPending = error;
              },
            }),
          "accessibility assertion",
        );
      } catch (error) {
        if (phase === "journeys" || phase === "update") {
          const observed =
            error.qualificationCommand === "accessibility"
              ? error
              : lastPending;
          reporter.emit(
            phase,
            observed?.accessibilityObservation ??
              accessibilityFailureCode(observed),
            "accessibility",
          );
        }
        throw error;
      }
    }
  }
  function retainedFiles() {
    for (const name of journeyNames)
      for (const expected of configuration.journeys[name].files) {
        const path = join(stateRoot, expected.path);
        const stat = lstatSync(path);
        assert(
          stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.nlink === 1 &&
            !relative(stateRoot, realpathSync(path)).startsWith("..") &&
            hash(path) === expected.sha256,
          "Synthetic retained data changed",
        );
      }
  }
  async function prepareAccount(artifact) {
    assert(
      process.platform === "darwin",
      "Final-artifact native qualification requires macOS",
    );
    requireNativeDesktop();
    const user = userInfo();
    assert(
      user.uid === configuration.account.uid &&
        user.username === configuration.account.name &&
        realpathSync(homedir()) === realpathSync(configuration.account.home),
      "Refusing to use a personal or different macOS account",
    );
    assert(
      !Object.keys(environment).some(
        (name) =>
          /^(APPLE_|TAURI_SIGNING_|SITUATE_RELEASE_SSH|GH_TOKEN|GITHUB_TOKEN)/.test(
            name,
          ) && environment[name],
      ),
      "Qualification account must not receive signing or publication credentials",
    );
    identifier = artifact.identifier;
    assert(
      /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(identifier),
      "Invalid signed application identifier",
    );
    archiveCandidateDeviceState = captureQualificationDeviceState({
      home: configuration.account.home,
      identifier,
      uid: configuration.account.uid,
    });
    assert(
      (await applicationPids()).length === 0,
      "Qualification account already has a running Situate application",
    );
  }
  function prepareDirectory() {
    owned = mkdtempSync(
      join(configuration.account.home, "situate-final-artifact-"),
    );
    app = join(owned, "Situate.app");
    writeFileSync(
      join(owned, "ownership.json"),
      JSON.stringify({ pid: process.pid }),
      { flag: "wx", mode: 0o600 },
    );
  }
  async function cleanup() {
    try {
      assert(
        !launchPending || pid,
        "Application launch outcome is unknown; retain the isolated account and package for inspection",
      );
      await quit();
    } finally {
      await provider?.close();
    }
    assert(
      !deviceStateIsolationPending,
      "Device-state isolation did not finish; retain the disposable account and archive for inspection",
    );
    assert(
      !mountUncertain,
      "Mount outcome is unknown; retain the isolated account and package for inspection",
    );
    assert(
      !placementUncertain,
      "Finder placement outcome is unknown; retain isolated storage for inspection",
    );
    if (owned) {
      if (launchDiagnostic) archiveCandidateDeviceState(owned);
      rmSync(owned, { recursive: true });
    }
  }
  if (launchDiagnostic)
    return async (directory, artifact) => {
      let failure;
      let phase = "prepare";
      const cleanupFailures = [];
      try {
        reporter.emit(phase, "started");
        await prepareAccount(artifact);
        prepareDirectory();
        reporter.emit(phase, "completed");
        phase = "install";
        reporter.emit(phase, "started");
        await installDmg(directory, artifact);
        reporter.emit(phase, "completed");
      } catch (error) {
        failure = error;
        reporter.emit(phase, "failed");
      }
      try {
        reporter.emit("cleanup", "started");
        await cleanup();
        reporter.emit("cleanup", "completed");
      } catch (error) {
        cleanupFailures.push(error);
        reporter.emit("cleanup", "failed");
      }
      reporter.check(failure, cleanupFailures);
    };
  return {
    async prepare({ manifest }) {
      await prepareAccount(manifest.artifacts[0]);
      const route = await routing.inspect();
      assert(
        route.isolatedRouting === true &&
          route.normalTls === true &&
          route.publicPointerUnchanged === true &&
          route.endpoint === manifest.artifacts[0].buildConfiguration.endpoint,
        "Production HTTPS route is not isolated",
      );
      const predecessor = configuration.predecessor;
      assert(
        route.publicVersion === predecessor.manifest.version &&
          ["darwin-aarch64", "darwin-x86_64"].every(
            (target) =>
              route.publicSignatures?.[target] ===
              predecessor.manifest.artifacts[0].updater.signature,
          ),
        "Public host-channel predecessor differs from the configured installation baseline",
      );
      await verifyQualificationFeed(route.endpoint, manifest, { signal });
      const predecessorBytes = readFileSync(
        join(predecessor.directory, "manifest.json"),
      );
      assert(
        JSON.stringify(JSON.parse(predecessorBytes)) ===
          JSON.stringify(predecessor.manifest),
        "Predecessor manifest differs from its exact file",
      );
      assert(
        predecessor.manifest.artifacts[0].buildConfiguration.endpoint ===
          route.endpoint,
        "Predecessor production updater endpoint differs",
      );
      await verifyDirectPayloads(
        predecessor.directory,
        predecessor.manifest.artifacts[0],
        { execute, env: safeEnv, signal },
      );
      prepareDirectory();
      stateRoot = join(owned, "candidate-state");
      seedWorkspace();
      await startProviderPhase();
      session = {
        productionEndpoint: route.endpoint,
        normalTls: true,
        isolatedRouting: true,
        publicPointerUnchanged: true,
        signingCredentialsAbsent: true,
        syntheticFixtures: true,
        host: {
          os: "darwin",
          architecture: process.arch,
          runnerImage: configuration.runnerImage,
        },
        predecessor: {
          version: predecessor.manifest.version,
          manifestSha256: hash(join(predecessor.directory, "manifest.json")),
        },
      };
      return session;
    },
    async install({ directory, artifact }) {
      await installDmg(directory, artifact);
      return {
        packageSha256: hash(join(directory, artifact.path)),
        bundleSha256: bundleDigest(app),
        version: artifact.version,
        launched: Boolean(pid),
      };
    },
    async journeys() {
      await exerciseState();
      return {
        bundleSha256: bundleDigest(app),
        restartVerified: true,
        workspace: "passed",
        onboarding: "passed",
        plugins: "passed",
      };
    },
    async update({ directory, artifact, predecessor }) {
      if (defaultProfile) await productJourneys.close();
      await quit();
      assert(
        bundleDigest(app) === artifact.bundleSha256,
        "Installed candidate changed before update qualification",
      );
      let upgrade;
      let predecessorStartedAt;
      await qualifyPredecessorUpdate({
        install: async () => {
          deviceStateIsolationPending = true;
          archiveCandidateDeviceState(owned);
          deviceStateIsolationPending = false;
          await startProviderPhase();
          rmSync(app, { recursive: true });
          const previous = configuration.predecessor;
          predecessorStartedAt = Date.now();
          await installDmg(previous.directory, previous.manifest.artifacts[0], {
            updater: true,
          });
          assert(
            (await processPath(pid)).startsWith(`${app}/Contents/MacOS/`),
            "Predecessor must launch from the writable installed bundle",
          );
          stateRoot = join(owned, "predecessor-state");
          seedWorkspace();
          if (defaultProfile) {
            const root = materializeUpgradeWorkspace(
              join(stateRoot, "workspace"),
            );
            upgrade = upgradeWorkspaceJourney({
              actions: (items) => actions(items, "update"),
              progress: (code) => reporter.emit("update", code, "upgrade_step"),
              verify: (expected) => verifyUpgradeWorkspace(root, expected),
              verifyCancellation: async (expectedDraft) => {
                assert(
                  pid &&
                    (await applicationPids()).includes(pid) &&
                    (await ownsProcess(pid)) &&
                    bundleDigest(app) ===
                      previous.manifest.artifacts[0].bundleSha256,
                  "Cancelled update did not leave the predecessor installed and running",
                );
                verifyUpgradeWorkspace(root, upgradeNoteAfter);
                verifyUpgradeDraft(root, expectedDraft);
              },
              writable: (enabled) => chmodSync(root, enabled ? 0o700 : 0o500),
            });
          }
        },
        author: async () => {
          if (!upgrade) return exerciseState();
          await upgrade.open();
          await upgrade.author();
        },
        report: () => provider.report(),
        update: async () => {
          const previousPid = pid;
          try {
            if (upgrade) await upgrade.update();
            else await actions(configuration.updateActions, "update");
            pid = undefined;
            launchPending = true;
            await waitFor(async () => {
              try {
                return bundleDigest(app) === artifact.bundleSha256;
              } catch {
                return false;
              }
            }, "production updater installation");
            await launch(false, previousPid);
          } catch (failure) {
            let installed;
            try {
              installed = bundleDigest(app);
            } catch {
              // Preserve the original failure when bundle identity cannot be observed.
            }
            const previous = configuration.predecessor.manifest.artifacts[0];
            reporter.emit(
              "update",
              installed === artifact.bundleSha256
                ? "bundle_candidate"
                : installed === previous.bundleSha256
                  ? "bundle_predecessor"
                  : "bundle_unverified",
              "updater",
            );
            throw failure;
          }
        },
        reopen: async (report) => {
          if (!upgrade) return reopenState(report);
          await upgrade.reopen();
          verifyNoProviderReplay(report);
        },
        restart: async () => {
          await quit();
          await launch();
        },
      }).catch((failure) => {
        if (predecessorStartedAt !== undefined) {
          const events = observeUpdater({
            ...configuration.account,
            identifier,
            version: configuration.predecessor.manifest.artifacts[0].version,
            since: predecessorStartedAt,
          });
          for (const event of events.length ? events : ["updater_unavailable"])
            reporter.emit("update", event, "updater");
        }
        reporter.check(failure);
      });
      return {
        predecessorManifestSha256: predecessor.manifestSha256,
        archiveSha256: hash(join(directory, artifact.updater.path)),
        bundleSha256: bundleDigest(app),
        version: artifact.version,
        usedProductionUpdater: true,
        retainedSyntheticData: true,
        relaunched: Boolean(pid),
      };
    },
    async inspect() {
      const route = await routing.inspect();
      return {
        publicPointerUnchanged: route.publicPointerUnchanged,
        normalTls: route.normalTls,
        isolatedRouting: route.isolatedRouting,
      };
    },
    cleanup,
  };
  async function startProviderPhase() {
    await provider?.close();
    provider = defaultProfile
      ? await startFinalArtifactProvider({ signal })
      : await startAgentProvider({ mode: "fixture", signal });
  }
  function seedWorkspace() {
    mkdirSync(join(stateRoot, "workspace"), { recursive: true });
    for (const fixture of configuration.fixtureFiles ?? []) {
      assert(
        typeof fixture.path === "string" &&
          !isAbsolute(fixture.path) &&
          !fixture.path.split("/").includes("..") &&
          typeof fixture.contents === "string",
        "Invalid synthetic fixture file",
      );
      const path = join(stateRoot, "workspace", fixture.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, fixture.contents, { flag: "wx", mode: 0o600 });
    }
  }
  function fixturePath(name, path = "") {
    assert(
      /^Qualification (candidate|predecessor)$/.test(name),
      "Invalid synthetic workspace name",
    );
    assert(
      !isAbsolute(path) && !path.split("/").includes(".."),
      "Invalid synthetic workspace path",
    );
    const root = join(stateRoot, "workspace", name);
    assert(
      !relative(realpathSync(stateRoot), realpathSync(root)).startsWith(".."),
      "Synthetic workspace escaped its owner",
    );
    const target = join(root, path);
    if (existsSync(target)) {
      const stat = lstatSync(target);
      assert(
        (stat.isDirectory() || stat.nlink === 1) &&
          !stat.isSymbolicLink() &&
          !relative(root, realpathSync(target)).startsWith(".."),
        "Unsafe synthetic fixture target",
      );
    }
    return target;
  }
  async function exerciseState() {
    if (defaultProfile) {
      const predecessor = stateRoot.endsWith("predecessor-state");
      const phase = predecessor ? "update" : "journeys";
      productJourneys = finalArtifactJourneys({
        actions: (items) => actions(items, phase),
        progress: (code) => reporter.emit(phase, code, "journey_step"),
        phase: predecessor ? "predecessor" : "candidate",
        seed: async (name, path, contents) =>
          writeFileSync(fixturePath(name, path), contents, {
            flag: "wx",
            mode: 0o600,
          }),
        verifyFiles: async (name, files) => {
          for (const [path, contents] of files)
            assert.equal(
              readFileSync(fixturePath(name, path), "utf8"),
              contents,
              "Synthetic retained file differs",
            );
        },
      });
      await productJourneys.exercise();
      const report = provider.report();
      assert(
        !report.failed && !report.budgetDenials,
        "Fixture provider failed or exceeded its budget",
      );
      await quit();
      await launch();
      await reopenState(report);
      return;
    }
    const initial = provider.report();
    for (const name of journeyNames) {
      const before = provider.report().requests;
      await actions(configuration.journeys[name].actions);
      assert(
        provider.report().requests > before,
        "Synthetic journey did not exercise the fixture provider",
      );
    }
    for (const name of [
      "multiwindow",
      "unsavedCancellation",
      "replacement",
      "relaunch",
      "recovery",
    ]) {
      const scenario = configuration.lifecycle[name];
      await actions(scenario.before);
      await actions(scenario.actions);
      await actions(scenario.after);
    }
    const report = provider.report();
    assert(
      report.pluginEffects.POST - initial.pluginEffects.POST === 1 &&
        report.pluginEffects.DELETE - initial.pluginEffects.DELETE === 1 &&
        report.budgetDenials === 0,
      "Synthetic plugin effects or provider budgets differ",
    );
    retainedFiles();
    await quit();
    await launch();
    await reopenState(report);
  }
  async function reopenState(report) {
    if (defaultProfile) await productJourneys.reopen();
    else
      for (const name of journeyNames)
        await actions(configuration.journeys[name].reopen);
    verifyNoProviderReplay(report);
    if (!defaultProfile) retainedFiles();
  }
  function verifyNoProviderReplay(report) {
    const observed = provider.report();
    assert(
      !report.failed &&
        !observed.failed &&
        !observed.budgetDenials &&
        observed.requests === report.requests &&
        observed.pluginEffects.POST === report.pluginEffects.POST &&
        observed.pluginEffects.DELETE === report.pluginEffects.DELETE,
      "Reopening replayed provider requests or plugin effects",
    );
  }
}
