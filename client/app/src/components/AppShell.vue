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
import { captureReference } from "../files/reference-operations";
import AppSidebar from "./AppSidebar.vue";
import SituateErrorScreen from "./SituateErrorScreen.vue";
import ErrorActions from "../errors/ErrorActions.vue";
import ErrorDialog from "../errors/ErrorDialog.vue";
import {
  SituateDialog,
  SituateDialogActions,
  SituateButton,
  SituateIconButton,
  SituateResizeHandle,
} from "@situate/ui";
import type { NavigationTicket } from "../layout/session";
import type { LayoutAction, LayoutActionResult } from "../layout/actions";
import { keyCombination } from "../layout/shortcut-keys";
import type { Accent, AppearanceSnapshot } from "../settings/accents";
import type { Workspace } from "../workspaces/api";
import { workspaceUi } from "../layout/runtime";
import {
  selectedTab,
  tabHasActivity,
  type LayoutIntent,
  type PaneAddress,
} from "../layout/model";
import {
  currentEntry,
  type PresentationValue,
  type ViewTarget,
} from "../layout/navigation";
import ViewHost from "../layout/ViewHost.vue";
import WorkspaceLoading from "../layout/components/WorkspaceLoading.vue";
const WorkspaceLayout = defineAsyncComponent(
  () => import("../layout/components/WorkspaceLayout.vue"),
);
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
const composerFocus = ref<string>();
function clearComposerFocus(id: string) {
  if (composerFocus.value === id) composerFocus.value = undefined;
}
watch(
  activeTarget,
  (target) => {
    if (
      target?.kind !== "new-conversation" ||
      target.conversationId !== composerFocus.value
    )
      composerFocus.value = undefined;
  },
  { flush: "sync" },
);
const viewChoices = computed(() =>
  (ui.value?.registry.browsableViews ?? [])
    .filter((view) => view.id !== "settings" && view.id !== "plugins")
    .map((view) => ({ id: view.id, title: view.title(), icon: view.icon })),
);
const media = window.matchMedia("(min-width: 1184px)");
const wide = ref(media.matches);
const sidebarCollapsed = ref(false);
const sidebarWidth = ref(300);
const sidebarId = useId();
const navigationOpen = ref(false);
function showSettings(page?: "updates" | "dictation") {
  return open(
    { kind: "view", viewId: "settings" },
    undefined,
    page && { page, detail: true },
  );
}
async function showUpdates(): Promise<boolean> {
  const owner = ui.value;
  await owner?.session.load();
  if (!owner?.session.state.document || owner !== ui.value) return false;
  await showSettings("updates");
  return true;
}
watch(dictationSettingsRequested, () => void showSettings("dictation"));
function showPlugins(id?: string, ticket?: NavigationTicket) {
  return open({ kind: "view", viewId: "plugins", contentId: id }, ticket);
}
let workspaceGeneration = 0;
async function developPlugin(ticket: NavigationTicket, pluginId?: string) {
  const owner = ui.value;
  const chats = conversations.value;
  const generation = workspaceGeneration;
  if (!owner || !chats || !owner.session.current(ticket)) return;
  const id = await chats.createDevelopment(pluginId);
  if (!id) return;
  const current = () => generation === workspaceGeneration;
  let opened = false;
  try {
    if (!current()) return;
    opened = await owner.coordinator.open(
      { kind: "new-conversation", conversationId: id },
      ticket,
      { isCurrent: current },
    );
    if (opened && current()) await focusView();
  } finally {
    if (!opened) discardUnsentChat(ticket.workspaceId, id);
  }
}
const operationError = ref<unknown>("");
const layoutError = computed(
  () => operationError.value || ui.value?.session.state.error,
);
const errorDismissed = ref(false);
watch([ui, layoutError], () => {
  errorDismissed.value = false;
});
const navigationId = useId();
const drawerControl =
  useTemplateRef<InstanceType<typeof SituateDialog>>("drawerControl");
