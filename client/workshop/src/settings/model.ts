import {
  createAiState,
  applyOutcome,
  cloneAiState,
  currentWorkspace,
  navigate,
  startConnection,
  chooseProvider,
  type AiState,
  type Connection,
} from "../ai/model";
import { gateAccess, needsReview } from "../ai/security";
import { connectionFixtures } from "../ai/scenarios";
import { providers as providerCatalog } from "../ai/providers";
export { providerName } from "../ai/content";
import { providerName } from "../ai/content";
import { attentionCopy, connectionCopy, deviceAiCopy } from "./content";
import type { ConnectionCatalog } from "./catalog";
import type { ThinkingPreference } from "../chat/thinking";

export const providerStates = [
  { id: "ready", label: "Connected", state: "settings" },
  { id: "reconnect", label: "API key needs reconnecting", state: "reconnect" },
  { id: "session", label: "Browser sign-in expired", state: "reconnect" },
  { id: "missing", label: "Local sign-in forgotten", state: "settings" },
  { id: "locked", label: "Saved sign-in locked", state: "locked" },
  {
    id: "store-denied",
    label: "Access to saved sign-in denied",
    state: "store-denied",
  },
  {
    id: "store-unavailable",
    label: "Saved sign-in unavailable",
    state: "store-unavailable",
  },
  { id: "source", label: "Sign-in source missing", state: "source" },
  {
    id: "access-denied",
    label: "Provider rejected access",
    state: "access-denied",
  },
  { id: "capability", label: "No chat models", state: "capability" },
  {
    id: "restriction",
    label: "Provider rules changed",
    state: "warning-changed",
  },
] as const;
export type ProviderState = (typeof providerStates)[number]["id"];

import appearanceCopy from "../localization/en.appearance.json" with { type: "json" };
import updateCopy from "../localization/en.updates.json" with { type: "json" };
import dictationCopy from "../localization/en.dictation.json" with { type: "json" };
import type { Accent } from "./accents";

export type SettingsPage =
  | "formats"
  | "appearance"
  | "ai"
  | "shortcuts"
  | "dictation"
  | "updates"
  | "about";
