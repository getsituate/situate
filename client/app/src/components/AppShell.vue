<script setup lang="ts">
import {
  dictationSettingsRequested,
  guardDictation,
} from "../dictation/runtime";
import {
  t,
  localizeError,
  type LocalizationSnapshot,
  type MessageKey,
  type Preferences,
} from "@situate/localization";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import {
  workspaceConversations,
  workspaceChat,
  discardUnsentChat,
} from "../ai/chat";
import { captureReference } from "../ai/content-references";
import AppSidebar from "./AppSidebar.vue";
import ErrorActions from "../errors/ErrorActions.vue";
const PluginManagement = defineAsyncComponent(
  () => import("../plugins/PluginManagement.vue"),
);
import {
  SituateDialog,
  SituateDialogActions,
  SituateButton,
  SituateIconButton,
  SituateResizeHandle,
} from "@situate/ui";
const SettingsView = defineAsyncComponent(
  () => import("../settings/SettingsView.vue"),
);
import type { Accent, AppearanceSnapshot } from "../settings/accents";
import type { Workspace } from "../workspaces/api";
import { workspaceUi } from "../layout/runtime";
import {
  selectedTab,
  tabHasActivity,
  type LayoutIntent,
  type PaneAddress,
} from "../layout/model";
import { currentEntry, type ViewTarget } from "../layout/navigation";
const WorkspaceLayout = defineAsyncComponent(
  () => import("../layout/components/WorkspaceLayout.vue"),
);
import ViewHost from "../layout/ViewHost.vue";
import {
  safeFileTarget,
  type FilePaneReference,
  type FilePaneIdentityChange,
} from "../files/presentation";

const props = defineProps<{
  workspaceName?: string;
  openWorkspaces?: Workspace[];
  currentWorkspaceId?: string;
  mobile?: boolean;
  localization?: LocalizationSnapshot | null;
  localizationLoading?: boolean;
  localizationSaving?: boolean;
  localizationError?: MessageKey | "";
  appearance?: AppearanceSnapshot | null;
  accent?: Accent;
  appearanceLoading?: boolean;
  appearanceSaving?: boolean;
  appearanceError?: MessageKey | "";
}>();
const emit = defineEmits<{
  workspaces: [];
  closeWorkspace: [];
  openWorkspace: [id: string];
  connect: [];
  preferences: [value: Preferences];
  retryLocalization: [];
  accent: [value: Accent];
  retryAppearance: [];
}>();
const ui = computed(() =>
  props.currentWorkspaceId ? workspaceUi(props.currentWorkspaceId) : undefined,
);
const conversations = computed(() =>
  props.currentWorkspaceId
    ? workspaceConversations(props.currentWorkspaceId)
    : undefined,
);
const document = computed(() => ui.value?.session.state.document);
const activeTab = computed(() =>
  document.value ? selectedTab(document.value.layout) : undefined,
);
const activeTarget = computed(() => {
  const pane = activeTab.value?.panes.find(
    (pane) => pane.id === activeTab.value?.activePaneId,
  );
  return pane ? currentEntry(pane.navigation).target : undefined;
});
const viewChoices = computed(() =>
  [...(ui.value?.registry.definitions.values() ?? [])]
    .filter((view) => !["conversation", "empty"].includes(view.id))
    .map((view) => ({ id: view.id, title: view.title(), icon: view.icon })),
);
const media = window.matchMedia("(min-width: 1184px)");
const wide = ref(media.matches);
const sidebarCollapsed = ref(false);
const sidebarWidth = ref(300);
const sidebarId = useId();
const navigationOpen = ref(false);
const settingsVisible = ref(false);
const pendingUpdatesPage = ref(false);
async function showUpdates(): Promise<void> {
  if (!(await showSettings())) return;
  pendingUpdatesPage.value = true;
  await nextTick();
  if (settings.value) {
    await settings.value.openUpdates();
    pendingUpdatesPage.value = false;
  }
}
const pendingDictationPage = ref(false);
watch(dictationSettingsRequested, async () => {
  pendingDictationPage.value = true;
  await showSettings();
  await nextTick();
  if (settings.value) {
    await settings.value.openDictation();
    pendingDictationPage.value = false;
  }
});
const pluginsVisible = ref(false);
const inspectedPlugin = ref<string>();
async function showPlugins(id?: string) {
  if (!management.value || !(await guardDictation(props.currentWorkspaceId)))
    return;
  closeNavigation();
  settingsVisible.value = false;
  inspectedPlugin.value = id;
  pluginsVisible.value = true;
}
let workspaceGeneration = 0;
const management = computed(() => {
  const scope = props.currentWorkspaceId;
  const owner = ui.value;
  const chats = conversations.value;
  const generation = workspaceGeneration;
  if (!scope || !owner || !chats) return;
  const current = () =>
    ui.value === owner && generation === workspaceGeneration;
  return {
    scope,
    async onDevelop(pluginId?: string) {
      if (!current()) return;
      await owner.session.load();
      if (!current()) return;
      const ticket = owner.session.capture();
      const id = await chats.createDevelopment(pluginId);
      if (!id || !current() || !owner.session.current(ticket)) return;
      const opened = await owner.coordinator.open(
        { kind: "new-conversation", conversationId: id },
        ticket,
      );
      if (!opened || !current()) return;
      pluginsVisible.value = false;
      settingsVisible.value = false;
      await focusView();
    },
  };
});
async function closePlugins() {
  pluginsVisible.value = false;
  await nextTick();
  shell.value
    ?.querySelector<HTMLButtonElement>(".plugins-action, .open-navigation")
    ?.focus();
}
const operationError = ref<unknown>("");
const navigationId = useId();
const drawerControl =
  useTemplateRef<InstanceType<typeof SituateDialog>>("drawerControl");
