import { run } from "./ios-xcode.mjs";

const maxBytes = 64 * 1024;
const unavailable = "observation_unavailable";
const queryFailureStages = new Set([
  "process",
  "window_collection",
  "window_attributes",
  "element_collection",
  "element_attributes",
  "limit",
  "serialization",
]);
const roles = new Set([
  "AXGroup",
  "AXStaticText",
  "AXButton",
  "AXImage",
  "AXScrollArea",
  "AXSheet",
  "AXDialog",
]);
const windowRoles = new Set(["AXWindow", "AXDialog", "AXSheet"]);
const text = (value) => typeof value === "string" && value.length <= 128;
const keys = (value, expected) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join() === expected;
const applicationToken =
  /(?<![\p{L}\p{N}_.-])Situate(?:\.app)?(?![\p{L}\p{N}_.-])/u;
const otherApplicationToken =
  /(?<![\p{L}\p{N}_.-])([\p{L}\p{N}_-]+)\.app(?![\p{L}\p{N}_.-])/gu;

export const launchDialogQuery = `(() => {
  let stage = "process";
  try {
    const events = Application("System Events");
    const agent = events.applicationProcesses.byName("CoreServicesUIAgent");
    const snapshot = { version: 1, process: "CoreServicesUIAgent", windows: [] };
    function string(value) {
      if (typeof value !== "string") throw new Error();
      if (value.length > 128) { stage = "limit"; throw new Error(); }
      return value;
    }
    function collection(value, maximum) {
      if (!Array.isArray(value)) throw new Error();
      if (value.length > maximum) { stage = "limit"; throw new Error(); }
      return value;
    }
    const present = agent.exists();
    if (typeof present !== "boolean") throw new Error();
    if (present) {
      stage = "window_collection";
      const windows = collection(agent.windows(), 4);
      for (let index = 0; index < windows.length; index++) {
        stage = "window_attributes";
        const source = windows[index];
        const window = { role: string(source.role()), title: string(source.name()), elements: [] };
        function visit(parent) {
          stage = "element_collection";
          const children = collection(parent.uiElements(), 64);
          for (let childIndex = 0; childIndex < children.length; childIndex++) {
            if (window.elements.length >= 64) { stage = "limit"; throw new Error(); }
            stage = "element_attributes";
            const element = children[childIndex];
            const role = string(element.role());
            const value = role === "AXStaticText" || role === "AXButton" ?
              string(element.name()) : "";
            window.elements.push({ role, text: value });
            visit(element);
          }
        }
        visit(source);
        snapshot.windows.push(window);
      }
    }
    stage = "serialization";
    const serialized = JSON.stringify(snapshot);
    if (encodeURIComponent(serialized).replace(/%[A-F\\d]{2}/gi, "x").length > 65536) { stage = "limit"; throw new Error(); }
    return serialized;
  } catch {
    return '{"unavailable":"' + stage + '"}';
  }
})()`;

export function classifyLaunchDialog(snapshot, applicationName) {
  if (applicationName !== "Situate") return unavailable;
  try {
    if (
      !keys(snapshot, "process,version,windows") ||
      snapshot.version !== 1 ||
      snapshot.process !== "CoreServicesUIAgent" ||
      !Array.isArray(snapshot.windows) ||
      snapshot.windows.length > 4
    )
      return unavailable;
    let matches = 0;
    let strict = false;
    for (const window of snapshot.windows) {
      if (
        !keys(window, "elements,role,title") ||
        !windowRoles.has(window.role) ||
        !text(window.title) ||
        !Array.isArray(window.elements) ||
        window.elements.length > 64
      )
        return unavailable;
      const buttons = [];
      const names = [window.title];
      for (const element of window.elements) {
        if (
          !keys(element, "role,text") ||
          !roles.has(element.role) ||
          !text(element.text)
        )
          return unavailable;
        if (element.role === "AXButton") buttons.push(element.text);
        else if (element.role === "AXStaticText") names.push(element.text);
        else if (element.text !== "") return unavailable;
      }
      if (new Set(buttons).size !== buttons.length) return unavailable;
      const content = names.join("\n");
      const applications = [...content.matchAll(otherApplicationToken)].map(
        (match) => match[1],
      );
      if (new Set(applications).size > 1) return unavailable;
      if (applicationToken.test(content)) {
        if (applications.some((name) => name !== "Situate") || ++matches > 1)
          return unavailable;
        strict =
          buttons.length === 2 &&
          buttons.includes("Open") &&
          buttons.includes("Cancel");
      } else if (!applications.length) return unavailable;
    }
    if (Buffer.byteLength(JSON.stringify(snapshot)) > maxBytes)
      return unavailable;
    if (!matches) return "dialog_not_observed";
    return strict ? "dialog_observed" : "associated_dialog_observed";
  } catch {
    return unavailable;
  }
}

export async function observeLaunchDialog({
  applicationName,
  signal,
  execute = run,
  environment = process.env,
} = {}) {
  if (applicationName !== "Situate" || signal?.aborted) return unavailable;
  const timeout = AbortSignal.timeout(1000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
    for (const name of [
      "PATH",
      "HOME",
      "TMPDIR",
      "USER",
      "LOGNAME",
      "LANG",
      "LC_ALL",
    ])
      if (typeof environment[name] === "string") env[name] = environment[name];
    const output = await execute(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", launchDialogQuery],
      {
        env,
        signal: combined,
        capture: true,
        terminationGraceMs: 2000,
      },
    );
    if (combined.aborted) return unavailable;
    if (typeof output !== "string") return "query_execution_unavailable";
    if (Buffer.byteLength(output) > maxBytes) return "query_limit_unavailable";
    const snapshot = JSON.parse(output);
    if (snapshot === null) return "query_execution_unavailable";
    if (Object.hasOwn(snapshot, "unavailable")) {
      if (
        !keys(snapshot, "unavailable") ||
        !queryFailureStages.has(snapshot.unavailable)
      )
        return "query_execution_unavailable";
      return `query_${snapshot.unavailable}_unavailable`;
    }
    return classifyLaunchDialog(snapshot, applicationName);
  } catch {
    return combined.aborted ? unavailable : "query_execution_unavailable";
  }
}
