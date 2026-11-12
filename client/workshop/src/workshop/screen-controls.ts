import callbackCopy from "../localization/en.auth-callback.json" with { type: "json" };
import updateCopy from "../localization/en.updates.json" with { type: "json" };
import historyCopy from "../localization/en.work-history.json" with { type: "json" };
import setupConversationCopy from "../localization/en.setup-conversation.json" with { type: "json" };
import { setupConversationScreen } from "../onboarding/conversation-setup";
import { visibleFeedback } from "../dictation/model";
import dictationCopy from "../localization/en.dictation.json" with { type: "json" };
import componentCopy from "../localization/en.components.json" with { type: "json" };
import { documentScreenLabel } from "../documents/model";
import sourceCopy from "../localization/en.import-preparation.json" with { type: "json" };
import resultCopy from "../localization/en.import-result.json" with { type: "json" };
import supportCopy from "../localization/en.support-plan.json" with { type: "json" };
import { pluginScreenLabel, pluginIsEditing } from "../plugins/model";
import { activeTab, conversationId } from "../tabs/model";
import { categories, connectionName } from "../settings/model";
import { connectionCopy } from "../settings/content";
import appearanceCopy from "../localization/en.appearance.json" with { type: "json" };
import { hasImport } from "../onboarding/model";
import methodCopy from "../localization/en.working-method.json" with { type: "json" };
import instructionsCopy from "../localization/en.workspace-instructions.json" with { type: "json" };
import finaleCopy from "../localization/en.setup-finale.json" with { type: "json" };
import type { Simulation } from "./simulation";
import { editorIsEditing, editorScreenLabel } from "../editor/model";
import {
  navigationIsEditing,
  navigationScreenLabel,
} from "../navigation/model";
import { aiIsEditing, aiScreenLabel } from "../ai/model";

export type WorkshopScreen =
  | "recovery"
  | "auth-callback"
  | "updates"
  | "dictation"
  | "components"
  | "setup-finale"
  | "first-entry"
  | "onboarding"
  | "setup-conversation"
  | "tabs"
  | "startup"
  | "selection"
  | "creation"
  | "removal"
  | "workspace"
  | "navigation"
  | "editor"
  | "ai"
  | "settings"
  | "chat"
  | "chat-queue"
  | "documents"
  | "plugins";

type Control =
  | "recovery"
  | "auth-callback"
  | "updates"
  | "dictation"
  | "components"
  | "setup-finale"
  | "first-entry"
  | "onboarding"
  | "onboarding-import"
  | "setup-conversation"
  | "tabs"
  | "tab-model"
  | "content"
  | "error"
  | "folder"
  | "navigation"
  | "editor"
  | "ai"
  | "settings"
  | "chat"
  | "chat-queue"
  | "documents"
  | "plugins";

interface ScreenDefinition {
  label: string;
  controls: readonly Control[];
}
const screens: Record<WorkshopScreen, ScreenDefinition> = {
  recovery: { label: "Error recovery", controls: ["recovery"] },
  "auth-callback": {
    label: callbackCopy.scenario,
    controls: ["auth-callback"],
  },
  updates: { label: updateCopy.title, controls: ["updates"] },
  dictation: { label: dictationCopy.chatScenario, controls: ["dictation"] },
  components: { label: componentCopy.title, controls: ["components"] },
  "setup-finale": {
    label: finaleCopy.controls.screen,
    controls: ["setup-finale"],
  },
  "first-entry": { label: "First visit", controls: ["first-entry"] },
  onboarding: { label: "Onboarding", controls: ["onboarding"] },
  "setup-conversation": {
    label: setupConversationCopy.scenario,
    controls: ["setup-conversation"],
  },
  tabs: { label: "Tabs and panes", controls: ["tabs"] },
  chat: { label: "Chat", controls: ["chat"] },
  "chat-queue": { label: "Chat queue", controls: ["chat-queue"] },
  startup: { label: "Startup", controls: [] },
  selection: { label: "Workspace selection", controls: ["content", "error"] },
  creation: { label: "Create workspace", controls: ["error", "folder"] },
  removal: { label: "Remove confirmation", controls: ["error"] },
  workspace: { label: "Open workspace", controls: ["content", "error"] },
  navigation: { label: "Navigation", controls: ["navigation"] },
  editor: { label: "Files", controls: ["editor"] },
  ai: { label: "AI access", controls: ["ai"] },
  settings: { label: "Settings", controls: ["settings"] },
  plugins: { label: "Plugins", controls: ["plugins"] },
  documents: { label: "Documents", controls: ["documents"] },
};

