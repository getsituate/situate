import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:https";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  bundleDigest,
  verifyDirectPayloads,
} from "./direct-release-verification.mjs";
import { run } from "./ios-xcode.mjs";
import { requireNativeDesktop } from "./native-desktop-session.mjs";
import {
  createQualificationRouting,
  validateQualificationRouting,
} from "./final-artifact-routing.mjs";
import {
  startAgentProvider,
  PINNED_AGENT_MODEL,
} from "./agent-e2e-provider.mjs";

import { finalArtifactJourneys, startFinalArtifactProvider } from "./final-artifact-journeys.mjs";

const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const quote = (value) => JSON.stringify(value);
const journeyNames = ["workspace", "onboarding", "plugins"];

export async function qualifyPredecessorUpdate({ install, author, report, update, reopen, restart }) {
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
  if (!configuration.journeys && !configuration.lifecycle && !configuration.updateActions) {
    assert(configuration.profile === "macos-direct-v1", "Blocked: a reviewed final-artifact profile is required");
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
    [...scenario.before, ...scenario.actions, ...scenario.after].forEach(
      validateAction,
    );
  }
  assert(
    configuration.updateActions?.length &&
      configuration.updateActions.some(
        (action) => action.click?.name === "Install and restart",
      ),
    "Blocked: native production updater actions are required",
  );
  configuration.updateActions.forEach(validateAction);
  return configuration;
}

function validateAction(action) {
  assert(
    action && Object.keys(action).length === 1,
    "Invalid native accessibility action",
  );
  if (action.windows !== undefined) {
    assert(Number.isInteger(action.windows) && action.windows > 0 && action.windows <= 4, "Invalid owned window count");
  } else if (action.key) {
    assert(["return", "a", "g", "w"].includes(action.key.key) &&
      Array.isArray(action.key.modifiers) && action.key.modifiers.every((value) => ["command", "shift"].includes(value)), "Invalid accessibility key chord");
  } else if (action.click || action.assert || action.focus) {
    const target = action.click ?? action.assert ?? action.focus;
    assert(
      [
        "AXButton",
        "AXMenuItem",
        "AXStaticText",
        "AXTextField",
        "AXCheckBox",
        "AXTextArea",
      ].includes(target.role) &&
        typeof target.name === "string" &&
        target.name.length > 0 &&
        (target.window === undefined || (typeof target.window === "string" && target.window.length > 0)) &&
        (target.value === undefined || typeof target.value === "string"),
      "Invalid accessibility target",
    );
  } else if (action.type !== undefined) {
    assert(
      typeof action.type === "string" && action.type.length <= 16384,
      "Invalid synthetic text input",
    );
  } else throw new Error("Unsupported native accessibility action");
}

export function accessibilityScript(pid, action) {
  assert(Number.isSafeInteger(pid) && pid > 1, "Invalid owned application PID");
  validateAction(action);
  const prefix = `tell application "System Events"\nset targetProcess to first application process whose unix id is ${pid}\ntell targetProcess\nset frontmost to true\n`;
  if (action.type !== undefined)
    return `${prefix}keystroke ${quote(action.type)}\nend tell\nend tell`;
  if (action.windows !== undefined)
    return `${prefix}if count of windows is not ${action.windows} then error "Owned window count differs"\nend tell\nend tell`;
  if (action.key) {
    const code = { return: 36, tab: 48, escape: 53 }[action.key.key];
    const modifiers = action.key.modifiers.length ? ` using {${action.key.modifiers.map((value) => `${value} down`).join(", ")}}` : "";
    return `${prefix}${code ? `key code ${code}` : `keystroke ${quote(action.key.key)}`}${modifiers}\nend tell\nend tell`;
  }
  const target = action.click ?? action.assert ?? action.focus;
  const selectWindow = target.window ? `if count of (windows whose name is ${quote(target.window)}) is not 1 then error "Owned window must be unique"\nperform action "AXRaise" of first window whose name is ${quote(target.window)}\n` : "";
  const contents = target.window
    ? `entire contents of first window whose name is ${quote(target.window)}`
    : "entire contents";
  return `${prefix}${selectWindow}set matches to {}\nrepeat with elementRef in ${contents}\ntry\nif role of elementRef is ${quote(target.role)} and (name of elementRef is ${quote(target.name)} or description of elementRef is ${quote(target.name)}) then set end of matches to elementRef\nend try\nend repeat\nif count of matches is not 1 then error "Accessibility target must be unique"\n${target.role === "AXButton" ? 'if not enabled of item 1 of matches then error "Accessibility control is disabled"\n' : ""}${action.click ? 'perform action "AXPress" of item 1 of matches' : action.focus ? 'set value of attribute "AXFocused" of item 1 of matches to true' : target.value !== undefined ? `if value of item 1 of matches is not ${quote(target.value)} then error "Accessibility value differs"` : 'if not (exists item 1 of matches) then error "Accessibility assertion failed"'}\nend tell\nend tell`;
}

