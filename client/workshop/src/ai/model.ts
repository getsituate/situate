import { gateAccess, needsReview, requiresSessionTakeover } from "./security";
import { heading, securityCopy } from "./content";
import { availableProviders, availableMethods } from "./providers";
import { gateHttpDestination, clearHttpConsent } from "./transport";
import type { ThinkingPreference } from "../chat/thinking";
import { aiScenarios, type aiFixtures } from "./scenarios";
export { aiScenarios } from "./scenarios";
export type AiStartingState = (typeof aiFixtures)[number]["state"];
export type WorkspaceName = "Personal" | "Studio";
export type ModelPhase =
  | "ready"
  | "loading"
  | "load-error"
  | "saving"
  | "save-error"
  | "uncertain"
  | "reconciling"
  | "unavailable";
export interface Connection {
  id?: string;
  label?: string;
  httpAcknowledgement?: string;
  warningVersion?: string;
  provider: string;
  method: string;
  endpoint?: string;
  source?: string;
}
export interface ModelState {
  selected: string | null;
  pending: string | null;
  phase: ModelPhase;
  count: "many" | "one" | "zero";
  manual: boolean;
}
export interface AiWorkspace {
  defaultConnection?: Connection | null;
  catalogModelIds?: string[];
  connection: Connection | null;
  unavailable: string | null;
  draft: string;
  note: string;
  history: string[];
  response: "idle" | "streaming" | "unsaved";
  defaultModel: string;
  thinkingDefaults: Record<string, ThinkingPreference>;
  showModelPicker: boolean;
  model: ModelState;
}
export interface AiState {
  settingsSession?: number;
  explorationMode: boolean;
  httpConsent: string;
  httpDestination: string;
  httpReturn: string;
  restrictionVersion: number;
  warningAccepted: string;
  warningChecked: boolean;
  warningIntent: "connect" | "use";
  warningReturn: string;
  independentSession: boolean;
  storeRetry: boolean;
  screen: string;
  mobile: boolean;
  workspace: WorkspaceName;
  workspaces: Record<WorkspaceName, AiWorkspace>;
  provider: string;
  method: string;
  origin: string;
  values: Record<string, string>;
  browserOpened: boolean;
  deviceIssued: boolean;
  stale: boolean;
  attempt: number;
  abandonedAttempt: number | null;
  dialog: "skip" | "model" | null;
  search: string;
  manualId: string;
  fieldError: string;
  invalidField: string;
  manualError: string;
  reveal: boolean;
  navigationOpen: boolean;
  announcement: string;
  sendStatus: string;
  handoff: string;
}
export const initialModel = (): ModelState => ({
  selected: null,
  pending: null,
  phase: "ready",
  count: "many",
  manual: false,
});
export const cloneAiState = (state: AiState): AiState =>
  JSON.parse(JSON.stringify(state));
export const currentWorkspace = (state: AiState) =>
  state.workspaces[state.workspace];
export const aiConnected = (state: AiState) =>
  !!currentWorkspace(state).connection && !currentWorkspace(state).unavailable;
export const aiSetup = (state: AiState) =>
  ![
    "local",
    "chat",
    "settings",
    "restored",
    "reconnect",
    "locked",
    "capability",
    "remove",
    "forget",
  ].includes(state.screen);
export const aiScreenLabel = (state: AiState) =>
  state.dialog === "model"
    ? "Model for the next message"
    : state.dialog === "skip"
      ? "Continue without AI?"
      : state.screen === "chat"
        ? "Chat"
        : aiScenarios.find((fixture) => fixture.state === state.screen)
            ?.label ||
          (state.screen === "local" ? "Local note" : heading(state)[0]);
export const aiIsEditing = (state: AiState) =>
  state.dialog === "model" ||
  (!state.dialog &&
    ([
      "providers",
      "key",
      "copy-code",
      "cloud",
      "endpoint",
      "advanced",
      "local",
      "chat",
    ].includes(state.screen) ||
      (state.screen === "browser" && state.provider !== "radius") ||
      (state.screen === "device" &&
        state.provider === "github-copilot" &&
        !state.deviceIssued)));
