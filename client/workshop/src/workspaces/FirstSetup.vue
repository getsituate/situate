<script setup lang="ts">
import { SituateButton, SituateInput, SituateSelect } from "../ui";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import AiView from "../ai/AiView.vue";
import {
  currentWorkspace,
  eligibleModels,
  startConnection,
  cloneAiState,
  type AiState,
} from "../ai/model";
import type { OnboardingState } from "../onboarding/model";
import SetupFrame from "./SetupFrame.vue";
import {
  accentStyle,
  type FirstEntryState,
  type FirstEntryAction,
} from "./first-entry";
import { setupCopy as c } from "./setup-content";
import { setupStep } from "./setup-transition";
const props = defineProps<{
  embedded?: boolean;
  state: FirstEntryState;
  ai: AiState;
  onboarding: OnboardingState;
  workspace: string;
}>();
const emit = defineEmits<{
  action: [action: FirstEntryAction];
  ai: [state: AiState];
}>();
const root = ref<HTMLElement>();
const modelStep = computed(
  () => props.state.step === "ai" && props.ai.screen === "success",
);
const models = computed(() => eligibleModels(props.ai));
const manual = computed(() => currentWorkspace(props.ai).model.manual);
const index = computed(() => setupStep(props.state, props.onboarding));
const pending = computed(() => props.state.check === "pending");
function changeConnection() {
  const ai = cloneAiState(props.ai);
  startConnection(ai, "providers");
  emit("ai", ai);
}
function focusHeading() {
  void nextTick(() => {
    const body = root.value?.querySelector<HTMLElement>(".setup-frame");
    if (body) body.scrollTop = 0;
    root.value
      ?.querySelector<HTMLElement>("h1")
      ?.focus({ preventScroll: true });
  });
}
watch([() => props.state.step, modelStep], focusHeading);
onMounted(focusHeading);
</script>
<template>
  <div
    ref="root"
    class="first-setup"
    :class="{
      embedded,
      'source-chat-host':
        state.step === 'working' && onboarding.step === 'source-chat',
    }"
    :style="accentStyle(state.accent)"
  >
    <SetupFrame
      :embedded="embedded"
      :focused="state.step === 'working' && onboarding.step === 'source-chat'"
      :step="index"
      :workspace="workspace"
      :paused="state.paused || state.step === 'paused'"
      :blocked="state.check === 'failed'"
    >
      <template #actions>
        <SituateButton
          variant="plain"
          v-if="state.step !== 'paused'"
          @click="emit('action', { type: 'pause-setup' })"
        >
          {{ c.pause }}
        </SituateButton>
      </template>
      <div class="setup-body">
        <main v-if="state.step === 'paused'" class="setup-card">
          <h1 tabindex="-1">{{ c.paused }}</h1>
          <p>{{ c.pausedDetail }}</p>
          <SituateButton
            variant="plain"
            class="primary"
            @click="emit('action', { type: 'resume-setup' })"
          >
            {{ c.resume }}
          </SituateButton>
        </main>
        <main v-else-if="modelStep" class="setup-card">
          <h1 tabindex="-1">{{ c.modelTitle }}</h1>
          <p>{{ c.modelDetail }}</p>
          <label v-if="manual" for="setup-model">{{ c.manualModel }}</label>
          <label v-else for="setup-model">{{ c.modelLabel }}</label>
          <SituateInput
            appearance="plain"
            v-if="manual"
            id="setup-model"
            :value="state.modelId"
            :disabled="pending"
            @input="
              emit('action', {
                type: 'model',
                id: ($event.target as HTMLInputElement).value,
              })
            "
          />
          <SituateSelect
            v-else
            id="setup-model"
            :value="state.modelId"
            :disabled="pending || !models.length"
            @change="
              emit('action', {
                type: 'model',
                id: ($event.target as HTMLSelectElement).value,
              })
            "
          >
            <option value="">{{ c.chooseModel }}</option>
            <option v-for="model in models" :key="model.id" :value="model.id">
              {{ model.name }}
            </option>
          </SituateSelect>
          <p v-if="!manual && !models.length" role="status">{{ c.noModels }}</p>
          <p class="small">{{ c.checkDetail }}</p>
          <p v-if="pending" role="status">{{ c.checking }}</p>
          <p v-if="state.check === 'failed'" role="alert">{{ c.failed }}</p>
          <div class="actions">
            <SituateButton
              variant="plain"
              :disabled="pending"
              @click="changeConnection"
            >
              {{ c.changeProvider }}
            </SituateButton>
            <SituateButton
              variant="plain"
              class="primary"
              :disabled="pending || !state.modelId.trim()"
              @click="emit('action', { type: 'check-model' })"
            >
              {{ c.check }}
            </SituateButton>
          </div>
        </main>
        <div v-else-if="state.step === 'ai'" class="connection">
          <AiView
            :state="ai"
            required-setup
            :connection-context="{ workspace, connected: [] }"
            @update:state="emit('ai', $event)"
          />
          <p class="required">{{ c.required }}</p>
        </div>
        <slot v-else />
      </div>
    </SetupFrame>
  </div>
</template>
<style scoped>
.first-setup {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.first-setup.embedded {
  height: auto;
}
.first-setup.source-chat-host,
.source-chat-host .setup-body {
  height: 100%;
  min-height: 0;
}
.setup-card {
  min-width: 0;
}
.connection :deep(.ai-view) {
  height: auto;
  overflow: visible;
  display: block;
}
.connection :deep(.pane) {
  display: block;
}
.connection :deep(.scroll) {
  padding: 0;
  overflow: visible;
}
.connection :deep(.content) {
  gap: 24px;
}
.connection :deep(.actions) {
  padding: 24px 0 0;
  margin-top: 24px;
  background: transparent;
}
.connection :deep(h1) {
  font-size: clamp(28px, 3vw, 40px);
  letter-spacing: -0.04em;
  line-height: 1.12;
}
.connection :deep(.providers) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: max-content;
  align-content: start;
  max-height: 360px;
  overflow: auto;
  padding: 4px;
  margin: -4px;
}
.connection :deep(.providers button) {
  border-radius: 16px;
}
.required {
  font-size: 13px;
  color: var(--situate-muted);
  margin: 24px 0 0;
}
h1 {
  font-size: clamp(28px, 3vw, 40px);
  line-height: 1.12;
  letter-spacing: -0.04em;
  margin: 0 0 20px;
}
p {
  line-height: 1.6;
}
label {
  display: block;
  margin: 28px 0 8px;
  font-weight: 600;
}
input,
select {
  width: 100%;
  min-height: 48px;
  border: 1px solid var(--situate-control-line);
  border-radius: 10px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  padding: 10px;
  font: inherit;
}
.small {
  font-size: 13px;
  color: var(--situate-muted);
}
button {
  min-height: 44px;
  border: 1px solid var(--situate-control-line);
  border-radius: 99px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  padding: 10px 20px;
  font: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
.primary,
.connection :deep(button.primary) {
  background: var(--workspace-accent);
  color: var(--workspace-on-accent);
  border-color: var(--situate-ink);
}
.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 24px;
}
:where(button, input, select):focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-ink);
  outline-offset: var(--situate-focus-offset);
}

@media (max-width: 420px) {
  .connection :deep(.providers) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
