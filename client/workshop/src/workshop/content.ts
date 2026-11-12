import callbackCopy from "../localization/en.auth-callback.json" with { type: "json" };
import updateCopy from "../localization/en.updates.json" with { type: "json" };
import dictationCopy from "../localization/en.dictation.json" with { type: "json" };
import componentCopy from "../localization/en.components.json" with { type: "json" };

export const scenarioBrowser = {
  selected: "Selected scenario",
  state: "Starting state",
  stateHelp:
    "Loading a state replaces example data and clears current interactions. Platform and window size stay unchanged.",
  states: {
    "settings-appearance": "Default accent · Violet",
    "settings-appearance-light": "Light accent · Lemon",
    "tabs-overview": "Three tabs with a three-pane arrangement",
    "tabs-single-topic": "One tab with three panes",
    "tabs-multiple-topics": "Single-pane tab selected",
    "tabs-empty": "Empty tab",
    "tabs-no-pins": "Empty tab without pinned views",
    "tabs-all-pins": "All views pinned",
    "tabs-new-chat": "New conversation in a pane",
    "tabs-many": "Many tabs with long names",
    "tabs-loading": "Active pane loading",
    "tabs-unavailable": "Active pane unavailable",
    "tabs-maximized": "Maximized pane with history",
    "tabs-maximized-many": "Maximized arrangement with twelve panes",
    "tabs-move-pane": "Move pane dialog open",
    "documents-sources": "Sources · opened from Documents",
    "documents-connect": "New source · opened from Documents",
    "ai-settings": "Connection details",
    "ai-restored": "Reopened connection",
    "ai-warning-changed": "Changed restriction before existing access",
    "ai-session-replacement": "Sign-in would affect another device",
    "ai-missing": "New device · AI not configured",
  },
  screens: {
    recovery: "Error recovery",
    authCallback: callbackCopy.scenario,
    updates: updateCopy.controls.scenario,
    releaseNotes: updateCopy.controls.notesScenario,
    components: componentCopy.title,
    onboardingWelcome: "01 · Welcome",
    onboardingCreate: "02 · Create a workspace",
    onboardingAi: "03 · Connect AI",
    onboardingModel: "04 · Verify a model",
    onboardingConversation: "05 · Set up your workspace",
    tabs: "Arrange tabs and panes",
    collection: "Document collection",
    reading: "Read a document",
    createTag: "Create a tag",
    deleteTag: "Delete a tag",
    chat: "Conversation",
    dictation: dictationCopy.chatScenario,
    dictationDownload: dictationCopy.settingsScenario,
    queue: "Pending chat messages",
    workspaces: "Choose a workspace",
    createWorkspace: "Create a workspace",
    removeWorkspace: "Remove a workspace listing",
    startup: "Start the app",
    navigation: "Workspace navigation",
    files: "File editor",
    conflicts: "Resolve file conflicts",
    plugins: "Installed plugins",
    pluginFiles: "Plugin files",
    pluginSettings: "Plugin settings",
    development: "Develop a plugin",
    appearance: "Workspace appearance",
    formats: "Language and formats",
    models: "AI settings",
    shortcuts: "Keyboard shortcuts",
    aiSetup: "Connect an AI provider",
  },
  search: "Search scenarios",
  find: "Find a scenario",
  filtered: "Find a scenario · filters active",
  searchHint: "Name, topic or state…",
  groups: "Scenario topics",
  all: "All topics",
  scenario: "Scenario",
  results: (count: number) =>
    `${count} ${count === 1 ? "scenario" : "scenarios"}`,
  empty: "No scenarios match these filters.",
  clear: "Clear filters",
} as const;

export const workshopSettings = {
  aiHelp:
    "Activity generation is provisional. Recommendations and model lists are illustrative, not provider policy. Adding or reconnecting a provider opens the shared AI-access flow and controls for its current screen. The chat-picker setting applies to the navigation chat reached through the sidebar. Connection details and recovery use the same Settings surface.",
} as const;

export const workshopNavigation = {
  openNavigation: "Open navigation",
  plugins: "Plugins",
  pluginsUnavailable: "Plugins are unavailable.",
} as const;