export function currentScreen(state: Simulation): WorkshopScreen {
  if (state.feature === "recovery") return "recovery";
  if (!state.snapshot.ready || state.snapshot.error) return "startup";
  if (state.updates.dialog) return "updates";
  if (
    state.feature === "settings" &&
    ["updates", "about"].includes(state.settings.page)
  )
    return "updates";
  if (
    state.feature === "onboarding" &&
    state.onboarding.finale.status === "playing"
  )
    return "setup-finale";
  if (
    state.feature === "first-entry" ||
    (state.creating && state.firstEntry.step === "intro")
  )
    return "first-entry";
  if (state.snapshot.current && !state.entryVisible) return state.feature;
  if (state.removingId) return "removal";
  return state.creating ? "creation" : "selection";
}

export function screenControls(state: Simulation) {
  const screen = currentScreen(state);
  const dictationNotice =
    screen === "dictation" && !state.dictationNavigation
      ? visibleFeedback(
          state.dictation,
          state.snapshot.current?.id ?? "",
          state.snapshot.mobile,
        )
      : null;
  const topic = screen === "tabs" ? activeTab(state.tabs) : undefined;
  const pane = topic?.panes[topic.active];
  const conversation =
    pane?.availability === "ready"
      ? state.tabs.conversations[conversationId(pane)]
      : undefined;
  const modelChoices = !!conversation && conversation.id !== "garden";
  return {
    ...screens[screen],
    dictationNotice: !!dictationNotice,
    controls:
      screen === "setup-conversation" && state.setupConversation.readFile
        ? []
        : [
            ...(state.updates.enabled && screen === "chat"
              ? ["updates" as const]
              : []),
            ...((screen === "settings" &&
              state.settings.page === "dictation") ||
            (screen !== "dictation" && !!state.dictation.session) ||
            !!state.dictationNavigation
              ? ["dictation" as const]
              : []),
            ...(modelChoices
              ? (["tabs", "tab-model"] as const)
              : screens[screen].controls
            ).filter(
              (control) =>
                !(
                  control === "settings" && state.settings.page === "dictation"
                ) &&
                !(
                  control === "ai" &&
                  state.firstEntry.created &&
                  state.ai.screen === "success"
                ),
            ),
            ...(screen === "creation" && state.firstEntry.openingAvailable
              ? ["first-entry" as const]
              : []),
            ...(screen === "ai" && state.firstEntry.created
              ? ["first-entry" as const]
              : []),
            ...(screen === "first-entry" && state.firstEntry.step === "create"
              ? ["folder" as const, "error" as const]
              : []),
            ...(screen !== "onboarding" &&
            screen !== "setup-finale" &&
            (state.scenario.startsWith("onboarding-") ||
              state.firstEntry.created) &&
            hasImport(state.onboarding) &&
            state.onboarding.importState !== "ready"
              ? ["onboarding-import" as const]
              : []),
          ],
    sourceManagement:
      screen === "plugins" &&
      !state.plugins.dialog &&
      state.documents.sources.length > 0 &&
      (state.plugins.screen === "list" ||
        (state.plugins.screen === "detail" &&
          state.plugins.plugins.find((p) => p.id === state.plugins.selected)
            ?.kind === "source")),
    label:
      screen === "chat" && state.chat.workHistory
        ? historyCopy.screen
        : screen === "updates"
          ? state.updates.dialog === "release-notes"
            ? updateCopy.controls.screenNotes
            : state.updates.dialog === "force"
              ? updateCopy.controls.forceScreen
              : state.updates.preparation === "pending"
                ? updateCopy.controls.preparationScreen
                : state.updates.preparation === "blocked"
                  ? updateCopy.controls.blockedScreen
                  : state.updates.preparation === "failed" &&
                      !state.updates.dialog
                    ? updateCopy.controls.failedScreen
                    : state.updates.dialog === "restart"
                      ? updateCopy.controls.screenRestart
                      : state.updates.dialog === "sync"
                        ? updateCopy.controls.screenSync
                        : state.updates.phase === "installing"
                          ? updateCopy.controls.screenInstalling
                          : state.settings.page === "about"
                            ? updateCopy.about
                            : updateCopy.controls.screenSettings
          : screen === "setup-conversation"
            ? setupConversationScreen(state.setupConversation)
            : state.dictationNavigation
              ? dictationCopy.controls.warning
              : dictationNotice
                ? dictationCopy.controls.notice
                : screen === "onboarding"
                  ? state.onboarding.step === "samples"
                    ? state.onboarding.importFile
                      ? resultCopy.controls.fileScreen
                      : resultCopy.controls.overviewScreen
                    : state.onboarding.instructionsOpen
                      ? instructionsCopy.controls.screen
                      : state.onboarding.methodInfo
                        ? methodCopy.controls.dialogScreen.replace(
                            "{method}",
                            methodCopy.methods.find(
                              (method) =>
                                method.id === state.onboarding.methodInfo,
                            )?.name ?? "",
                          )
                        : state.onboarding.step === "source-chat"
                          ? state.onboarding.importHandoff.status === "playing"
                            ? resultCopy.controls.state
                            : sourceCopy.controls.screen
                          : state.onboarding.step === "plan"
                            ? supportCopy.controls.screen
                            : `Onboarding · ${state.onboarding.step}`
                  : modelChoices && conversation.ai.dialog === "model"
                    ? aiScreenLabel(conversation.ai)
                    : screen === "documents"
                      ? documentScreenLabel(state.documents)
                      : screen === "plugins"
                        ? pluginScreenLabel(state.plugins)
                        : screen === "settings"
                          ? state.settings.page === "ai" && state.settings.setup
                            ? aiScreenLabel(state.settings.setup)
                            : state.settings.page === "appearance"
                              ? `Settings · ${appearanceCopy.title} · ${appearanceCopy.colors[state.settings.accent]}`
                              : state.settings.dialog === "rename"
                                ? connectionCopy.renameTitle
                                : state.settings.dialog === "disconnect"
                                  ? `Disconnect ${connectionName(state.settings, state.settings.target)}`
                                  : `Settings · ${categories.find((c) => c.id === state.settings.page)?.label}`
                          : screen === "ai"
                            ? aiScreenLabel(state.ai)
                            : screen === "editor"
                              ? editorScreenLabel(state.editor)
                              : screen === "navigation"
                                ? navigationScreenLabel(state.navigation)
                                : topic?.maximized
                                  ? "Tabs and panes · maximized pane"
                                  : screens[screen].label,
    editing:
      screen === "recovery" ||
      screen === "setup-conversation" ||
      screen === "components" ||
      (screen === "first-entry" && state.firstEntry.step === "create") ||
      (screen === "onboarding" &&
        !state.onboarding.methodInfo &&
        !state.onboarding.instructionsOpen &&
        !state.onboarding.importFile &&
        (["method", "proposal", "sources", "source-chat", "note"].includes(
          state.onboarding.step,
        ) ||
          (state.onboarding.step === "samples" &&
            state.onboarding.imported.length > 50))) ||
      (screen === "ai" &&
        state.firstEntry.created &&
        state.ai.screen === "success") ||
      screen === "tabs" ||
      (screen === "documents" &&
        (!!state.documents.dialog ||
          !!state.documents.tagCreation ||
          !!state.documents.tagDeletion ||
          !!state.documents.collectionMenu ||
          !state.documents.selected)) ||
      (screen === "dictation" && !state.dictationNavigation) ||
      screen === "chat-queue" ||
      screen === "chat" ||
      (screen === "plugins" &&
        !state.plugins.generalError &&
        pluginIsEditing(state.plugins)) ||
      (screen === "settings" &&
        (state.settings.page === "ai" && state.settings.setup
          ? aiIsEditing(state.settings.setup)
          : state.settings.page === "shortcuts" ||
            state.settings.dialog === "rename" ||
            (state.settings.page === "ai" &&
              state.settings.advanced &&
              ["compatible", "llama.cpp"].includes(
                state.settings.connections[state.settings.provider]?.provider ??
                  "",
              )))) ||
      screen === "creation" ||
      (screen === "ai" && aiIsEditing(state.ai)) ||
      (screen === "editor" && editorIsEditing(state.editor)) ||
      (screen === "navigation" && navigationIsEditing(state.navigation)),
    canSetOutcome:
      screen !== "updates" &&
      screen !== "setup-conversation" &&
      screen !== "components" &&
      screen !== "setup-finale" &&
      (screen !== "first-entry" || state.firstEntry.step === "create") &&
      screen !== "onboarding" &&
      screen !== "tabs" &&
      screen !== "documents" &&
      screen !== "dictation" &&
      screen !== "chat-queue" &&
      screen !== "chat" &&
      screen !== "plugins" &&
      screen !== "settings" &&
      screen !== "ai" &&
      screen !== "editor" &&
      screen !== "navigation" &&
      !state.pending &&
      (screen !== "startup" || !!(state.snapshot.error || state.error)),
    canComplete: !!state.pending,
  };
}
