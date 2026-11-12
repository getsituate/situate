<script setup lang="ts">
import "@situate/localization/onboarding";
import { computed, useId } from "vue";
import { localizeError, t } from "@situate/localization";
import {
  SituateButton,
  SituateCheckbox,
  SituateRadio,
  SituateTextarea,
} from "@situate/ui";
import SetupFrame from "./SetupFrame.vue";
import type { OnboardingRecord } from "./types";

const props = defineProps<{
  state: OnboardingRecord;
  workspacePath: string;
  workspaceName?: string;
  initialFrom?: number;
  finaleTime?: number;
  busy: boolean;
  connected: boolean;
  access: boolean;
  accessConfigured: boolean;
  started: boolean;
  canFinish?: boolean;
  canContinueSupport?: boolean;
  error?: unknown;
}>();
const emit = defineEmits<{
  patch: [patch: Partial<OnboardingRecord>];
  action: [
    action:
      "start" | "enter" | "finish" | "support" | "pause" | "resume" | "retry",
  ];
}>();
const id = useId();
const intentLabels = computed(() => ({
  keep: t("onboarding.conversation.keep"),
  change: t("onboarding.conversation.change"),
  help: t("onboarding.conversation.help"),
}));
const conversation = computed(
  () => props.started && !props.access && !props.state.paused,
);
const step = computed(() =>
  props.access
    ? 1
    : ["sources", "review"].includes(props.state.step)
      ? 3
      : ["support", "complete"].includes(props.state.step)
        ? 4
        : 2,
);
function input(event: Event) {
  return (event.target as HTMLTextAreaElement).value;
}
</script>
<template>
  <SetupFrame
    continuous
    class="conversation-setup"
    :class="{ 'with-conversation': conversation }"
    :workspace="workspaceName ?? workspacePath"
    :step="step"
    :initial-from="initialFrom"
    :finale-time="finaleTime"
    :paused="state.paused"
    :blocked="!!error"
    :labelledby="
      conversation ? undefined : access && !accessConfigured ? 'ai-heading' : id
    "
  >
    <template #finale-actions><slot name="finale-actions" /></template>
    <template #actions>
      <div
        v-if="state.instructionRevision"
        class="conversation-actions"
        :class="{ 'with-completion': state.step === 'support' }"
      >
        <SituateButton
          v-if="
            started &&
            !access &&
            !state.paused &&
            !state.entered &&
            ['sources', 'review'].includes(state.step)
          "
          :disabled="busy || !canContinueSupport"
          @click="emit('action', 'support')"
          >{{ t("onboardingAgent.choice.support") }}</SituateButton
        >
        <SituateButton
          v-if="state.step === 'support' && state.instructionRevision"
          :disabled="busy || !canFinish"
          @click="emit('action', 'finish')"
          >{{ t("onboardingAgent.choice.finish") }}</SituateButton
        >
        <SituateButton
          variant="secondary"
          :disabled="busy || (!state.entered && !connected)"
          @click="emit('action', 'enter')"
          >{{ t("onboarding.conversation.openApp") }}
          <span aria-hidden="true">↗</span></SituateButton
        >
      </div>
    </template>
    <div v-if="state.paused" class="setup-message">
      <h1 :id="id">{{ t("onboarding.paused.title") }}</h1>
      <p>{{ t("onboarding.paused.detail") }}</p>
      <SituateButton :disabled="busy" @click="emit('action', 'resume')">{{
        t("onboarding.resume")
      }}</SituateButton>
    </div>
    <div v-else-if="access" class="setup-access-panel">
      <h1 v-if="accessConfigured" :id="id">
        {{ t("onboarding.access.modelTitle") }}
      </h1>
      <p v-if="accessConfigured">{{ t("onboarding.access.modelDetail") }}</p>
      <p v-if="error" role="alert">{{ localizeError(error) }}</p>
      <SituateButton
        v-if="error"
        variant="secondary"
        :disabled="busy"
        @click="emit('action', 'retry')"
        >{{ t("onboarding.retry") }}</SituateButton
      >
      <slot name="access" />
    </div>
    <form
      v-else-if="!started"
      class="starting-details"
      @submit.prevent="emit('action', 'start')"
    >
      <header class="method-introduction">
        <h1 :id="id">{{ t("onboarding.conversation.briefTitle") }}</h1>
        <p>{{ t("onboarding.conversation.briefHelp") }}</p>
      </header>
      <section class="conversation-explanation" :aria-labelledby="`${id}-chat`">
        <h2 :id="`${id}-chat`">{{ t("onboarding.conversation.chatTitle") }}</h2>
        <p>{{ t("onboarding.conversation.chatHelp") }}</p>
      </section>
      <p v-if="error" role="alert">{{ localizeError(error) }}</p>
      <SituateButton
        v-if="error"
        variant="secondary"
        :disabled="busy"
        @click="emit('action', 'retry')"
        >{{ t("onboarding.retry") }}</SituateButton
      >
      <div class="source-details">
        <p :id="`${id}-source-help`">
          {{ t("onboarding.conversation.sourceHelp") }}
        </p>
        <label v-if="!state.fresh" :for="`${id}-sources`"
          >{{ t("onboarding.conversation.sources") }}
          <SituateTextarea
            :id="`${id}-sources`"
            :value="state.sourceDescription"
            :aria-describedby="`${id}-source-help`"
            :placeholder="t('onboarding.conversation.sourcesPlaceholder')"
            rows="2"
            required
            :disabled="busy"
            @input="emit('patch', { sourceDescription: input($event) })"
          />
        </label>
        <label class="fresh-choice"
          ><SituateCheckbox
            :checked="!!state.fresh"
            :disabled="busy"
            @change="
              emit('patch', {
                fresh: ($event.target as HTMLInputElement).checked,
              })
            "
          />{{ t("onboarding.conversation.fresh") }}</label
        >
      </div>
      <div class="method-preferences">
        <fieldset :disabled="busy">
          <legend>{{ t("onboarding.conversation.intent") }}</legend>
          <label
            v-for="intent in ['keep', 'change', 'help'] as const"
            :key="intent"
            class="intent-choice"
            :class="{ selected: (state.intent ?? 'help') === intent }"
          >
            <SituateRadio
              :name="`${id}-intent`"
              :value="intent"
              :checked="(state.intent ?? 'help') === intent"
              @change="emit('patch', { intent })"
            />{{ intentLabels[intent] }}
          </label>
        </fieldset>
        <label :for="`${id}-preferences`"
          >{{ t("onboarding.conversation.preferences") }}
          <SituateTextarea
            :id="`${id}-preferences`"
            :value="state.description"
            :aria-describedby="`${id}-hint`"
            rows="2"
            :disabled="busy"
            @input="emit('patch', { description: input($event) })"
          />
        </label>
        <span :id="`${id}-hint`" class="hint">{{
          t("onboarding.conversation.preferencesHint")
        }}</span>
      </div>
      <div class="setup-next">
        <p>{{ t("onboarding.conversation.laterHelp") }}</p>
        <SituateButton
          type="submit"
          :disabled="
            busy ||
            !connected ||
            (!state.fresh && !state.sourceDescription.trim())
          "
          >{{ t("onboarding.conversation.start") }}</SituateButton
        >
      </div>
    </form>
    <div v-else class="guided-conversation">
      <div v-if="error" class="setup-error" role="alert">
        <p>{{ localizeError(error) }}</p>
        <SituateButton
          variant="secondary"
          size="small"
          :disabled="busy"
          @click="emit('action', 'retry')"
          >{{ t("onboarding.retry") }}</SituateButton
        >
      </div>
      <slot name="notices" />
      <slot name="conversation" />
    </div>
  </SetupFrame>
