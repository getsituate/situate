<script setup lang="ts">
import { ref, useId, useTemplateRef } from "vue";
import SituateMenu from "../ui/SituateMenu.vue";
import {
  SituateIcon,
  SituateIconButton,
  type IconName,
  SituateButton,
} from "../ui";
import { workshopNavigation } from "../workshop/content";
import wordmark from "../brand/assets/wordmark.svg";
import type { Workspace } from "../workspaces/api";

withDefaults(
  defineProps<{
    drawer?: boolean;
    collapsible?: boolean;
    workspaceName?: string;
    openWorkspaces?: Workspace[];
    currentWorkspaceId?: string;
    mobile?: boolean;
    settingsAvailable?: boolean;
    pluginsAvailable?: boolean;
    settingsActive?: boolean;
  }>(),
  {
    drawer: false,
    workspaceName: "",
    openWorkspaces: () => [],
    currentWorkspaceId: "",
    mobile: false,
  },
);
const emit = defineEmits<{
  close: [];
  collapse: [];
  workspaces: [];
  closeWorkspace: [];
  openWorkspace: [id: string];
  settings: [];
  plugins: [];
}>();
const menuOpen = ref(false);
const workspaceTrigger =
  useTemplateRef<InstanceType<typeof SituateButton>>("workspaceTrigger");
const menuId = useId();
const initialFocus = ref<"first" | "last">("first");
function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}
function showMenu(last = false) {
  initialFocus.value = last ? "last" : "first";
  menuOpen.value = true;
}
function dismissMenu() {
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

const views: { label: string; icon: IconName }[] = [
  { label: "Calendar", icon: "calendar" },
  { label: "Tasks", icon: "tasks" },
  { label: "Notes", icon: "notes" },
];
</script>

<template>
  <nav class="app-sidebar" aria-label="Workspace navigation">
    <div class="sidebar-brand">
      <div class="workspace-picker">
        <SituateButton
          variant="plain"
          ref="workspaceTrigger"
          class="workspace-menu"
          type="button"
          aria-label="Workspace menu"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :popovertarget="menuId"
          @click.prevent="toggleMenu"
          :aria-controls="menuId"
          @keydown.down.prevent="showMenu()"
          @keydown.up.prevent="showMenu(true)"
        >
          <img :src="wordmark" width="116" height="35" alt="Situate" />
          <SituateIcon name="chevron" />
        </SituateButton>
        <SituateMenu
          :id="menuId"
          :open="menuOpen"
          :anchor="workspaceTrigger?.element"
          label="Workspace"
          :initial-focus="initialFocus"
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
            <SituateIcon name="folder" />Open workspace…
          </SituateButton>
          <div
            v-if="openWorkspaces.length"
            role="group"
            aria-label="Open workspaces"
          >
            <p class="workspace-menu-label" aria-hidden="true">
              Open workspaces
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
                >{{ workspace.name
                }}<small>{{
                  workspace.id === currentWorkspaceId
                    ? mobile
                      ? "Current workspace"
                      : "This window"
                    : mobile
                      ? "Open workspace"
                      : "Another window"
                }}</small></span
              >
            </SituateButton>
          </div>
          <div
            class="workspace-close"
            role="group"
            aria-label="Current workspace actions"
          >
            <SituateButton
              variant="plain"
              type="button"
              role="menuitem"
              tabindex="-1"
              @click="select('closeWorkspace')"
            >
              <SituateIcon name="close" />Close workspace
            </SituateButton>
          </div>
        </SituateMenu>
      </div>
      <SituateIconButton
        v-if="drawer"
        autofocus
        icon="close"
        label="Close navigation"
        @click="$emit('close')"
      />
      <SituateIconButton
        v-else
        icon="collapse"
        label="Collapse sidebar"
        :disabled="!collapsible"
        @click="emit('collapse')"
      />
    </div>

    <div class="workspace-context">
      <p v-if="workspaceName" class="workspace-name" :title="workspaceName">
        {{ workspaceName }}
      </p>
    </div>
    <div class="sidebar-content">
      <slot name="content">
        <section aria-label="Views">
          <h2 class="section-label">Views</h2>
          <ul class="nav-list">
            <li v-for="view in views" :key="view.label">
              <SituateButton
                variant="plain"
                type="button"
                class="nav-destination"
                disabled
                :title="`${view.label} is unavailable.`"
                :aria-description="`${view.label} is unavailable.`"
              >
                <SituateIcon :name="view.icon" />
                <span>{{ view.label }}</span>
              </SituateButton>
            </li>
          </ul>
          <SituateButton
            variant="plain"
            class="disclosure"
            type="button"
            disabled
            title="Additional views are unavailable."
            aria-description="Additional views are unavailable."
          >
            <SituateIcon name="chevron" />More views
          </SituateButton>
        </section>

        <section class="conversations" aria-label="Conversations">
          <div class="section-heading">
            <h2 class="section-label">Conversations</h2>
            <SituateIconButton icon="plus" label="New chat" disabled />
          </div>
          <p class="empty-conversations">No conversations yet.</p>
          <SituateButton
            variant="plain"
            class="disclosure"
            type="button"
            disabled
            title="There are no archived conversations."
            aria-description="There are no archived conversations."
          >
            <SituateIcon name="chevron" />Archive
          </SituateButton>
        </section>
      </slot>
    </div>

    <div class="sidebar-footer">
      <SituateButton
        variant="plain"
        type="button"
        class="footer-action"
        :disabled="!pluginsAvailable"
        :title="
          pluginsAvailable ? undefined : workshopNavigation.pluginsUnavailable
        "
        :aria-description="
          pluginsAvailable ? undefined : workshopNavigation.pluginsUnavailable
        "
        @click="emit('plugins')"
      >
        <SituateIcon name="plugins" />{{ workshopNavigation.plugins }}
      </SituateButton>
      <SituateButton
        variant="plain"
        type="button"
        class="footer-action"
        :disabled="!settingsAvailable"
        :aria-current="settingsActive ? 'page' : undefined"
        :title="settingsAvailable ? undefined : 'Settings are unavailable.'"
        :aria-description="
          settingsAvailable ? undefined : 'Settings are unavailable.'
        "
        @click="emit('settings')"
      >
        <SituateIcon name="settings" />Settings
      </SituateButton>
    </div>
  </nav>
</template>

<style scoped>
.app-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  padding: max(24px, var(--app-safe-area-top, env(safe-area-inset-top, 0px)))
    12px
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
  width: 264px;
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
  width: 116px;
  height: 35px;
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
.disclosure {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  margin: 4px 4px 0;
  padding: 10px 8px;
  border: 0;
  background: transparent;
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
}
.disclosure .situate-icon {
  width: 16px;
  height: 16px;
  transform: rotate(-90deg);
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
.footer-action[aria-current="page"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 650;
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
