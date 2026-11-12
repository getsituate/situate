import { c } from "./content";
import { connectionAvailability } from "./connection-readiness";
import {
  createAssignmentInspection,
  type AssignmentInspectionState,
} from "./assignment-files";
import {
  initializeAssignment,
  syncAssignmentInspection,
  shareAssignmentWrites,
  emptyAssignmentCheck,
  startAssignmentChecks,
  finishAssignmentChecks,
  activateAssignment,
  removePendingAssignmentCode,
  assignmentText,
  type AssignmentPackage,
  type AssignmentCheck,
  type AssignmentActivation,
  type WorkspaceEffect,
} from "./assignment-model";
export {
  growAssignment,
  startAssignmentChecks,
  finishAssignmentChecks,
  activateAssignment,
  editAssignmentPackage,
  resolveAssignmentActivation,
} from "./assignment-model";
import { createCodeBrowser, type CodeBrowserState } from "./code-browser";
import {
  documentPluginFixtures,
  mailPluginFixtures,
  connectionAccounts,
  type ConnectionAccount,
  type PluginKind,
  pluginFixtures,
  preparedExisting,
  preparedNew,
} from "./fixtures";
export type Plugin = (typeof pluginFixtures)[number];
export type DevelopmentPhase = keyof typeof c.phases;
export interface Development {
  id: string;
  pluginId?: string | null;
  kind?: PluginKind;
  packages: AssignmentPackage[];
  workspaceEffects: WorkspaceEffect[];
  check: AssignmentCheck;
  activation: AssignmentActivation;
  inspection: AssignmentInspectionState;
  title: string;
  phase: DevelopmentPhase;
  draft: string;
  messages: string[];
  responses: DevelopmentPhase[];
  filesOpen: boolean;
  storageMB: number;
  baseVersion: number | null;
  codeBrowser: CodeBrowserState;
  panel: "chat" | "files";
}
export interface PluginDisableOperation {
  target: string;
  phase: "waiting" | "stopping" | "failed" | "uncertain" | "checking";
  previous: { id: string; enabled: boolean; blocked: boolean }[];
}
export interface PluginState {
  disableOperation: PluginDisableOperation | null;
  connectionAvailability: Record<
    string,
    "ready" | "permission" | "not-implemented" | "unsupported" | "failed"
  >;
  connectionPlatform: "macos" | "ios";
  generalError: boolean;
  cardStyle: "plain" | "illustrated";
  listSection: "tools" | "sources";
  returnToDocuments: boolean;
  returnToDevelopment: string;
  screen: "list" | "detail" | "development" | "retained" | "files";
  fileBrowsers: Record<string, CodeBrowserState>;
  plugins: Plugin[];
  accounts: Record<string, ConnectionAccount[]>;
  accountSelections: Record<string, string[]>;
  connectionAttempt: { connectorId: string; accountId?: string } | null;
  connectionError: string;
  developments: Development[];
  selected: string;
  developmentId: string;
  dialog: "disable" | "discard" | "uninstall" | null;
  uninstallStatus: "idle" | "pending" | "error";
  target: string;
  notice: string;
  nextId: number;
}
export const clonePluginState = (s: PluginState): PluginState =>
  JSON.parse(JSON.stringify(s));
export const pluginScenarios = Object.entries(c.scenarioLabels).map(
  ([id, label]) => ({ id: `plugins-${id}`, label }),
);
export const currentDevelopment = (s: PluginState) =>
  s.developments.find((d) => d.id === s.developmentId);
export const developmentWorking = (d: Development) =>
  ["working", "checking", "waiting"].includes(d.phase);
export const hasPluginWork = (s: PluginState) =>
  s.developments.some(developmentWorking);
export const pluginDevelopmentTitle = (s: PluginState) =>
  currentDevelopment(s)?.title ?? c.newDevelopment;
