import c from "../localization/en.error-recovery.json" with { type: "json" };
export type RecoveryPreset = keyof typeof c.states;
export type RecoveryDialog = "unexpected" | "report" | "mail" | "reopen" | null;
export interface RecoveryState {
  startup: boolean;
  failed: boolean;
  escalated: boolean;
  dialog: RecoveryDialog;
  draft: string;
  savedDraft: string | null;
  running: boolean;
  description: string;
  intent: "workspace" | "app";
  reloadSucceeds: boolean;
  saveSucceeds: boolean;
  mail: "available" | "missing" | "offline";
  still: boolean;
  gestureSeen: boolean;
  screen: "notes" | "library" | "repair";
  note: "weekend" | "garden";
  notice: string;
}
export type RecoveryAction =
  | { type: "dialog"; dialog: RecoveryDialog }
  | { type: "draft" | "description"; value: string }
  | {
      type: "still" | "reloadSucceeds" | "saveSucceeds";
      value: boolean;
    }
  | { type: "select-note"; note: RecoveryState["note"] }
  | { type: "library" }
  | { type: "mail"; value: RecoveryState["mail"] }
  | {
      type:
        | "recover"
        | "reload"
        | "repeat"
        | "save"
        | "stop"
        | "restart"
        | "repair"
        | "return"
        | "retry-repair"
        | "gesture";
    };
export const recoveryScenarios = (
  Object.keys(c.states) as RecoveryPreset[]
).map((id) => ({
  id: `recovery-${id}` as `recovery-${RecoveryPreset}`,
  label: c.states[id],
  group: "Interface" as const,
}));
export function createRecovery(scenario = ""): RecoveryState {
  const preset = scenario.replace("recovery-", "");
  return {
    startup: preset === "startup",
    failed: true,
    escalated: preset !== "pane",
    dialog:
      preset === "unexpected" || preset === "startup"
        ? "unexpected"
        : preset === "report"
          ? "report"
          : preset === "mail-unavailable"
            ? "mail"
            : null,
    draft: c.draftInitial,
    savedDraft: preset === "restart" ? c.draftInitial : null,
    running: preset !== "restart",
    description: "",
    intent: "app",
    reloadSucceeds: true,
    saveSucceeds: true,
    mail: preset === "mail-unavailable" ? "missing" : "available",
    still: false,
    gestureSeen: false,
    screen: preset === "restart" ? "library" : "notes",
    note: "weekend",
    notice: preset === "restart" ? c.restartDone : "",
  };
}
export const technicalDetails =
  "Event: VIEW_LOAD_FAILED\nOperation: open reading list view\nPlugin: reading-list 0.4.2\nApp: 0.1.0-example\nCause: unknown\nBook request: outcome unknown\nTrace: example-event-0042";
export const startupDetails =
  "Event: INTERFACE_INIT_FAILED\nApp: 0.1.0-example\nWorkspace: not opened\nCause: unknown";
export function incidentDetails(state: RecoveryState) {
  return state.startup ? startupDetails : technicalDetails;
}
export function reportText(state: RecoveryState) {
  return [
    `To: ${c.recipient}`,
    `Subject: ${state.startup ? c.startupTitle : c.subject}`,
    state.startup ? c.startupBody : c.reportSummary,
    state.description.slice(0, 2000),
    incidentDetails(state),
  ]
    .filter(Boolean)
    .join("\n\n");
}
function finishRecovery(s: RecoveryState, intent: RecoveryState["intent"]) {
  s.intent = intent;
  if (!s.saveSucceeds && s.savedDraft !== s.draft) {
    s.notice = c.saveFailed;
    return;
  }
  s.savedDraft = s.draft;
  s.running = false;
  s.dialog = null;
  s.screen = "library";
  if (intent === "workspace") {
    s.failed = !s.reloadSucceeds;
    s.dialog = s.failed ? "unexpected" : null;
    s.notice = s.failed ? c.workspaceRetryFailed : c.workspaceLoaded;
  } else s.notice = c.restartDone;
}
export function reduceRecovery(s: RecoveryState, a: RecoveryAction) {
  switch (a.type) {
    case "dialog":
      s.dialog = a.dialog;
      s.notice = "";
      break;
    case "draft":
    case "description":
      s[a.type] = a.value.slice(0, a.type === "description" ? 2000 : 10000);
      break;
    case "still":
    case "reloadSucceeds":
    case "saveSucceeds":
      s[a.type] = a.value;
      break;
    case "mail":
      s.mail = a.value;
      break;
    case "library":
      s.screen = "library";
      break;
    case "select-note":
      s.screen = "notes";
      s.note = a.note;
      break;
    case "repeat":
      break;
    case "recover":
      if (s.startup) {
        s.notice = c.startupStill;
        break;
      }
      finishRecovery(s, "workspace");
      break;
    case "reload":
      s.dialog = null;
      if (s.startup) {
        s.notice = c.startupStill;
        break;
      }
      s.failed = !s.reloadSucceeds;
      s.notice = s.failed ? c.retryFailed : c.loaded;
      break;
    case "save":
      if (s.saveSucceeds) {
        s.savedDraft = s.draft;
        s.notice = "";
      } else s.notice = c.saveFailed;
      break;
    case "stop":
      s.running = false;
      break;
    case "restart":
      if (!s.startup) finishRecovery(s, "app");
      break;
    case "repair":
      s.screen = "repair";
      s.dialog = null;
      s.notice = "";
      break;
    case "return":
      s.screen = "notes";
      s.notice = "";
      break;
    case "retry-repair":
      s.notice = c.repairStill;
      break;
    case "gesture":
      s.gestureSeen = true;
      break;
  }
}
