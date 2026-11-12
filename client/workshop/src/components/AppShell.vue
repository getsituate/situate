<script setup lang="ts">
import { SituateDialog } from "../ui";
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  useTemplateRef,
} from "vue";
import AppSidebar from "./AppSidebar.vue";
import ChatPane from "./ChatPane.vue";
import type { Workspace } from "../workspaces/api";

defineProps<{
  workspaceName?: string;
  openWorkspaces?: Workspace[];
  currentWorkspaceId?: string;
  mobile?: boolean;
  collapsible?: boolean;
  settingsAvailable?: boolean;
  pluginsAvailable?: boolean;
  settingsActive?: boolean;
}>();
const collapsed = defineModel<boolean>("collapsed", { default: false });
const emit = defineEmits<{
  workspaces: [];
  closeWorkspace: [];
  openWorkspace: [id: string];
  settings: [];
  plugins: [];
}>();
function showWorkspaces(): void {
  closeNavigation();
  emit("workspaces");
}
function closeWorkspace(): void {
  closeNavigation();
  emit("closeWorkspace");
}
function openWorkspace(id: string): void {
  closeNavigation();
  emit("openWorkspace", id);
}

const media = window.matchMedia("(min-width: 1184px)");
const wide = ref(media.matches);
const navigationOpen = ref(false);
const navigationId = useId();
const drawer = useTemplateRef<InstanceType<typeof SituateDialog>>("drawer");
const chat = useTemplateRef<InstanceType<typeof ChatPane>>("chat");

function openNavigation(event: MouseEvent): void {
  if (wide.value) {
    collapsed.value = false;
    return;
  }
  if (!drawer.value?.element) return;
  // Safari does not focus pointer-activated buttons; the dialog needs a return target.
  (event.currentTarget as HTMLButtonElement).focus();
  drawer.value?.element.showModal();
  navigationOpen.value = true;
}

function closeNavigation(): void {
  drawer.value?.element?.close();
  navigationOpen.value = false;
}

function dismissBackdrop(event: MouseEvent): void {
  if (event.target === drawer.value?.element) closeNavigation();
}

function syncNavigationState(): void {
  // A queued close event can arrive after the dialog has already reopened.
  navigationOpen.value = drawer.value?.element?.open ?? false;
}

async function updateLayout(event: MediaQueryListEvent): Promise<void> {
  wide.value = event.matches;
  if (wide.value && drawer.value?.element?.open) {
    closeNavigation();
    await nextTick();
    if (chat.value) chat.value.focusTitle();
    else
      document
        .querySelector<HTMLElement>('.app-shell [tabindex="-1"]')
        ?.focus();
  }
}

const onLayoutChange = (event: MediaQueryListEvent) => {
  void updateLayout(event);
};
onMounted(() => media.addEventListener("change", onLayoutChange));

onBeforeUnmount(() => {
  media.removeEventListener("change", onLayoutChange);
  drawer.value?.element?.close();
});
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': collapsed }">
    <aside v-if="!collapsed" class="desktop-sidebar">
      <AppSidebar
        :plugins-available="pluginsAvailable"
        @plugins="
          closeNavigation();
          emit('plugins');
        "
        :settings-available="settingsAvailable"
        :settings-active="settingsActive"
        @settings="
          closeNavigation();
          emit('settings');
        "
        :workspace-name="workspaceName"
        :open-workspaces="openWorkspaces"
        :current-workspace-id="currentWorkspaceId"
        :mobile="mobile"
        :collapsible="collapsible"
        @collapse="collapsed = true"
        @workspaces="showWorkspaces"
        @close-workspace="closeWorkspace"
        @open-workspace="openWorkspace"
      >
        <template v-if="$slots['sidebar-content']" #content
          ><slot name="sidebar-content" :close-navigation="closeNavigation"
        /></template>
      </AppSidebar>
    </aside>
    <slot
      :navigation-id="navigationId"
      :navigation-open="navigationOpen"
      :show-navigation="!wide || collapsed"
      :open-navigation="openNavigation"
    >
      <ChatPane
        ref="chat"
        :navigation-id="navigationId"
        :navigation-open="navigationOpen"
        @open-navigation="openNavigation"
      />
    </slot>
    <SituateDialog
      appearance="plain"
      :id="navigationId"
      ref="drawer"
      class="navigation-drawer"
      aria-label="Workspace navigation"
      @cancel.prevent="closeNavigation"
      @close="syncNavigationState"
      @click="dismissBackdrop"
    >
      <AppSidebar
        :plugins-available="pluginsAvailable"
        @plugins="
          closeNavigation();
          emit('plugins');
        "
        v-if="!wide"
        drawer
        :settings-available="settingsAvailable"
        :settings-active="settingsActive"
        @settings="
          closeNavigation();
          emit('settings');
        "
        :workspace-name="workspaceName"
        :open-workspaces="openWorkspaces"
        :current-workspace-id="currentWorkspaceId"
        :mobile="mobile"
        @close="closeNavigation"
        @workspaces="showWorkspaces"
        @close-workspace="closeWorkspace"
        @open-workspace="openWorkspace"
      >
        <template v-if="$slots['sidebar-content']" #content
          ><slot name="sidebar-content" :close-navigation="closeNavigation"
        /></template>
      </AppSidebar>
    </SituateDialog>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  padding-left: var(--app-safe-area-left, env(safe-area-inset-left, 0px));
  padding-right: var(--app-safe-area-right, env(safe-area-inset-right, 0px));
  padding-bottom: var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px));
  background: var(--situate-surface);
}
.desktop-sidebar {
  display: none;
  min-height: 0;
  border-right: 1px solid var(--situate-line);
}
.navigation-drawer {
  position: fixed;
  inset: 0 auto 0 0;
  width: min(320px, calc(100vw - 24px));
  top: var(--app-content-top, var(--app-viewport-top, 0px));
  height: var(--app-content-height, var(--app-viewport-height, 100dvh));
  max-width: none;
  max-height: none;
  margin: 0;
  padding: 0 0 0 var(--app-safe-area-left, env(safe-area-inset-left, 0px));
  border: 0;
  border-right: 1px solid var(--situate-line);
  color: var(--situate-ink);
  background: var(--situate-paper);
}
.navigation-drawer::backdrop {
  background: var(--situate-ink);
  opacity: 0.35;
}
@media (min-width: 1184px) {
  .desktop-sidebar {
    display: block;
  }
  .app-shell {
    grid-template-columns: 272px minmax(0, 1fr);
  }
  .app-shell.sidebar-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