export function createAiState(preset: string = "offer"): AiState {
  preset = preset.replace(/^ai-/, "");
  const workspace = (note: string): AiWorkspace => ({
    connection: null,
    unavailable: null,
    draft: "",
    note,
    history: [],
    response: "idle",
    defaultModel: "recommended",
    thinkingDefaults: {},
    showModelPicker: true,
    model: initialModel(),
  });
  const state: AiState = {
    explorationMode: false,
    httpConsent: "",
    httpDestination: "",
    httpReturn: "endpoint",
    restrictionVersion: 1,
    warningAccepted: "",
    warningChecked: false,
    warningIntent: "connect",
    warningReturn: "methods",
    independentSession: true,
    storeRetry: false,
    screen: preset,
    mobile: false,
    workspace: "Personal",
    workspaces: {
      Personal: workspace("Move the reading lamp beside the armchair."),
      Studio: workspace("Prepare the workshop outline."),
    },
    provider: "openai",
    method: "key",
    origin: "offer",
    values: {},
    browserOpened: false,
    deviceIssued: false,
    stale: false,
    attempt: 1,
    abandonedAttempt: null,
    dialog: null,
    search: "",
    manualId: "",
    fieldError: "",
    invalidField: "",
    manualError: "",
    reveal: false,
    navigationOpen: false,
    announcement: "",
    sendStatus: "",
    handoff: "",
  };
  state.workspaces.Studio.connection = { provider: "anthropic", method: "key" };
  state.workspaces.Studio.model.selected = "example-studio";
  const current = currentWorkspace(state);
  if (
    [
      "settings",
      "restored",
      "reconnect",
      "locked",
      "capability",
      "success",
    ].includes(preset)
  )
    current.connection = {
      provider: preset === "capability" ? "typesafe" : "openai",
      method: "key",
    };
  if (["reconnect", "locked", "capability"].includes(preset))
    current.unavailable = preset;
  if (preset === "cloud") {
    state.provider = "google-vertex";
    state.method = "service";
  }
  if (preset === "device") {
    state.provider = "github-copilot";
    state.method = "device";
    state.deviceIssued = true;
  }
  if (preset === "browser") state.method = "browser";
  if (preset === "copy-code") {
    state.provider = "openrouter";
    state.method = "browser";
  }
  if (preset === "endpoint") {
    state.provider = "compatible";
    state.method = "none";
  }
  if (preset === "advanced") state.method = "command";
  if (preset.startsWith("chat-")) {
    const fixture = preset.slice(5),
      model = current.model;
    current.connection = {
      provider: fixture === "custom" ? "compatible" : "openai",
      method: fixture === "oauth" ? "browser" : "key",
      ...(fixture === "custom"
        ? { endpoint: "https://example-endpoint.invalid/v1" }
        : {}),
    };
    model.manual = fixture === "custom";
    if (fixture === "one" || fixture === "zero") model.count = fixture;
    if (
      [
        "loading",
        "load-error",
        "saving",
        "save-error",
        "uncertain",
        "unavailable",
      ].includes(fixture)
    )
      model.phase = fixture as ModelPhase;
    if (fixture === "streaming" || fixture === "unsaved")
      current.response = fixture;
    if (
      [
        "existing",
        "synced",
        "streaming",
        "unsaved",
        "saving",
        "save-error",
        "uncertain",
      ].includes(fixture)
    )
      model.selected = "example-chat";
    if (["saving", "save-error", "uncertain"].includes(fixture))
      model.pending = "example-fast";
    if (fixture === "long") model.selected = "example-reasoning-long";
    if (fixture === "unavailable") model.selected = "example-retired";
    if (fixture === "disconnected") current.unavailable = "reconnect";
    if (["existing", "synced", "unconfigured"].includes(fixture)) {
      current.history = [
        "Please help me organize a reading corner.",
        "Start by choosing a comfortable seat near a light source.",
      ];
    }
    if (fixture === "unconfigured") current.connection = null;
    if (fixture === "custom") current.defaultModel = "local-chat";
    state.screen = "chat";
  }
  if (
    ["store-denied", "store-unavailable", "source", "access-denied"].includes(
      preset,
    )
  ) {
    current.connection = {
      provider: "openai",
      method: preset === "source" ? "environment" : "key",
    };
    if (preset === "source") current.connection.source = "EXAMPLE_AI_KEY";
    current.unavailable = preset;
    state.screen = "settings";
  }
  if (
    [
      "warning",
      "warning-device",
      "warning-changed",
      "blocked-subscription",
      "session-replacement",
    ].includes(preset)
  ) {
    state.provider =
      preset === "blocked-subscription" ? "anthropic" : "example-orbit";
    state.method = preset === "warning-device" ? "device" : "browser";
    state.screen = "methods";
    if (preset === "warning-changed" || preset === "session-replacement") {
      current.connection = {
        provider: "example-orbit",
        method: "browser",
        warningVersion: "orbit-browser-1",
      };
      current.model.selected = "example-orbit-chat";
      current.draft = "Keep this reading plan.";
      if (preset === "warning-changed") {
        state.restrictionVersion = 2;
        state.screen = "settings";
        gateAccess(state, "use");
      } else {
        current.connection = null;
        current.model = initialModel();
        state.independentSession = false;
        state.screen = "session-unavailable";
      }
    } else gateAccess(state, "connect");
  }
  if (preset === "missing") {
    state.screen = "settings";
    current.history = [
      "Please help me organize a reading corner.",
      "Start by choosing a comfortable seat near a light source.",
    ];
  }
  if (state.screen === "chat")
    current.draft = "Help me plan a quiet reading corner.";
  state.explorationMode = [
    "cloud",
    "device",
    "copy-code",
    "advanced",
    "capability",
    "source",
    "warning",
    "warning-device",
    "warning-changed",
    "blocked-subscription",
    "session-replacement",
  ].includes(preset);
  return state;
}
export const catalog = [
  {
    provider: "openai-codex",
    id: "example-codex",
    name: "Example Codex",
    methods: ["device"],
    chat: true,
    platform: true,
  },
  {
    provider: "openrouter",
    id: "example-router",
    name: "Example Router",
    methods: ["key"],
    chat: true,
    platform: true,
  },
  {
    provider: "example-orbit",
    id: "example-orbit-chat",
    name: "Orbit Example Chat",
    methods: ["browser", "device", "key"],
    chat: true,
    platform: true,
  },
  {
    provider: "openai",
    id: "example-chat",
    name: "Example Chat",
    settingsLabel: "GPT Chat",
    methods: ["key", "browser"],
    chat: true,
    platform: true,
  },
  {
    provider: "openai",
    id: "example-fast",
    name: "Example Fast",
    settingsLabel: "GPT Mini",
    methods: ["key"],
    chat: true,
    platform: true,
  },
  {
    provider: "openai",
    id: "example-reasoning-long",
    settingsLabel: "Example Reasoning",
    name: "Example Reasoning",
    methods: ["key"],
    chat: true,
    platform: true,
  },
  {
    provider: "anthropic",
    id: "example-studio",
    name: "Example Studio",
    settingsLabel: "Claude Sonnet",
    methods: ["key", "browser", "copy"],
    chat: true,
    platform: true,
  },
  {
    provider: "openai",
    id: "example-desktop",
    name: "Example Desktop",
    methods: ["key"],
    chat: true,
    platform: true,
    desktopOnly: true,
  },
  {
    provider: "openai",
    id: "example-image",
    name: "Example Image",
    methods: ["key"],
    chat: false,
    platform: true,
  },
  {
    provider: "openai",
    id: "example-unsupported",
    name: "Example Unsupported",
    methods: ["key"],
    chat: true,
    platform: false,
  },
];
export function eligibleModels(state: AiState) {
  const { connection, model, catalogModelIds } = currentWorkspace(state);
  if (!connection || model.count === "zero") return [];
  const eligible = catalog.filter(
    (item) =>
      item.provider === connection.provider &&
      (catalogModelIds === undefined || catalogModelIds.includes(item.id)) &&
      item.methods.includes(connection.method) &&
      item.chat &&
      item.platform &&
      !(state.mobile && item.desktopOnly),
  );
  return model.count === "one" ? eligible.slice(0, 1) : eligible;
}
export function resolvedModelId(state: AiState): string | null {
  const current = currentWorkspace(state);
  if (current.model.selected) return current.model.selected;
  if (current.defaultModel !== "recommended") return current.defaultModel;
  return eligibleModels(state)[0]?.id ?? null;
}
export const selectedModelName = (state: AiState) =>
  catalog.find(
    (item) =>
      item.provider === currentWorkspace(state).connection?.provider &&
      item.id === resolvedModelId(state),
  )?.name ||
  resolvedModelId(state) ||
  "Recommended";