export function createFinalArtifactQualificationHost(
  configuration,
  { execute = run, environment = process.env, signal } = {},
) {
  validateFinalArtifactConfiguration(configuration);
  const safeEnv = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL"]
      .filter((name) => environment[name] !== undefined)
      .map((name) => [name, environment[name]]),
  );
  const options = { env: safeEnv, signal, capture: true };
  const routing = createQualificationRouting(configuration.routing, {
    execute,
    environment: safeEnv,
    signal,
  });
  let app;
  let pid;
  let launchPending = false;
  let owned;
  let session;
  let provider;
  let stateRoot;
  let productJourneys;
  const defaultProfile = !configuration.journeys;
  async function processPath(id) {
    return (
      await execute("ps", ["-p", String(id), "-o", "comm="], {
        ...options,
        signal: undefined,
      })
    ).trim();
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
  async function launch(start = true, previousPid) {
    launchPending = true;
    if (start) await execute("open", ["-n", app], options);
    await waitFor(async () => {
      const output = await execute(
        "osascript",
        [
          "-e",
          'tell application "System Events" to get unix id of every application process whose name is "Situate"',
        ],
        options,
      );
      const ids = output.trim().split(/,\s*/).filter(Boolean).map(Number);
      for (const id of ids) {
        if (
          Number.isSafeInteger(id) && id !== previousPid &&
          (await processPath(id)).startsWith(`${app}/Contents/MacOS/`)
        ) {
          assert(
            !pid || pid === id,
            "Multiple qualification application processes",
          );
          pid = id;
          launchPending = false;
        }
      }
      return Boolean(pid);
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
    assert(
      (await processPath(pid)).startsWith(`${app}/Contents/MacOS/`),
      "Owned application PID changed",
    );
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
  async function installDmg(directory, artifact) {
    assert(
      !existsSync(app),
      "Qualification application destination already exists",
    );
    const image = join(owned, "mount");
    mkdirSync(image, { recursive: true });
    let mounted = false;
    try {
      assert(
        hash(join(directory, artifact.path)) === artifact.sha256,
        "DMG changed before installation",
      );
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
      assert(
        bundleDigest(join(image, "Situate.app")) === artifact.bundleSha256,
        "Mounted installation bundle changed",
      );
      await execute("ditto", [join(image, "Situate.app"), app], options);
    } finally {
      if (mounted)
        await execute("hdiutil", ["detach", image], {
          ...options,
          signal: undefined,
        });
    }
    assert(
      bundleDigest(app) === artifact.bundleSha256,
      "Installed app differs from the final package",
    );
    await execute(
      "xattr",
      [
        "-w",
        "com.apple.quarantine",
        "0083;00000000;SituateQualification;",
        app,
      ],
      options,
    );
    await execute("spctl", ["--assess", "--type", "execute", app], options);
    await execute("xcrun", ["stapler", "validate", app], options);
    await launch();
  }
  async function actions(items) {
    for (const original of items) {
      const action = structuredClone(original);
      if (action.type !== undefined)
        action.type = action.type
          .replaceAll("{{workspace}}", join(stateRoot, "workspace"))
          .replaceAll("{{fixture.baseUrl}}", provider.baseUrl)
          .replaceAll("{{fixture.token}}", provider.token)
          .replaceAll("{{fixture.model}}", PINNED_AGENT_MODEL);
      await waitFor(async () => {
        try {
          await execute(
            "osascript",
            ["-e", accessibilityScript(pid, action)],
            options,
          );
          return true;
        } catch (error) {
          if (!action.assert && action.windows === undefined) throw error;
          return false;
        }
      }, "accessibility assertion");
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
  return {
    async prepare({ manifest }) {
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
      const identifier = manifest.artifacts[0].identifier;
      assert(
        /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(identifier),
        "Invalid signed application identifier",
      );
      for (const path of [
        join("Library", "Application Support", identifier),
        join("Library", "Containers", identifier),
        join("Library", "Preferences", `${identifier}.plist`),
        join("Library", "WebKit", identifier),
        join("Library", "Saved Application State", `${identifier}.savedState`),
      ])
        assert(
          !existsSync(join(configuration.account.home, path)),
          "Qualification account retains prior app data; inspect it before using a fresh disposable account",
        );
      const processes = await execute(
        "osascript",
        [
          "-e",
          'tell application "System Events" to get unix id of every application process whose name is "Situate"',
        ],
        options,
      );
      assert(
        !processes.trim(),
        "Qualification account already has a running Situate application",
      );
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
      owned = mkdtempSync(
        join(configuration.account.home, "situate-final-artifact-"),
      );
      app = join(owned, "Situate.app");
      writeFileSync(
        join(owned, "ownership.json"),
        JSON.stringify({ pid: process.pid }),
        { flag: "wx", mode: 0o600 },
      );
      stateRoot = join(owned, "candidate-state");
      seedWorkspace();
      provider = defaultProfile
        ? await startFinalArtifactProvider({ signal })
        : await startAgentProvider({ mode: "fixture", signal });
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
      await qualifyPredecessorUpdate({
        install: async () => {
          rmSync(app, { recursive: true });
          const previous = configuration.predecessor;
          await installDmg(previous.directory, previous.manifest.artifacts[0]);
          stateRoot = join(owned, "predecessor-state");
          seedWorkspace();
        },
        author: exerciseState,
        report: () => provider.report(),
        update: async () => {
          const previousPid = pid;
          if (defaultProfile) await productJourneys.update();
          else await actions(configuration.updateActions);
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
        },
        reopen: reopenState,
        restart: async () => { await quit(); await launch(); },
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
    async cleanup() {
      try {
        assert(
          !launchPending || pid,
          "Application launch outcome is unknown; retain the isolated account and package for inspection",
        );
        await quit();
      } finally {
        await provider?.close();
      }
      if (owned) rmSync(owned, { recursive: true });
    },
  };
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
    assert(/^Qualification (candidate|predecessor)$/.test(name), "Invalid synthetic workspace name");
    assert(!isAbsolute(path) && !path.split("/").includes(".."), "Invalid synthetic workspace path");
    const root = join(stateRoot, "workspace", name);
    assert(!relative(realpathSync(stateRoot), realpathSync(root)).startsWith(".."), "Synthetic workspace escaped its owner");
    const target = join(root, path);
    if (existsSync(target)) {
      const stat = lstatSync(target);
      assert((stat.isDirectory() || stat.nlink === 1) && !stat.isSymbolicLink() && !relative(root, realpathSync(target)).startsWith(".."), "Unsafe synthetic fixture target");
    }
    return target;
  }
  async function exerciseState() {
    if (defaultProfile) {
      productJourneys = finalArtifactJourneys({
        actions,
        phase: stateRoot.endsWith("predecessor-state") ? "predecessor" : "candidate",
        seed: async (name, path, contents) => writeFileSync(fixturePath(name, path), contents, { flag: "wx", mode: 0o600 }),
        writable: async (name, value) => chmodSync(fixturePath(name), value ? 0o700 : 0o500),
        verifyFiles: async (name, files) => {
          for (const [path, contents] of files)
            assert.equal(readFileSync(fixturePath(name, path), "utf8"), contents, "Synthetic retained file differs");
        },
      });
      await productJourneys.exercise();
      const report = provider.report();
      assert(!report.failed && !report.budgetDenials, "Fixture provider failed or exceeded its budget");
      await quit();
      await launch();
      await reopenState(report);
      return;
    }
    const initial = provider.report();
    for (const name of journeyNames) {
      const before = provider.report().requests;
      await actions(configuration.journeys[name].actions);
      assert(provider.report().requests > before, "Synthetic journey did not exercise the fixture provider");
    }
    for (const name of ["multiwindow", "unsavedCancellation", "replacement", "relaunch", "recovery"]) {
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
    else for (const name of journeyNames)
      await actions(configuration.journeys[name].reopen);
    assert(
      provider.report().failed !== true &&
      provider.report().requests === report.requests &&
      provider.report().pluginEffects.POST === report.pluginEffects.POST &&
      provider.report().pluginEffects.DELETE === report.pluginEffects.DELETE,
      "Reopening replayed provider requests or plugin effects",
    );
    if (!defaultProfile) retainedFiles();
  }
}
