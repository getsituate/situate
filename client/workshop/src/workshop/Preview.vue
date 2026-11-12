<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  shallowRef,
  ref,
} from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { SituateButton, SituateIcon } from "../ui";
import ConversationSetup from "../onboarding/ConversationSetup.vue";
import setupConversationCopy from "../localization/en.setup-conversation.json";
import AuthCallbackView from "../auth-callback/AuthCallbackView.vue";
import RecoveryView from "../error-recovery/RecoveryView.vue";
import ComponentLibraryView from "../component-library/ComponentLibraryView.vue";
import AppSurface from "../components/AppSurface.vue";
import FirstEntry from "../workspaces/FirstEntry.vue";
import FirstSetup from "../workspaces/FirstSetup.vue";
import { finaleTiming } from "../workspaces/setup-journey/finale/score";
import FileEditorView from "../editor/FileEditorView.vue";
import DocumentsView from "../documents/DocumentsView.vue";
import { c as documentContent } from "../documents/content";
import AiView from "../ai/AiView.vue";
import OnboardingView from "../onboarding/OnboardingView.vue";
import { guided, hasImport } from "../onboarding/model";
import ImportStatus from "../onboarding/ImportStatus.vue";
import { f as onboardingFlow } from "../onboarding/flow-content";
import { selectFile } from "../editor/model";
import SettingsView from "../settings/SettingsView.vue";
import { accentStyle } from "../settings/accents";
import ChatModelPicker from "../settings/ChatModelPicker.vue";
import ChatView from "../chat/ChatView.vue";
import DictationView from "../dictation/DictationView.vue";
import DictationDialog from "../dictation/DictationDialog.vue";
import { copy as dictationCopy } from "../dictation/content";
import QueueView from "../chat-queue/QueueView.vue";
import TabsView from "../tabs/TabsView.vue";
import tabCopy from "../localization/en.tabs.json";
import NavigationView from "../navigation/NavigationView.vue";
import NavigationSidebar from "../navigation/NavigationSidebar.vue";
import PreviewEnvironment from "./platform/PreviewEnvironment.vue";
import { useVisualViewport } from "../use-visual-viewport";
import type { RunAction } from "../workspaces/api";
import { workspaceFormServices } from "../workspaces/form-services";
import { reduceSimulation, type Command, type Simulation } from "./simulation";
import { connect, viewport, type Transport } from "./transport";
import PluginView from "../plugins/PluginView.vue";
import UpdateNotice from "../updates/UpdateNotice.vue";
import UpdateDialogs from "../updates/UpdateDialogs.vue";
import type { UpdateAction } from "../updates/model";
import PluginSidebar from "../plugins/PluginSidebar.vue";

defineOptions({ name: "WorkshopPreview" });
const topicsView = ref<InstanceType<typeof TabsView>>();
const initialMove = ref(false);
function navigateTopics() {
  dispatch({ type: "feature", feature: "tabs" });
  void nextTick(() => topicsView.value?.focusPaneHeader());
}
useVisualViewport();
const state = shallowRef<Simulation | null>(null);
const onboardingSession = computed(
  () =>
    state.value?.firstEntry.created ||
    state.value?.scenario.startsWith("onboarding-"),
);
const finaleTime = ref(0);
const finaleActive = computed(
  () =>
    state.value?.feature === "onboarding" &&
    state.value.onboarding.finale.status === "playing",
);
const finale = computed(() => finaleTiming(finaleTime.value));
const onboardingChat = ref<InstanceType<typeof ChatView>>();
const setupVisible = computed(() => {
  const s = state.value;
  return (
    !!s &&
    (finaleActive.value ||
      ((s.creating || s.feature === "first-entry") &&
        s.firstEntry.step === "create") ||
      (s.feature === "onboarding" &&
        guided(s.onboarding) &&
        s.onboarding.presentation === "companion") ||
      (s.firstEntry.created &&
        (s.feature === "first-entry" ||
          s.feature === "ai" ||
          (s.feature === "onboarding" && guided(s.onboarding)))))
  );
});
const workspaceVisible = computed(() => {
  const s = state.value;
  return (
    !!s &&
    (finaleActive.value ||
      (!setupVisible.value &&
        !s.creating &&
        ![
          "first-entry",
          "ai",
          "components",
          "setup-conversation",
          "auth-callback",
          "recovery",
        ].includes(s.feature) &&
        !(s.feature === "onboarding" && guided(s.onboarding))))
  );
});
let transport: Transport | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let alive = true;
let host = "";
let revision = -1;
let sequence = 0;
let optimistic: { sequence: number; command: Command }[] = [];
const requests = new Map<
  string,
  { resolve: (ok: boolean) => void; epoch: number; host: string }
