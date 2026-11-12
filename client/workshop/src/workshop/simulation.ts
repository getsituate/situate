import {
  callbackScenarios,
  createCallbackState,
  reduceCallback,
  type CallbackState,
  type CallbackAction,
} from "../auth-callback/model";
import { replyToQuestion } from "../chat/question-examples";
import {
  conversationScenarios,
  conversationAliases,
  conversationSeed,
} from "../chat/conversation-presets";
import type { QuestionResponse } from "../chat/question";
import {
  conversationSetupStates,
  createSetupConversation,
  reduceSetupConversation,
  type SetupConversationState,
  type SetupConversationAction,
} from "../onboarding/conversation-setup";
import {
  createUpdates,
  reduceUpdates,
  updateScenarios,
  type UpdateState,
  type UpdateAction,
} from "../updates/model";
import {
  createDictation,
  ensureWorkspace as ensureDictationWorkspace,
  dictationScenarios,
  reduceDictation,
  type DictationState,
  type DictationAction,
} from "../dictation/model";
import {
  componentScenarios,
  createComponentLibraryState,
  type ComponentLibraryState,
} from "../component-library/model";
import {
  openSourceWorkflow,
  syncSourceState,
  sourcePluginAction,
  reconcileSourceDocuments,
} from "./document-sources";
import {
  createDocumentsState,
  documentScenarios,
  interruptDocumentWork,
  type DocumentsState,
} from "../documents/model";
import {
  createFirstEntry,
  reduceFirstEntry,
  type FirstEntryState,
  type FirstEntryAction,
} from "../workspaces/first-entry";
import {
  createOnboardingState,
  importWorking,
  reduceOnboarding,
  type OnboardingState,
  type OnboardingAction,
  type ToolId,
} from "../onboarding/model";
import { toolCards } from "../onboarding/flow-content";
import { supportRequest, supportNote } from "../onboarding/support-plan";
import {
  startPluginDevelopment,
  sendPluginRequest,
  createPluginState,
  interruptPluginWork,
  pluginScenarios,
  type PluginState,
} from "../plugins/model";
import type { Action, Snapshot, Workspace } from "../workspaces/api";
import {
  createTabsState,
  reduceTabs,
  tabScenarios,
  type TabsState,
  type TabsAction,
} from "../tabs/model";
import { createEditorState, type EditorState } from "../editor/model";
import {
  createNavigationState,
  type NavigationState,
} from "../navigation/model";
import {
  aiScenarios,
  createAiState,
  aiConnected,
  currentWorkspace,
  eligibleModels,
  cancelConnection,
  type AiState,
} from "../ai/model";
import { createPlatformState, type PlatformState } from "./platform/model";
import { reconcile } from "./reconcile";
import {
  createSettingsState,
  settingsScenarios,
  type SettingsState,
} from "../settings/model";

import { createChatState, type ChatState } from "../chat/model";
import {
  applyConnectionDefaults,
  restoresInheritance,
} from "../settings/connection-defaults";
import {
  createQueueState,
  queueScenarios,
  reduceQueue,
  type QueueState,
  type QueueAction,
} from "../chat-queue/model";

import {
  createRecovery,
  recoveryScenarios,
  reduceRecovery,
  type RecoveryAction,
  type RecoveryState,
} from "../error-recovery/model";