export const pluginScreenLabel = (s: PluginState) =>
  s.generalError
    ? c.generalError
    : s.dialog === "uninstall"
      ? c.uninstall.title.replace(
          "{name}",
          s.plugins.find((p) => p.id === s.target)?.name ?? "",
        )
      : s.screen === "files"
        ? c.files
        : s.screen === "development"
          ? c.development
          : s.screen === "retained"
            ? c.retained
            : s.screen === "detail"
              ? s.plugins.find((p) => p.id === s.selected)?.kind === "source"
                ? c.sourceKind
                : s.plugins.find((p) => p.id === s.selected)?.kind ===
                    "connector"
                  ? c.accounts
                  : c.summary
              : c.plugins;
export const pluginIsEditing = (s: PluginState) =>
  (s.screen === "development" && !s.dialog) || s.screen === "detail";
export function openPluginScreen(
  s: PluginState,
  screen: PluginState["screen"],
) {
  s.screen = screen;
  s.dialog = null;
  s.notice = "";
}
export function openPluginFiles(s: PluginState, id: string) {
  if (!s.plugins.some((plugin) => plugin.id === id)) return;
  s.selected = id;
  s.fileBrowsers[id] ??= createCodeBrowser();
  openPluginScreen(s, "files");
}
export function startPluginDevelopment(
  s: PluginState,
  request?: string,
  kind?: PluginKind,
): void {
  if (request !== undefined) s.selected = "";
  const plugin = s.plugins.find((p) => p.id === s.selected);
  const d: Development = {
    id: `development-${s.nextId++}`,
    packages: [],
    workspaceEffects: [],
    check: emptyAssignmentCheck(),
    activation: "pending",
    inspection: createAssignmentInspection("plugins-create"),
    pluginId: plugin?.id ?? null,
    kind: plugin?.kind ?? kind,
    title: plugin?.name ?? c.newDevelopment,
    phase: "draft",
    draft:
      request ??
      (plugin
        ? plugin.id === "weekly"
          ? preparedExisting
          : c.adaptRequest(plugin.name)
        : preparedNew),
    messages: [],
    responses: [],
    filesOpen: true,
    storageMB: 0,
    baseVersion: plugin?.version ?? null,
    codeBrowser: { ...createCodeBrowser(), selected: "", pane: "tree" },
    panel: "chat",
  };
  s.developments.push(d);
  s.developmentId = d.id;
  openPluginScreen(s, "development");
}
function setDevelopmentPhase(d: Development, phase: DevelopmentPhase) {
  d.phase = phase;
  if (d.messages.length) d.responses[d.messages.length - 1] = phase;
}
export function sendPluginRequest(s: PluginState) {
  const d = currentDevelopment(s);
  if (!d || !d.draft.trim() || developmentWorking(d)) return;
  if (d.activation === "uncertain") {
    d.messages.push(d.draft.trim());
    d.draft = "";
    d.responses.push("interrupted");
    return;
  }
  const previousFiles = JSON.parse(JSON.stringify(d.inspection.workspaceFiles));
  if (["active", "notification-failed"].includes(d.activation)) {
    for (const p of d.packages) {
      if (p.change === "unchanged") continue;
      p.change = "modified";
      p.revision++;
      p.activation = "pending";
    }
  }
  d.check = emptyAssignmentCheck();
  d.activation = "pending";
  for (const p of d.packages) {
    p.check = "pending";
    if (p.activation === "removed") p.activation = "pending";
  }
  if (!d.packages.length) {
    initializeAssignment(
      s,
      d,
      d.pluginId ? "entry-context" : "plugins-development",
    );
    d.inspection = createAssignmentInspection("plugins-development");
  }
  syncAssignmentInspection(d, d.messages.length + 1);
  shareAssignmentWrites(s, d, previousFiles);
  d.messages.push(d.draft.trim());
  d.draft = "";
  setDevelopmentPhase(d, "working");
  d.storageMB = 24;
}
export function affectedPlugins(s: PluginState, id: string): Plugin[] {
  const affected = new Set([id]);
  let count = 0;
  while (count !== affected.size) {
    count = affected.size;
    for (const p of s.plugins)
      if (p.dependencies.some((dep) => affected.has(dep))) affected.add(p.id);
  }
  return s.plugins.filter((p) => p.id !== id && affected.has(p.id));
}
export function canUninstallPlugin(s: PluginState, id: string): boolean {
  const plugin = s.plugins.find((p) => p.id === id);
  return !!plugin && !plugin.running && !affectedPlugins(s, id).length;
}
export function startUninstallPlugin(s: PluginState) {
  if (
    s.dialog !== "uninstall" ||
    s.uninstallStatus === "pending" ||
    !canUninstallPlugin(s, s.target)
  )
    return;
  s.uninstallStatus = "pending";
}
export function finishUninstallPlugin(s: PluginState, success: boolean) {
  if (s.dialog !== "uninstall" || s.uninstallStatus !== "pending") return;
  if (!success || !canUninstallPlugin(s, s.target)) {
    s.uninstallStatus = "error";
    return;
  }
  const plugin = s.plugins.find((p) => p.id === s.target)!;
  s.plugins = s.plugins.filter((p) => p.id !== plugin.id);
  delete s.accounts[plugin.id];
  delete s.accountSelections[plugin.id];
  delete s.fileBrowsers[plugin.id];
  delete s.connectionAvailability[plugin.id];
  if (s.connectionAttempt?.connectorId === plugin.id)
    s.connectionAttempt = null;
  if (s.selected === plugin.id) s.selected = "";
  s.screen = "list";
  s.dialog = null;
  s.uninstallStatus = "idle";
  s.notice = c.uninstall.success.replace("{name}", plugin.name);
}
export function disablePlugin(s: PluginState, abort = false) {
  const p = s.plugins.find((p) => p.id === s.target);
  if (!p) return;
  for (const item of [p, ...affectedPlugins(s, p.id)].filter(
    (item) => item.enabled || item.id === p.id,
  )) {
    item.enabled = false;
    item.blocked = item.id !== p.id;
    if (abort) item.running = 0;
  }
  if (
    s.connectionAttempt &&
    !s.plugins.find((item) => item.id === s.connectionAttempt!.connectorId)
      ?.enabled
  )
    s.connectionAttempt = null;
  s.dialog = null;
  s.notice = abort ? c.noticeAborted : c.noticeDisabled;
}
export function startPluginDisable(s: PluginState, abort = false) {
  if (s.disableOperation) return;
  const target = s.plugins.find((p) => p.id === s.target);
  if (!target?.enabled) return;
  const items = [target, ...affectedPlugins(s, target.id)].filter(
    (p) => p.enabled,
  );
  const previous = items.map(({ id, enabled, blocked }) => ({
    id,
    enabled,
    blocked,
  }));
  const running = items.some((p) => p.running > 0);
  if (!running) {
    disablePlugin(s);
    return;
  }
  s.dialog = "disable";
  s.disableOperation = {
    target: target.id,
    phase: abort ? "stopping" : "waiting",
    previous,
  };
  s.notice = "";
}
export function cancelPluginDisable(s: PluginState) {
  const operation = s.disableOperation;
  if (!operation || !["waiting", "failed"].includes(operation.phase)) return;
  for (const previous of operation.previous) {
    const plugin = s.plugins.find((p) => p.id === previous.id);
    if (plugin) Object.assign(plugin, previous);
  }
  s.disableOperation = null;
  s.dialog = null;
  s.notice = c.disableProgress.cancelled;
}
export function stopPluginDisable(s: PluginState) {
  if (s.disableOperation?.phase === "waiting")
    s.disableOperation.phase = "stopping";
}
export function finishPluginDisable(s: PluginState) {
  const operation = s.disableOperation;
  if (
    !operation ||
    !["waiting", "stopping", "checking"].includes(operation.phase)
  )
    return;
  s.target = operation.target;
  disablePlugin(s);
  for (const plugin of s.plugins)
    if (operation.previous.some((p) => p.id === plugin.id)) plugin.running = 0;
  s.notice =
    operation.phase === "stopping" ? c.noticeAborted : c.noticeDisabled;
  s.disableOperation = null;
}
export const canEnablePlugin = (s: PluginState, p: Plugin) =>
  !s.disableOperation?.previous.some((previous) => previous.id === p.id) &&
  p.dependencies.every((id) =>
    s.plugins.some((dep) => dep.id === id && dep.enabled),
  );
