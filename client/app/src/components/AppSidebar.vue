<script setup lang="ts">
import { t, localizeError } from "@situate/localization";
import type { ConversationSummary } from "../ai/conversation-record";
import ConversationListItem from "./ConversationListItem.vue";
import { computed, nextTick, useId, ref, useTemplateRef, watch } from "vue";
import {
  SituateButton,
  SituateMenu,
  SituateIcon,
  SituateIconButton,
  type IconName,
} from "@situate/ui";
import wordmark from "../../../../design/brand/assets/wordmark.svg";
import { displayWorkspaceName, type Workspace } from "../workspaces/api";

const props = withDefaults(
  defineProps<{
    drawer?: boolean;
    workspaceName?: string;
    openWorkspaces?: Workspace[];
    currentWorkspaceId?: string;
    mobile?: boolean;
    filesActive?: boolean;
    settingsActive?: boolean;
    pluginsAvailable?: boolean;
    pluginsActive?: boolean;
    conversations?: ConversationSummary[];
    selectedConversation?: string;
    conversationsBusy?: boolean;
    conversationsError?: unknown;
    conversationRunning?: (id: string) => boolean;
    availableViews?: { id: string; title: string; icon: IconName }[];
    pinnedViews?: readonly string[];
    activeView?: string;
  }>(),
  {
    drawer: false,
    workspaceName: "",
    openWorkspaces: () => [],
    currentWorkspaceId: "",
    mobile: false,
    filesActive: false,
  },
);
const emit = defineEmits<{
  close: [];
  collapse: [];
  workspaces: [];
  closeWorkspace: [];
  openWorkspace: [id: string];
  files: [];
  connect: [];
  plugins: [];
  conversation: [id: string];
  newConversation: [];
  retryConversations: [];
  view: [id: string];
  pin: [id: string];
}>();
const menuOpen = ref(false);
const moreOpen = ref(false);
const moreId = useId();
const navigation = useTemplateRef<HTMLElement>("navigation");
const pinnedChoices = computed(() =>
  (props.pinnedViews ?? []).flatMap(
    (id) => props.availableViews?.filter((view) => view.id === id) ?? [],
  ),
);
const additionalViews = computed(() =>
  (props.availableViews ?? []).filter(
    (view) => !props.pinnedViews?.includes(view.id),
  ),
);
const directViews = computed(() =>
  pinnedChoices.value.length ? pinnedChoices.value : additionalViews.value,
);
const hasMore = computed(
  () => pinnedChoices.value.length > 0 && additionalViews.value.length > 0,
);
watch(hasMore, (value) => {
  if (!value) moreOpen.value = false;
});
watch(
  () => props.currentWorkspaceId,
  () => {
    moreOpen.value = false;
  },
);
async function pin(id: string): Promise<void> {
  if (!pinnedChoices.value.length || props.pinnedViews?.includes(id))
    moreOpen.value = true;
  emit("pin", id);
  await nextTick();
  Array.from(
    navigation.value?.querySelectorAll<HTMLButtonElement>("[data-view-pin]") ??
      [],
  )
    .find((button) => button.dataset.viewPin === id)
    ?.focus();
}
const workspaceTriggerControl = useTemplateRef<
  InstanceType<typeof SituateButton>
>("workspaceTriggerControl");
const workspaceTrigger = computed(() => workspaceTriggerControl.value?.element);
const menuId = useId();
const initialFocus = ref<"first" | "last">("first");
function toggleMenu(): void {
  initialFocus.value = "first";
  menuOpen.value = !menuOpen.value;
}
function showMenu(last = false): void {
  initialFocus.value = last ? "last" : "first";
  menuOpen.value = true;
}
function dismissMenu(): void {
  menuOpen.value = false;
}
function select(action: "workspaces" | "closeWorkspace"): void {
  dismissMenu();
  if (action === "workspaces") emit("workspaces");
  else emit("closeWorkspace");
}
function openWorkspace(id: string): void {
  dismissMenu();
  emit("openWorkspace", id);
}

const views = computed<{ label: string; icon: IconName }[]>(() => [
  { label: t("navigation.myDay"), icon: "sun" },
  { label: t("navigation.calendar"), icon: "calendar" },
  { label: t("navigation.tasks"), icon: "tasks" },
  { label: t("navigation.notes"), icon: "notes" },
]);
</script>

