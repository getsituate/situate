export type UpdateChannel = "direct" | "homebrew" | "store";
export type UpdatePhase =
  | "current"
  | "checking"
  | "downloading"
  | "ready"
  | "installing"
  | "check-failed";
export interface UpdateState {
  enabled: boolean;
  channel: UpdateChannel;
  phase: UpdatePhase;
  progress: number;
  installed: string;
  previousVersion: string;
  available: string;
  dialog: null | "restart" | "release-notes" | "sync" | "force";
  preparation: "idle" | "pending" | "failed" | "blocked";
  preparationReason: "window" | "native" | "stop-failed";
  forceTarget: string | null;
  forced: boolean;
  running: boolean;
  unsynced: boolean;
  result: "available" | "current" | "offline";
}
export const updateScenarios = [
  {
    id: "updates-notice",
    label: "Update ready in the workspace",
    group: "Settings",
  },
  {
    id: "updates-settings",
    label: "Settings · ready to install",
    group: "Settings",
  },
  { id: "updates-current", label: "No update available", group: "Settings" },
  { id: "updates-checking", label: "Checking for updates", group: "Settings" },
  {
    id: "updates-downloading",
    label: "Download in progress",
    group: "Settings",
  },
  {
    id: "updates-check-failed",
    label: "Update check unavailable",
    group: "Settings",
  },
  {
    id: "updates-restart",
    label: "Restart with actions running",
    group: "Settings",
  },
  {
    id: "updates-sync",
    label: "Restart with unsynchronized changes",
    group: "Settings",
  },
  {
    id: "updates-installing",
    label: "Installation in progress",
    group: "Settings",
  },
  {
    id: "updates-managed",
    label: "Externally managed installation",
    group: "Settings",
  },
  {
    id: "release-notes-direct",
    label: "About · website installation",
    group: "Settings",
  },
  {
    id: "release-notes-homebrew",
    label: "About · package-managed installation",
    group: "Settings",
  },
  {
    id: "release-notes-store",
    label: "About · App Store installation",
    group: "Settings",
  },
  {
    id: "release-notes-skipped",
    label: "About · skipped releases",
    group: "Settings",
  },
] as const;
export type UpdateAction =
  | { type: "check" }
  | { type: "finish-check" }
  | { type: "progress"; value: number }
  | { type: "finish-download" }
  | { type: "request-install" }
  | { type: "confirm-install"; synchronize?: boolean }
  | { type: "request-force" }
  | { type: "confirm-force" }
  | { type: "finish-preparation" }
  | { type: "fail-preparation" }
  | { type: "settle-writes" }
  | { type: "preparation-reason"; value: UpdateState["preparationReason"] }
  | { type: "finish-sync" }
  | { type: "finish-install" }
  | { type: "external-update" }
  | { type: "close-dialog" }
  | { type: "show-notes" }
  | { type: "previous-version"; value: "0.8.0" | "0.7.0" }
  | { type: "channel"; channel: UpdateChannel }
  | { type: "running"; value: boolean }
  | { type: "unsynced"; value: boolean }
  | { type: "result"; value: UpdateState["result"] };