const drawer = computed(() => drawerControl.value?.element);
const shell = useTemplateRef<HTMLElement>("shell");
const settings = useTemplateRef<InstanceType<typeof SettingsView>>("settings");
watch(settings, (view) => {
  if (view && pendingUpdatesPage.value) {
    pendingUpdatesPage.value = false;
    void view.openUpdates();
  }
  if (view && pendingDictationPage.value) {
    pendingDictationPage.value = false;
    void view.openDictation();
  }
});
const pluginManagement =
  useTemplateRef<InstanceType<typeof PluginManagement>>("pluginManagement");
async function managementOpened() {
  pluginsVisible.value = false;
  settingsVisible.value = false;
  await focusView();
}
const layout = useTemplateRef<InstanceType<typeof WorkspaceLayout>>("layout");
let viewFocusPending = false;
const reloadDialogControl = useTemplateRef<InstanceType<typeof SituateDialog>>(
  "reloadDialogControl",
);
const reloadDialog = computed(() => reloadDialogControl.value?.element);
watch(
  () => props.currentWorkspaceId,
  () => {
    ++workspaceGeneration;
    pluginsVisible.value = false;
    settingsVisible.value = false;
    operationError.value = "";
    closeNavigation();
    void conversations.value?.refresh();
    void ui.value?.session.load();
  },
  { immediate: true },
);
function closeNavigation() {
  const opened = drawer.value?.open;
  drawer.value?.close();
  navigationOpen.value = false;
  if (opened) focusNavigation();
}
async function focusView() {
  await nextTick();
  viewFocusPending = !layout.value;
  layout.value?.focusPaneHeader();
}
async function open(target: ViewTarget) {
  if (!(await guardDictation(props.currentWorkspaceId))) return;
  closeNavigation();
  pluginsVisible.value = false;
  settingsVisible.value = false;
  operationError.value = "";
  try {
    await ui.value?.coordinator.open(target);
    await focusView();
  } catch (error) {
    operationError.value = error;
  }
}
async function newConversation(
  address?: PaneAddress,
  reference?: FilePaneReference,
) {
  const owner = ui.value,
    chats = conversations.value;
  if (!owner || !chats || !(await guardDictation(props.currentWorkspaceId)))
    return;
  await owner.session.load();
  const ticket = owner.session.capture(address);
  closeNavigation();
  pluginsVisible.value = false;
  settingsVisible.value = false;
  operationError.value = "";
  let draftId: string | undefined;
  let opened = false;
  try {
    const captured =
      reference?.kind === "live"
        ? await captureReference(
            owner.session.workspaceId,
            reference.path,
            reference.expectedRevision,
          )
        : reference;
    if (ui.value !== owner || !owner.session.current(ticket)) return;
    const id = await chats.create();
    draftId = id;
    if (!id || !owner.session.current(ticket)) return;
    if (captured)
      await workspaceChat(owner.session.workspaceId, id).addReference(captured);
    if (ui.value !== owner || !owner.session.current(ticket)) return;
    opened = await owner.coordinator.open(
      { kind: "new-conversation", conversationId: id },
      ticket,
    );
    await focusView();
  } catch (error) {
    if (ui.value === owner) operationError.value = error;
  } finally {
    if (draftId && !opened)
      discardUnsentChat(owner.session.workspaceId, draftId);
  }
}
function reference(value: unknown, address: PaneAddress) {
  const item = value as FilePaneReference;
  if (
    !item ||
    item.workspaceId !== props.currentWorkspaceId ||
    !safeFileTarget(item.path) ||
    !["live", "historical"].includes(item.kind) ||
    (item.kind === "live" &&
      (typeof item.expectedRevision !== "string" || !item.expectedRevision)) ||
    (item.kind === "historical" && !item.revision)
  )
    return;
  void newConversation(address, item);
}
function identity(value: unknown) {
  const change = value as FilePaneIdentityChange;
  if (
    !change ||
    change.workspaceId !== props.currentWorkspaceId ||
    change.kind !== "rename" ||
    !safeFileTarget(change.from) ||
    !safeFileTarget(change.to)
  )
    return;
  const renamed = (path: string) =>
    path === change.from || path.startsWith(`${change.from}/`)
      ? change.to + path.slice(change.from.length)
      : path;
  ui.value?.session.mapTargets((target) =>
    target.kind === "view" &&
    target.viewId === "files" &&
    target.contentId &&
    !target.revision
      ? { ...target, contentId: renamed(target.contentId) }
      : target,
  );
}
function intent(
  value: LayoutIntent,
  diagnostic?: import("../diagnostics").Context,
) {
  ui.value?.coordinator.dispatch(value, diagnostic);
}
function hasActivity(tabId: string) {
  const tab = document.value?.layout.tabs.find((tab) => tab.id === tabId);
  return (
    !!tab && tabHasActivity(tab, (id) => !!conversations.value?.running(id))
  );
}
function showWorkspaces() {
  closeNavigation();
  emit("workspaces");
}
function closeWorkspace() {
  closeNavigation();
  emit("closeWorkspace");
}
function openWorkspace(id: string) {
  closeNavigation();
  emit("openWorkspace", id);
}
async function showSettings(): Promise<boolean> {
  if (!(await guardDictation(props.currentWorkspaceId))) return false;
  closeNavigation();
  pluginsVisible.value = false;
  settingsVisible.value = true;
  return true;
}
async function closeSettings() {
  settingsVisible.value = false;
  await nextTick();
  shell.value
    ?.querySelector<HTMLButtonElement>(".settings-action, .open-navigation")
    ?.focus();
}
async function openNavigation(event: MouseEvent) {
  viewFocusPending = false;
  if (wide.value) {
    sidebarCollapsed.value = false;
    await nextTick();
    shell.value
      ?.querySelector<HTMLButtonElement>(".collapse-navigation")
      ?.focus();
    return;
  }
  (event.currentTarget as HTMLElement | null)?.focus();
  drawer.value?.showModal();
  navigationOpen.value = true;
}
async function collapseNavigation() {
  sidebarCollapsed.value = true;
  await nextTick();
  shell.value?.querySelector<HTMLButtonElement>(".open-navigation")?.focus();
}
function updateLayout(event: MediaQueryListEvent) {
  const restoreFocus =
    navigationOpen.value ||
    !!shell.value
      ?.querySelector(".desktop-sidebar")
      ?.contains(window.document.activeElement);
  wide.value = event.matches;
  if (wide.value) closeNavigation();
  if (restoreFocus)
    void nextTick(() => {
      if (!wide.value)
        shell.value
          ?.querySelector<HTMLButtonElement>(".open-navigation")
          ?.focus();
      else void focusView();
    });
}
function back(): boolean {
  if (navigationOpen.value) {
    closeNavigation();
    return true;
  }
  if (pluginsVisible.value) {
    if (pluginManagement.value?.back()) return true;
    void closePlugins();
    return true;
  }
  if (settingsVisible.value) {
    settings.value?.back();
    return true;
  }
  if (layout.value?.back()) return true;
  const tab = activeTab.value;
  const pane = tab?.panes.find((item) => item.id === tab.activePaneId);
  if (tab && pane && pane.navigation.cursor > 0) {
    intent({ type: "history", tabId: tab.id, paneId: pane.id, delta: -1 });
    return true;
  }
  return false;
}
let navigationFocusPending = false;
function focusNavigation(): void {
  viewFocusPending = false;
  const target = shell.value?.querySelector<HTMLButtonElement>(
    ".desktop-sidebar .workspace-menu, .open-navigation",
  );
  navigationFocusPending = !target;
  target?.focus();
}
watch(layout, () => {
  if (
    navigationFocusPending ||
    shell.value
      ?.querySelector(".layout-recovery-header")
      ?.contains(window.document.activeElement)
  )
    void nextTick(focusNavigation);
  else if (viewFocusPending && layout.value) void focusView();
});
async function revealConversation(conversationId: string): Promise<void> {
  const owner = ui.value;
  if (!owner) throw new Error("plugins.workspaceUnavailable");
  await owner.coordinator.open(
    { kind: "conversation", conversationId },
    owner.session.capture(),
  );
  if (
    ui.value !== owner ||
    activeTarget.value?.kind !== "conversation" ||
    activeTarget.value.conversationId !== conversationId
  )
    throw new Error("plugins.workspaceUnavailable");
  pluginsVisible.value = false;
  settingsVisible.value = false;
  await nextTick();
  await focusView();
}
defineExpose({
  back,
  focusNavigation,
  showPlugins,
  showUpdates,
  revealConversation,
});
onMounted(() => media.addEventListener("change", updateLayout));
onBeforeUnmount(() => {
  media.removeEventListener("change", updateLayout);
  closeNavigation();
});
const sidebar = computed(() => ({
  workspaceName: props.workspaceName,
  openWorkspaces: props.openWorkspaces,
  currentWorkspaceId: props.currentWorkspaceId,
  mobile: props.mobile,
  conversations: conversations.value?.state.conversations,
  selectedConversation:
    !settingsVisible.value &&
    !pluginsVisible.value &&
    activeTarget.value?.kind === "conversation"
      ? activeTarget.value.conversationId
      : undefined,
  conversationsBusy:
    conversations.value?.state.loading || conversations.value?.state.creating,
  conversationsError: conversations.value?.state.error,
  conversationRunning: conversations.value?.running,
  filesActive:
    !settingsVisible.value &&
    !pluginsVisible.value &&
    activeTarget.value?.kind === "view" &&
    activeTarget.value.viewId === "files",
  settingsActive: settingsVisible.value,
  pluginsActive: pluginsVisible.value,
  availableViews: viewChoices.value,
  pluginsAvailable: !!management.value,
  pinnedViews: document.value?.pinnedViews ?? [],
  activeView:
    !settingsVisible.value &&
    !pluginsVisible.value &&
    activeTarget.value?.kind === "view"
      ? activeTarget.value.viewId
      : undefined,
}));
const sidebarActions = {
  conversation: (id: string) =>
    open({ kind: "conversation", conversationId: id }),
  newConversation: () => newConversation(),
  retryConversations: () => conversations.value?.refresh(),
  files: () => open({ kind: "view", viewId: "files" }),
  view: (id: string) => open({ kind: "view", viewId: id }),
  pin: (id: string) => ui.value?.session.pin(id),
  workspaces: showWorkspaces,
  closeWorkspace,
  openWorkspace,
  connect: showSettings,
  plugins: () => {
    void showPlugins();
  },
  collapse: collapseNavigation,
  close: closeNavigation,
};
</script>