export const scenarios = [
  ...recoveryScenarios,
  ...callbackScenarios,
  ...updateScenarios,
  ...dictationScenarios,
  ...componentScenarios,
  ...tabScenarios,
  ...documentScenarios,
  ...(
    [
      {
        id: "first-entry",
        label: "01 · Welcome",
      },
      {
        id: "first-entry-create",
        label: "02 · Create a workspace · name, location and color",
      },
      { id: "first-entry-ai", label: "03 · Connect AI" },
      { id: "first-entry-model", label: "04 · Verify a model" },
      { id: "first-entry-paused", label: "04.1 · Paused setup · resume" },
      ...conversationSetupStates,
    ] as const
  )
    .map((s) => ({ ...s, group: "Onboarding" as const }))
    .sort((a, b) => Number.parseFloat(a.label) - Number.parseFloat(b.label)),
  ...queueScenarios,
  ...conversationScenarios.map((s) => ({ ...s, group: "Chat" as const })),
  { id: "workspaces", label: "Choose a workspace", group: "Workspaces" },
  { id: "create", label: "Create a workspace", group: "Workspaces" },
  { id: "collision", label: "Folder already exists", group: "Workspaces" },
  { id: "create-error", label: "Creation failed", group: "Workspaces" },
  {
    id: "invalid-folder",
    label: "Not a workspace folder",
    group: "Workspaces",
  },
  { id: "remove", label: "Remove confirmation", group: "Workspaces" },
  { id: "opening", label: "Opening a workspace", group: "Workspaces" },
  { id: "access-error", label: "Workspace access denied", group: "Workspaces" },
  {
    id: "restore-error",
    label: "Workspace could not be reopened",
    group: "Workspaces",
  },
  { id: "startup", label: "Starting the app", group: "Workspaces" },
  { id: "startup-error", label: "Startup failed", group: "Workspaces" },
  { id: "workspace", label: "Open workspace", group: "Workspaces" },
  { id: "navigation-chat", label: "New chat", group: "Navigation" },
  { id: "navigation-dashboard", label: "My day and chat", group: "Navigation" },
  { id: "navigation-draft", label: "Chat draft", group: "Navigation" },
  { id: "navigation-empty", label: "No open tabs", group: "Navigation" },
  { id: "files-read", label: "Read a file", group: "Files and editing" },
  { id: "files-source", label: "Edit Markdown", group: "Files and editing" },
  { id: "files-chat", label: "Chat with a file", group: "Files and editing" },
  { id: "files-history", label: "Version history", group: "Files and editing" },
  {
    id: "files-save-error",
    label: "Automatic save failed",
    group: "Files and editing",
  },
  { id: "files-empty", label: "No open file", group: "Files and editing" },
  {
    id: "files-conflict",
    label: "Review conflicting versions",
    group: "Files and editing",
  },
  {
    id: "files-conflict-failure",
    label: "Conflict write fails once",
    group: "Files and editing",
  },
  {
    id: "files-conflict-race",
    label: "File changes during application",
    group: "Files and editing",
  },
  { id: "files-merged", label: "Automatic merge", group: "Files and editing" },
  ...pluginScenarios.map(({ id, label }) => ({
    id,
    label,
    group: "Plugins" as const,
  })),
  ...settingsScenarios.map(({ id, label }) => ({
    id,
    label,
    group: "Settings" as const,
  })),
  ...aiScenarios.map(({ id, label }) => ({
    id,
    label,
    group: "AI access" as const,
  })),
] as const;
type RegisteredScenario = (typeof scenarios)[number]["id"];
export const scenarioAliases = {
  ...conversationAliases,
  "first-entry-opus": "first-entry",
  "onboarding-method": "setup-conversation-brief",
  "onboarding-method-brief": "setup-conversation-keep",
  "onboarding-method-waiting": "setup-conversation-proposal",
  "onboarding-method-info": "setup-conversation-brief",
  "onboarding-proposal": "setup-conversation-proposal",
  "onboarding-proposal-waiting": "setup-conversation-proposal",
  "onboarding-proposal-failed": "setup-conversation-proposal",
  "onboarding-proposal-file": "setup-conversation-proposal",
  "onboarding-proposal-saving": "setup-conversation-proposal",
  "onboarding-proposal-save-error": "setup-conversation-proposal",
  "onboarding-proposal-short": "setup-conversation-proposal",
  "onboarding-proposal-existing": "setup-conversation-proposal",
  "onboarding-proposal-conflict": "setup-conversation-proposal",
  "onboarding-sources": "setup-conversation-brief",
  "onboarding-sources-chat": "setup-conversation-import",
  "onboarding-sources-apple-notes": "setup-conversation-import",
  "onboarding-sources-waiting": "setup-conversation-import",
  "onboarding-sources-failed": "setup-conversation-blocked",
  "onboarding-sources-ready": "setup-conversation-support",
  "onboarding-sources-partial": "setup-conversation-partial",
  "onboarding-samples": "setup-conversation-app",
  "onboarding-samples-file": "setup-conversation-app",
  "onboarding-samples-large": "setup-conversation-app",
  "onboarding-samples-flat": "setup-conversation-app",
  "onboarding-samples-added": "setup-conversation-app",
  "onboarding-form": "first-entry-ai",
  "onboarding-clean": "setup-conversation-fresh",
  "onboarding-plan": "setup-conversation-support",
  "onboarding-plan-waiting": "setup-conversation-support",
  "onboarding-plan-error": "setup-conversation-support",
  "onboarding-plan-empty": "setup-conversation-support",
  "onboarding-plan-fewer": "setup-conversation-support",
  "onboarding-finale": "setup-conversation-finale",
  "onboarding-reopened": "setup-conversation-app",
  "onboarding-crash": "setup-conversation-partial",
  "onboarding-device": "first-entry-ai",
  "onboarding-completed": "setup-conversation-finale",
  "onboarding-development-failed": "setup-conversation-support",
  "onboarding-import": "setup-conversation-import",
  "onboarding-import-failed": "setup-conversation-blocked",
  "onboarding-provider": "first-entry-ai",
  "onboarding-arrival": "chat-empty",
  "onboarding-pending-empty": "chat-empty",
  "onboarding-empty": "chat-empty",
  "onboarding-manual": "chat-empty",
  "onboarding-hint": "chat-empty",
  "ai-chat": "ai-chat-unconfigured",
  "ai-chat-new": "chat-empty",
  "ai-chat-existing": "chat-work-history",
  "ai-chat-synced": "chat-work-history",
  "ai-chat-one": "chat-work-history",
  "ai-chat-oauth": "chat-work-history",
  "ai-chat-custom": "chat-work-history",
  "ai-chat-long": "chat-work-history",
  "ai-chat-loading": "chat-work-history",
  "ai-chat-saving": "chat-work-history",
  "ai-chat-streaming": "chat-work-history-working",
  "ai-chat-unsaved": "chat-work-history",
  "ai-chat-disconnected": "ai-chat-unconfigured",
  "documents-find-focused": "documents-find",
  "documents-gather-focused": "documents-gather",
  "documents-missing-tag": "documents-tag-removed",
  "documents-repair-view": "documents-tag-removed",
} as const satisfies Record<string, RegisteredScenario>;
export type Scenario = RegisteredScenario | keyof typeof scenarioAliases;
export function canonicalScenario(id: Scenario): RegisteredScenario {
  return Object.hasOwn(scenarioAliases, id)
    ? scenarioAliases[id as keyof typeof scenarioAliases]
    : (id as RegisteredScenario);
}
export type Outcome = "success" | "error" | "wait";
export type Content = "empty" | "few" | "many" | "long";
export interface PendingAction {
  request: string;
  action: Action;
  id?: string;
  name?: string;
}
export interface Simulation {
  recovery: RecoveryState;
  callback: CallbackState;
  updates: UpdateState;
  dictation: DictationState;
  dictationNavigation: Command | null;
  firstEntry: FirstEntryState;
  scenario: Scenario;
  conversationStart?: Scenario;
  epoch: number;
  snapshot: Snapshot;
  entryVisible: boolean;
  creating: boolean;
  removingId: string | null;
  draftName: string;
  error: string;
  content: Content;
  nextOutcome: Outcome;
  folderExists: boolean;
  pending: PendingAction | null;
  completion: { request: string; ok: boolean } | null;
  lastAction: string;
  components: ComponentLibraryState;
  feature:
    | "recovery"
    | "auth-callback"
    | "dictation"
    | "components"
    | "first-entry"
    | "setup-conversation"
    | "workspace"
    | "onboarding"
    | "navigation"
    | "editor"
    | "ai"
    | "settings"
    | "chat"
    | "chat-queue"
    | "plugins"
    | "tabs"
    | "documents";
  tabs: TabsState;
  tabsByWorkspace: Record<string, TabsState>;
  documents: DocumentsState;
  documentsByWorkspace: Record<string, DocumentsState>;
  setupConversation: SetupConversationState;
  onboarding: OnboardingState;
  onboardingByWorkspace: Record<string, OnboardingState>;
  onboardingEditors: Record<string, EditorState>;
  userHintsDone: boolean;
  chatQueue: QueueState;

