<script setup lang="ts">
import { SituateButton } from "../ui";
import { useTemplateRef } from "vue";
import AppShell from "./AppShell.vue";
import WorkspaceEntry from "../workspaces/WorkspaceEntry.vue";
import type { RunAction, Snapshot, Workspace } from "../workspaces/api";

defineProps<{
  state: Snapshot | null;
  run: RunAction;
  busy: boolean;
  error: string;
  entryVisible: boolean;
  retryAvailable: boolean;
  collapsible?: boolean;
  settingsAvailable?: boolean;
  pluginsAvailable?: boolean;
  settingsActive?: boolean;
}>();
const collapsed = defineModel<boolean>("collapsed", { default: false });
const emit = defineEmits<{
  back: [];
  opened: [];
  workspaces: [];
  retry: [];
  settings: [];
  plugins: [];
}>();
const creating = defineModel<boolean>("creating", { default: false });
const removing = defineModel<Workspace | null>("removing", { default: null });
const draftName = defineModel<string>("draftName", { default: "" });
const entry = useTemplateRef<InstanceType<typeof WorkspaceEntry>>("entry");
defineExpose({ back: () => entry.value?.back() ?? false });
</script>

<template>
  <section
    v-if="!state?.ready || state.error"
    class="startup"
    aria-labelledby="startup-title"
  >
    <h1 id="startup-title">Situate</h1>
    <p v-if="state?.error || error" role="alert">{{ state?.error || error }}</p>
    <p v-else role="status">Opening workspaces…</p>
    <SituateButton
      variant="secondary"
      size="small"
      v-if="retryAvailable && (error || state?.error)"
      type="button"
      :disabled="busy"
      @click="emit('retry')"
    >
      Retry
    </SituateButton>
  </section>
  <WorkspaceEntry
    v-else-if="!state.current || entryVisible"
    ref="entry"
    v-model:creating="creating"
    v-model:removing="removing"
    v-model:draft-name="draftName"
    :state="state"
    :run="run"
    :busy="busy"
    :error="error"
    @back="emit('back')"
    @opened="emit('opened')"
  />
  <template v-else>
    <div v-if="error || state.failures.length" class="workspace-notice">
      <span role="status">{{
        error || "Some workspaces couldn’t be reopened."
      }}</span>
      <SituateButton
        variant="ghost"
        size="small"
        type="button"
        class="text-action"
        @click="emit('workspaces')"
      >
        Review
      </SituateButton>
    </div>
    <AppShell
      :plugins-available="pluginsAvailable"
      @plugins="emit('plugins')"
      :settings-available="settingsAvailable"
      :settings-active="settingsActive"
      @settings="emit('settings')"
      v-model:collapsed="collapsed"
      :collapsible="collapsible"
      :workspace-name="state.current.name"
      :open-workspaces="state.open"
      :current-workspace-id="state.current.id"
      :mobile="state.mobile"
      @workspaces="emit('workspaces')"
      @close-workspace="run('close', state.current?.id)"
      @open-workspace="run('open', $event)"
    >
      <template v-if="$slots.default" #default="navigation"
        ><slot v-bind="navigation"
      /></template>
      <template v-if="$slots['sidebar-content']" #sidebar-content="sidebar"
        ><slot name="sidebar-content" v-bind="sidebar"
      /></template>
    </AppShell>
  </template>
</template>

<style scoped>
.startup {
  padding: max(24px, var(--app-safe-area-top, env(safe-area-inset-top))) 18px
    max(24px, var(--app-safe-area-bottom, env(safe-area-inset-bottom)));
  max-width: 640px;
  max-height: 100%;
  overflow: auto;
  margin: auto;
  overflow-wrap: anywhere;
}
.startup button {
  min-height: 48px;
}
.workspace-notice button {
  min-height: 48px;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--situate-radius-control);
  background: transparent;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  text-align: left;
}
.workspace-notice {
  position: fixed;
  bottom: max(16px, var(--app-safe-area-bottom, env(safe-area-inset-bottom)));
  left: 16px;
  right: 16px;
  z-index: 3;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  background: var(--situate-paper);
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-control);
}
</style>