export function enablePlugin(s: PluginState, id: string) {
  const p = s.plugins.find((p) => p.id === id);
  if (!p || !canEnablePlugin(s, p)) return;
  p.enabled = true;
  p.blocked = false;
  s.notice = c.noticeEnabled;
}
export function discardDevelopment(s: PluginState) {
  const d = s.developments.find((d) => d.id === s.target);
  if (!d) return;
  removePendingAssignmentCode(d);
  s.dialog = null;
}
export function applyPluginOutcome(s: PluginState, outcome: DevelopmentPhase) {
  const d = currentDevelopment(s);
  if (!d || !developmentWorking(d)) return;
  if (outcome === "checking" && d.phase === "working") startAssignmentChecks(d);
  else if (outcome === "waiting" && d.phase === "checking")
    finishAssignmentChecks(d);
  else if (outcome === "adopted" && d.phase === "waiting")
    activateAssignment(s);
  else if (outcome === "failed") {
    if (d.check.status !== "running") startAssignmentChecks(d);
    finishAssignmentChecks(
      d,
      d.packages.find((p) => p.change !== "unchanged")?.id,
    );
  } else if (outcome === "interrupted") setDevelopmentPhase(d, "interrupted");
}
export function interruptPluginWork(s: PluginState): void {
  s.connectionAttempt = null;
  for (const d of s.developments)
    if (developmentWorking(d)) {
      if (d.check.status === "running") d.check = emptyAssignmentCheck();
      setDevelopmentPhase(d, "interrupted");
    }
}
export const connectorDependencies = (s: PluginState, plugin: Plugin) =>
  s.plugins.filter(
    (p) => p.kind === "connector" && plugin.dependencies.includes(p.id),
  );