export const categories = [
  { id: "appearance", label: appearanceCopy.title, icon: "palette" },
  { id: "formats", label: "Language & formats", icon: "globe" },
  { id: "ai", label: "AI & models", icon: "sparkle" },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: "keyboard" },
  { id: "dictation", label: dictationCopy.title, icon: "mic" },
  { id: "updates", label: updateCopy.title, icon: "update" },
  { id: "about", label: updateCopy.about, icon: "info" },
] as const;
export const settingsScenarios = [
  {
    id: "settings-appearance",
    label: "Workspace accent colors",
    page: "appearance",
  },
  {
    id: "settings-appearance-light",
    label: "Light workspace accent",
    page: "appearance",
  },
  {
    id: "settings-formats",
    label: "Language and independent formats",
    page: "formats",
  },
  { id: "settings-ai", label: "AI with recommended models", page: "ai" },
  { id: "settings-advanced", label: "Manual model selection", page: "ai" },
  {
    id: "settings-empty",
    label: "No AI configured on this device",
    page: "ai",
  },
  { id: "settings-local", label: "Local model on this device", page: "ai" },
  {
    id: "settings-managed",
    label: "Situate AI available, local model selected",
    page: "ai",
  },
  { id: "settings-error", label: "Provider needs attention", page: "ai" },
  {
    id: "settings-connections",
    label: "Multiple accounts and servers",
    page: "ai",
  },
  {
    id: "settings-shortcuts",
    label: "Customize keyboard shortcuts",
    page: "shortcuts",
  },
  ...connectionFixtures.map(({ id, label }) => ({
    id,
    label,
    page: "ai" as const,
  })),
] as const;
const modelExamples: Record<string, string[]> = {
  anthropic: ["Claude Sonnet", "Claude Haiku"],
  openai: ["GPT Chat", "GPT Mini", "Example Reasoning"],
  "llama.cpp": ["Local Chat"],
  "openai-codex": ["Example Codex"],
  openrouter: ["Example Router"],
};
export const providers = providerCatalog.map((provider) => ({
  ...provider,
  models: modelExamples[provider.id] ?? [],
}));
export const dateFormats = [
  { id: "dmy-dot", label: "31.12.2026", detail: "Day · month · year" },
  { id: "dmy-slash", label: "31/12/2026", detail: "Day · month · year" },
  { id: "mdy", label: "12/31/2026", detail: "Month · day · year" },
  { id: "ymd", label: "2026-12-31", detail: "Year · month · day" },
] as const;
export const numberFormats = [
  { id: "dot-comma", label: "1,234.56" },
  { id: "comma-dot", label: "1.234,56" },
  { id: "dot-space", label: "1 234.56" },
  { id: "comma-space", label: "1 234,56" },
  { id: "dot-apostrophe", label: "1’234.56" },
] as const;
export interface Formats {
  time: "12" | "24";
  date: (typeof dateFormats)[number]["id"];
  number: (typeof numberFormats)[number]["id"];
}
export function initialFormats(
  language: "en" | "de",
  system: Partial<Formats>,
): Formats {
  const fallback: Formats =
    language === "de"
      ? { time: "24", date: "dmy-dot", number: "comma-dot" }
      : { time: "12", date: "mdy", number: "dot-comma" };
  return {
    time: system.time ?? fallback.time,
    date: system.date ?? fallback.date,
    number: system.number ?? fallback.number,
  };
}
export type SettingsConnection = Connection & { id?: string; label?: string };
export interface SettingsState {
  page: SettingsPage;
  accent: Accent;
  detail: boolean;
  language: "en" | "de";
  formats: Formats;
  connected: string[];
  connections: Record<string, SettingsConnection>;
  connectionStates: Record<string, AiState>;
  nextConnection: number;
  nextSetup: number;
  nextCatalogRequest: number;
  connectionDefaults: Record<
    string,
    { chatModel: string; activityModel: string }
  >;
  catalogs: Record<string, ConnectionCatalog>;
  modelIdDraft: string;
  nameDraft: string;
  nameError: string;
  setupProvider: string | null;
  setup: AiState | null;
  unavailable: string | null;
  provider: string;
  managedAvailable: boolean;
  useManaged: boolean;
  chatModel: string;
  thinkingDefaults: Record<string, ThinkingPreference>;
  conversationThinking: Record<string, Record<string, ThinkingPreference>>;
  showModelPicker: boolean;
  activity: boolean;
  activityModel: string;
  advanced: boolean;
  dialog: "disconnect" | "shortcut" | "rename" | null;
  target: string;
  notice: string;
  search: string;
  shortcutDraft: string;
  shortcutError: string;
  shortcuts: {
    id: string;
    name: string;
    group: string;
    keys: string;
    original: string;
  }[];
}
export function createSettingsState(
  scenario = "settings-formats",
): SettingsState {
  const state: SettingsState = {
    page: settingsScenarios.find((s) => s.id === scenario)?.page ?? "formats",
    accent: scenario === "settings-appearance-light" ? "lemon" : "violet",
    detail: scenario.startsWith("settings-appearance"),
    language: "en",
    formats: initialFormats("en", {
      time: "24",
      date: "dmy-dot",
      number: "comma-dot",
    }),
    connected: ["anthropic", "openai"],
    connections: {
      anthropic: { provider: "anthropic", method: "key" },
      openai: { provider: "openai", method: "key" },
    },
    connectionStates: {},
    nextConnection: 1,
    nextSetup: 1,
    nextCatalogRequest: 1,
    connectionDefaults: {},
    catalogs: {},
    modelIdDraft: "",
    nameDraft: "",
    nameError: "",
    setupProvider: null,
    setup: null,
    unavailable: null,
    provider: "anthropic",
    managedAvailable: false,
    useManaged: false,
    chatModel: "recommended",
    thinkingDefaults: {},
    conversationThinking: {},
    showModelPicker: false,
    activity: true,
    activityModel: "recommended",
    advanced: false,
    dialog: null,
    target: "",
    notice: "",
    search: "",
    shortcutDraft: "",
    shortcutError: "",
    shortcuts: [
      {
        id: "search",
        name: "Search workspace",
        group: "Navigation",
        keys: "Mod+K",
        original: "Mod+K",
      },
      {
        id: "chat",
        name: "New chat",
        group: "Chat",
        keys: "Mod+Shift+N",
        original: "Mod+Shift+N",
      },
      {
        id: "settings",
        name: "Open settings",
        group: "Navigation",
        keys: "Mod+,",
        original: "Mod+,",
      },
      {
        id: "sidebar",
        name: "Toggle sidebar",
        group: "Navigation",
        keys: "Mod+Shift+B",
        original: "Mod+Shift+B",
      },
    ],
  };
  if (scenario === "settings-advanced") {
    state.advanced = true;
    state.chatModel = "Claude Sonnet";
    state.showModelPicker = true;
  }
  if (scenario === "settings-empty") {
    state.connected = [];
    state.connections = {};
    state.provider = "";
  }
  if (["settings-local", "settings-managed"].includes(scenario)) {
    state.detail = true;
    state.connected = ["llama.cpp"];
    state.connections = {
      "llama.cpp": {
        provider: "llama.cpp",
        method: "none",
        endpoint: "http://127.0.0.1:8080/v1",
      },
    };
    state.provider = "llama.cpp";
    state.chatModel = "Local Chat";
    state.managedAvailable = scenario === "settings-managed";
  }
  if (scenario === "settings-connections") {
    state.detail = true;
    state.connected = ["openai", "openai-team", "local-desk", "local-lab"];
    state.connections = {
      openai: {
        id: "openai",
        provider: "openai",
        method: "key",
        label: "Personal OpenAI",
      },
      "openai-team": {
        id: "openai-team",
        provider: "openai",
        method: "browser",
        label: "Team ChatGPT",
      },
      "local-desk": {
        id: "local-desk",
        provider: "compatible",
        method: "none",
        label: "Desk server",
        endpoint: "https://desk.example.invalid/v1",
      },
      "local-lab": {
        id: "local-lab",
        provider: "compatible",
        method: "key",
        label: "Lab server",
        endpoint: "https://lab.example.invalid/v1",
      },
    };
    state.provider = "openai";
    state.advanced = true;
  }
  if (scenario === "settings-error") setProviderState(state, "reconnect");
  const fixture = connectionFixtures.find((item) => item.id === scenario);
  if (fixture) {
    const setup = createAiState(fixture.state);
    setup.origin = "settings";
    const connection = currentWorkspace(setup).connection;
    if (!connection) {
      state.connected = [];
      state.connections = {};
      state.provider = "";
      state.detail = true;
      state.setup = fixture.state === "missing" ? null : setup;
      return state;
    }
    const id = connection.provider;
    setup.provider = id;
    setup.method = connection.method;
    state.detail = true;
    state.setup = setup;
    state.setupProvider = id;
    if (!state.connected.includes(id)) state.connected.push(id);
    state.connections[id] = { ...connection };
    state.connectionStates[id] = cloneAiState(setup);
    state.unavailable = connectionIssue(state, id) ? id : null;
    state.provider = id;
  }
  return state;
}
export function setProviderState(state: SettingsState, id: ProviderState) {
  const fixture = providerStates.find((item) => item.id === id)!;
  const setup = createAiState(fixture.state);
  setup.origin = "settings";
  setup.screen = "settings";
  const current = currentWorkspace(setup);
  const connection = current.connection!;
  if (id === "reconnect") connection.provider = "anthropic";
  if (id === "session") connection.method = "browser";
  if (id === "missing") current.unavailable = "missing";
  setup.provider = connection.provider;
  setup.method = connection.method;
  state.connected = ["anthropic", "openai"];
  if (!state.connected.includes(connection.provider))
    state.connected.push(connection.provider);
  state.connections = {
    anthropic: { provider: "anthropic", method: "key" },
    openai: { provider: "openai", method: "key" },
    [connection.provider]: { ...connection },
  };
  state.connectionStates = { [connection.provider]: setup };
  state.catalogs = {};
  state.connectionDefaults = {};
  state.unavailable = connectionIssue(state, connection.provider)
    ? connection.provider
    : null;
  state.provider = connection.provider;
  state.chatModel = "recommended";
  state.activityModel = "recommended";
  state.setup = null;
  state.setupProvider = null;
  state.dialog = null;
  state.notice = "";
  state.detail = true;
}
export function currentProviderState(state: SettingsState): ProviderState {
  if (!state.unavailable) return "ready";
  const issue = connectionIssue(state, state.unavailable);
  if (
    issue === "reconnect" &&
    state.connections[state.unavailable]?.method === "browser"
  )
    return "session";
  return providerStates.some((item) => item.id === issue)
    ? (issue as ProviderState)
    : "ready";
}
export function providerAttention(state: SettingsState, id: string) {
  const issue = connectionIssue(state, id);
  return issue ? attentionCopy[issue] : undefined;
}
export function recoverProvider(state: SettingsState, id: string) {
  const issue = connectionIssue(state, id);
  if (["locked", "store-denied", "store-unavailable"].includes(issue ?? "")) {
    const saved = state.connectionStates[id];
    if (saved) saved.storeRetry = true;
  } else if (issue === "restriction") {
    openConnection(state, id, true);
    gateAccess(state.setup!, "use");
  } else if (issue && issue !== "capability") openConnection(state, id);
}
export function completeProviderRetry(state: SettingsState, id: string) {
  const saved = state.connectionStates[id];
  if (!saved?.storeRetry) return;
  applyOutcome(saved, "store-ready");
  state.notice = saved.announcement;
  if (!connectionIssue(state, id) && state.unavailable === id)
    state.unavailable = null;
}
export function selectProvider(state: SettingsState, id: string) {
  if (id === "situate") {
    if (!state.managedAvailable) return;
    state.useManaged = true;
    state.notice = deviceAiCopy.selected(deviceAiCopy.managedTitle);
    return;
  }
  if (!state.connected.includes(id)) return;
  state.useManaged = false;
  if (id === state.provider) {
    state.notice = deviceAiCopy.selected(connectionName(state, id));
    return;
  }
  rememberConnectionDefaults(state);
  state.provider = id;
  state.modelIdDraft = "";
  const defaults = state.connectionDefaults[id];
  state.chatModel = defaults?.chatModel ?? "recommended";
  state.activityModel = defaults?.activityModel ?? "recommended";
  state.notice = deviceAiCopy.selected(connectionName(state, id));
}
export function connectionIssue(state: SettingsState, provider: string) {
  const saved = state.connectionStates[provider];
  if (
    saved &&
    state.connections[provider] &&
    needsReview(saved, state.connections[provider])
  )
    return "restriction";
  return saved
    ? currentWorkspace(saved).unavailable
    : state.unavailable === provider
      ? "reconnect"
      : null;
}
export function openConnection(
  state: SettingsState,
  provider?: string,
  manage = false,
) {
  const saved = provider && state.connectionStates[provider];
  const setup = saved ? cloneAiState(saved) : createAiState("providers");
  if (provider) {
    currentWorkspace(setup).connection = state.connections[provider]
      ? { ...state.connections[provider] }
      : null;
    currentWorkspace(setup).unavailable = saved
      ? currentWorkspace(saved).unavailable
      : state.unavailable === provider
        ? "reconnect"
        : null;
    setup.provider = state.connections[provider]?.provider ?? provider;
    setup.method = state.connections[provider]?.method ?? "key";
  }
  if (manage) {
    navigate(setup, "settings");
    setup.origin = "settings";
  } else {
    startConnection(setup, "settings");
    if (provider)
      chooseProvider(setup, state.connections[provider]?.provider ?? provider);
  }
  state.setupProvider = provider ?? null;
  setup.settingsSession = state.nextSetup++;
  state.setup = setup;
  state.detail = true;
}
export function updateConnection(state: SettingsState, setup: AiState) {
  if (!state.setup || setup.settingsSession !== state.setup.settingsSession)
    return;
  state.setup = setup;
  const current = currentWorkspace(setup);
  const saved = [
    "settings",
    "restored",
    "reconnect",
    "locked",
    "success",
    "capability",
  ].includes(setup.screen);
  if (!saved && setup.warningIntent !== "use") return;
  if (!current.connection) {
    if (state.setupProvider && setup.screen === "settings") {
      state.target = state.setupProvider;
      disconnect(state);
    }
    return;
  }
  const id =
    state.setupProvider ??
    `${current.connection.provider}-${state.nextConnection++}`;
  const previous = state.connections[id];
  const connection: SettingsConnection = {
    ...current.connection,
    id,
    label: previous
      ? connectionName(state, id)
      : uniqueConnectionName(state, current.connection.provider),
  };
  if (!state.connected.includes(id)) state.connected.push(id);
  state.connections[id] = connection;
  current.connection = { ...connection };
  if (
    setup.screen === "success" ||
    (previous &&
      (previous.method !== connection.method ||
        previous.endpoint !== connection.endpoint))
  )
    delete state.catalogs[id];
  state.connectionStates[id] = cloneAiState(setup);
  state.setupProvider = id;
  if (connectionIssue(state, id)) state.unavailable = id;
  else if (state.unavailable === id) state.unavailable = null;
  if (!state.provider && !current.unavailable) selectProvider(state, id);
  if (setup.screen === "success")
    state.notice = connectionCopy.connected(connectionName(state, id));
}
export function connectionName(state: SettingsState, id: string): string {
  const connection = state.connections[id];
  return connection?.label || providerName(connection?.provider ?? id);
}
function uniqueConnectionName(state: SettingsState, provider: string): string {
  const base = providerName(provider);
  const labels = state.connected.map((id) =>
    connectionName(state, id).toLocaleLowerCase(),
  );
  let name = base;
  for (let number = 2; labels.includes(name.toLocaleLowerCase()); number++)
    name = `${base} ${number}`;
  return name;
}
function rememberConnectionDefaults(state: SettingsState) {
  if (state.provider)
    state.connectionDefaults[state.provider] = {
      chatModel: state.chatModel,
      activityModel: state.activityModel,
    };
}
export function renameConnection(state: SettingsState) {
  const connection = state.connections[state.target];
  if (!connection) return;
  const name = state.nameDraft.trim();
  if (!name || name.length > 80) {
    state.nameError = connectionCopy.nameRequired;
    return;
  }
  if (
    state.connected.some(
      (id) =>
        id !== state.target &&
        connectionName(state, id).toLocaleLowerCase() ===
          name.toLocaleLowerCase(),
    )
  ) {
    state.nameError = connectionCopy.nameDuplicate;
    return;
  }
  connection.label = name;
  const saved = state.connectionStates[state.target];
  if (saved && currentWorkspace(saved).connection)
    Object.assign(currentWorkspace(saved).connection!, { label: name });
  state.notice = connectionCopy.renamed(name);
  state.dialog = null;
  state.nameError = "";
}
export function disconnect(state: SettingsState) {
  const name = connectionName(state, state.target);
  state.connected = state.connected.filter((id) => id !== state.target);
  delete state.connections[state.target];
  delete state.connectionStates[state.target];
  delete state.catalogs[state.target];
  delete state.connectionDefaults[state.target];
  if (state.unavailable === state.target) state.unavailable = null;
  if (state.provider === state.target) {
    state.provider = "";
    state.chatModel = "recommended";
    state.activityModel = "recommended";
  }
  state.notice = deviceAiCopy.disconnected(name);
  state.dialog = null;
}
export function saveShortcut(state: SettingsState) {
  const current = state.shortcuts.find((s) => s.id === state.target);
  if (!current) return;
  const conflict = state.shortcuts.find(
    (s) => s.id !== current.id && s.keys && s.keys === state.shortcutDraft,
  );
  if (conflict) {
    state.shortcutError = `Already used for “${conflict.name}”. Choose another combination.`;
    return;
  }
  current.keys = state.shortcutDraft;
  state.dialog = null;
  state.notice = `Shortcut for ${current.name.toLowerCase()} updated.`;
}
export function cloneSettings(state: SettingsState): SettingsState {
  return JSON.parse(JSON.stringify(state));
}