<template>
  <div
    ref="shell"
    class="app-shell"
    :class="{ 'sidebar-collapsed': wide && sidebarCollapsed }"
  >
    <aside
      v-if="wide && !sidebarCollapsed"
      :id="sidebarId"
      class="desktop-sidebar"
      :style="{ flexBasis: `${sidebarWidth}px` }"
    >
      <AppSidebar v-bind="sidebar" v-on="sidebarActions" />
      <SituateResizeHandle
        v-model="sidebarWidth"
        :min="224"
        :max="480"
        :reset-value="300"
        :label="t('navigation.resizeSidebar')"
        :controls="sidebarId"
      />
    </aside>
    <section
      v-if="ui && !settingsVisible && !pluginsVisible"
      class="workspace-content"
    >
      <slot name="setup" />
      <header
        v-if="!layout && (!wide || sidebarCollapsed)"
        class="layout-recovery-header"
      >
        <SituateIconButton
          class="open-navigation"
          icon="menu"
          :label="t('navigation.openNavigation')"
          :aria-controls="navigationId"
          :aria-expanded="navigationOpen"
          @click="openNavigation"
        />
      </header>
      <div
        v-if="ui.session.state.error || operationError"
        class="layout-notice"
        role="alert"
      >
        <span>{{
          localizeError(operationError || ui.session.state.error)
        }}</span>
        <SituateButton
          variant="plain"
          type="button"
          @click="
            operationError = '';
            ui.session.retry();
          "
        >
          {{ t("layoutHost.retry") }}
        </SituateButton>
        <SituateButton
          variant="plain"
          v-if="document"
          type="button"
          @click="reloadDialog?.showModal()"
        >
          {{ t("layoutHost.reload") }}
        </SituateButton>
        <ErrorActions
          boundary="workspace"
          :error="operationError || ui.session.state.error"
          :scope="ui.session.workspaceId"
        />
      </div>
      <p v-if="ui.session.state.loading && !document" role="status">
        {{ t("layoutHost.loading") }}
      </p>
      <WorkspaceLayout
        v-if="document"
        ref="layout"
        :state="document.layout"
        :workspace-id="ui.session.workspaceId"
        :mobile="mobile"
        :title-for="ui.titleFor"
        :has-activity="hasActivity"
        :show-navigation="!wide || sidebarCollapsed"
        :navigation-id="navigationId"
        :navigation-open="navigationOpen"
        @intent="intent"
        @navigation="openNavigation"
      >
        <template #pane="{ pane, tab }"
          ><ViewHost
            :ui="ui"
            :pane="pane"
            :tab="tab"
            :workspace-name="workspaceName ?? ''"
            @new-conversation="
              newConversation({ tabId: tab.id, paneId: pane.id })
            "
            @reference="reference($event, { tabId: tab.id, paneId: pane.id })"
            @identity="identity"
            @error="operationError = $event"
            @plugins="showPlugins($event)"
        /></template>
      </WorkspaceLayout>
      <SituateDialog
        ref="reloadDialogControl"
        class="layout-confirmation"
        :aria-label="t('layoutHost.reloadTitle')"
        @cancel.prevent="reloadDialog?.close()"
      >
        <h2>{{ t("layoutHost.reloadTitle") }}</h2>
        <p>{{ t("layoutHost.reloadHelp") }}</p>
        <SituateDialogActions
          ><SituateButton
            variant="secondary"
            type="button"
            autofocus
            @click="reloadDialog?.close()"
          >
            {{ t("layoutHost.cancel") }}
          </SituateButton>
          <SituateButton
            variant="primary"
            type="button"
            @click="
              reloadDialog?.close();
              ui.session.reload();
            "
          >
            {{ t("layoutHost.reload") }}
          </SituateButton>
        </SituateDialogActions>
      </SituateDialog>
    </section>
    <SettingsView
      v-if="settingsVisible"
      ref="settings"
      :workspace-scope="currentWorkspaceId"
      :workspace-name="workspaceName"
      :appearance="appearance"
      :accent="accent"
      :appearance-loading="appearanceLoading"
      :appearance-saving="appearanceSaving"
      :appearance-error="appearanceError"
      @accent="emit('accent', $event)"
      @retry-appearance="emit('retryAppearance')"
      :snapshot="localization ?? null"
      :loading="localizationLoading ?? false"
      :saving="localizationSaving ?? false"
      :error="localizationError ?? ''"
      :show-navigation="!wide || sidebarCollapsed"
      :navigation-id="navigationId"
      :navigation-open="navigationOpen"
      @navigation="openNavigation"
      @close="closeSettings"
      @plugins="showPlugins()"
      @connect="emit('connect')"
      @change="emit('preferences', $event)"
      @retry="emit('retryLocalization')"
    />
    <section v-if="pluginsVisible && management" class="workspace-content">
      <header v-if="!wide || sidebarCollapsed" class="layout-recovery-header">
        <SituateIconButton
          class="open-navigation"
          icon="menu"
          :label="t('navigation.openNavigation')"
          :aria-controls="navigationId"
          :aria-expanded="navigationOpen"
          @click="openNavigation"
        />
      </header>
      <PluginManagement
        :key="management.scope"
        ref="pluginManagement"
        :selected-plugin="inspectedPlugin"
        v-bind="management"
        @opened="managementOpened"
      />
    </section>
    <SituateDialog
      appearance="plain"
      :id="navigationId"
      ref="drawerControl"
      class="navigation-drawer"
      :aria-label="t('navigation.workspaceNavigation')"
      @cancel.prevent="closeNavigation"
      @close="navigationOpen = drawer?.open ?? false"
      @click="$event.target === drawer && closeNavigation()"
    >
      <AppSidebar v-if="!wide" v-bind="sidebar" drawer v-on="sidebarActions" />
    </SituateDialog>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  padding-bottom: var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px));
  min-height: 0;
  min-width: 0;
  flex: 1;
}
.desktop-sidebar {
  position: relative;
  flex: 0 0 300px;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--situate-line);
}
.workspace-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1;
}
.workspace-content > :deep(.topic-window) {
  flex: 1;
  min-height: 0;
}
.layout-recovery-header {
  flex-shrink: 0;
  padding: max(12px, var(--app-safe-area-top, 0px)) 24px 12px;
  background: var(--situate-surface);
  border-bottom: 1px solid var(--situate-line);
}
.layout-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  flex-wrap: wrap;
}
.layout-notice button {
  min-height: 44px;
  padding: 8px 16px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-surface);
  color: var(--situate-ink);
  font: inherit;
  font-size: var(--situate-text-caption);
}
.layout-notice button:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: 2px solid var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
.navigation-drawer {
  margin: 0;
  width: min(320px, calc(100vw - 32px));
  height: var(--app-viewport-height, 100dvh);
  max-height: none;
  max-width: none;
  padding: 0 0 0 env(safe-area-inset-left, 0px);
  border: 0;
  border-right: 1px solid var(--situate-line);
  background: var(--situate-paper);
}
.navigation-drawer::backdrop {
  background: rgb(32 20 42 / 30%);
}
</style>