  plugins: PluginState;
  pluginsByWorkspace: Record<string, PluginState>;
  settings: SettingsState;
  settingsByWorkspace: Record<string, SettingsState>;
  chat: ChatState;
  navigation: NavigationState;
  editor: EditorState;
  ai: AiState;
  environment: PlatformState;
  sidebarCollapsed: boolean;
}
export type Command =
  | { type: "recovery"; action: RecoveryAction }
  | { type: "auth-callback"; action: CallbackAction }
  | { type: "updates"; action: UpdateAction }
  | { type: "update-settings" }
  | { type: "dictation"; action: DictationAction }
  | { type: "dictation-settings" }
  | { type: "dictation-file-error"; value: boolean }
  | { type: "dictation-confirm"; discard: boolean }
  | { type: "components"; patch: Partial<ComponentLibraryState> }
  | { type: "tabs"; action: TabsAction }
  | { type: "first-entry"; action: FirstEntryAction }
  | { type: "setup-conversation"; action: SetupConversationAction }
  | { type: "chat-answer"; response: QuestionResponse }
  | { type: "onboarding"; action: OnboardingAction; workspaceId?: string }
  | { type: "scenario"; scenario: Scenario }
  | {
      type: "documents";
      state: DocumentsState;
      base?: DocumentsState;
      workspaceId: string;
    }
  | {
      type: "plugins";
      state: PluginState;
      base?: PluginState;
      workspaceId?: string;
    }
  | {
      type: "plugin-action";
      action: "finish" | "adopt" | "abort";
      id?: string;
      workspaceId: string;
    }
  | {
      type: "document-sources";
      action: "list" | "create" | "detail";
      id?: string;
      workspaceId: string;
    }
  | { type: "settings"; state: SettingsState; base?: SettingsState }
  | { type: "chat-queue"; action: QueueAction }
  | { type: "chat"; state: ChatState; base?: ChatState }
  | { type: "navigation"; state: NavigationState; base?: NavigationState }
  | { type: "editor"; state: EditorState; base?: EditorState }
  | { type: "ai"; state: AiState; base?: AiState }
  | { type: "environment"; state: PlatformState }
  | { type: "feature"; feature: Simulation["feature"] }
  | { type: "sidebar"; collapsed: boolean }
  | { type: "reset" }
  | { type: "platform"; mobile: boolean }
  | { type: "content"; content: Content }
  | { type: "outcome"; outcome: Outcome }
  | { type: "folder"; exists: boolean }
  | { type: "finish"; ok: boolean }
  | { type: "error"; error: string }
  | { type: "creating"; value: boolean }
  | { type: "removing"; id: string | null }
  | { type: "draft"; name: string }
  | { type: "entry"; visible: boolean }
  | { type: "action"; operation: PendingAction };

export function isScenario(value: string | null): value is Scenario {
  return (
    scenarios.some((scenario) => scenario.id === value) ||
    (value !== null && Object.hasOwn(scenarioAliases, value))
  );
}
export function workspaces(content: Content): Workspace[] {
  if (content === "empty") return [];
  return Array.from({ length: content === "many" ? 18 : 3 }, (_, i) => ({
    id: `sample-${i + 1}`,
    name:
      content === "long"
        ? `Field notes and observations from the community garden — collection ${i + 1}`
        : (["Field notes", "Reading room", "Garden journal"][i] ??
          `Notebook ${i + 1}`),
    display: `/Example/Workspaces/Notebook ${i + 1}`,
  }));
}

