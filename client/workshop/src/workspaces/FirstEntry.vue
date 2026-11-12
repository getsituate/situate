<script setup lang="ts">
import { computed, nextTick } from "vue";
import { welcomeStudy } from "../onboarding/welcome-studies";
import SetupFrame from "./SetupFrame.vue";
import AppearanceSettings from "../settings/AppearanceSettings.vue";
import WorkspaceCreateForm from "./WorkspaceCreateForm.vue";
import {
  entryCopy as c,
  accentStyle,
  type FirstEntryState,
  type FirstEntryAction,
} from "./first-entry";
import type { RunAction } from "./api";
import "./workspace-entry.css";
const props = defineProps<{
  embedded?: boolean;
  state: FirstEntryState;
  run: RunAction;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{
  action: [action: FirstEntryAction];
  cancel: [];
}>();
const name = defineModel<string>("name", { default: "" });
const study = computed(() => welcomeStudy(props.state.welcomeStudy));
function finishStudy() {
  emit("action", { type: "step", step: "create" });
  void nextTick(() => document.getElementById("create-title")?.focus());
}
</script>

<template>
  <div v-if="state.step === 'intro' && study" class="fullscreen-welcome">
    <component
      :is="study.component"
      :key="`${state.welcomeStudy}-${state.welcomeRun}`"
      :paused="state.paused"
      :time-ms="state.welcomeTime ?? undefined"
      @toggle="emit('action', { type: 'pause' })"
      @finished="finishStudy"
    />
  </div>
  <SetupFrame
    v-else
    class="first-entry"
    :embedded="embedded"
    role="main"
    :step="0"
    :paused="state.paused"
    :style="accentStyle(state.accent)"
    labelledby="create-title"
  >
    <div class="first-panel">
      <div class="workspace-entry first-create">
        <WorkspaceCreateForm
          v-model:name="name"
          :run="run"
          :busy="busy"
          :operation-error="error"
          @cancel="emit('cancel')"
          @open="run('pick')"
          @location="emit('action', { type: 'parent', parent: $event })"
        >
          <template #appearance>
            <AppearanceSettings
              class="accent-picker"
              :accent="state.accent"
              :workspace-name="name || c.defaultName"
              :help="c.colorHelp"
              :disabled="busy"
              @select="emit('action', { type: 'accent', accent: $event })"
            />
          </template>
        </WorkspaceCreateForm>
      </div>
    </div>
  </SetupFrame>
</template>

<style scoped>
.fullscreen-welcome {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.accent-picker {
  margin: 24px 0;
}
.first-create {
  height: auto;
  padding: 0;
  background: transparent;
}
.first-panel :deep(.entry-layout) {
  display: block;
}
.first-panel :deep(.creation) {
  padding: 0;
}
.first-panel :deep(.creation h1) {
  font-size: clamp(28px, 3vw, 40px);
}
.first-panel :deep(.form-actions .entry-primary) {
  background: var(--workspace-accent);
  color: var(--workspace-on-accent);
  border-color: var(--situate-ink);
}
.first-panel :deep(.form-actions .entry-primary:disabled) {
  background: var(--situate-muted);
  color: var(--situate-surface);
}
.first-panel :deep(.form-actions) {
  padding: 24px 0 0;
  margin-top: 0;
}
.first-panel :deep(input:not([type="radio"]):focus-visible) {
  outline: var(--situate-stroke-focus) solid var(--situate-ink);
  box-shadow: inset 0 0 0 6px var(--workspace-accent);
  outline-offset: var(--situate-focus-offset);
}
.first-panel :deep(.path-preview) {
  border-left: 4px solid var(--workspace-accent);
  background: color-mix(
    in srgb,
    var(--workspace-accent) 10%,
    var(--situate-surface)
  );
}
.first-panel :deep(.entry-eyebrow) {
  color: var(--situate-muted);
}
.first-panel :deep(.form-actions .entry-primary:hover:not(:disabled)) {
  background: var(--workspace-accent);
  color: var(--workspace-on-accent);
  filter: brightness(0.97);
}
</style>
