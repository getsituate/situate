import { spawn, spawnSync } from "node:child_process";
import { release } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { nativeDesktopIssue } from "../client/scripts/native-desktop-session.mjs";

const script = `
ObjC.import("AppKit");
// The C function signatures live in the subframeworks' BridgeSupport metadata.
ObjC.import("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework");
ObjC.import("/System/Library/Frameworks/CoreServices.framework/Frameworks/AE.framework");
function run() {
  var evidence = {
    accessibilityTrusted: false,
    systemEventsRunning: false,
    appleEventsAllowed: false,
    finderRunning: false,
    menuBar: false,
    menuBarElementCount: 0
  };
  try {
    evidence.accessibilityTrusted = Boolean($.AXIsProcessTrusted());
    if (!evidence.accessibilityTrusted) return JSON.stringify(evidence);
    evidence.systemEventsRunning =
      $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.systemevents").count > 0;
    if (!evidence.systemEventsRunning) return JSON.stringify(evidence);
    var target = $.NSAppleEventDescriptor.descriptorWithBundleIdentifier("com.apple.systemevents");
    // typeWildCard ('****') covers the reads below; false forbids consent prompts.
    evidence.appleEventsAllowed = $.AEDeterminePermissionToAutomateTarget(
      target.aeDesc, 0x2a2a2a2a, 0x2a2a2a2a, false
    ) === 0;
    if (!evidence.appleEventsAllowed) return JSON.stringify(evidence);
    evidence.finderRunning =
      $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.finder").count > 0;
    if (!evidence.finderRunning) return JSON.stringify(evidence);
    var finder = Application("com.apple.systemevents").applicationProcesses.byName("Finder");
    var menu = finder.menuBars.at(0);
    evidence.menuBar = menu.role() === "AXMenuBar";
    if (evidence.menuBar) evidence.menuBarElementCount = menu.uiElements.length;
  } catch (_) {
    // Never return AppleEvents errors, which can contain UI object descriptions.
  }
  return JSON.stringify(evidence);
}
`;

function verifiedEvidence(value) {
  const evidence = {};
  for (const key of [
    "desktopUnlocked",
    "accessibilityTrusted",
    "systemEventsRunning",
    "appleEventsAllowed",
    "finderRunning",
    "menuBar",
  ]) {
    if (value?.[key] !== true)
      throw new Error("Release desktop capability is unavailable.");
    evidence[key] = true;
  }
  if (
    !Number.isSafeInteger(value.menuBarElementCount) ||
    value.menuBarElementCount <= 0
  )
    throw new Error("Release desktop menu bar is unavailable.");
  evidence.menuBarElementCount = value.menuBarElementCount;
  return evidence;
}

export function probeReleaseDesktopWorker({
  platform = process.platform,
  probe = spawnSync,
} = {}) {
  if (platform !== "darwin")
    throw new Error("Release desktop preflight requires macOS.");
  let desktopIssue;
  try {
    desktopIssue = nativeDesktopIssue({ platform, probe });
  } catch {
    desktopIssue = "desktop-session-unavailable";
  }
  if (desktopIssue)
    throw new Error("Release desktop preflight requires an unlocked desktop.");
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
    if (result.error || result.status !== 0) throw new Error();
    return verifiedEvidence({
      ...JSON.parse(result.stdout),
      desktopUnlocked: true,
    });
  } catch {
    throw new Error("Release desktop capability is unavailable.");
  }
}

export async function probeReleaseDesktop({
  platform = process.platform,
  environment = process.env,
  spawnProcess = spawn,
  killProcess = process.kill,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (platform !== "darwin")
    throw new Error("Release desktop preflight requires macOS.");
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
      if (error) reject(new Error("Release desktop preflight failed."));
      else accept(value);
    };
    try {
      child = spawnProcess(
        process.execPath,
        [fileURLToPath(import.meta.url), "--worker"],
        { env: {}, detached: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      timer = setTimer(() => finish(true), 28000);
      child.on("error", () => finish(true));
      child.stdout.on("error", () => finish(true));
      child.stdout.on("data", (chunk) => {
        if (settled) return;
        output += chunk.toString();
        if (Buffer.byteLength(output) > 4096) finish(true);
      });
      child.on("close", (code) => {
        if (settled) return;
        try {
          if (code !== 0) throw new Error();
          finish(false, verifiedEvidence(JSON.parse(output)));
        } catch {
          finish(true);
        }
      });
    } catch {
      finish(true);
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
    throw new Error("Release desktop preflight accepts no options.");
  output(JSON.stringify(await (args[0] === "--worker" ? worker() : probe())));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    console.error("Release desktop preflight failed.");
    process.exitCode = 1;
  });