export function createSimulation(
  scenario: Scenario = "workspaces",
  mobile = false,
  epoch = 0,
): Simulation {
  const requestedScenario = scenario;
  if (
    scenario.startsWith("ai-chat") ||
    scenario.startsWith("chat-") ||
    scenario.startsWith("onboarding-") ||
    scenario.startsWith("first-entry")
  )
    scenario = canonicalScenario(scenario);
  const known = workspaces(
    scenario.startsWith("first-entry") ? "empty" : "few",
  );
  const state: Simulation = {
    recovery: createRecovery(scenario),
    callback: createCallbackState(scenario),
    updates: createUpdates(scenario.startsWith("recovery-") ? "" : scenario),
    dictation: createDictation(scenario),
    dictationNavigation: null,
    firstEntry: createFirstEntry(scenario),
    scenario,
    epoch,
    snapshot: {
      ready: true,
      mobile,
      known,
      open: [],
      current: null,
      failures: [],
      error: null,
    },
    entryVisible: true,
    creating: false,
    removingId: null,
    draftName: "",
    error: "",
    content: "few",
    nextOutcome: "success",
    folderExists: false,
    pending: null,
    completion: null,
    lastAction: "",
    feature: "workspace",
    components: createComponentLibraryState(scenario),
    tabs: createTabsState(scenario),
    tabsByWorkspace: {},
    documents: createDocumentsState(scenario),
    documentsByWorkspace: {},
    setupConversation: createSetupConversation(
      scenario.startsWith("setup-conversation-") ? scenario : undefined,
    ),
    onboarding: createOnboardingState(scenario),
    onboardingByWorkspace: {},
    onboardingEditors: {},
    userHintsDone: false,
    chatQueue: createQueueState(scenario),
    chat: createChatState(conversationSeed(requestedScenario, scenario)),
    plugins: createPluginState(scenario),
    pluginsByWorkspace: {},
    navigation: createNavigationState(),
    editor: createEditorState(),
    ai: createAiState(),
    environment: createPlatformState(),
    sidebarCollapsed: false,
    settings: createSettingsState(scenario),
    settingsByWorkspace: {},
  };
  if (
    scenario === "create" ||
    scenario === "collision" ||
    scenario === "create-error"
  ) {
    state.creating = true;
    state.firstEntry = createFirstEntry("first-entry-create");
  }
  if (scenario === "create-error") {
    state.draftName = "Garden journal";
    state.error =
      "You don’t have permission to create a folder here. Choose another parent folder and try again.";
  }
  if (scenario === "invalid-folder")
    state.error =
      "This folder is not a Situate workspace. Choose an existing workspace folder.";
  if (scenario.startsWith("setup-conversation-"))
    state.feature = "setup-conversation";
  if (scenario.startsWith("components-")) state.feature = "components";
  if (scenario.startsWith("auth-callback-")) state.feature = "auth-callback";
  if (scenario.startsWith("recovery-")) state.feature = "recovery";
  if (scenario.startsWith("tabs-")) {
    state.feature = "tabs";
  }
  if (scenario.startsWith("onboarding-")) {
    state.feature = "onboarding";
    state.plugins.plugins = [];
    state.plugins.developments = [];
    state.plugins.accounts = {};
    state.editor = createEditorState("empty");
    for (const id of state.onboarding.startedTools)
      startOnboardingDevelopment(state, id);
    if (scenario === "onboarding-development-failed") {
      const failed = state.plugins.developments.at(-1)!;
      failed.phase = "start-error";
      failed.responses[0] = "start-error";
    }
    if (state.onboarding.existingInstructions !== null) {
      const content = state.onboarding.existingInstructions;
      state.editor.files.push({
        key: "workspace-instructions",
        folder: "",
        name: "AGENTS.md",
        content,
        draft: content,
        versions: [],
        deleted: false,
        saveError: false,
      });
    }
    mergeOnboardingFiles(state);
  }
  if (scenario.startsWith("chat-") || scenario.startsWith("ai-chat-"))
    state.feature = "chat";
  if (scenario.startsWith("chat-queue-")) state.feature = "chat-queue";
  if (state.feature === "chat") {
    state.chat.transcriptStyle = "history";
    state.conversationStart = requestedScenario;
  }
  if (state.feature === "chat" || state.feature === "tabs") {
    const current = currentWorkspace(state.chat.ai);
    const connection = current.connection;
    state.settings.chatModel = current.defaultModel;
    state.settings.showModelPicker = current.showModelPicker;
    state.settings.provider = connection?.provider ?? "";
    state.settings.connected = connection ? [connection.provider] : [];
    state.settings.connections = connection
      ? { [connection.provider]: connection }
      : {};
  }
  if (scenario.startsWith("navigation-")) {
    state.feature = "navigation";
    state.navigation = createNavigationState(
      scenario.slice("navigation-".length) as Parameters<
        typeof createNavigationState
      >[0],
    );
  }
  if (scenario.startsWith("files-")) {
    state.feature = "editor";
    state.editor = createEditorState(
      scenario.slice("files-".length) as Parameters<
        typeof createEditorState
      >[0],
    );
  }
  const aiScenario = aiScenarios.find((item) => item.id === scenario);
  if (aiScenario) {
    state.feature = "ai";
    state.ai = createAiState(aiScenario.state);
  }
  if (scenario.startsWith("documents-")) state.feature = "documents";
  if (settingsScenarios.some((item) => item.id === scenario))
    state.feature = "settings";
  if (scenario.startsWith("plugins-")) state.feature = "plugins";
  if (
    ["documents-empty", "plugins-sources-empty", "plugins-empty"].includes(
      scenario,
    )
  ) {
    state.plugins.plugins = state.plugins.plugins.filter(
      (p) => p.kind !== "source",
    );
    state.documents.sources = [];
    state.documents.documents = [];
  }
  syncSourceState(state.documents, state.plugins);
  if (scenario === "documents-sources" || scenario === "documents-connect") {
    state.feature = "plugins";
    state.documents.returnFocus = "actions";
    openSourceWorkflow(
      state.plugins,
      scenario === "documents-connect" ? "create" : "list",
    );
  }
  state.ai.mobile = mobile;
  state.chat.ai.mobile = mobile;
  if (scenario === "collision") {
    state.folderExists = true;
    state.draftName = "Field notes";
  }
  if (scenario === "remove") state.removingId = known[0]!.id;
  if (scenario === "access-error")
    state.error =
      "Access to this workspace was denied. Grant access or choose another folder.";
  if (scenario === "restore-error")
    state.snapshot.failures = [
      {
        location: known[0]!,
        message: "The workspace folder could not be found.",
      },
    ];
  if (scenario === "startup" || scenario === "startup-error")
    state.snapshot.ready = false;
  if (scenario === "startup-error")
    state.snapshot.error = "Workspaces could not be opened. Try again.";
  if (scenario === "startup")
    state.pending = { request: "scenario", action: "reload" };
  if (scenario === "opening")
    state.pending = { request: "scenario", action: "open", id: known[0]!.id };
  if (scenario.startsWith("dictation-")) {
    state.feature = scenario.startsWith("dictation-download-")
      ? "settings"
      : "dictation";
    if (state.feature === "settings") {
      state.settings.page = "dictation";
      state.settings.detail = true;
    }
    if (scenario === "dictation-close-files")
      state.editor = createEditorState("save-error");
    if (scenario.startsWith("dictation-close-"))
      state.dictationNavigation = {
        type: "action",
        operation: { action: "quit", request: "dictation-quit" },
      };
  }
  if (
    scenario.startsWith("updates-") ||
    scenario.startsWith("release-notes-")
  ) {
    state.feature =
      scenario === "updates-notice" || scenario === "updates-managed"
        ? "chat"
        : "settings";
    state.chat = createChatState("chat-complete");
    if (state.feature === "settings") {
      state.settings.page = scenario.startsWith("release-notes-")
        ? "about"
        : "updates";
      state.settings.detail = true;
    }
  }
  if (scenario === "workspace" || state.feature !== "workspace") {
    state.snapshot.open = known.slice(0, 2);
    state.snapshot.current = known[0]!;
    state.entryVisible = false;
  }
  if (scenario === "recovery-startup") {
    state.snapshot.current = null;
    state.snapshot.open = [];
  }
  if (scenario.startsWith("first-entry")) {
    state.feature = "first-entry";
    state.onboarding = createOnboardingState();
    state.content = "empty";
    state.draftName = "My workspace";
    if (
      ["first-entry-ai", "first-entry-model", "first-entry-paused"].includes(
        scenario,
      )
    ) {
      const workspace: Workspace = {
        id: "created-example",
        name: "My workspace",
        display: "/Example/Workspaces/My workspace",
        accent: "sky",
      };
      state.snapshot.current = workspace;
      state.snapshot.open = [workspace];
      state.snapshot.known = [workspace];
      state.entryVisible = false;
      state.firstEntry.created = true;
      state.firstEntry.accent = "sky";
      state.settings.accent = "sky";
      state.firstEntry.step =
        scenario === "first-entry-paused" ? "paused" : "ai";
      state.feature = scenario === "first-entry-paused" ? "first-entry" : "ai";
      state.ai = createAiState(
        scenario === "first-entry-model" ? "success" : "providers",
      );
      state.ai.origin = "providers";
      state.ai.mobile = mobile;
    }
  }
  if (state.onboarding.support.attempt > 0)
    state.onboarding.support.attempt += epoch * 1000000;
  state.onboarding.workspacePath =
    state.snapshot.current?.display ?? state.onboarding.workspacePath;
  if (scenario.startsWith("onboarding-") && state.onboarding.confirmed) {
    prepareOnboardingChat(state);
    if (state.onboarding.finale.status !== "playing") state.feature = "chat";
  }
  return state;
}

