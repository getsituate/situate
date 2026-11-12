import {
  canonicalScenario,
  scenarioAliases,
  scenarios,
  type Scenario,
} from "./simulation";
import { scenarioBrowser as c } from "./content";

type Definition = {
  name: keyof typeof c.screens;
  topic: (typeof scenarios)[number]["group"];
  states: readonly [Scenario, ...Scenario[]];
};
const definitions = [
  {
    name: "recovery",
    topic: "Interface",
    states: [
      "recovery-pane",
      "recovery-unexpected",
      "recovery-report",
      "recovery-mail-unavailable",
      "recovery-restart",
      "recovery-startup",
    ],
  },
  {
    name: "authCallback",
    topic: "Interface",
    states: ["auth-callback-received", "auth-callback-rejected"],
  },
  {
    name: "updates",
    topic: "Settings",
    states: [
      "updates-notice",
      "updates-settings",
      "updates-current",
      "updates-checking",
      "updates-downloading",
      "updates-check-failed",
      "updates-restart",
      "updates-sync",
      "updates-installing",
      "updates-managed",
    ],
  },
  {
    name: "releaseNotes",
    topic: "Settings",
    states: [
      "release-notes-direct",
      "release-notes-homebrew",
      "release-notes-store",
      "release-notes-skipped",
    ],
  },
  {
    name: "dictation",
    topic: "Chat",
    states: [
      "dictation-ready",
      "dictation-recording",
      "dictation-transcribing",
      "dictation-selection",
      "dictation-split",
      "dictation-permission",
      "dictation-denied",
      "dictation-silence",
      "dictation-failed",
      "dictation-interrupted",
      "dictation-offline",
      "dictation-agent",
      "dictation-close-files",
      "dictation-close-agent",
    ],
  },
  {
    name: "dictationDownload",
    topic: "Settings",
    states: [
      "dictation-download-waiting",
      "dictation-download-active",
      "dictation-download-paused",
      "dictation-download-preparing",
      "dictation-download-failed",
      "dictation-download-storage",
      "dictation-download-ready",
    ],
  },
  {
    name: "components",
    topic: "Interface",
    states: [
      "components-ready",
      "components-disabled",
      "components-error",
      "components-loading",
      "components-empty",
      "components-success",
    ],
  },
  {
    name: "onboardingWelcome",
    topic: "Onboarding",
    states: ["first-entry"],
  },
  {
    name: "onboardingCreate",
    topic: "Onboarding",
    states: ["first-entry-create"],
  },
  {
    name: "onboardingAi",
    topic: "Onboarding",
    states: ["first-entry-ai"],
  },
  {
    name: "onboardingModel",
    topic: "Onboarding",
    states: ["first-entry-model", "first-entry-paused"],
  },
  {
    name: "onboardingConversation",
    topic: "Onboarding",
    states: [
      "setup-conversation-brief",
      "setup-conversation-fresh",
      "setup-conversation-keep",
      "setup-conversation-proposal",
      "setup-conversation-import",
      "setup-conversation-app",
      "setup-conversation-blocked",
      "setup-conversation-partial",
      "setup-conversation-support",
      "setup-conversation-finale",
    ],
  },
  {
    name: "tabs",
    topic: "Tabs and panes",
    states: [
      "tabs-overview",
      "tabs-single-topic",
      "tabs-multiple-topics",
      "tabs-empty",
      "tabs-no-pins",
      "tabs-all-pins",
      "tabs-new-chat",
      "tabs-many",
      "tabs-loading",
      "tabs-unavailable",
      "tabs-maximized",
      "tabs-maximized-many",
      "tabs-move-pane",
    ],
  },
  {
    name: "collection",
    topic: "Documents",
    states: [
      "documents-find",
      "documents-gather",
      "documents-results",
      "documents-previews-loading",
      "documents-previews-missing",
      "documents-empty",
      "documents-no-results",
      "documents-loading",
      "documents-error",
      "documents-no-tags",
      "documents-tag-removed",
    ],
  },
  {
    name: "reading",
    topic: "Documents",
    states: ["documents-preview", "documents-image", "documents-unavailable"],
  },
  {
    name: "createTag",
    topic: "Documents",
    states: [
      "documents-new-tag",
      "documents-new-document-tag",
      "documents-tag-duplicate",
    ],
  },
  {
    name: "deleteTag",
    topic: "Documents",
    states: [
      "documents-delete-tag",
      "documents-delete-branch",
      "documents-tag-delete-conflict",
    ],
  },
  {
    name: "chat",
    topic: "Chat",
    states: [
      "chat-work-history",
      "chat-empty",
      "chat-work-history-working",
      "chat-question",
      "chat-work-history-approval",
      "chat-work-history-changes",
      "chat-plugin-available",
      "chat-work-history-cancelled",
      "chat-work-history-error",
      "ai-chat-unconfigured",
    ],
  },
  {
    name: "queue",
    topic: "Chat",
    states: [
      "chat-queue-mixed",
      "chat-queue-long",
      "chat-queue-compacting",
      "chat-queue-stopped",
    ],
  },
  {
    name: "workspaces",
    topic: "Workspaces",
    states: [
      "workspaces",
      "opening",
      "access-error",
      "restore-error",
      "invalid-folder",
    ],
  },
  {
    name: "createWorkspace",
    topic: "Workspaces",
    states: ["create", "collision", "create-error"],
  },
  { name: "removeWorkspace", topic: "Workspaces", states: ["remove"] },
  {
    name: "startup",
    topic: "Workspaces",
    states: ["startup", "startup-error"],
  },
  {
    name: "navigation",
    topic: "Navigation",
    states: [
      "navigation-dashboard",
      "navigation-chat",
      "navigation-draft",
      "navigation-empty",
      "workspace",
    ],
  },
  {
    name: "files",
    topic: "Files and editing",
    states: [
      "files-read",
      "files-source",
      "files-chat",
      "files-history",
      "files-save-error",
      "files-empty",
      "files-merged",
    ],
  },
  {
    name: "conflicts",
    topic: "Files and editing",
    states: ["files-conflict", "files-conflict-failure", "files-conflict-race"],
  },
  {
    name: "plugins",
    topic: "Plugins",
    states: [
      "plugins-list",
      "plugins-connections",
      "plugins-sources",
      "plugins-empty",
      "plugins-sources-empty",
      "plugins-disabled",
      "plugins-uninstall",
      "plugins-uninstall-dependencies",
      "plugins-uninstall-running",
      "plugins-uninstall-pending",
      "plugins-uninstall-error",
      "plugins-uninstall-disabled",
      "plugins-disable-waiting",
      "plugins-disable-stopping",
      "plugins-disable-error",
      "plugins-disable-uncertain",
      "plugins-list-illustrated",
      "plugins-connections-illustrated",
      "documents-sources",
    ],
  },
  {
    name: "pluginFiles",
    topic: "Plugins",
    states: [
      "plugins-files",
      "plugins-files-loading",
      "plugins-files-error",
      "plugins-files-empty",
    ],
  },
  {
    name: "pluginSettings",
    topic: "Plugins",
    states: [
      "plugins-source-detail",
      "plugins-source-disabled",
      "plugins-connection-empty",
      "plugins-connection-error",
      "plugins-connection-platform",
    ],
  },
  {
    name: "development",
    topic: "Plugins",
    states: [
      "plugins-create",
      "plugins-development",
      "plugins-development-connection-only",
      "plugins-development-reuse",
      "plugins-development-missing-connection",
      "plugins-development-shared-change",
      "plugins-development-system-change",
      "plugins-development-parallel",
      "plugins-development-changes",
      "plugins-development-workspace-files",
      "plugins-development-activation",
      "plugins-development-access-needed",
      "plugins-general-error",
      "plugins-interrupted",
      "plugins-error",
      "plugins-success",
      "plugins-source-create",
      "plugins-source-error",
      "plugins-source-success",
      "documents-connect",
    ],
  },
  {
    name: "appearance",
    topic: "Settings",
    states: ["settings-appearance", "settings-appearance-light"],
  },
  { name: "formats", topic: "Settings", states: ["settings-formats"] },
  {
    name: "models",
    topic: "Settings",
    states: [
      "settings-ai",
      "settings-advanced",
      "settings-connections",
      "settings-empty",
      "settings-local",
      "settings-managed",
      "settings-error",
      "ai-settings",
      "ai-restored",
      "ai-reconnect",
      "ai-locked",
      "ai-missing",
      "ai-store-denied",
      "ai-store-unavailable",
      "ai-source",
      "ai-access-denied",
      "ai-capability",
      "ai-warning-changed",
      "ai-session-replacement",
    ],
  },
  { name: "shortcuts", topic: "Settings", states: ["settings-shortcuts"] },
  {
    name: "aiSetup",
    topic: "AI access",
    states: [
      "ai-providers",
      "ai-offer",
      "ai-methods",
      "ai-key",
      "ai-browser",
      "ai-copy-code",
      "ai-device",
      "ai-cloud",
      "ai-endpoint",
      "ai-advanced",
      "ai-warning",
      "ai-warning-device",
      "ai-blocked-subscription",
      "ai-unsupported",
      "ai-connecting",
      "ai-success",
      "ai-cancelled",
      "ai-denied",
      "ai-expired",
      "ai-offline",
      "ai-save-error",
    ],
  },
] as const satisfies readonly Definition[];

export const scenarioCatalog = definitions.map((definition) => ({
  id: definition.states[0],
  label: c.screens[definition.name],
  group: definition.topic,
  states: definition.states.map((id) => {
    const preset = scenarios.find((s) => s.id === id)!;
    const label =
      id in c.states
        ? c.states[id as keyof typeof c.states]
        : preset.label.replace(/^(Plugins|Chat) · /, "");
    return { id, label: label.charAt(0).toUpperCase() + label.slice(1) };
  }),
}));
export type CatalogScenario = (typeof scenarioCatalog)[number];
export function scenarioForState(id: Scenario): CatalogScenario {
  return scenarioCatalog.find((item) =>
    item.states.some((state) => state.id === canonicalScenario(id)),
  )!;
}
export function matchingScenarios(query: string): CatalogScenario[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return scenarioCatalog.filter((item) =>
    terms.every((term) =>
      `${item.group} ${item.label} ${item.states.map((state) => `${state.id} ${state.label}`).join(" ")} ${Object.entries(
        scenarioAliases,
      )
        .filter(([, target]) =>
          item.states.some((state) => state.id === target),
        )
        .map(([alias]) => alias)
        .join(" ")}`
        .toLocaleLowerCase()
        .includes(term),
    ),
  );
}