export function choiceGuard(state: AiState): string {
  const connection = currentWorkspace(state).connection;
  if (connection && needsReview(state, connection)) return securityCopy.guard;
  const m = currentWorkspace(state).model;
  if (!aiConnected(state))
    return "AI access is unavailable. Manage the connection in Settings. Local notes and tasks remain available.";
  const messages: Partial<Record<ModelPhase, string>> = {
    loading: "Loading models…",
    "load-error": "Models could not be loaded. Try loading them again.",
    saving: "Saving model choice…",
    uncertain:
      "Model choice could not be confirmed. Check the selected model and retry.",
    reconciling: "Checking the selected model…",
    "save-error":
      "The model choice could not be saved. Your previous choice is unchanged.",
  };
  if (messages[m.phase]) return messages[m.phase]!;
  if (
    m.phase === "unavailable" ||
    (resolvedModelId(state) &&
      !m.manual &&
      !eligibleModels(state).some((item) => item.id === resolvedModelId(state)))
  )
    return "The selected model is unavailable. Choose another eligible model, or manage the connection in Settings.";
  if (!m.manual && !eligibleModels(state).length)
    return "No eligible chat models are available for this connection. Manage the connection in Settings.";
  return resolvedModelId(state)
    ? ""
    : "No suitable default model is available. Check the model settings for this connection.";
}
export function chatGuard(state: AiState): string {
  const issue = choiceGuard(state);
  if (issue) return issue;
  const response = currentWorkspace(state).response;
  if (response === "streaming") return "A response is in progress.";
  if (response === "unsaved")
    return "Save the response before sending another message.";
  return "";
}
export const modelLocked = (state: AiState) =>
  (!!currentWorkspace(state).connection &&
    needsReview(state, currentWorkspace(state).connection!)) ||
  !aiConnected(state) ||
  ["loading", "load-error", "saving", "uncertain", "reconciling"].includes(
    currentWorkspace(state).model.phase,
  ) ||
  (!currentWorkspace(state).model.manual && !eligibleModels(state).length);
