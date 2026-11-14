import { spawn, spawnSync } from "node:child_process";
import { release } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { nativeDesktopIssue } from "../client/scripts/native-desktop-session.mjs";

const script = `
function run() {
  var evidence = { stage: "framework-appkit" };
  try {
    ObjC.import("AppKit");
    evidence.stage = "framework-accessibility";
    // The C function signatures live in the subframeworks' BridgeSupport metadata.
    ObjC.import("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework");
    evidence.stage = "framework-appleevents";
    ObjC.import("/System/Library/Frameworks/CoreServices.framework/Frameworks/AE.framework");
    evidence.stage = "accessibility-query";
    evidence.accessibilityTrusted = Boolean($.AXIsProcessTrusted());
    if (!evidence.accessibilityTrusted) {
      evidence.stage = "accessibilityTrusted";
      return JSON.stringify(evidence);
    }
    evidence.stage = "system-events-query";
    evidence.systemEventsRunning =
      $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.systemevents").count > 0;
    if (!evidence.systemEventsRunning) {
      evidence.stage = "system-events-launch";
      var configuration = $.NSWorkspaceOpenConfiguration.configuration;
      configuration.activates = false;
      configuration.hides = true;
      configuration.promptsUserIfNeeded = false;
      configuration.addsToRecentItems = false;
      configuration.allowsRunningApplicationSubstitution = false;
      $.NSWorkspace.sharedWorkspace.openApplicationAtURLConfigurationCompletionHandler(
        $.NSURL.fileURLWithPath("/System/Library/CoreServices/System Events.app"),
        configuration, null
      );
      for (var attempt = 0; attempt < 50 && !evidence.systemEventsRunning; attempt++) {
        $.NSThread.sleepForTimeInterval(0.1);
        evidence.systemEventsRunning =
          $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.systemevents").count > 0;
      }
      if (!evidence.systemEventsRunning) return JSON.stringify(evidence);
    }
    evidence.stage = "appleevents-target";
    var target = $.NSAppleEventDescriptor.descriptorWithBundleIdentifier("com.apple.systemevents");
    var address = target.aeDesc;
    evidence.stage = "appleevents-query";
    // typeWildCard ('****') covers the reads below; false forbids consent prompts.
    var permission = $.AEDeterminePermissionToAutomateTarget(
      address, 0x2a2a2a2a, 0x2a2a2a2a, false
    );
    evidence.appleEventsAllowed = permission === 0;
    if (!evidence.appleEventsAllowed) {
      evidence.stage = permission === -1744 ? "appleevents-consent-required" : "appleEventsAllowed";
      return JSON.stringify(evidence);
    }
    evidence.stage = "finder-query";
    evidence.finderRunning =
      $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.finder").count > 0;
    if (!evidence.finderRunning) {
      evidence.stage = "finderRunning";
      return JSON.stringify(evidence);
    }
    evidence.stage = "menu-role-query";
    var finder = Application("com.apple.systemevents").applicationProcesses.byName("Finder");
    var menu = finder.menuBars.at(0);
    evidence.menuBar = menu.role() === "AXMenuBar";
    if (!evidence.menuBar) {
      evidence.stage = "menuBar";
      return JSON.stringify(evidence);
    }
    evidence.stage = "menu-count-query";
    evidence.menuBarElementCount = menu.uiElements.length;
    evidence.stage = "complete";
  } catch (_) {
    // Never return AppleEvents errors, which can contain UI object descriptions.
  }
  return JSON.stringify(evidence);
}
`;

const capabilities = [
  "desktopUnlocked",
  "accessibilityTrusted",
  "systemEventsRunning",
  "appleEventsAllowed",
  "finderRunning",
  "menuBar",
];
const stages = new Set([
  ...capabilities,
  "menuBarElementCount",
  "platform",
  "desktop-session-locked",
  "desktop-session-unavailable",
  "framework-appkit",
  "framework-accessibility",
  "framework-appleevents",
  "accessibility-query",
  "system-events-query",
  "system-events-launch",
  "finder-query",
  "menu-role-query",
  "menu-count-query",
  "appleevents-target",
  "appleevents-query",
  "appleevents-consent-required",
  "jxa-process",
  "jxa-timeout",
  "jxa-output",
  "worker-start",
  "worker-stream",
  "worker-timeout",
  "worker-output",
  "worker-exit",
  "arguments",
]);

function diagnostic(value, fallback = "worker-exit") {
  const result = { stage: stages.has(value?.stage) ? value.stage : fallback };
  for (const key of capabilities)
    if (typeof value?.[key] === "boolean") result[key] = value[key];
  if (
    Number.isSafeInteger(value?.menuBarElementCount) &&
    value.menuBarElementCount >= 0
  )
    result.menuBarElementCount = value.menuBarElementCount;
  return result;
}

