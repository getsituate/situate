import { spawn, spawnSync } from "node:child_process";
import { release } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { nativeDesktopIssue } from "../client/scripts/native-desktop-session.mjs";

const script = `
function run() {
  var evidence = { stage: "framework-appkit" };
  var phaseOutput;
  // Use a separate pipe for fixed phases; stderr may contain UI descriptions.
  function phase(value) {
    evidence.stage = value;
    phaseOutput.writeData(
      $.NSString.stringWithString(value + "\\n").dataUsingEncoding($.NSUTF8StringEncoding)
    );
  }
  try {
    ObjC.import("Foundation");
    phaseOutput = $.NSFileHandle.alloc.initWithFileDescriptor(3);
    phase("framework-appkit");
    ObjC.import("AppKit");
    phase("framework-accessibility");
    // The C function signatures live in the subframeworks' BridgeSupport metadata.
    ObjC.import("/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework");
    phase("framework-appleevents");
    ObjC.import("/System/Library/Frameworks/CoreServices.framework/Frameworks/AE.framework");
    phase("accessibility-query");
    evidence.accessibilityTrusted = Boolean($.AXIsProcessTrusted());
    if (!evidence.accessibilityTrusted) {
      phase("accessibilityTrusted");
      return JSON.stringify(evidence);
    }
    phase("system-events-query");
    evidence.systemEventsRunning =
      $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.systemevents").count > 0;
    if (!evidence.systemEventsRunning) {
      phase("system-events-launch");
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
    phase("appleevents-target");
    var target = $.NSAppleEventDescriptor.descriptorWithBundleIdentifier("com.apple.systemevents");
    phase("appleevents-address");
    var address = target.aeDesc;
    phase("appleevents-query");
    // aeDesc's Ref type differs from AE's BridgeSupport struct type; keep the address opaque.
    ObjC.bindFunction("AEDeterminePermissionToAutomateTarget", [
      "int", ["void *", "unsigned int", "unsigned int", "bool"]
    ]);
    // typeWildCard ('****') covers the reads below; false forbids consent prompts.
    var permission = $.AEDeterminePermissionToAutomateTarget(
      address, 0x2a2a2a2a, 0x2a2a2a2a, false
    );
    evidence.appleEventsAllowed = permission === 0;
    if (!evidence.appleEventsAllowed) {
      phase(permission === -1744 ? "appleevents-consent-required" : "appleEventsAllowed");
      return JSON.stringify(evidence);
    }
    phase("finder-query");
    evidence.finderRunning =
      $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.finder").count > 0;
    if (!evidence.finderRunning) {
      phase("finderRunning");
      return JSON.stringify(evidence);
    }
    phase("menu-role-query");
    var finder = Application("com.apple.systemevents").applicationProcesses.byName("Finder");
    var menu = finder.menuBars.at(0);
    evidence.menuBar = menu.role() === "AXMenuBar";
    if (!evidence.menuBar) {
      phase("menuBar");
      return JSON.stringify(evidence);
    }
    phase("menu-count-query");
    evidence.menuBarElementCount = menu.uiElements.length;
    phase("complete");
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
const jxaPhases = new Set([
  "framework-appkit",
  "framework-accessibility",
  "framework-appleevents",
  "accessibility-query",
  "accessibilityTrusted",
  "system-events-query",
  "system-events-launch",
  "appleevents-target",
  "appleevents-address",
  "appleevents-query",
  "appleevents-consent-required",
  "appleEventsAllowed",
  "finder-query",
  "finderRunning",
  "menu-role-query",
  "menuBar",
  "menu-count-query",
  "complete",
]);
const signals = new Set([
  "SIGABRT",
  "SIGSEGV",
  "SIGBUS",
  "SIGILL",
  "SIGFPE",
  "SIGTRAP",
  "SIGKILL",
  "SIGTERM",
  "SIGINT",
  "SIGHUP",
  "SIGQUIT",
  "SIGPIPE",
  "SIGALRM",
  "SIGSYS",
  "SIGXCPU",
  "SIGXFSZ",
]);
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
  "appleevents-address",
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
  if (result.stage === "jxa-process" || result.stage === "jxa-timeout") {
    if (
      Number.isSafeInteger(value?.jxaStatus) &&
      value.jxaStatus >= 0 &&
      value.jxaStatus <= 255
    )
      result.jxaStatus = value.jxaStatus;
    if (signals.has(value?.jxaSignal)) result.jxaSignal = value.jxaSignal;
    if (jxaPhases.has(value?.jxaPhase)) result.jxaPhase = value.jxaPhase;
  }
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
      stdio: ["pipe", "pipe", "ignore", "pipe"],
    });
  } catch {
    throw failure("jxa-process", { desktopUnlocked: true });
  }
  if (result.error || result.status !== 0) {
    const trace = result.output?.[3];
    const jxaPhase =
      typeof trace === "string" && trace.length <= 4096
        ? trace.trimEnd().split("\n").at(-1)
        : undefined;
    throw failure(
      result.error?.code === "ETIMEDOUT" ? "jxa-timeout" : "jxa-process",
      {
        desktopUnlocked: true,
        jxaStatus: result.status,
        jxaSignal: result.signal,
        jxaPhase,
      },
    );
  }
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