</template>
<style scoped>
.conversation-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}
.conversation-actions.with-completion
  :deep(.situate-button.situate-button--secondary:not(:disabled)) {
  background: var(--situate-surface);
  color: var(--situate-ink);
  border-color: var(--situate-control-line);
}
.starting-details,
.setup-access-panel,
.setup-message {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.starting-details {
  gap: 28px;
}
.method-introduction,
.conversation-explanation,
.source-details,
.method-preferences,
.setup-next {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.method-introduction p {
  max-width: 55ch;
  font-size: 16px;
}
.conversation-explanation {
  padding: 16px 18px;
  border-radius: 12px;
  background: var(--situate-accent-soft, var(--situate-paper));
  gap: 6px;
}
.conversation-explanation h2 {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
}
.method-preferences {
  gap: 16px;
}
.setup-next {
  border-top: 1px solid var(--situate-line);
  padding-top: 20px;
  gap: 16px;
}
.starting-details p,
.starting-details h1,
.starting-details h2 {
  overflow-wrap: anywhere;
}
h1 {
  font-size: clamp(24px, 2.8vw, 36px);
  line-height: 1.15;
  letter-spacing: -0.035em;
  margin: 0;
}
p {
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}
.starting-details label {
  display: grid;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
.starting-details .fresh-choice {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 400;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
  display: grid;
  gap: 8px;
}
legend {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}
.starting-details .intent-choice {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--situate-line);
  border-radius: 12px;
  padding: 12px;
  min-height: 48px;
  font-weight: 400;
}
.intent-choice.selected {
  border-color: var(--situate-accent-strong, var(--situate-violet-deep));
  background: var(--situate-accent-soft, var(--situate-paper));
}
.hint {
  color: var(--situate-muted);
  font-size: 12px;
  line-height: 1.5;
}
.with-conversation {
  display: flex;
  flex-direction: column;
  overflow: auto;
}
.with-conversation :deep(.frame-header),
.with-conversation :deep(.setup-steps) {
  flex: none;
}
.with-conversation :deep(.frame-stage) {
  width: 100%;
  flex: 1;
  min-height: 0;
  align-items: stretch;
}
.with-conversation :deep(.setup-panel) {
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
}
.guided-conversation {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.guided-conversation :deep(.chat-pane) {
  flex: 1;
  min-height: 0;
  width: 100%;
}
@media (max-width: 1000px) {
  .with-conversation :deep(.frame-stage) {
    grid-template-columns: minmax(0, 1fr);
  }
  .with-conversation :deep(.frame-art) {
    display: none;
  }
}
.setup-error {
  padding: 12px 20px;
  flex: none;
}
.setup-error p {
  margin-bottom: 8px;
}
</style>