<template>
  <nav
    ref="navigation"
    class="app-sidebar"
    :aria-label="t('navigation.workspaceNavigation')"
  >
    <div class="sidebar-brand">
      <div class="workspace-picker">
        <SituateButton
          variant="plain"
          ref="workspaceTriggerControl"
          class="workspace-menu"
          type="button"
          :aria-label="t('navigation.workspaceMenu')"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :aria-controls="menuId"
          :popovertarget="menuId"
          @click.prevent="toggleMenu"
          @keydown.down.prevent="showMenu()"
          @keydown.up.prevent="showMenu(true)"
        >
          <img
            :src="wordmark"
            width="104"
            height="32"
            :alt="t('navigation.situate')"
          />
          <SituateIcon name="chevron" />
        </SituateButton>
        <SituateMenu
          :id="menuId"
          :open="menuOpen"
          :anchor="workspaceTrigger"
          :initial-focus="initialFocus"
          :label="t('navigation.workspace')"
          class="workspace-actions"
          @close="dismissMenu"
        >
          <SituateButton
            variant="plain"
            type="button"
            role="menuitem"
            tabindex="-1"
            @click="select('workspaces')"
          >
            <SituateIcon name="folder" />{{ t("navigation.openWorkspace") }}
          </SituateButton>
          <div
            v-if="openWorkspaces.length"
            role="group"
            :aria-label="t('workspace.openWorkspaces')"
          >
            <p class="workspace-menu-label" aria-hidden="true">
              {{ t("workspace.openWorkspaces") }}
            </p>
            <SituateButton
              variant="plain"
              v-for="workspace in openWorkspaces"
              :key="workspace.id"
              type="button"
              role="menuitem"
              tabindex="-1"
              :class="{
                'current-workspace': workspace.id === currentWorkspaceId,
              }"
              :aria-current="
                workspace.id === currentWorkspaceId ? 'true' : undefined
              "
              @click="openWorkspace(workspace.id)"
            >
              <SituateIcon name="workspace" />
              <span
                ><span data-localization-content="user">{{
                  displayWorkspaceName(workspace)
                }}</span
                ><small>{{
                  workspace.id === currentWorkspaceId
                    ? mobile
                      ? t("navigation.currentWorkspace")
                      : t("navigation.thisWindow")
                    : mobile
                      ? t("navigation.openWorkspaceDetail")
                      : t("navigation.anotherWindow")
                }}</small></span
              >
            </SituateButton>
          </div>
          <div
            class="workspace-close"
            role="group"
            :aria-label="t('navigation.currentWorkspaceActions')"
          >
            <SituateButton
              variant="plain"
              type="button"
              role="menuitem"
              tabindex="-1"
              @click="select('closeWorkspace')"
            >
              <SituateIcon name="close" />{{ t("workspace.closeWorkspace") }}
            </SituateButton>
          </div>
        </SituateMenu>
      </div>
      <SituateIconButton
        v-if="drawer"
        autofocus
        icon="close"
        :label="t('navigation.closeNavigation')"
        @click="$emit('close')"
      />
      <SituateIconButton
        v-else
        class="collapse-navigation"
        icon="collapse"
        :label="t('navigation.collapseSidebar')"
        @click="emit('collapse')"
      />
    </div>

    <div v-if="drawer" class="workspace-context">
      <p
        v-if="workspaceName"
        class="workspace-name"
        data-localization-content="user"
        :title="t('workspace.nameLabel', { name: workspaceName })"
      >
        {{ workspaceName }}
      </p>
    </div>
    <div class="sidebar-content">
      <section :aria-label="t('navigation.views')">
        <div class="section-heading views-heading">
          <h2 class="section-label">{{ t("navigation.views") }}</h2>
          <SituateButton
            v-if="hasMore"
            variant="ghost"
            size="small"
            class="more-views"
            :aria-expanded="moreOpen"
            :aria-controls="moreId"
            @click="moreOpen = !moreOpen"
          >
            <span class="more-views-content">
              {{ t("navigation.more") }}<SituateIcon name="chevron" />
            </span>
          </SituateButton>
        </div>
        <template v-if="availableViews">
          <ul class="nav-list">
            <li
              v-for="view in directViews"
              :key="view.id"
              class="pinnable-view"
            >
              <SituateButton
                variant="plain"
                type="button"
                class="nav-destination"
                :aria-current="activeView === view.id ? 'page' : undefined"
                @click="emit('view', view.id)"
              >
                <SituateIcon :name="view.icon" /><span
                  data-localization-content="user"
                  >{{ view.title }}</span
                >
              </SituateButton>
              <SituateIconButton
                icon="pin"
                class="view-pin"
                :label="
                  t(
                    pinnedChoices.length
                      ? 'layoutHost.unpin'
                      : 'layoutHost.pin',
                    { title: view.title },
                  )
                "
                :data-view-pin="view.id"
                :aria-pressed="pinnedChoices.length > 0"
                @click="pin(view.id)"
              />
            </li>
          </ul>
          <div
            :id="moreId"
            v-show="hasMore && moreOpen"
            class="additional-views"
            role="group"
            :aria-label="t('navigation.moreViews')"
          >
            <p class="additional-views-label">
              {{ t("navigation.moreViews") }}
            </p>
            <ul class="nav-list">
              <li
                v-for="view in hasMore ? additionalViews : []"
                :key="view.id"
                class="pinnable-view"
              >
                <SituateButton
                  variant="plain"
                  type="button"
                  class="nav-destination"
                  :aria-current="activeView === view.id ? 'page' : undefined"
                  @click="emit('view', view.id)"
                >
                  <SituateIcon :name="view.icon" /><span
                    data-localization-content="user"
                    >{{ view.title }}</span
                  >
                </SituateButton>
                <SituateIconButton
                  icon="pin"
                  class="view-pin"
                  :label="t('layoutHost.pin', { title: view.title })"
                  :data-view-pin="view.id"
                  :aria-pressed="false"
                  @click="pin(view.id)"
                />
              </li>
            </ul>
          </div>
        </template>
        <template v-else>
          <ul class="nav-list">
            <li v-for="view in views" :key="view.icon">
              <SituateButton
                variant="plain"
                type="button"
                class="nav-destination"
                disabled
                :title="t('navigation.viewUnavailable', { name: view.label })"
                :aria-description="
                  t('navigation.viewUnavailable', { name: view.label })
                "
              >
                <SituateIcon :name="view.icon" />
                <span>{{ view.label }}</span>
              </SituateButton>
            </li>
            <li>
              <SituateButton
                variant="plain"
                type="button"
                class="nav-destination"
                :aria-current="filesActive ? 'page' : undefined"
                @click="emit('files')"
              >
                <SituateIcon name="folder" /><span>{{
                  t("navigation.files")
                }}</span>
              </SituateButton>
            </li>
          </ul>
        </template>
      </section>

      <section
        class="conversations"
        :aria-label="t('navigation.conversations')"
      >
        <div class="section-heading">
          <h2 class="section-label">{{ t("navigation.conversations") }}</h2>
          <SituateIconButton
            icon="plus"
            :label="t('navigation.newChat')"
            :disabled="
              !currentWorkspaceId || conversationsBusy || !!conversationsError
            "
            @click="emit('newConversation')"
          />
        </div>
        <ul
          v-if="conversations?.length"
          class="nav-list"
          :aria-busy="conversationsBusy"
        >
          <li
            v-for="item in conversations"
            :key="`${currentWorkspaceId}:${item.id}`"
          >
            <ConversationListItem
              :item="item"
              :scope="currentWorkspaceId"
              :selected="selectedConversation === item.id"
              :running="!!conversationRunning?.(item.id)"
              @open="emit('conversation', item.id)"
            />
          </li>
        </ul>
        <p
          v-else-if="!conversationsBusy && !conversationsError"
          class="empty-conversations"
        >
          {{ t("navigation.noConversationsYet") }}
        </p>
        <div v-if="conversationsError" class="conversation-error">
          <p role="alert">{{ localizeError(conversationsError) }}</p>
          <SituateButton
            variant="plain"
            type="button"
            :disabled="conversationsBusy"
            @click="emit('retryConversations')"
          >
            {{ t("navigation.retry") }}
          </SituateButton>
        </div>
      </section>
    </div>

    <div class="sidebar-footer">
      <SituateButton
        variant="plain"
        type="button"
        class="footer-action plugins-action"
        :aria-current="pluginsActive ? 'page' : undefined"
        :disabled="!pluginsAvailable"
        :title="
          pluginsAvailable ? undefined : t('navigation.pluginsAreUnavailable')
        "
        :aria-description="
          pluginsAvailable ? undefined : t('navigation.pluginsAreUnavailable')
        "
        @click="emit('plugins')"
      >
        <SituateIcon name="plugins" />{{ t("navigation.plugins") }}
      </SituateButton>
      <SituateButton
        variant="plain"
        type="button"
        class="footer-action settings-action"
        :aria-current="settingsActive ? 'page' : undefined"
        :disabled="!currentWorkspaceId"
        :title="
          !currentWorkspaceId
            ? t('navigation.settingsAreUnavailable')
            : undefined
        "
        :aria-description="
          !currentWorkspaceId
            ? t('navigation.settingsAreUnavailable')
            : undefined
        "
        @click="emit('connect')"
      >
        <SituateIcon name="settings" />{{ t("navigation.settings") }}
      </SituateButton>
    </div>
  </nav>
