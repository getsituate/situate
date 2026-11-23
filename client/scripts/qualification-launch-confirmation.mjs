import { run } from "./ios-xcode.mjs";

// Keep the validated accessibility reference and the press in one query.
function launchConsent(Application, ObjC, $, mode, expiresAt) {
  try {
    const events = Application("System Events");
    const agent = events.applicationProcesses.byName("CoreServicesUIAgent");
    const present = agent.exists();
    if (present === false) return "absent";
    if (present !== true) return "unavailable";
    ObjC.import("AppKit");
    const pid = agent.unixId();
    const trustedAgent = () => {
      if (!Number.isSafeInteger(pid) || pid <= 0 || agent.unixId() !== pid)
        return false;
      const process =
        $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
      return (
        ObjC.unwrap(process.bundleIdentifier) ===
          "com.apple.coreservices.uiagent" &&
        ObjC.unwrap(process.bundleURL.path) ===
          "/System/Library/CoreServices/CoreServicesUIAgent.app"
      );
    };
    if (!trustedAgent()) return "unavailable";
    const windows = agent.windows();
    if (!Array.isArray(windows)) return "unavailable";
    if (windows.length === 0) return "absent";
    if (mode !== "confirm" || windows.length !== 1) return "unexpected";
    const window = windows[0];
    if (window.role() !== "AXWindow") return "unexpected";
    const labels = [],
      buttons = [];
    let count = 0;
    function visit(parent) {
      const children = parent.uiElements();
      if (!Array.isArray(children) || children.length > 64) return false;
      for (const element of children) {
        if (++count > 64) return false;
        switch (element.role()) {
          case "AXStaticText": {
            const label = element.name();
            if (typeof label !== "string" || label.length > 256) return false;
            labels.push(label.replace(/\s+/g, " ").trim());
            break;
          }
          case "AXButton": {
            const name = element.name();
            if (name !== null && name !== "Open" && name !== "Cancel")
              return false;
            buttons.push({ name, element });
            break;
          }
          case "AXImage":
          case "AXGroup":
            break;
          default:
            return false;
        }
        if (!visit(element)) return false;
      }
      return true;
    }
    if (
      !visit(window) ||
      labels.length !== 2 ||
      buttons.length !== 3 ||
      buttons.filter(({ name }) => name === null).length !== 1 ||
      buttons.filter(({ name }) => name === "Cancel").length !== 1
    )
      return "unexpected";
    const headline =
      /^“Situate(?:\.app)?” is an app created by the app ([^.!?]{1,64})\. Are you sure you want to open it\?$/;
    const creator = labels
      .map((label) => headline.exec(label))
      .find(Boolean)?.[1];
    if (
      !creator ||
      !labels.some(
        (label) =>
          label.startsWith(`${creator} created this file on `) &&
          /^.{1,64}\. Apple checked it for malicious software and none was detected\.$/.test(
            label.slice(`${creator} created this file on `.length),
          ),
      )
    )
      return "unexpected";
    const button = buttons.find(({ name }) => name === "Open")?.element;
    if (
      !button ||
      !trustedAgent() ||
      agent.windows().length !== 1 ||
      button.name() !== "Open" ||
      button.enabled() !== true
    )
      return "unexpected";
    const press = button.actions.byName("AXPress");
    if (press.name() !== "AXPress" || Date.now() >= expiresAt)
      return "unavailable";
    try {
      events.perform(press);
    } catch {
      return "press-unknown";
    }
    return "confirmed";
  } catch {
    return "unavailable";
  }
}

export async function queryLaunchConsent(
  mode,
  { environment = {}, signal, execute = run } = {},
) {
  const baseline = mode === "baseline";
  if (!baseline && mode !== "confirm") return "unavailable";
  if (signal?.aborted) return baseline ? "query_cancelled" : "unavailable";
  const budgetMs = baseline ? 1500 : 3500;
  const expiresAt = Date.now() + budgetMs;
  const timeout = AbortSignal.timeout(budgetMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const env = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL"]
      .filter((key) => typeof environment[key] === "string")
      .map((key) => [key, environment[key]]),
  );
  try {
    const result = await execute(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        `(${launchConsent.toString()})(Application, ObjC, $, ${JSON.stringify(mode)}, ${expiresAt})`,
      ],
      { env, signal: combined, capture: true, terminationGraceMs: 2000 },
    );
    if (!combined.aborted) {
      if (result === "absent" || result === "unexpected") return result;
      if (!baseline && ["confirmed", "press-unknown"].includes(result))
        return result;
    }
  } catch {
    // A failed AppleEvent cannot prove that an attempted press had no effect.
  }
  if (!baseline) return "unavailable";
  if (signal?.aborted) return "query_cancelled";
  return timeout.aborted ? "query_timeout" : "query_failed";
}

export function launchBaselineStatus(result) {
  switch (result) {
    case "absent":
      return "confirmation_baseline_clear";
    case "unexpected":
      return "confirmation_baseline_dialog_present";
    case "query_timeout":
      return "confirmation_baseline_timeout";
    case "query_cancelled":
      return "confirmation_baseline_cancelled";
    default:
      return "confirmation_baseline_query_failed";
  }
}