function failure(stage, evidence) {
  const safe = diagnostic(evidence, stage);
  return Object.assign(
    new Error(`Release desktop preflight failed: ${JSON.stringify(safe)}`),
    { diagnostic: safe },
  );
}

function verifiedEvidence(value) {
  const evidence = {};
  for (const key of capabilities) {
    if (value?.[key] !== true) throw failure(key, value);
    evidence[key] = true;
  }
  if (
    !Number.isSafeInteger(value.menuBarElementCount) ||
    value.menuBarElementCount <= 0
  )
    throw failure("menuBarElementCount", value);
  evidence.menuBarElementCount = value.menuBarElementCount;
  return evidence;
}

export function probeReleaseDesktopWorker({
  platform = process.platform,
  probe = spawnSync,
} = {}) {
  if (platform !== "darwin") throw failure("platform");
  let desktopIssue;
  try {
    desktopIssue = nativeDesktopIssue({ platform, probe });
  } catch {
    desktopIssue = "desktop-session-unavailable";
  }
  if (desktopIssue)
    throw failure(
      stages.has(desktopIssue) ? desktopIssue : "desktop-session-unavailable",
      { desktopUnlocked: false },
    );
  let result;
  try {
    result = probe("/usr/bin/osascript", ["-l", "JavaScript", "-"], {
      env: {},
      encoding: "utf8",
      input: script,
      timeout: 20000,
      killSignal: "SIGKILL",
      maxBuffer: 4096,
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    throw failure("jxa-process", { desktopUnlocked: true });
  }
  if (result.error || result.status !== 0)
    throw failure(
      result.error?.code === "ETIMEDOUT" ? "jxa-timeout" : "jxa-process",
      { desktopUnlocked: true },
    );
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw failure("jxa-output", { desktopUnlocked: true });
  }
  return verifiedEvidence({ ...value, desktopUnlocked: true });
}

export async function probeReleaseDesktop({
  platform = process.platform,
  environment = process.env,
  spawnProcess = spawn,
  killProcess = process.kill,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (platform !== "darwin") throw failure("platform");
  const evidence = await new Promise((accept, reject) => {
    let child;
    let timer;
    let settled = false;
    let output = "";
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      if (error && child?.pid) {
        try {
          // The detached worker and osascript share a group, including on timeout.
          killProcess(-child.pid, "SIGKILL");
        } catch {
          // The process group may already have exited.
        }
      }
      if (error) reject(error);
      else accept(value);
    };
    try {
      child = spawnProcess(
        process.execPath,
        [fileURLToPath(import.meta.url), "--worker"],
        { env: {}, detached: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      timer = setTimer(() => finish(failure("worker-timeout")), 28000);
      child.on("error", () => finish(failure("worker-start")));
      child.stdout.on("error", () => finish(failure("worker-stream")));
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        output += chunk.toString();
        if (Buffer.byteLength(output) > 4096) finish(failure("worker-output"));
      });
      child.on("close", (code) => {
        if (settled) return;
        let value;
        try {
          value = JSON.parse(output);
        } catch {
          finish(failure(code === 0 ? "worker-output" : "worker-exit"));
          return;
        }
        if (code !== 0) {
          finish(failure("worker-exit", value));
          return;
        }
        try {
          finish(null, verifiedEvidence(value));
        } catch (error) {
          finish(error);
        }
      });
    } catch {
      finish(failure("worker-start"));
    }
  });
  const imageValue = (name) =>
    /^[a-zA-Z0-9._+-]{1,100}$/.test(environment[name] ?? "")
      ? environment[name]
      : null;
  return {
    image: { os: imageValue("ImageOS"), version: imageValue("ImageVersion") },
    os: { platform, release: release() },
    arch: process.arch,
    ...evidence,
  };
}

export async function main(
  args = process.argv.slice(2),
  {
    probe = probeReleaseDesktop,
    worker = probeReleaseDesktopWorker,
    output = console.log,
  } = {},
) {
  if (args.length && (args.length !== 1 || args[0] !== "--worker"))
    throw failure("arguments");
  if (args[0] === "--worker") {
    try {
      output(JSON.stringify(await worker()));
    } catch (error) {
      const safe = failure("worker-exit", error?.diagnostic);
      output(JSON.stringify(safe.diagnostic));
      throw safe;
    }
  } else {
    output(JSON.stringify(await probe()));
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(failure("worker-exit", error?.diagnostic).message);
    process.exitCode = 1;
  });