function prepareOnboardingChat(state: Simulation): void {
  state.chat = createChatState("chat-empty");
  if (state.firstEntry.created && state.firstEntry.check === "verified") {
    state.chat.ai = structuredClone(state.ai);
    const current = currentWorkspace(state.chat.ai);
    const connection = current.connection;
    if (connection) {
      const id = connection.id ?? connection.provider;
      state.settings.provider = id;
      state.settings.connections[id] = { ...connection, id };
      if (!state.settings.connected.includes(id))
        state.settings.connected.push(id);
    }
    state.settings.chatModel = state.firstEntry.modelId;
    current.draft = "";
    current.history = [];
    current.response = "idle";
  } else {
    applyConnectionDefaults(state.chat.ai, state.settings, undefined, true);
  }
  state.chat.ai.screen = "chat";
  state.chat.ai.mobile = state.snapshot.mobile;
  if (!state.onboarding.connected)
    currentWorkspace(state.chat.ai).unavailable = "offline";
}

function startOnboardingDevelopment(state: Simulation, id: ToolId): void {
  const proposal = state.onboarding.support.proposals.find((p) => p.id === id);
  if (
    state.onboarding.developmentLinks[id] ||
    (!proposal && !toolCards[id].request)
  )
    return;
  startPluginDevelopment(
    state.plugins,
    proposal
      ? supportRequest(state.onboarding, proposal)
      : `${toolCards[id].request}\n\nAgreed working method:\n${state.onboarding.organization}`,
    "tool",
  );
  const development = state.plugins.developments.at(-1)!;
  state.onboarding.developmentLinks[id] = development.id;
  sendPluginRequest(state.plugins);
  development.title = proposal?.title ?? toolCards[id].title;
}
function commitConversationImport(
  state: Simulation,
  previous: OnboardingState,
): void {
  const base = state.onboarding.importBase ?? previous.imported;
  const changed = state.onboarding.imported.filter((file) => {
    const before = base.find((item) => item.key === file.key);
    return (
      !before ||
      before.content !== file.content ||
      before.folder !== file.folder ||
      before.name !== file.name
    );
  });
  const conflict = changed.some((file) => {
    const before = base.find((item) => item.key === file.key);
    const existing = state.editor.files.find((item) => item.key === file.key);
    return (
      (!!before && !existing) ||
      (existing &&
        (!before ||
          existing.deleted ||
          existing.content !== before.content ||
          existing.folder !== before.folder ||
          existing.name !== before.name ||
          existing.draft !== existing.content)) ||
      state.editor.files.some(
        (item) =>
          !item.deleted &&
          item.key !== file.key &&
          item.folder === file.folder &&
          item.name === file.name,
      )
    );
  });
  if (conflict) {
    state.onboarding.imported = structuredClone(previous.imported);
    state.onboarding.importApproved = previous.importApproved;
    state.onboarding.importState =
      previous.importState === "ready" ? "ready" : "failed";
    state.onboarding.importConflict = true;
    state.onboarding.importHandoff.status = "idle";
    const conversation = state.onboarding.sourceConversation;
    conversation.ready = false;
    conversation.phase = "error";
    if (conversation.messages.at(-1)?.speaker === "assistant")
      conversation.messages.pop();
    return;
  }
  for (const file of changed) {
    const index = state.editor.files.findIndex((item) => item.key === file.key);
    if (index >= 0) state.editor.files[index] = structuredClone(file);
  }
}

function mergeOnboardingFiles(state: Simulation): void {
  state.onboarding.imported = state.onboarding.imported.filter((file) => {
    if (state.editor.files.some((existing) => existing.key === file.key))
      return true;
    if (
      state.editor.files.some(
        (existing) =>
          !existing.deleted &&
          existing.folder === file.folder &&
          existing.name === file.name,
      )
    ) {
      state.onboarding.importState = "failed";
      return false;
    }
    state.editor.files.push(JSON.parse(JSON.stringify(file)));
    const folders = file.folder
      .split("/")
      .map((_, i, parts) => parts.slice(0, i + 1).join("/"));
    state.editor.folders = [...new Set([...state.editor.folders, ...folders])];
    state.editor.expanded = [
      ...new Set([...state.editor.expanded, ...folders]),
    ];
    state.editor.currentKey ??= file.key;
    return true;
  });
}