>();
const removing = computed(
  () =>
    state.value?.snapshot.known.find(
      (item) => item.id === state.value?.removingId,
    ) ?? null,
);
function dispatch(command: Command): void {
  if (!state.value || !transport) return;
  const current = state.value;
  if (command.type === "onboarding")
    command = { ...command, workspaceId: current.snapshot.current?.id ?? "" };
  if (command.type === "chat") command = { ...command, base: current.chat };
  if (command.type === "documents")
    command = { ...command, base: current.documents };
  if (command.type === "plugins")
    command = {
      ...command,
      base: current.plugins,
      workspaceId: current.snapshot.current?.id ?? "",
    };
  if (command.type === "navigation")
    command = { ...command, base: current.navigation };
  if (command.type === "editor") command = { ...command, base: current.editor };
  if (command.type === "ai") command = { ...command, base: current.ai };
  if (command.type === "settings")
    command = { ...command, base: current.settings };
  const next = ++sequence;
  optimistic.push({ sequence: next, command });
  state.value = reduceSimulation(current, command);
  if (
    !current.onboarding.confirmed &&
    state.value.onboarding.confirmed &&
    state.value.feature === "chat"
  )
    void nextTick(() => onboardingChat.value?.focusTitle());
  if (
    (current.creating || current.feature === "first-entry") &&
    state.value.feature === "workspace" &&
    !state.value.creating &&
    !state.value.firstEntry.created
  )
    void nextTick(() => {
      document
        .querySelector<HTMLButtonElement>(".workspace-entry .primary-choice")
        ?.focus();
    });
  void transport.send({
    type: "command",
    command,
    host,
    epoch: current.epoch,
    sequence: next,
  });
}
function openUpdateSettings(): void {
  dispatch({ type: "update-settings" });
  void nextTick(() =>
    document.querySelector<HTMLElement>(".settings-page-heading h2")?.focus(),
  );
}
function updateAction(action: UpdateAction): void {
  dispatch({ type: "updates", action });
}
function navigateShared(): void {
  if (!state.value) return;
  const current = state.value;
  const conversation =
    (current.scenario.startsWith("chat-") &&
      !current.scenario.startsWith("chat-queue-")) ||
    current.scenario.startsWith("ai-chat-") ||
    current.ai.screen === "chat" ||
    (onboardingSession.value && current.onboarding.confirmed);
  const tab = current.navigation.tabs.find(
    (tab) => tab.id === current.navigation.activeTab,
  );
  dispatch({
    type: "feature",
    feature: conversation && tab?.kind === "chat" ? "chat" : "navigation",
  });
}
function openPlugins(): void {
  if (!state.value) return;
  dispatch({
    type: "plugins",
    state: {
      ...state.value.plugins,
      screen: "list",
      listSection: "tools",
      returnToDocuments: false,
    },
  });
  dispatch({ type: "feature", feature: "plugins" });
}
async function announce(): Promise<void> {
  const size = viewport();
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const native = (await getCurrentWindow().innerSize()).toLogical(
      window.devicePixelRatio,
    );
    size.insetWidth = Math.max(0, native.width - window.innerWidth);
    size.insetHeight = Math.max(0, native.height - window.innerHeight);
  }
  if (alive) await transport?.send({ type: "hello", viewport: size });
}
const run: RunAction = (action, id, name) =>
  new Promise((resolve) => {
    if (!transport || !state.value || state.value.pending || requests.size) {
      resolve(false);
      return;
    }
    const request = crypto.randomUUID();
    requests.set(request, { resolve, epoch: state.value.epoch, host });
    void transport
      .send({
        type: "command",
        host,
        epoch: state.value.epoch,
        sequence: ++sequence,
        command: { type: "action", operation: { request, action, id, name } },
      })
      .catch(() => {
        requests.delete(request);
        resolve(false);
      });
  });