export const connectionConsumers = (s: PluginState, id: string) =>
  s.plugins.filter((p) => p.dependencies.includes(id));
export function selectConnectionAccount(
  s: PluginState,
  pluginId: string,
  accountId: string,
  selected: boolean,
) {
  const plugin = s.plugins.find((p) => p.id === pluginId);
  if (!plugin?.enabled || plugin.kind !== "tool") return;
  const available = connectorDependencies(s, plugin).flatMap(
    (p) => s.accounts[p.id] ?? [],
  );
  if (!available.some((account) => account.id === accountId)) return;
  const ids = new Set(s.accountSelections[pluginId] ?? []);
  if (selected) ids.add(accountId);
  else ids.delete(accountId);
  s.accountSelections[pluginId] = [...ids];
  s.notice = c.saved;
}
export function startConnectionAttempt(
  s: PluginState,
  connectorId: string,
  accountId?: string,
) {
  const connector = s.plugins.find((p) => p.id === connectorId);
  if (
    !connector?.enabled ||
    !canEnablePlugin(s, connector) ||
    connector.kind !== "connector" ||
    s.connectionAttempt ||
    ["unsupported", "not-implemented"].includes(
      connectionAvailability(s, connectorId),
    )
  )
    return;
  if (
    accountId &&
    !(s.accounts[connectorId] ?? []).some((account) => account.id === accountId)
  )
    return;
  s.connectionError = "";
  s.connectionAttempt = { connectorId, accountId };
}
export function finishConnectionAttempt(s: PluginState, ok: boolean) {
  const attempt = s.connectionAttempt;
  if (!attempt) return;
  s.connectionAttempt = null;
  if (!ok) {
    s.connectionError = c.connectionFailed;
    return;
  }
  const connector = s.plugins.find((p) => p.id === attempt.connectorId);
  if (
    !connector?.enabled ||
    ["unsupported", "not-implemented"].includes(
      connectionAvailability(s, connector.id),
    )
  )
    return;
  const accounts = s.accounts[connector.id] ?? (s.accounts[connector.id] = []);
  const account = accounts.find((item) => item.id === attempt.accountId);
  if (account) account.status = "connected";
  else if (!attempt.accountId)
    accounts.push({
      id: `${connector.id}-account-${s.nextId++}`,
      name: c.additionalAccount(accounts.length + 1),
      status: "connected",
    });
  if (["permission", "failed"].includes(s.connectionAvailability[connector.id]))
    s.connectionAvailability[connector.id] = "ready";
  for (const d of s.developments)
    for (const p of d.packages) if (p.id === connector.id) p.access = "ready";
  s.notice = c.accountConnected;
}
export function createPluginState(scenario = "plugins-list"): PluginState {
  const illustrated = scenario.endsWith("-illustrated");
  if (illustrated) scenario = scenario.slice(0, -"-illustrated".length);
  const s: PluginState = {
    disableOperation: null,
    connectionAvailability: {},
    connectionPlatform: "macos",
    generalError: scenario === "plugins-general-error",
    cardStyle: illustrated ? "illustrated" : "plain",
    listSection: "tools",
    returnToDocuments: false,
    returnToDevelopment: "",
    screen: "list",
    fileBrowsers: {},
    plugins: JSON.parse(JSON.stringify(pluginFixtures)),
    accounts: JSON.parse(
      JSON.stringify({ calendar: connectionAccounts.calendar }),
    ),
    accountSelections: {
      weekly: ["calendar-personal"],
      morning: ["calendar-courses"],
    },
    connectionAttempt: null,
    connectionError: "",
    developments: [],
    selected: "",
    developmentId: "",
    dialog: null,
    uninstallStatus: "idle",
    target: "",
    notice: "",
    nextId: 1,
  };
  if (scenario.startsWith("plugins-files")) {
    openPluginFiles(s, "weekly");
    if (scenario === "plugins-files-loading")
      s.fileBrowsers.weekly.status = "loading";
    if (scenario === "plugins-files-error")
      s.fileBrowsers.weekly.status = "error";
    if (scenario === "plugins-files-empty")
      s.fileBrowsers.weekly.status = "empty";
  }
  if (scenario === "plugins-empty") {
    s.plugins = [];
    s.accounts = {};
    s.accountSelections = {};
  }
  if (
    [
      "plugins-connections",
      "plugins-connection-empty",
      "plugins-connection-error",
    ].includes(scenario)
  ) {
    s.plugins = JSON.parse(JSON.stringify(mailPluginFixtures));
    s.accounts = {
      gmail: JSON.parse(JSON.stringify(connectionAccounts.gmail)),
    };
    s.accountSelections = {
      inbox: ["gmail-personal"],
      "follow-up": ["gmail-project"],
    };
    if (scenario !== "plugins-connections") {
      s.selected = "gmail";
      s.screen = "detail";
      if (scenario === "plugins-connection-empty") {
        s.accounts.gmail = [];
        s.accountSelections.inbox = [];
        s.accountSelections["follow-up"] = [];
      } else s.accounts.gmail[0].status = "expired";
    }
  }
  if (scenario.startsWith("plugins-disable-")) {
    s.target = "calendar";
    startPluginDisable(s);
    if (scenario === "plugins-disable-stopping") stopPluginDisable(s);
    if (scenario === "plugins-disable-error")
      s.disableOperation!.phase = "failed";
    if (scenario === "plugins-disable-uncertain")
      s.disableOperation!.phase = "uncertain";
  }
  if (scenario === "plugins-disabled") {
    s.target = "calendar";
    disablePlugin(s);
    s.notice = "";
  }
  if (scenario === "plugins-connection-platform") {
    s.selected = "calendar";
    s.screen = "detail";
    s.connectionAvailability.calendar = "ready";
  }
  if (scenario === "plugins-create") startPluginDevelopment(s);
  if (
    [
      "plugins-development",
      "plugins-general-error",
      "plugins-interrupted",
      "plugins-error",
      "plugins-success",
    ].includes(scenario)
  ) {
    startPluginDevelopment(s, assignmentText.request);
    initializeAssignment(s, currentDevelopment(s)!, scenario);
    currentDevelopment(s)!.inspection = createAssignmentInspection(scenario);
    sendPluginRequest(s);
    if (scenario === "plugins-interrupted")
      applyPluginOutcome(s, "interrupted");
    if (scenario === "plugins-error") applyPluginOutcome(s, "failed");
    if (scenario === "plugins-success") {
      applyPluginOutcome(s, "checking");
      applyPluginOutcome(s, "waiting");
      applyPluginOutcome(s, "adopted");
    }
  }
  if (scenario !== "plugins-empty") {
    s.plugins.push(...JSON.parse(JSON.stringify(documentPluginFixtures)));
    s.accounts["cloud-connection"] = [
      { id: "cloud-personal", name: "Personal account", status: "connected" },
    ];
    s.accountSelections.drive = ["cloud-personal"];
  }
  if (scenario === "plugins-sources-empty")
    s.plugins = s.plugins.filter((p) => p.kind !== "source");
  if (scenario.startsWith("plugins-source")) s.listSection = "sources";
  if (["plugins-source-detail", "plugins-source-disabled"].includes(scenario)) {
    s.selected = "drive";
    s.screen = "detail";
    if (scenario === "plugins-source-disabled")
      s.plugins.find((p) => p.id === "drive")!.enabled = false;
  }
  if (
    [
      "plugins-source-create",
      "plugins-source-error",
      "plugins-source-success",
    ].includes(scenario)
  ) {
    startPluginDevelopment(s, c.sourceRequest, "source");
    if (scenario !== "plugins-source-create") {
      sendPluginRequest(s);
      if (scenario === "plugins-source-error") applyPluginOutcome(s, "failed");
      else {
        applyPluginOutcome(s, "checking");
        applyPluginOutcome(s, "waiting");
        applyPluginOutcome(s, "adopted");
      }
    }
  }
  if (scenario.startsWith("plugins-development-")) {
    startPluginDevelopment(s, assignmentText.request);
    const d = currentDevelopment(s)!;
    initializeAssignment(s, d, scenario);
    d.inspection = createAssignmentInspection(scenario);
    sendPluginRequest(s);
    if (scenario.endsWith("activation") || scenario.endsWith("access-needed")) {
      startAssignmentChecks(d);
      finishAssignmentChecks(d);
      if (scenario.endsWith("access-needed")) activateAssignment(s);
    }
    if (scenario.endsWith("parallel")) {
      const firstId = d.id;
      startPluginDevelopment(s, assignmentText.parallelRequest);
      const parallel = currentDevelopment(s)!;
      parallel.title = assignmentText.parallelTitle;
      parallel.packages = [
        { ...d.packages.find((p) => p.id === "notes")!, revision: 3 },
      ];
      parallel.inspection = createAssignmentInspection(scenario);
      const previous = d.inspection.recordedChanges.find(
        (change) => change.packageId === "notes",
      )!;
      const current = parallel.inspection.workspaceFiles.find(
        (file) => file.identity === previous.identity,
      )!;
      parallel.inspection.recordedChanges = [
        {
          ...JSON.parse(JSON.stringify(previous)),
          id: "parallel-notes-r3",
          packageRevision: 3,
          before: { ...previous.after! },
          after: { ...current.current },
          provenance: {
            attribution: "recorded",
            source: "write",
            conversationId: parallel.id,
            runId: `${parallel.id}-run-1`,
          },
        },
      ];
      parallel.inspection.observations = [];
      sendPluginRequest(s);
      s.developmentId = firstId;
    }
  }
  if (scenario.startsWith("plugins-uninstall")) {
    s.target = scenario.endsWith("dependencies") ? "calendar" : "morning";
    s.dialog = "uninstall";
    if (scenario.endsWith("running"))
      s.plugins.find((p) => p.id === s.target)!.running = 1;
    if (scenario.endsWith("disabled"))
      s.plugins.find((p) => p.id === s.target)!.enabled = false;
    if (scenario.endsWith("pending")) startUninstallPlugin(s);
    if (scenario.endsWith("error")) {
      startUninstallPlugin(s);
      finishUninstallPlugin(s, false);
    }
  }
  return s;
}