function pauseImport(state: OnboardingState): void {
  if (state.support.phase === "working") {
    state.support.phase = "error";
    state.support.attempt++;
  }
  state.importHandoff.status = "idle";
  if (importWorking(state)) state.importState = "paused";
  state.sourceConversation = reduceOnboarding(state, {
    type: "source-chat",
    action: { type: "stop" },
  }).sourceConversation;
}
function finish(state: Simulation, ok: boolean): void {
  const pending = state.pending;
  if (!pending) return;
  state.pending = null;
  state.completion = { request: pending.request, ok };
  if (!ok) {
    const message =
      pending.action === "create"
        ? "The workspace could not be created. Check folder access and try again."
        : "The workspace could not be opened. Check folder access and try again.";
    if (!state.snapshot.ready || state.snapshot.error)
      state.snapshot.error = message;
    else state.error = message;
    return;
  }
  const { action, id, name } = pending;
  const snapshot = state.snapshot;
  state.error = "";
  if (action === "reload") {
    snapshot.ready = true;
    snapshot.error = null;
  } else if (action === "remove") {
    snapshot.known = snapshot.known.filter((item) => item.id !== id);
    state.removingId = null;
  } else if (action === "close") {
    for (const [owner, draft] of Object.entries(state.dictation.drafts))
      if (owner.startsWith(`${id}/`)) draft.working = false;
    const closingPlugins =
      id === snapshot.current?.id
        ? state.plugins
        : state.pluginsByWorkspace[id ?? ""];
    if (closingPlugins) interruptPluginWork(closingPlugins);
    const closingDocuments =
      id === snapshot.current?.id
        ? state.documents
        : state.documentsByWorkspace[id ?? ""];
    if (closingDocuments) interruptDocumentWork(closingDocuments);
    const closingOnboarding =
      id === snapshot.current?.id
        ? state.onboarding
        : state.onboardingByWorkspace[id ?? ""];
    if (closingOnboarding) pauseImport(closingOnboarding);
    snapshot.open = snapshot.open.filter((item) => item.id !== id);
    snapshot.failures = snapshot.failures.filter(
      (item) => item.location.id !== id,
    );
    if (snapshot.current?.id === id)
      snapshot.current = snapshot.open[0] ?? null;
    if (!snapshot.current) state.entryVisible = true;
  } else if (action === "entry") state.entryVisible = true;
  else if (action === "quit" || action === "background") {
    if (action === "quit") {
      Object.values(state.dictation.drafts).forEach((draft) => {
        draft.working = false;
      });
      interruptPluginWork(state.plugins);
      Object.values(state.pluginsByWorkspace).forEach(interruptPluginWork);
      interruptDocumentWork(state.documents);
      Object.values(state.documentsByWorkspace).forEach(interruptDocumentWork);
      pauseImport(state.onboarding);
      Object.values(state.onboardingByWorkspace).forEach(pauseImport);
    }
    // Keep the preview available when exercising native lifecycle actions.
    state.entryVisible = true;
  } else if (
    action === "open" ||
    action === "pick" ||
    action === "create" ||
    action === "regrant"
  ) {
    let workspace =
      snapshot.known.find((item) => item.id === id) ??
      snapshot.open.find((item) => item.id === id);
    if (!workspace) {
      const label =
        action === "create" ? name || "New workspace" : "Selected workspace";
      workspace = {
        id: `sample-${pending.request}`,
        name: label,
        display: `/Example/Workspaces/${label}`,
      };
    }
    if (!snapshot.known.some((item) => item.id === workspace.id))
      snapshot.known.push(workspace);
    if (!snapshot.open.some((item) => item.id === workspace.id))
      snapshot.open.push(workspace);
    if (
      state.feature === "first-entry" ||
      (action === "create" && state.creating)
    ) {
      state.feature = action === "create" ? "ai" : "workspace";
      state.firstEntry.created = action === "create";
      state.firstEntry.step = action === "create" ? "ai" : "intro";
      state.firstEntry.transitionAvailable = action === "create";
      if (action === "create") {
        state.onboardingByWorkspace[workspace.id] = createOnboardingState();
        state.ai = createAiState("providers");
        state.ai.origin = "providers";
        state.ai.mobile = snapshot.mobile;
        workspace.accent = state.firstEntry.accent;
        workspace.display = `${state.firstEntry.parent}/${workspace.name}`;
      } else {
        workspace.accent =
          state.settingsByWorkspace[workspace.id]?.accent ??
          workspace.accent ??
          "cobalt";
        state.firstEntry.accent = workspace.accent;
      }
    }
    snapshot.current = workspace;
    snapshot.failures = snapshot.failures.filter(
      (item) => item.location.id !== workspace.id,
    );
    state.entryVisible = false;
    state.creating = false;
    state.removingId = null;
  }
}