export function createUpdates(scenario: string): UpdateState {
  const notes = scenario.startsWith("release-notes-");
  return {
    enabled: scenario.startsWith("updates-") || notes,
    channel:
      scenario.endsWith("homebrew") || scenario === "updates-managed"
        ? "homebrew"
        : scenario.endsWith("store")
          ? "store"
          : "direct",
    phase:
      scenario.endsWith("current") || notes
        ? "current"
        : scenario.endsWith("checking")
          ? "checking"
          : scenario.endsWith("downloading")
            ? "downloading"
            : scenario.endsWith("check-failed")
              ? "check-failed"
              : scenario.endsWith("installing")
                ? "installing"
                : "ready",
    progress: scenario.endsWith("downloading") ? 42 : 100,
    installed: notes ? "0.8.1" : "0.8.0",
    previousVersion: scenario === "release-notes-skipped" ? "0.7.0" : "0.8.0",
    available: "0.8.1",
    dialog:
      scenario.endsWith("restart") || scenario.endsWith("sync")
        ? "restart"
        : null,
    preparation: "idle",
    preparationReason: "window",
    forceTarget: null,
    forced: false,
    running: scenario.endsWith("restart"),
    unsynced: scenario.endsWith("sync"),
    result: "available",
  };
}
function reopen(state: UpdateState) {
  state.phase = "current";
  if (state.installed !== state.available)
    state.previousVersion = state.installed;
  state.installed = state.available;
  state.dialog = null;
  state.running = false;
}
export function reduceUpdates(state: UpdateState, action: UpdateAction): void {
  const direct = state.channel === "direct";
  switch (action.type) {
    case "check":
      if (direct && ["current", "check-failed"].includes(state.phase))
        state.phase = "checking";
      break;
    case "finish-check":
      if (!direct || state.phase !== "checking") break;
      state.phase =
        state.result === "offline"
          ? "check-failed"
          : state.result === "current"
            ? "current"
            : "downloading";
      state.progress = 0;
      break;
    case "progress":
      if (direct && state.phase === "downloading") {
        state.progress = Math.max(0, Math.min(100, action.value));
        if (state.progress === 100) state.phase = "ready";
      }
      break;
    case "finish-download":
      if (direct && state.phase === "downloading") {
        state.progress = 100;
        state.phase = "ready";
      }
      break;
    case "request-install":
      if (
        direct &&
        state.phase === "ready" &&
        state.preparation !== "blocked" &&
        state.preparation !== "pending"
      )
        state.dialog = "restart";
      break;
    case "confirm-install":
      if (direct && state.phase === "ready" && state.dialog === "restart") {
        if (state.unsynced && action.synchronize) state.dialog = "sync";
        else {
          state.dialog = null;
          state.preparation = "pending";
          state.forced = false;
        }
      }
      break;
    case "request-force":
      if (direct && state.phase === "ready" && state.preparation === "failed") {
        state.forceTarget = state.available;
        state.dialog = "force";
      }
      break;
    case "confirm-force":
      if (
        direct &&
        state.phase === "ready" &&
        state.dialog === "force" &&
        state.forceTarget === state.available &&
        state.preparation === "failed"
      ) {
        state.forced = true;
        state.forceTarget = null;
        state.preparation = "pending";
        state.dialog = null;
      }
      break;
    case "finish-preparation":
      if (
        direct &&
        state.phase === "ready" &&
        state.preparation === "pending"
      ) {
        state.preparation = "idle";
        state.running = false;
        state.dialog = null;
        state.phase = "installing";
      }
      break;
    case "fail-preparation":
      if (direct && state.preparation === "pending") {
        state.preparation = ["native", "stop-failed"].includes(
          state.preparationReason,
        )
          ? "blocked"
          : "failed";
        state.dialog = null;
        state.forceTarget = null;
        if (state.preparation === "failed") state.running = false;
      }
      break;
    case "settle-writes":
      if (state.preparation === "blocked") {
        state.preparation = "idle";
        state.running = false;
      }
      break;
    case "preparation-reason":
      state.preparationReason = action.value;
      break;
    case "finish-sync":
      if (direct && state.dialog === "sync" && state.phase === "ready") {
        state.unsynced = false;
        state.running = false;
        state.dialog = null;
        state.phase = "installing";
      }
      break;
    case "finish-install":
      if (direct && state.phase === "installing") reopen(state);
      break;
    case "external-update":
      if (!direct) reopen(state);
      break;
    case "close-dialog":
      state.forceTarget = null;
      state.dialog = null;
      break;
    case "previous-version":
      if (state.installed !== state.available) state.installed = action.value;
      else state.previousVersion = action.value;
      break;
    case "show-notes":
      state.dialog = "release-notes";
      break;
    case "channel":
      state.preparation = "idle";
      state.forceTarget = null;
      state.channel = action.channel;
      if (state.dialog !== "release-notes") state.dialog = null;
      state.phase = "current";
      break;
    case "running":
      state.running = action.value;
      break;
    case "unsynced":
      state.unsynced = action.value;
      break;
    case "result":
      state.result = action.value;
      break;
  }
}
export function updateReady(state: UpdateState): boolean {
  return state.enabled && state.channel === "direct" && state.phase === "ready";
}