let parentFolder = "/Example/Workspaces";
provide(workspaceFormServices, {
  validationKey: () => state.value?.folderExists,
  async chooseParent(pick) {
    parentFolder = pick ? "/Example/Selected folder" : "/Example/Workspaces";
    return { id: "example-parent", name: "Workspaces", display: parentFolder };
  },
  async preflight(_parent, name) {
    if (state.value?.folderExists) throw "This folder already exists.";
    return `${parentFolder}/${name}`;
  },
});

onMounted(async () => {
  const connection = await connect("preview", (message) => {
    if (message.type === "resize") {
      window.resizeTo(
        message.width + window.outerWidth - window.innerWidth,
        message.height + window.outerHeight - window.innerHeight,
      );
      void announce();
      return;
    }
    if (
      message.type !== "state" ||
      (message.host === host && message.revision <= revision)
    )
      return;
    if (host !== message.host || state.value?.epoch !== message.state.epoch) {
      optimistic = [];
      initialMove.value = message.state.scenario === "tabs-move-pane";
    } else
      optimistic = optimistic.filter(
        (item) => item.sequence > message.acknowledged,
      );
    host = message.host;
    revision = message.revision;
    sequence = Math.max(sequence, message.acknowledged);
    state.value = optimistic.reduce(
      (current, item) => reduceSimulation(current, item.command),
      message.state,
    );
    for (const [request, pending] of requests) {
      if (message.state.completion?.request === request) {
        requests.delete(request);
        pending.resolve(message.state.completion.ok);
      } else if (
        pending.host !== host ||
        pending.epoch !== message.state.epoch
      ) {
        requests.delete(request);
        pending.resolve(false);
      }
    }
  });
  if (!alive) {
    connection.close();
    return;
  }
  transport = connection;
  void announce();
  timer = setInterval(onResize, 1000);
  window.addEventListener("resize", onResize);
});
const onResize = () => {
  void announce();
};
onBeforeUnmount(() => {
  alive = false;
  if (timer) clearInterval(timer);
  window.removeEventListener("resize", onResize);
  transport?.close();
  for (const pending of requests.values()) pending.resolve(false);
  requests.clear();
});
function openOnboardingDevelopment(id: string) {
  if (!state.value) return;
  dispatch({
    type: "plugins",
    state: { ...state.value.plugins, screen: "development", developmentId: id },
  });
  dispatch({ type: "feature", feature: "plugins" });
}
function openImportedFile(key: string) {
  if (!state.value) return;
  const editor = JSON.parse(JSON.stringify(state.value.editor));
  selectFile(editor, key);
  dispatch({ type: "editor", state: editor });
  dispatch({ type: "feature", feature: "editor" });
}
function openImport() {
  dispatch({
    type: "onboarding",
    action: state.value?.onboarding.sourceConversation.messages.length
      ? { type: "open-source-chat" }
      : { type: "patch", patch: { step: "import-chat" } },
  });
  dispatch({ type: "feature", feature: "onboarding" });
}
</script>