</template>

<style scoped>
.pinnable-view {
  display: flex;
  align-items: center;
}
.pinnable-view .nav-destination {
  flex: 1;
  min-width: 0;
}
.view-pin[aria-pressed="true"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.view-pin[aria-pressed="true"] :deep(svg) {
  fill: currentColor;
}
.footer-action[aria-current="page"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 650;
}
.app-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  padding: max(24px, env(safe-area-inset-top, 0px)) 12px
    max(12px, var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px)));
  background: var(--situate-paper);
}
.sidebar-brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 4px 20px;
}
.workspace-menu {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  min-height: 44px;
  padding: 4px 8px;
  border: 0;
  background: transparent;
}
.workspace-picker {
  position: relative;
  min-width: 0;
}
.workspace-context {
  margin: -12px 12px 20px;
}
.workspace-name {
  margin: 0;
  font-size: var(--situate-text-small);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
.workspace-actions {
  width: 280px;
}
.workspace-actions button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  width: 100%;
  min-height: var(--situate-target-min);
  padding: 12px;
  border: 0;
  border-radius: var(--situate-radius-small);
  background: transparent;
  text-align: left;
  font-size: var(--situate-text-small);
}
.workspace-actions button > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.workspace-actions small {
  display: block;
  margin-top: 2px;
  color: var(--situate-muted);
  font-size: 12px;
}
.workspace-menu-label {
  margin: 8px 4px 4px;
  padding: 16px 8px 4px;
  border-top: 1px solid var(--situate-line);
  color: var(--situate-muted);
  font-size: 12px;
}
.current-workspace {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.workspace-close {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--situate-line);
}
.workspace-menu {
  border-radius: var(--situate-radius-small);
}
.workspace-menu[aria-expanded="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.workspace-menu[aria-expanded="true"] .situate-icon {
  transform: rotate(180deg);
}
@media (hover: hover) {
  .workspace-menu:hover {
    background: var(--situate-accent-soft, var(--situate-lilac));
  }
  .workspace-actions button:hover {
    background: var(--situate-paper);
  }
}
.workspace-menu img {
  display: block;
  width: 104px;
  height: 32px;
}
.workspace-menu .situate-icon {
  width: 14px;
  height: 14px;
  color: var(--situate-muted);
}
.sidebar-content {
  flex: 1;
  min-height: 0;
  overflow-y: scroll;
  overscroll-behavior: contain;
  padding: 5px;
  margin: -5px;
}
.section-label {
  margin: 0 12px 8px;
  color: var(--situate-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.nav-destination {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--situate-row-compact);
  padding: 12px;
  border: 0;
  border-radius: var(--situate-radius-control);
  background: transparent;
  text-align: left;
  font-size: var(--situate-text-small);
  overflow-wrap: anywhere;
}
.nav-destination .situate-icon {
  color: var(--situate-muted);
}
.nav-destination[aria-current="page"] {
  position: relative;
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.nav-destination[aria-current="page"] .situate-icon {
  color: inherit;
}
.nav-destination[aria-current="page"]::before {
  content: "";
  position: absolute;
  left: 0;
  width: 3px;
  height: 20px;
  border-radius: 3px;
  background: var(--situate-accent-strong, var(--situate-violet-deep));
}
.nav-destination:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
.views-heading {
  min-height: var(--situate-target-min);
  gap: var(--situate-space-1);
}
.more-views.situate-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  min-height: var(--situate-target-min);
  padding: 0;
  border: 0;
  border-radius: var(--situate-radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--situate-muted);
  font-family: var(--situate-font-body);
  font-size: var(--situate-text-caption);
  font-weight: var(--situate-weight-emphasis);
  line-height: var(--situate-leading-body);
  -webkit-tap-highlight-color: transparent;
}
.more-views-content {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 10px 4px 12px;
  border-radius: inherit;
}
.more-views .situate-icon {
  width: 14px;
  height: 14px;
  transform: rotate(-90deg);
}
.more-views[aria-expanded="true"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.more-views[aria-expanded="true"] .more-views-content,
.more-views:active .more-views-content {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.more-views[aria-expanded="true"] .situate-icon {
  transform: rotate(0deg);
}
@media (hover: hover) {
  .more-views:not([aria-expanded="true"]):hover {
    color: var(--situate-ink);
  }
  .more-views:hover .more-views-content {
    background: var(--situate-accent-soft, var(--situate-lilac));
  }
}
.additional-views {
  margin-top: var(--situate-space-3);
  padding-top: var(--situate-space-3);
  border-top: var(--situate-stroke-divider) solid var(--situate-line);
}
.additional-views-label {
  margin: 0 var(--situate-space-3) var(--situate-space-1);
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
  font-weight: var(--situate-weight-emphasis);
}
.conversations {
  margin-top: var(--situate-space-8);
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-heading .section-label {
  margin-bottom: 0;
}
.section-heading .situate-icon-button {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.conversation-error {
  margin: 8px 12px;
  font-size: var(--situate-text-caption);
  overflow-wrap: anywhere;
}
.conversation-error button {
  min-height: var(--situate-target-min);
}
.empty-conversations {
  margin: 8px 12px 16px;
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
}
.sidebar-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 4px;
  margin-top: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--situate-line);
}
.footer-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
}
</style>