export function navigate(state: AiState, screen: string) {
  state.storeRetry = false;
  if (["local", "chat", "settings", "restored"].includes(screen)) {
    clearHttpConsent(state);
    if (["connecting", "browser", "copy-code", "device"].includes(state.screen))
      state.abandonedAttempt = state.attempt;
    state.stale = true;
    state.attempt++;
    state.values = {};
    state.reveal = false;
  }
  state.screen = screen;
  state.dialog = null;
  state.navigationOpen = false;
  state.announcement = "";
  state.sendStatus = "";
  state.fieldError = "";
  state.invalidField = "";
}
export function switchWorkspace(state: AiState, workspace: WorkspaceName) {
  state.workspace = workspace;
  navigate(state, "settings");
}
export function startConnection(state: AiState, origin: string) {
  clearHttpConsent(state);
  state.origin = origin;
  state.warningAccepted = "";
  state.values = {};
  state.provider = currentWorkspace(state).connection?.provider || "openai";
  state.method = currentWorkspace(state).connection?.method || "key";
  state.stale = false;
  state.attempt++;
  state.search = "";
  navigate(state, "providers");
}
export function chooseProvider(state: AiState, provider: string) {
  if (
    !availableProviders(state.explorationMode).some(
      (item) => item.id === provider,
    )
  )
    return;
  clearHttpConsent(state);
  state.provider = provider;
  state.warningAccepted = "";
  state.values = {};
  navigate(state, "methods");
}
export function authScreen(state: AiState) {
  if (requiresSessionTakeover(state)) {
    navigate(state, "session-unavailable");
    return;
  }
  if (gateAccess(state, "connect")) return;
  state.browserOpened = false;
  state.deviceIssued = false;
  state.stale = false;
  state.attempt++;
  const method = state.method;
  navigate(
    state,
    method === "browser"
      ? "browser"
      : method === "copy"
        ? "copy-code"
        : method === "device"
          ? "device"
          : ["profile", "chain", "adc", "service", "federation"].includes(
                method,
              )
            ? "cloud"
            : ["environment", "command", "extension"].includes(method)
              ? "advanced"
              : ["compatible", "llama.cpp"].includes(state.provider)
                ? "endpoint"
                : "key",
  );
}
export function chooseMethod(state: AiState, method: string) {
  if (!availableMethods(state.provider, state.explorationMode).includes(method))
    return;
  clearHttpConsent(state);
  state.method = method;
  state.warningAccepted = "";
  state.values = {};
  state.reveal = false;
  authScreen(state);
}
export function cancelConnection(state: AiState) {
  clearHttpConsent(state);
  state.abandonedAttempt = state.attempt;
  state.stale = true;
  state.attempt++;
  state.browserOpened = false;
  state.values = {};
  state.reveal = false;
  navigate(state, "cancelled");
}
export function beginConnection(state: AiState) {
  if (requiresSessionTakeover(state)) {
    navigate(state, "session-unavailable");
    return;
  }
  if (gateAccess(state, "connect") || gateHttpDestination(state)) return;
  state.stale = false;
  navigate(state, "connecting");
}
export function saveModel(state: AiState, id: string | null) {
  if (
    modelLocked(state) ||
    (id !== null &&
      (!id.trim() ||
        (!currentWorkspace(state).model.manual &&
          !eligibleModels(state).some((item) => item.id === id))))
  )
    return;
  const model = currentWorkspace(state).model;
  model.pending = id?.trim() ?? null;
  model.phase = "saving";
  state.dialog = null;
  state.sendStatus = "";
}
export function modelAction(state: AiState, action: string) {
  const current = currentWorkspace(state);
  const model = current.model;
  if (
    action === "inherit" &&
    current.defaultConnection !== undefined &&
    model.selected &&
    !["saving", "uncertain", "reconciling", "save-error"].includes(model.phase)
  ) {
    model.pending = null;
    model.phase = "saving";
  }
  if (action === "check" && model.phase === "uncertain")
    model.phase = "reconciling";
  if (action === "retry" && ["uncertain", "save-error"].includes(model.phase))
    model.phase = "saving";
  if (action === "discard" && model.phase === "save-error") {
    model.phase = "ready";
    model.pending = null;
  }
  if (action === "reload" && model.phase === "load-error")
    model.phase = "loading";
  state.sendStatus = "";
}
export function sendMessage(state: AiState) {
  const reason = chatGuard(state);
  state.sendStatus = reason
    ? `Message not sent. ${reason}`
    : currentWorkspace(state).draft.trim()
      ? "Ready to send."
      : "Write a message first.";
  if (!reason && currentWorkspace(state).draft.trim())
    state.handoff =
      "Message handoff reached. No message was transmitted and no AI response was generated.";
}
export function applyOutcome(
  state: AiState,
  outcome: string,
  attempt = state.attempt,
) {
  const current = currentWorkspace(state),
    model = current.model;
  if (outcome === "conversation-synced" && state.screen === "chat") {
    current.history.push(
      "A small shelf beside the chair will keep your current books within reach.",
    );
    return;
  }
  if (outcome.startsWith("model-")) {
    if (state.screen !== "chat") return;
    if (model.phase === "saving") {
      if (outcome === "model-saved") {
        model.selected = model.pending;
        model.pending = null;
        model.phase = "ready";
      }
      if (outcome === "model-save-error") model.phase = "save-error";
      if (outcome === "model-save-uncertain") model.phase = "uncertain";
    }
    if (
      model.phase === "reconciling" &&
      ["model-confirmed-new", "model-confirmed-previous"].includes(outcome)
    ) {
      if (outcome === "model-confirmed-new") model.selected = model.pending;
      model.pending = null;
      model.phase = "ready";
    }
    if (model.phase === "loading" && outcome === "model-loaded")
      model.phase = "ready";
    if (model.phase === "loading" && outcome === "model-load-error")
      model.phase = "load-error";
    if (
      current.response === "streaming" &&
      outcome === "model-response-finished"
    )
      current.response = "unsaved";
    if (current.response === "unsaved" && outcome === "model-response-saved")
      current.response = "idle";
    state.sendStatus = "";
    return;
  }
  if (outcome === "restriction-changed") {
    state.restrictionVersion = 2;
    return;
  }
  if (
    outcome === "store-ready" &&
    state.storeRetry &&
    attempt === state.attempt
  ) {
    state.storeRetry = false;
    if (state.screen.startsWith("store-save-")) beginConnection(state);
    else if (
      ["locked", "store-denied", "store-unavailable"].includes(
        current.unavailable || "",
      )
    ) {
      current.unavailable = null;
      state.announcement = securityCopy.storeReady;
    }
    return;
  }
  if (outcome === "reopen") {
    navigate(state, aiConnected(state) ? "restored" : "settings");
    return;
  }
  if (outcome === "late" || attempt !== state.attempt) {
    state.announcement =
      "The previous sign-in attempt is no longer active. Start a new attempt to connect.";
    return;
  }
  if (
    state.stale ||
    !["connecting", "browser", "copy-code", "device"].includes(state.screen)
  )
    return;
  if (requiresSessionTakeover(state)) {
    navigate(state, "session-unavailable");
    return;
  }
  if (gateAccess(state, "connect") || gateHttpDestination(state)) return;
  if (outcome === "success") {
    if (
      state.screen === "copy-code" ||
      (state.screen === "device" &&
        state.provider === "github-copilot" &&
        !state.deviceIssued)
    )
      return;
    if (state.screen !== "connecting") {
      beginConnection(state);
      return;
    }
    if (current.connection?.provider !== state.provider)
      current.defaultModel = "recommended";
    current.connection = {
      ...(current.connection?.id !== undefined
        ? { id: current.connection.id }
        : {}),
      ...(current.connection?.label !== undefined
        ? { label: current.connection.label }
        : {}),
      provider: state.provider,
      method:
        state.method === "key" &&
        ["compatible", "llama.cpp"].includes(state.provider) &&
        !state.values.credential?.trim()
          ? "none"
          : state.method,
      ...(state.httpConsent ? { httpAcknowledgement: state.httpConsent } : {}),
      ...(state.warningAccepted
        ? { warningVersion: state.warningAccepted }
        : {}),
      ...(state.values.endpoint || state.values["base-override"]
        ? { endpoint: state.values.endpoint || state.values["base-override"] }
        : {}),
      ...(state.values.profile ||
      state.values.variable ||
      state.method === "command"
        ? {
            source:
              state.values.profile ||
              state.values.variable ||
              "Credential command",
          }
        : {}),
    };
    current.model = {
      ...initialModel(),
      manual: ["compatible", "llama.cpp"].includes(state.provider),
    };
    current.unavailable = state.provider === "typesafe" ? "capability" : null;
    clearHttpConsent(state);
    state.values = {};
    state.reveal = false;
    navigate(state, current.unavailable ? "capability" : "success");
  } else if (
    [
      "denied",
      "expired",
      "offline",
      "save-error",
      "unsupported",
      "store-save-locked",
      "store-save-denied",
      "store-save-unavailable",
    ].includes(outcome)
  )
    navigate(state, outcome);
}
export function availableOutcomes(
  state: AiState,
): { id: string; label: string }[] {
  const option = (id: string, label: string) => ({ id, label });
  if (state.storeRetry)
    return [option("store-ready", securityCopy.storeControl)];
  if (state.screen === "chat") {
    const {
      model: { phase },
      response,
    } = currentWorkspace(state);
    const lifecycle =
      response === "streaming"
        ? [
            option(
              "model-response-finished",
              "Response finished, not yet saved",
            ),
          ]
        : response === "unsaved"
          ? [option("model-response-saved", "Response saved")]
          : [];
    if (phase === "saving")
      return [
        ...lifecycle,
        option("model-saved", "Model choice saved"),
        option("model-save-error", "Model save failed (confirmed unchanged)"),
        option("model-save-uncertain", "Model save outcome uncertain"),
      ];
    if (phase === "reconciling")
      return [
        ...lifecycle,
        option("model-confirmed-new", "Readback confirms new model"),
        option("model-confirmed-previous", "Readback confirms previous model"),
      ];
    if (phase === "loading")
      return [
        ...lifecycle,
        option("model-loaded", "Model catalog loaded"),
        option("model-load-error", "Model catalog failed"),
      ];
    return lifecycle;
  }
  if (
    !state.stale &&
    ["connecting", "browser", "copy-code", "device"].includes(state.screen)
  )
    return [
      ...(state.screen === "copy-code" ||
      (state.screen === "device" &&
        state.provider === "github-copilot" &&
        !state.deviceIssued)
        ? []
        : [
            option(
              "success",
              state.screen === "connecting"
                ? "Complete successfully"
                : "Provider approved sign-in",
            ),
          ]),
      option("denied", "Authorization denied"),
      option("expired", "Sign-in expired"),
      option("offline", "Provider unreachable"),
      ...(state.screen === "connecting"
        ? [
            option("save-error", "Local connection save failed"),
            option("store-save-locked", securityCopy.saveLocked),
            option("store-save-denied", securityCopy.saveDenied),
            option("store-save-unavailable", securityCopy.saveUnavailable),
          ]
        : []),
      option("unsupported", "Method unavailable on device"),
    ];
  return [];
}