<template>
  <PreviewEnvironment
    v-if="state"
    :state="state.environment"
    :data-workspace-accent="
      state.snapshot.current && !state.entryVisible && state.feature !== 'ai'
        ? state.settings.accent
        : undefined
    "
    :style="
      state.snapshot.current && !state.entryVisible && state.feature !== 'ai'
        ? accentStyle(state.settings.accent)
        : {}
    "
  >
    <div class="scene-stack">
      <div class="scene-content">
        <ConversationSetup
          v-if="state.feature === 'setup-conversation' || setupVisible"
          :key="`conversation-setup-${host}-${state.epoch}`"
          :state="state.setupConversation"
          :workspace-name="state.snapshot.current?.name ?? 'Field notes'"
          :mobile="state.snapshot.mobile"
          :entry="
            state.firstEntry.created ||
            state.creating ||
            state.feature === 'first-entry'
              ? state.firstEntry
              : undefined
          "
          :preparation-step="
            setupVisible
              ? state.firstEntry.step === 'create'
                ? 0
                : 1
              : undefined
          "
          @action="dispatch({ type: 'setup-conversation', action: $event })"
          @entry-action="dispatch({ type: 'first-entry', action: $event })"
          @navigate="dispatch({ type: 'feature', feature: $event })"
        >
          <template #preparation="{ step }">
            <FirstEntry
              v-if="step === 0"
              embedded
              :state="{ ...state.firstEntry, step: 'create', created: false }"
              :run="run"
              :busy="!!state.pending"
              :error="state.error"
              :name="state.draftName"
              @update:name="dispatch({ type: 'draft', name: $event })"
              @action="dispatch({ type: 'first-entry', action: $event })"
              @cancel="dispatch({ type: 'creating', value: false })"
            />
            <FirstSetup
              v-else
              embedded
              :state="{
                ...state.firstEntry,
                step: state.firstEntry.step === 'paused' ? 'paused' : 'ai',
              }"
              :ai="state.ai"
              :onboarding="state.onboarding"
              :workspace="state.snapshot.current?.name ?? state.draftName"
              @action="dispatch({ type: 'first-entry', action: $event })"
              @ai="dispatch({ type: 'ai', state: $event })"
            />
          </template>
        </ConversationSetup>
        <RecoveryView
          v-else-if="state.feature === 'recovery'"
          :key="`recovery-${host}-${state.epoch}`"
          :state="state.recovery"
          :mobile="state.snapshot.mobile"
          @action="dispatch({ type: 'recovery', action: $event })"
        />
        <AuthCallbackView
          v-else-if="state.feature === 'auth-callback'"
          :key="`callback-${host}-${state.epoch}`"
          :state="state.callback"
          @action="dispatch({ type: 'auth-callback', action: $event })"
        />
        <ComponentLibraryView
          v-else-if="state.feature === 'components'"
          :key="`${host}-${state.epoch}`"
          :state="state.components"
          @patch="dispatch({ type: 'components', patch: $event })"
        />
        <FirstEntry
          v-else-if="state.feature === 'first-entry' || state.creating"
          :key="`${host}-${state.epoch}`"
          :state="state.firstEntry"
          :run="run"
          :busy="!!state.pending"
          :error="state.error"
          :name="state.draftName"
          @update:name="dispatch({ type: 'draft', name: $event })"
          @action="dispatch({ type: 'first-entry', action: $event })"
          @cancel="dispatch({ type: 'creating', value: false })"
        />
        <OnboardingView
          v-else-if="state.feature === 'onboarding' && guided(state.onboarding)"
          :key="`${host}-${state.epoch}`"
          :state="state.onboarding"
          :developments="state.plugins.developments"
          @action="dispatch({ type: 'onboarding', action: $event })"
          @development="openOnboardingDevelopment"
          @file="openImportedFile"
        />
        <AiView
          v-else-if="state.feature === 'ai'"
          :key="`${host}-${state.epoch}`"
          :state="state.ai"
          @update:state="dispatch({ type: 'ai', state: $event })"
        />
        <div
          v-if="workspaceVisible"
          class="workspace-destination"
          :style="
            finaleActive
              ? {
                  transform: `scale(${finale.workspaceScale})`,
                  transformOrigin: '50% 50%',
                }
              : undefined
          "
          :inert="finaleActive ? true : undefined"
          :aria-hidden="finaleActive ? true : undefined"
        >
          <AppSurface
            :key="`${host}-${state.epoch}`"
            :state="state.snapshot"
            :run="run"
            :busy="!!state.pending"
            :collapsible="state.feature !== 'workspace'"
            :collapsed="state.sidebarCollapsed"
            @update:collapsed="dispatch({ type: 'sidebar', collapsed: $event })"
            :error="state.error"
            :entry-visible="state.entryVisible"
            retry-available
            settings-available
            plugins-available
            @plugins="openPlugins"
            :settings-active="
              state.feature === 'settings' ||
              (state.feature === 'plugins' &&
                state.plugins.screen !== 'development')
            "
            @settings="dispatch({ type: 'feature', feature: 'settings' })"
            :creating="state.creating"
            :removing="removing"
            :draft-name="state.draftName"
            @update:creating="dispatch({ type: 'creating', value: $event })"
            @update:removing="
              dispatch({ type: 'removing', id: $event?.id ?? null })
            "
            @update:draft-name="dispatch({ type: 'draft', name: $event })"
            @back="dispatch({ type: 'entry', visible: false })"
            @opened="dispatch({ type: 'entry', visible: false })"
            @workspaces="dispatch({ type: 'entry', visible: true })"
            @retry="run('reload')"
          >
            <template
              v-if="state.feature !== 'workspace'"
              #default="navigation"
            >
              <TabsView
                v-if="state.feature === 'tabs'"
                ref="topicsView"
                :show-navigation="navigation.showNavigation"
                :key="state.snapshot.current?.id"
                :state="state.tabs"
                :initial-move="initialMove"
                @initial-move-opened="initialMove = false"
                :mobile="state.snapshot.mobile"
                :workspace-name="state.snapshot.current?.name ?? 'Field notes'"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                @action="dispatch({ type: 'tabs', action: $event })"
                @open-navigation="navigation.openNavigation"
              />
              <OnboardingView
                v-else-if="state.feature === 'onboarding' && !finaleActive"
                :show-navigation="navigation.showNavigation"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                @open-navigation="navigation.openNavigation"
                :state="state.onboarding"
                :developments="state.plugins.developments"
                @action="dispatch({ type: 'onboarding', action: $event })"
                @development="openOnboardingDevelopment"
                @file="openImportedFile"
              />
              <PluginView
                v-else-if="state.feature === 'plugins'"
                :state="state.plugins"
                :documents="state.documents"
                @abort="
                  dispatch({
                    type: 'plugin-action',
                    action: 'abort',
                    id: $event,
                    workspaceId: state.snapshot.current?.id ?? '',
                  })
                "
                :mobile="state.snapshot.mobile"
                :workspace-name="state.snapshot.current?.name ?? 'Field notes'"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                :show-navigation="navigation.showNavigation"
                @update:state="dispatch({ type: 'plugins', state: $event })"
                @open-navigation="navigation.openNavigation"
                @settings="dispatch({ type: 'feature', feature: 'settings' })"
                @update:documents="
                  dispatch({
                    type: 'documents',
                    state: $event,
                    workspaceId: state.snapshot.current?.id ?? '',
                  })
                "
                @documents="dispatch({ type: 'feature', feature: 'documents' })"
              />
              <DictationView
                v-else-if="state.feature === 'dictation'"
                :state="state.dictation"
                :covered="!!state.dictationNavigation"
                :workspace="state.snapshot.current!.id"
                :mobile="state.snapshot.mobile"
                :show-navigation="navigation.showNavigation"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                @open-navigation="navigation.openNavigation"
                @action="dispatch({ type: 'dictation', action: $event })"
                @settings="dispatch({ type: 'dictation-settings' })"
              />
              <SettingsView
                v-else-if="state.feature === 'settings'"
                :state="state.settings"
                :dictation="state.dictation"
                :updates="state.updates"
                @update-action="updateAction"
                @dictation-action="
                  dispatch({ type: 'dictation', action: $event })
                "
                :mobile="state.snapshot.mobile"
                :workspace-name="state.snapshot.current?.name ?? 'Field notes'"
                :mac="
                  state.environment.profile === 'mac' ||
                  state.environment.profile === 'ios'
                "
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                :show-navigation="navigation.showNavigation"
                @update:state="dispatch({ type: 'settings', state: $event })"
                @plugins="openPlugins"
                @open-navigation="navigation.openNavigation"
              />
              <DocumentsView
                v-else-if="state.feature === 'documents'"
                :key="state.snapshot.current?.id"
                :state="state.documents"
                :mobile="state.snapshot.mobile"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                :show-navigation="navigation.showNavigation"
                @update:state="
                  dispatch({
                    type: 'documents',
                    state: $event,
                    workspaceId: state.snapshot.current?.id ?? '',
                  })
                "
                @open-navigation="navigation.openNavigation"
                @sources="
                  (action, id) =>
                    dispatch({
                      type: 'document-sources',
                      action,
                      id,
                      workspaceId: state?.snapshot.current?.id ?? '',
                    })
                "
              />
              <FileEditorView
                v-else-if="state.feature === 'editor'"
                :state="state.editor"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                :show-navigation="navigation.showNavigation"
                @update:state="dispatch({ type: 'editor', state: $event })"
                @open-navigation="navigation.openNavigation"
              />
              <QueueView
                v-else-if="state.feature === 'chat-queue'"
                :state="state.chatQueue"
                :show-navigation="navigation.showNavigation"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                @action="dispatch({ type: 'chat-queue', action: $event })"
                @open-navigation="navigation.openNavigation"
              />
              <ChatView
                v-else-if="state.feature === 'chat' || finaleActive"
                ref="onboardingChat"
                :state="state.chat"
                :show-navigation="navigation.showNavigation"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                @update:state="dispatch({ type: 'chat', state: $event })"
                @answer="dispatch({ type: 'chat-answer', response: $event })"
                @open-navigation="navigation.openNavigation"
              />
              <NavigationView
                v-else
                :state="state.navigation"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                :show-navigation="navigation.showNavigation"
                @update:state="dispatch({ type: 'navigation', state: $event })"
                @open-navigation="navigation.openNavigation"
              >
                <template #chat-options="{ conversationId }"
                  ><ChatModelPicker
                    :conversation-id="conversationId"
                    :state="state.settings"
                    @update:state="
                      dispatch({ type: 'settings', state: $event })
                    "
                /></template>
              </NavigationView>
            </template>
            <template
              v-if="state.feature !== 'workspace'"
              #sidebar-content="sidebar"
            >
              <SituateButton
                variant="plain"
                v-if="
                  state.scenario.startsWith('tabs-') && state.feature !== 'tabs'
                "
                type="button"
                class="feature-link"
                @click="
                  dispatch({ type: 'feature', feature: 'tabs' });
                  sidebar.closeNavigation();
                "
              >
                <SituateIcon name="split" />{{ tabCopy.backToTabs }}
              </SituateButton>
              <SituateButton
                variant="plain"
                v-if="!state.scenario.startsWith('tabs-')"
                type="button"
                class="feature-link"
                :aria-current="state.feature === 'editor' ? 'page' : undefined"
                @click="
                  dispatch({ type: 'feature', feature: 'editor' });
                  sidebar.closeNavigation();
                "
              >
                <SituateIcon name="folder" />Files
              </SituateButton>
              <SituateButton
                variant="plain"
                v-if="!state.scenario.startsWith('tabs-')"
                type="button"
                class="feature-link"
                :aria-current="
                  state.feature === 'documents' ? 'page' : undefined
                "
                @click="
                  dispatch({ type: 'feature', feature: 'documents' });
                  sidebar.closeNavigation();
                "
              >
                <SituateIcon name="notes" />{{ documentContent.title }}
              </SituateButton>
              <template v-if="state.scenario.startsWith('dictation-')">
                <SituateButton
                  v-for="chat in ['a', 'b'] as const"
                  :key="chat"
                  variant="plain"
                  class="feature-link"
                  :aria-current="
                    state.feature === 'dictation' &&
                    state.dictation.selected[state.snapshot.current!.id] ===
                      chat
                      ? 'page'
                      : undefined
                  "
                  @click="
                    ($event.currentTarget as HTMLElement).focus();
                    dispatch({
                      type: 'dictation',
                      action: {
                        type: 'select',
                        workspace: state.snapshot.current!.id,
                        chat,
                      },
                    });
                    sidebar.closeNavigation();
                  "
                >
                  <SituateIcon name="chat" />{{
                    chat === "a"
                      ? dictationCopy(state.dictation.language).chatA
                      : dictationCopy(state.dictation.language).chatB
                  }}
                </SituateButton>
              </template>
              <NavigationSidebar
                v-else
                :state="state.navigation"
                :topics="
                  state.scenario.startsWith('tabs-') ? state.tabs : undefined
                "
                @topic-action="dispatch({ type: 'tabs', action: $event })"
                :hidden-views="
                  state.scenario.startsWith('tabs-') ? [] : ['documents']
                "
                @update:state="dispatch({ type: 'navigation', state: $event })"
                @navigate="
                  state.scenario.startsWith('tabs-')
                    ? navigateTopics()
                    : navigateShared();
                  sidebar.closeNavigation();
                "
              >
                <template #conversation-items>
                  <SituateButton
                    v-if="
                      state.setupConversation.entered ||
                      state.scenario.startsWith('setup-conversation-')
                    "
                    variant="plain"
                    class="feature-link"
                    @click="
                      dispatch({
                        type: 'feature',
                        feature: 'setup-conversation',
                      });
                      sidebar.closeNavigation();
                    "
                    >{{ setupConversationCopy.title }}</SituateButton
                  >
                  <SituateButton
                    variant="plain"
                    v-if="
                      onboardingSession &&
                      (hasImport(state.onboarding) ||
                        state.onboarding.sourceConversation.messages.length)
                    "
                    class="feature-link"
                    @click="
                      openImport();
                      sidebar.closeNavigation();
                    "
                  >
                    {{ onboardingFlow.importTitle }}
                  </SituateButton>

                  <PluginSidebar
                    :state="state.plugins"
                    :active="state.feature === 'plugins'"
                    @update:state="dispatch({ type: 'plugins', state: $event })"
                    @navigate="
                      dispatch({ type: 'feature', feature: 'plugins' });
                      sidebar.closeNavigation();
                    "
                  />
                </template>
              </NavigationSidebar>
            </template>
          </AppSurface>
        </div>
      </div>
      <DictationDialog
        v-if="state.dictationNavigation"
        :state="state.dictation"
        :file-blocked="
          state.dictationNavigation.type === 'action' &&
          state.editor.files.some((file) => file.saveError)
        "
        :agent-working="
          state.dictationNavigation.type === 'action' &&
          Object.values(state.dictation.drafts).some((draft) => draft.working)
        "
        @review-file="
          dispatch({ type: 'dictation-confirm', discard: false });
          dispatch({ type: 'feature', feature: 'editor' });
        "
        @decide="dispatch({ type: 'dictation-confirm', discard: $event })"
      />
      <UpdateNotice
        v-if="
          state.updates.enabled && state.snapshot.current && !state.entryVisible
        "
        :state="state.updates"
        :above-composer="
          ['chat', 'chat-queue', 'dictation', 'tabs'].includes(state.feature)
        "
        @open="openUpdateSettings"
      />
      <UpdateDialogs :state="state.updates" @action="updateAction" />
      <ImportStatus
        v-if="
          onboardingSession &&
          hasImport(state.onboarding) &&
          state.onboarding.importState !== 'ready' &&
          !(
            state.feature === 'onboarding' &&
            (['source-chat', 'samples'].includes(state.onboarding.step) ||
              (state.onboarding.step === 'import-chat' &&
                state.onboarding.sourceConversation.messages.length))
          )
        "
        :inert="finaleActive ? true : undefined"
        :aria-hidden="finaleActive ? true : undefined"
        :state="state.onboarding"
        @open="openImport"
      />
    </div>
  </PreviewEnvironment>
</template>

<style scoped>
.scene-stack {
  position: relative;
  background: var(--situate-paper);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.workspace-destination {
  height: 100%;
  min-height: 0;
}
.scene-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.feature-link {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 12px;
  border: 0;
  border-radius: var(--situate-radius-control);
  background: transparent;
  color: var(--situate-ink);
  text-align: left;
  font-size: var(--situate-text-small);
}
.feature-link[aria-current="page"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
</style>