const drawer = computed(() => drawerControl.value?.element);
const shell = useTemplateRef<HTMLElement>("shell");
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
    composerFocus.value = undefined;
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
async function open(
  target: ViewTarget,
  ticket?: NavigationTicket,
  presentation?: PresentationValue,
) {
  const owner = ui.value;
  if (!owner) return;
  const generation = workspaceGeneration;
  const current = () => generation === workspaceGeneration;
  operationError.value = "";
  try {
    const opened = await owner.coordinator.open(
      target,
      ticket,
      { isCurrent: current },
      presentation,
    );
    if (!current()) return;
    closeNavigation();
    if (opened || presentation !== undefined) await focusView();
  } catch (error) {
    if (current()) operationError.value = error;
  }
}
async function newConversation(
  address?: PaneAddress,
  reference?: FilePaneReference,
) {
  const owner = ui.value,
    chats = conversations.value;
  if (!owner || !chats) return;
  const destination = owner.session.state.document
    ? owner.session.capture(address)
    : undefined;
  if (!(await guardDictation(owner.session.workspaceId))) return;
  await owner.session.load();
  const ticket = destination ?? owner.session.capture(address);
  if (ui.value !== owner || !owner.session.current(ticket)) return;
  closeNavigation();
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
    const target = activeTarget.value;
    if (
      opened &&
      ui.value === owner &&
      target?.kind === "new-conversation" &&
      target.conversationId === id
    )
      composerFocus.value = id;
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
function runLayoutAction(
  action: LayoutAction,
  control: string,
  isCurrent: () => boolean = () => true,
): Promise<LayoutActionResult> {
  const owner = ui.value;
  const generation = workspaceGeneration;
  return owner
    ? owner.session.runAction(
        action,
        control,
        () =>
          generation === workspaceGeneration &&
          owner === ui.value &&
          isCurrent(),
      )
    : Promise.resolve({ status: "unavailable" });
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
  if (reloadDialog.value?.open) {
    reloadDialog.value.close();
    return true;
  }
  if (document.value && layoutError.value && !errorDismissed.value) {
    errorDismissed.value = true;
    return true;
  }
  if (navigationOpen.value) {
    closeNavigation();
    return true;
  }
  if (layout.value?.back()) return true;
  if (!document.value && layoutError.value) {
    showWorkspaces();
    return true;
  }
  return stepHistory(-1);
}
function stepHistory(delta: -1 | 1): boolean {
  const tab = activeTab.value;
  const pane = tab?.panes.find((item) => item.id === tab.activePaneId);
  if (!tab || !pane) return false;
  const { cursor, entries } = pane.navigation;
  if (!entries[cursor + delta]) return false;
  intent({ type: "history", tabId: tab.id, paneId: pane.id, delta });
  void focusView();
  return true;
}
function hasOpenOverlay(): boolean {
  return !!window.document.querySelector(
    'dialog[open], [popover]:popover-open:not([role="tooltip"])',
  );
}
function mouseHistory(delta: -1 | 1) {
  if (layout.value && !hasOpenOverlay()) stepHistory(delta);
}
function handleMouseHistory(event: MouseEvent) {
  if (event.defaultPrevented || (event.button !== 3 && event.button !== 4))
    return;
  event.preventDefault();
  mouseHistory(event.button === 3 ? -1 : 1);
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
  await focusView();
}
defineExpose({
  back,
  mouseHistory,
  focusNavigation,
  showPlugins,
  showUpdates,
  revealConversation,
});
watch(
  [ui, layout, () => props.mobile],
  ([workspace, surface, mobile], _, cleanup) => {
    if (!workspace?.shortcuts.platform || !surface || mobile) return;
    workspace.shortcuts.start();
    const unbind = workspace.shortcuts.bindLayout(surface.runPluginAction);
    cleanup(() => {
      unbind();
      workspace.shortcuts.stop();
    });
  },
  { flush: "post" },
);
function handleShortcut(event: KeyboardEvent) {
  const surface = layout.value;
  const workspace = ui.value;
  if (
    !workspace?.shortcuts.platform ||
    props.mobile ||
    !surface ||
    event.defaultPrevented ||
    navigationOpen.value
  )
    return;
  const keys = keyCombination(event);
  if (!keys) return;
  const entry = workspace.shortcuts.rows.value.find(
    (item) => item.keys === keys,
  );
  if (!entry || event.target instanceof HTMLSelectElement) return;
  if (hasOpenOverlay()) return;
  event.preventDefault();
  if (event.repeat) return;
  if (typeof entry.action === "function") {
    void entry.action().catch((error: unknown) => {
      if (ui.value === workspace) operationError.value = error;
    });
  } else if (entry.action.type === "new-chat") void newConversation();
  else void surface.runShortcut(entry.action);
}
onMounted(() => {
  media.addEventListener("change", updateLayout);
  window.addEventListener("keydown", handleShortcut);
  window.addEventListener("mouseup", handleMouseHistory);
});
onBeforeUnmount(() => {
  ++workspaceGeneration;
  media.removeEventListener("change", updateLayout);
  window.removeEventListener("keydown", handleShortcut);
  window.removeEventListener("mouseup", handleMouseHistory);
  closeNavigation();
});
const sidebar = computed(() => ({
  workspaceName: props.workspaceName,
  openWorkspaces: props.openWorkspaces,
  currentWorkspaceId: props.currentWorkspaceId,
  mobile: props.mobile,
  conversations: conversations.value?.state.conversations,
  selectedConversation:
    activeTarget.value?.kind === "conversation"
      ? activeTarget.value.conversationId
      : undefined,
  conversationsLoading: !!conversations.value?.state.loading,
  conversationsLoaded: !!conversations.value?.state.loaded,
  conversationCreating: !!conversations.value?.state.creating,
  conversationRunning: conversations.value?.running,
  filesActive:
    activeTarget.value?.kind === "view" &&
    activeTarget.value.viewId === "files",
  settingsActive:
    activeTarget.value?.kind === "view" &&
    activeTarget.value.viewId === "settings",
  pluginsActive:
    activeTarget.value?.kind === "view" &&
    activeTarget.value.viewId === "plugins",
  availableViews: viewChoices.value,
  pluginsAvailable: !!ui.value,
  pinnedViews: document.value?.pinnedViews ?? [],
  activeView:
    activeTarget.value?.kind === "view" ? activeTarget.value.viewId : undefined,
}));
async function conversationInNewTab(id: string) {
  const surface = layout.value;
  const result = await surface?.openConversationInTab(id);
  if (
    surface === layout.value &&
    result?.status === "applied" &&
    navigationOpen.value
  ) {
    closeNavigation();
    await focusView();
  }
}
const sidebarActions = {
  conversation: (id: string) =>
    open({ kind: "conversation", conversationId: id }),
  conversationInNewTab,
  newConversation: () => newConversation(),
  files: () => open({ kind: "view", viewId: "files" }),
  view: (id: string) => open({ kind: "view", viewId: id }),
  pin: (id: string) => ui.value?.session.pin(id),
  workspaces: showWorkspaces,
  closeWorkspace,
  openWorkspace,
  connect: () => showSettings(),
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
    <section v-if="ui" class="workspace-content">
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
      <SituateErrorScreen
        v-if="layoutError && !document"
        :title="t('layoutHost.openFailedTitle')"
        :message="localizeError(layoutError)"
      >
        <template #actions>
          <SituateButton
            :busy="ui.session.state.loading"
            @click="ui.session.retry()"
          >
            {{ t("layoutHost.retry") }}
          </SituateButton>
          <SituateButton variant="secondary" @click="showWorkspaces">
            {{ t("errorRecovery.workspaces") }}
          </SituateButton>
          <ErrorActions
            boundary="workspace"
            :error="layoutError"
            :scope="ui.session.workspaceId"
          />
        </template>
      </SituateErrorScreen>
      <WorkspaceLoading
        v-if="!layout && (!layoutError || document)"
        :pending="ui.session.state.loading || !!document"
      />
      <div v-if="layoutError && document" class="layout-notice">
        <SituateButton variant="secondary" @click="errorDismissed = false">
          {{ t("errorRecovery.review") }}
        </SituateButton>
      </div>
      <ErrorDialog
        :open="!!layoutError && !!document && !errorDismissed"
        :message="localizeError(layoutError)"
        @dismiss="errorDismissed = true"
      >
        <template #actions>
          <SituateButton
            @click="
              operationError = '';
              ui.session.retry();
            "
          >
            {{ t("layoutHost.retry") }}
          </SituateButton>
          <SituateButton
            variant="ghost"
            v-if="document"
            @click="reloadDialog?.showModal()"
          >
            {{ t("layoutHost.reload") }}
          </SituateButton>
          <ErrorActions
            boundary="workspace"
            :error="layoutError"
            :scope="ui.session.workspaceId"
          />
        </template>
      </ErrorDialog>
      <WorkspaceLayout
        v-if="document"
        ref="layout"
        :state="document.layout"
        :workspace-id="ui.session.workspaceId"
        :mobile="mobile"
        :title-for="ui.titleFor"
        :run-action="runLayoutAction"
        :has-activity="hasActivity"
        :show-navigation="!wide || sidebarCollapsed"
        :navigation-id="navigationId"
        :navigation-open="navigationOpen"
        @intent="intent"
        @navigation="openNavigation"
      >
        <template #pane="{ pane, tab, active }"
          ><ViewHost
            :ui="ui"
            :pane="pane"
            :tab="tab"
            :workspace-name="workspaceName ?? ''"
            :focus-conversation="active ? composerFocus : undefined"
            @composer-focused="clearComposerFocus"
            @new-conversation="
              newConversation({ tabId: tab.id, paneId: pane.id })
            "
            @reference="reference($event, { tabId: tab.id, paneId: pane.id })"
            @identity="identity"
            @error="operationError = $event"
          >
            <template #settings="{ component, entry, ticket, retain }">
              <component
                :is="component"
                :mobile="mobile"
                :workspace-scope="currentWorkspaceId"
                :shortcuts="ui.shortcuts"
                :workspace-name="workspaceName"
                :appearance="appearance"
                :accent="accent"
                :appearance-loading="appearanceLoading"
                :appearance-saving="appearanceSaving"
                :appearance-error="appearanceError"
                :snapshot="localization ?? null"
                :loading="localizationLoading ?? false"
                :saving="localizationSaving ?? false"
                :error="localizationError ?? ''"
                :presentation="entry.presentation"
                @presentation="retain"
                @accent="emit('accent', $event)"
                @retry-appearance="emit('retryAppearance')"
                @plugins="showPlugins(undefined, ticket)"
                @connect="emit('connect')"
                @change="emit('preferences', $event)"
                @retry="emit('retryLocalization')"
              />
            </template>
            <template #documents="{ component, entry, ticket, retain }">
              <component
                :is="component"
                :plugins="ui.plugins"
                :presentation="entry.presentation"
                @presentation="retain"
                @sources="
                  (id?: string) =>
                    open(
                      { kind: 'view', viewId: 'plugins', contentId: id },
                      ticket,
                      id ? undefined : { section: 'sources' },
                    )
                "
                @develop="developPlugin(ticket)"
                @error="operationError = $event"
              />
            </template>
            <template #plugins="{ component, entry, ticket }">
              <component
                :is="component"
                :ui="ui"
                :scope="ui.session.workspaceId"
                :focus-sources="
                  !!entry.presentation &&
                  typeof entry.presentation === 'object' &&
                  'section' in entry.presentation &&
                  entry.presentation.section === 'sources'
                "
                :selected-plugin="
                  entry.target.kind === 'view'
                    ? entry.target.contentId
                    : undefined
                "
                :ticket="ticket"
                :on-develop="(id?: string) => developPlugin(ticket, id)"
                @opened="focusView"
              />
            </template>
          </ViewHost>
        </template>
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
    <SituateDialog
      appearance="plain"
      :id="navigationId"
      ref="drawerControl"
      class="navigation-drawer"
      :aria-label="t('navigation.workspaceNavigation')"
      @cancel.self.prevent="closeNavigation"
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