function applyModelDefaults(state: Simulation, previous?: SettingsState): void {
  for (const ai of [
    state.ai,
    state.chat.ai,
    ...Object.values(state.tabs.conversations).map(
      (conversation) => conversation.ai,
    ),
  ]) {
    applyConnectionDefaults(ai, state.settings, previous);
  }
}
export function reduceSimulation(
  previous: Simulation,
  command: Command,
): Simulation {
  if (command.type === "scenario" || command.type === "reset") {
    const reset = createSimulation(
      command.type === "scenario"
        ? command.scenario
        : (previous.conversationStart ?? previous.scenario),
      previous.snapshot.mobile,
      previous.epoch + 1,
    );
    reset.environment = { ...previous.environment };
    return reset;
  }
  const state: Simulation = JSON.parse(JSON.stringify(previous));
  if (command.type === "dictation-confirm") {
    const pending = state.dictationNavigation;
    if (
      command.discard &&
      pending?.type === "action" &&
      state.editor.files.some((file) => file.saveError)
    )
      return state;
    state.dictationNavigation = null;
    if (!command.discard) {
      if (pending?.type === "action")
        state.completion = { request: pending.operation.request, ok: false };
      return state;
    }
    state.dictation.session = null;
    return pending ? reduceSimulation(state, pending) : state;
  }
  const session = state.dictation.session;
  const closingOrigin =
    command.type === "action" &&
    (command.operation.action === "quit" ||
      (command.operation.action === "close" &&
        session?.owner.startsWith(`${command.operation.id}/`)));
  const leaving =
    (command.type === "feature" && command.feature !== state.feature) ||
    command.type === "dictation-settings" ||
    (command.type === "entry" && command.visible) ||
    (command.type === "action" &&
      ["open", "close", "quit", "entry"].includes(command.operation.action)) ||
    (command.type === "dictation" &&
      ((command.action.type === "select" &&
        `${command.action.workspace}/${command.action.chat}` !==
          session?.owner) ||
        (command.action.type === "close-pane" &&
          `${command.action.workspace}/${command.action.chat}` ===
            session?.owner)));
  if (
    session &&
    ((session.phase !== "transcribing" && leaving) || closingOrigin)
  ) {
    state.dictationNavigation ??= command;
    return state;
  }
  const previousWorkspace = state.snapshot.current?.id;
  if (previousWorkspace) {
    state.onboardingByWorkspace[previousWorkspace] = state.onboarding;
    if (state.scenario.startsWith("onboarding-"))
      state.onboardingEditors[previousWorkspace] = state.editor;
    state.settingsByWorkspace[previousWorkspace] = state.settings;
    state.pluginsByWorkspace[previousWorkspace] = state.plugins;
    state.tabsByWorkspace[previousWorkspace] = state.tabs;
    state.documentsByWorkspace[previousWorkspace] = state.documents;
  }
  switch (command.type) {
    case "recovery":
      if (command.action.type !== "restart" || !state.snapshot.mobile)
        reduceRecovery(state.recovery, command.action);
      break;
    case "auth-callback":
      reduceCallback(state.callback, command.action);
      break;
    case "update-settings":
      if (state.updates.channel !== "direct") break;
      state.feature = "settings";
      state.settings.page = "updates";
      state.settings.detail = true;
      break;
    case "updates":
      reduceUpdates(state.updates, command.action);
      if (
        command.action.type === "channel" &&
        state.updates.channel !== "direct" &&
        state.settings.page === "updates"
      ) {
        state.settings.page = "appearance";
      }
      break;
    case "setup-conversation":
      if (state.firstEntry.created && state.firstEntry.check !== "verified")
        break;
      reduceSetupConversation(state.setupConversation, command.action);
      break;
    case "dictation":
      reduceDictation(state.dictation, command.action);
      if (command.action.type === "select") {
        state.feature = "dictation";
        state.entryVisible = false;
      }
      break;
    case "dictation-file-error":
      if (command.value) state.editor = createEditorState("save-error");
      else
        state.editor.files.forEach((file) => {
          file.saveError = false;
        });
      break;
    case "dictation-settings":
      state.feature = "settings";
      state.settings.page = "dictation";
      state.settings.detail = true;
      break;
    case "components":
      state.components = { ...state.components, ...command.patch };
      break;
    case "documents":
      if (command.workspaceId !== state.snapshot.current?.id) break;
      state.documents = reconcileSourceDocuments(
        state.documents,
        command.state,
        command.base,
      );
      break;
    case "first-entry": {
      if (state.pending) break;
      const action = command.action;
      if (
        action.type === "model-result" &&
        (state.firstEntry.step !== "ai" ||
          state.firstEntry.check !== "pending" ||
          state.firstEntry.attempt !== action.attempt)
      )
        break;
      if (
        ["check-model", "model-result"].includes(action.type) &&
        (!aiConnected(state.ai) ||
          state.ai.screen !== "success" ||
          (!currentWorkspace(state.ai).model.manual &&
            !eligibleModels(state.ai).some(
              (model) => model.id === state.firstEntry.modelId,
            )))
      )
        break;
      const previousStep = state.firstEntry.step;
      state.firstEntry = reduceFirstEntry(state.firstEntry, action);
      if (action.type === "step") {
        state.error = "";
      }
      if (
        action.type === "pause-setup" &&
        previousStep === "ai" &&
        state.ai.screen !== "success"
      ) {
        if (
          ["connecting", "browser", "copy-code", "device"].includes(
            state.ai.screen,
          )
        )
          cancelConnection(state.ai);
        state.ai.values = {};
        state.ai.reveal = false;
      }
      if (state.firstEntry.created) {
        if (state.firstEntry.step === "ai") state.feature = "ai";
        if (state.firstEntry.step === "paused") state.feature = "first-entry";
        if (state.firstEntry.step === "working") {
          state.feature = "setup-conversation";
          if (previousStep === "ai") {
            state.setupConversation = createSetupConversation();
            currentWorkspace(state.ai).model.selected =
              state.firstEntry.modelId;
          }
        }
      }
      break;
    }
    case "onboarding": {
      if (
        command.workspaceId !== undefined &&
        command.workspaceId !== previousWorkspace
      )
        break;
      if (state.firstEntry.created && state.firstEntry.check !== "verified")
        break;
      const beforeImport = state.onboarding;
      if (
        command.action.type === "confirm" &&
        !beforeImport.confirmed &&
        beforeImport.step === "plan" &&
        beforeImport.support.proposals.some(
          (p) => beforeImport.support.choices[p.id] === "save",
        ) &&
        (state.editor.saveOutcome === "failure" ||
          beforeImport.support.saveOutcome === "failure")
      ) {
        state.onboarding.support.confirmError = "save";
        break;
      }
      if (
        [
          "confirm-method",
          "complete-instructions",
          "use-existing-instructions",
        ].includes(command.action.type)
      ) {
        const current = state.editor.files.find(
          (file) => !file.deleted && !file.folder && file.name === "AGENTS.md",
        );
        if (current) {
          const reviewed = state.onboarding.existingInstructions;
          state.onboarding.existingInstructions = current.draft;
          if (
            command.action.type !== "use-existing-instructions" ||
            current.draft !== current.content ||
            current.content !== reviewed
          ) {
            state.onboarding.instructionSave = "error";
            break;
          }
        }
      }
      state.onboarding = reduceOnboarding(state.onboarding, command.action);
      if (
        beforeImport.support.attempt === 0 &&
        state.onboarding.support.attempt > 0
      )
        state.onboarding.support.attempt += state.epoch * 1000000;
      if (state.onboarding.importHandoff.run > beforeImport.importHandoff.run)
        commitConversationImport(state, beforeImport);
      if (state.onboarding.hintDone) state.userHintsDone = true;
      if (!state.onboarding.connected) interruptPluginWork(state.plugins);
      if (!beforeImport.confirmed && state.onboarding.confirmed) {
        prepareOnboardingChat(state);
        for (const proposal of state.onboarding.support.proposals) {
          if (state.onboarding.support.choices[proposal.id] !== "save")
            continue;
          const note = supportNote(
            state.onboarding,
            proposal,
            state.editor.files,
          );
          state.editor.files.push(note);
          state.onboarding.support.savedNotes.push({
            key: note.key,
            title: proposal.title,
          });
        }
      }
      mergeOnboardingFiles(state);
      break;
    }
    case "plugins":
      if (
        command.workspaceId !== undefined &&
        command.workspaceId !== previousWorkspace
      )
        break;
      state.plugins = reconcile(command.base, command.state, state.plugins);
      break;
    case "tabs": {
      const before = state.tabs;
      state.tabs = reduceTabs(state.tabs, command.action);
      for (const [id, conversation] of Object.entries(
        state.tabs.conversations,
      )) {
        const old = before.conversations[id];
        applyConnectionDefaults(
          conversation.ai,
          state.settings,
          undefined,
          !old || restoresInheritance(old.ai, conversation.ai),
        );
      }
      break;
    }
    case "plugin-action":
      if (command.workspaceId !== previousWorkspace) break;
      sourcePluginAction(
        state.documents,
        state.plugins,
        command.action,
        command.id,
      );
      break;
    case "document-sources":
      if (command.workspaceId !== previousWorkspace) break;
      openSourceWorkflow(state.plugins, command.action, command.id);
      state.feature = "plugins";
      break;
    case "settings": {
      const previousSettings = state.settings;
      state.settings = reconcile(command.base, command.state, state.settings);
      applyModelDefaults(state, previousSettings);
      if (state.snapshot.current) {
        state.snapshot.current.accent = state.settings.accent;
        if (state.firstEntry.created)
          state.firstEntry.accent = state.settings.accent;
      }
      break;
    }
    case "chat-queue":
      state.chatQueue = reduceQueue(state.chatQueue, command.action);
      break;
    case "chat-answer":
      replyToQuestion(state.chat, command.response);
      break;
    case "chat": {
      const before = state.chat;
      state.chat = reconcile(command.base, command.state, state.chat);
      state.chat.ai.mobile = state.snapshot.mobile;
      if (restoresInheritance(before.ai, state.chat.ai))
        applyConnectionDefaults(state.chat.ai, state.settings, undefined, true);
      break;
    }
    case "navigation":
      state.navigation = reconcile(
        command.base,
        command.state,
        state.navigation,
      );
      break;
    case "editor":
      state.editor = reconcile(command.base, command.state, state.editor);
      break;
    case "ai":
      if (
        state.firstEntry.created &&
        state.firstEntry.step !== "ai" &&
        (state.firstEntry.check !== "verified" ||
          !state.setupConversation.confirmed)
      )
        break;
      state.ai = {
        ...reconcile(command.base, command.state, state.ai),
        mobile: state.snapshot.mobile,
      };
      if (state.ai.screen !== "providers") {
        state.firstEntry.transitionAvailable = false;
        state.firstEntry.transitionTime = null;
      }
      if (
        state.firstEntry.created &&
        state.firstEntry.step === "ai" &&
        state.ai.screen !== "success"
      ) {
        state.firstEntry.check = "idle";
        state.firstEntry.modelId = "";
        state.firstEntry.attempt++;
      }
      break;
    case "environment":
      state.environment = command.state;
      break;
    case "sidebar":
      state.sidebarCollapsed = command.collapsed;
      break;
    case "feature":
      if (state.firstEntry.created && state.firstEntry.check !== "verified")
        break;
      state.feature = command.feature;
      break;
    case "platform":
      state.snapshot.mobile = command.mobile;
      state.ai.mobile = command.mobile;
      state.chat.ai.mobile = command.mobile;
      break;
    case "outcome":
      state.nextOutcome = command.outcome;
      break;
    case "folder":
      state.folderExists = command.exists;
      break;
    case "error":
      state.error = command.error;
      break;
    case "creating":
      if (!command.value && state.firstEntry.created) break;
      if (command.value && !state.creating)
        state.firstEntry = createFirstEntry("first-entry");
      if (!command.value) {
        state.firstEntry = createFirstEntry("first-entry");
        state.feature = "workspace";
        state.entryVisible = true;
      }
      state.creating = command.value;
      state.removingId = null;
      break;
    case "removing":
      state.removingId = command.id;
      break;
    case "draft":
      state.draftName = command.name;
      break;
    case "entry":
      state.entryVisible = command.visible || !state.snapshot.current;
      break;
    case "finish":
      finish(state, command.ok);
      break;
    case "content": {
      state.content = command.content;
      const known = workspaces(command.content);
      state.snapshot.known = known;
      state.snapshot.open = known.filter((item) =>
        state.snapshot.open.some((open) => open.id === item.id),
      );
      state.snapshot.current =
        state.snapshot.open.find(
          (item) => item.id === state.snapshot.current?.id,
        ) ?? null;
      state.snapshot.failures = state.snapshot.failures.flatMap((failure) => {
        const location = known.find((item) => item.id === failure.location.id);
        return location ? [{ ...failure, location }] : [];
      });
      state.removingId = known.some((item) => item.id === state.removingId)
        ? state.removingId
        : null;
      if (!state.snapshot.current) state.entryVisible = true;
      state.pending = null;
      state.completion = null;
      state.epoch++;
      break;
    }
    case "action":
      if (command.operation.action === "background")
        reduceDictation(state.dictation, { type: "background" });
      if (state.pending) break;
      state.pending = command.operation;
      state.lastAction = command.operation.action;
      state.error = "";
      state.completion = null;
      if (state.nextOutcome !== "wait")
        finish(state, state.nextOutcome === "success");
      break;
  }
  if (
    state.feature === "onboarding" &&
    state.onboarding.confirmed &&
    state.onboarding.step === "home" &&
    state.onboarding.finale.status !== "playing"
  )
    state.feature = "chat";
  if (
    state.feature === "chat" &&
    command.type === "onboarding" &&
    ((command.action.type === "confirm" && !previous.onboarding.confirmed) ||
      (command.action.type === "finale-finish" &&
        previous.onboarding.finale.status === "playing")) &&
    state.onboarding.confirmed &&
    state.onboarding.finale.status !== "playing"
  ) {
    for (const id of state.onboarding.requestedTools) {
      if (state.onboarding.developmentLinks[id]) continue;
      startOnboardingDevelopment(state, id);
      state.onboarding.startedTools.push(id);
    }
  }
  if (state.feature === "ai" && state.ai.screen === "chat") {
    state.chat = createChatState("chat-empty");
    state.chat.ai = state.ai;
    state.chat.draft = currentWorkspace(state.ai).draft;
    state.settings.showModelPicker = currentWorkspace(state.ai).showModelPicker;
    const connection = currentWorkspace(state.ai).connection;
    state.settings.provider = connection?.provider ?? "";
    if (connection) {
      state.settings.connections[connection.provider] = connection;
      if (!state.settings.connected.includes(connection.provider))
        state.settings.connected.push(connection.provider);
    }
    state.feature = "chat";
  }
  const workspace = state.snapshot.current?.id;
  if (workspace) ensureDictationWorkspace(state.dictation, workspace);
  if (workspace !== previousWorkspace) {
    state.documents =
      (workspace && state.documentsByWorkspace[workspace]) ||
      createDocumentsState();
    state.documents.dialog = null;
    state.documents.collectionMenu = null;
    state.onboarding =
      (workspace && state.onboardingByWorkspace[workspace]) ||
      createOnboardingState("onboarding-manual");
    if (state.scenario.startsWith("onboarding-"))
      state.editor =
        (workspace && state.onboardingEditors[workspace]) ||
        createEditorState("empty");
    state.onboarding.hintOpen = false;
    state.onboarding.hintDone = state.userHintsDone;
    state.plugins =
      (workspace && state.pluginsByWorkspace[workspace]) || createPluginState();
    state.tabs =
      (workspace && state.tabsByWorkspace[workspace]) ||
      createTabsState("tabs-empty");
    const accountHasAiAccess = state.settings.managedAvailable;
    state.settings = (workspace && state.settingsByWorkspace[workspace]) || {
      ...createSettingsState(),
      accent: state.snapshot.current?.accent ?? "violet",
    };
    state.settings.managedAvailable = accountHasAiAccess;
    state.settings.dialog = null;
    state.settings.setup = null;
  }
  state.onboarding.imported = state.onboarding.imported.flatMap((file) => {
    const current = state.editor.files.find((item) => item.key === file.key);
    return current && !current.deleted ? [structuredClone(current)] : [];
  });
  state.onboarding.workspacePath =
    state.snapshot.current?.display ?? state.onboarding.workspacePath;
  syncSourceState(state.documents, state.plugins);
  return state;
}
