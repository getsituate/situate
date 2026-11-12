<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { setupCopy } from "../workspaces/setup-content";
import {
  accentStyle,
  type FirstEntryAction,
  type FirstEntryState,
} from "../workspaces/first-entry";
import SetupFrame from "../workspaces/SetupFrame.vue";
import { useSetupTransition } from "../workspaces/use-setup-transition";
import { useFinalePlayback } from "../workspaces/setup-journey/finale/use-finale-playback";
import { finaleTiming } from "../workspaces/setup-journey/finale/score";
import finaleCopy from "../localization/en.setup-finale.json";
import AppShell from "../components/AppShell.vue";
import ChatView from "../chat/ChatView.vue";
import MarkdownContent from "../editor/MarkdownContent.vue";
import SetupConversationChat from "./SetupConversationChat.vue";
import {
  SituateButton,
  SituateTextarea,
  SituateCheckbox,
  SituateRadio,
  SituateDialog,
} from "../ui";
import copy from "../localization/en.setup-conversation.json";
import {
  importedExamples,
  setupStep,
  type SetupConversationState,
  type SetupConversationAction,
} from "./conversation-setup";

const props = defineProps<{
  state: SetupConversationState;
  workspaceName: string;
  mobile: boolean;
  preparationStep?: 0 | 1;
  entry?: FirstEntryState;
}>();
const emit = defineEmits<{
  action: [action: SetupConversationAction];
  "entry-action": [action: FirstEntryAction];
  navigate: [feature: "workspace" | "settings" | "plugins"];
}>();
const root = ref<HTMLElement>();
const guidedChat = ref<InstanceType<typeof SetupConversationChat>>();
const appChat = ref<InstanceType<typeof SetupConversationChat>>();
const reader = ref<InstanceType<typeof SituateDialog>>();
const file = computed(() =>
  importedExamples.find((file) => file.path === props.state.readFile),
);
const act = (action: SetupConversationAction) => emit("action", action);
const celebrating = computed(() => props.state.finale.status === "playing");
const finale = useFinalePlayback(
  root,
  () => props.state.finale,
  () => props.state.motionPaused || !!props.entry?.paused,
  () => act({ type: "finale-finish" }),
);
const reveal = computed(() => finaleTiming(finale.time.value));
const transition = useSetupTransition(
  root,
  () =>
    props.state.motionPaused ||
    !!props.entry?.paused ||
    props.entry?.step === "paused",
  () => props.entry?.transitionTime ?? null,
  () => props.entry?.openingTime ?? null,
);
const step = computed(() => props.preparationStep ?? setupStep(props.state));
const frame = computed(() =>
  transition.active.value && transition.mode.value === "step"
    ? transition.frame.value
    : undefined,
);
const opening = computed(() =>
  props.preparationStep === 0 ? transition.opening.value : undefined,
);
const shownPreparation = computed(() =>
  frame.value && !frame.value.incoming && frame.value.from < 2
    ? frame.value.from
    : props.preparationStep,
);
watch(step, (next, before) => transition.start(before, next));
onMounted(() => {
  if (props.preparationStep === 0 && props.entry?.openingAvailable)
    transition.startOpening();
});
watch(
  () => props.entry?.openingRun,
  (next, previous) => {
    if (next !== previous && props.preparationStep === 0)
      transition.startOpening();
  },
);
watch(
  () => props.entry?.transitionRun,
  (next, previous) => {
    if (next !== previous && props.preparationStep === 1)
      transition.start(0, 1);
  },
);
watch(
  () => props.entry?.transitionAvailable,
  (available, previous) => {
    if (previous && !available && props.preparationStep === 1)
      transition.finish();
  },
);
const secondary = computed(() => ({ ...props.state.otherChat, empty: false }));
const secondaryEvents = computed(() => props.state.otherChat.transcript ?? []);
const status = computed(() =>
  props.state.phase === "import"
    ? copy.importStatus
    : props.state.phase === "support"
      ? copy.supportStatus
      : props.state.phase === "done"
        ? copy.doneStatus
        : copy.methodStatus,
);
function read(path: string) {
  act({ type: "read", path });
}
watch(
  () => props.state.readFile,
  async (path) => {
    await nextTick();
    const dialog = reader.value?.element;
    if (path && !dialog?.open) dialog?.showModal();
    else if (!path && dialog?.open) dialog.close();
  },
);
watch(celebrating, async (playing) => {
  if (playing) {
    await nextTick();
    root.value?.querySelector<HTMLButtonElement>(".finale-skip")?.focus();
  }
});
watch(
  [
    () => props.state.view,
    () => props.state.pane,
    () => props.state.phase === "brief",
  ],
  async () => {
    await nextTick();
    if (celebrating.value) return;
    if (props.state.phase === "brief")
      root.value
        ?.querySelector<HTMLTextAreaElement>(".starting-details textarea")
        ?.focus();
    else if (props.state.view === "guided") guidedChat.value?.focusTitle();
    else if (props.state.pane === "setup") appChat.value?.focusTitle();
    else
      root.value
        ?.querySelector<HTMLTextAreaElement>(".app-pane textarea")
        ?.focus();
  },
);
</script>
<template>
  <div
    ref="root"
    class="conversation-setup"
    :class="{ 'workspace-setup': state.view === 'guided' || celebrating }"
    :style="entry ? accentStyle(entry.accent) : undefined"
    :data-finale-time="celebrating ? finale.time.value : undefined"
    :data-opening="!!opening && transition.active.value"
    :data-opening-time="opening?.time"
    :data-transitioning="!!frame"
    :data-transition-time="transition.frame.value.time"
    :data-view="state.view"
    :data-phase="state.phase"
    :data-finalizing="celebrating"
  >
    <div
      v-if="state.view === 'app' || celebrating"
      class="app-destination workspace-destination"
      :style="
        celebrating
          ? { transform: `scale(${reveal.workspaceScale})` }
          : undefined
      "
      :inert="celebrating || undefined"
      :aria-hidden="celebrating || undefined"
    >
      <AppShell
        :workspace-name="workspaceName"
        :mobile="mobile"
        collapsible
        @workspaces="emit('navigate', 'workspace')"
        @close-workspace="emit('navigate', 'workspace')"
        @settings="emit('navigate', 'settings')"
        @plugins="emit('navigate', 'plugins')"
      >
        <template #sidebar-content="navigation">
          <div class="setup-sidebar">
            <SituateButton
              variant="plain"
              :aria-current="state.pane === 'files' ? 'page' : undefined"
              @click="
                act({ type: 'pane', value: 'files' });
                navigation.closeNavigation();
              "
              >{{ copy.files }}</SituateButton
            >
            <p>{{ copy.conversations }}</p>
            <SituateButton
              variant="plain"
              :aria-current="state.pane === 'setup' ? 'page' : undefined"
              @click="
                act({ type: 'pane', value: 'setup' });
                navigation.closeNavigation();
              "
              >{{ copy.title }}<small>{{ status }}</small></SituateButton
            >
            <SituateButton
              variant="plain"
              :aria-current="state.pane === 'new' ? 'page' : undefined"
              @click="
                act({ type: 'pane', value: 'new' });
                navigation.closeNavigation();
              "
              >{{ copy.newChat }}</SituateButton
            >
            <SituateButton
              v-if="state.developmentStarted"
              variant="plain"
              :aria-current="state.pane === 'development' ? 'page' : undefined"
              @click="
                act({ type: 'pane', value: 'development' });
                navigation.closeNavigation();
              "
              >{{ copy.developmentTitle }}</SituateButton
            >
          </div>
        </template>
        <template #default="navigation">
          <main class="app-content">
            <nav class="setup-tabs" aria-label="Tabs">
              <SituateButton
                variant="plain"
                :aria-current="state.pane === 'setup' ? 'page' : undefined"
                @click="act({ type: 'pane', value: 'setup' })"
                >{{ copy.title }}</SituateButton
              >
              <SituateButton
                variant="plain"
                :aria-current="state.pane === 'new' ? 'page' : undefined"
                @click="act({ type: 'pane', value: 'new' })"
                >+ {{ copy.newChat }}</SituateButton
              >
            </nav>
            <div class="setup-status">
              <span role="status"
                >{{ copy.setupStatus }} · {{ status
                }}<template v-if="state.imported.length">
                  · {{ state.imported.length }}
                  {{
                    state.imported.length === 1 ? copy.countOne : copy.count
                  }}</template
                ></span
              >
              <SituateButton variant="plain" @click="act({ type: 'guided' })"
                >{{ copy.guided }} ↗</SituateButton
              >
            </div>
            <div class="app-pane">
              <SetupConversationChat
                v-if="state.pane === 'setup'"
                ref="appChat"
                :state="state"
                :show-navigation="navigation.showNavigation"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                @open-navigation="navigation.openNavigation"
                @action="act"
                @read="read"
              />
              <ChatView
                v-else-if="state.pane === 'new'"
                :state="secondary"
                :conversation="{
                  title: copy.newChat,
                  events: secondaryEvents,
                  working: '',
                  stopped: '',
                  error: '',
                }"
                :send-enabled="true"
                :show-navigation="navigation.showNavigation"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                @open-navigation="navigation.openNavigation"
                @update:state="act({ type: 'other-chat', state: $event })"
                @send="act({ type: 'other-send' })"
              >
                <template #thread-start
                  ><p v-if="!secondaryEvents.length" class="parallel-help">
                    {{ copy.parallelHelp }}
                  </p></template
                >
              </ChatView>
              <section
                v-else-if="state.pane === 'files'"
                class="file-list"
                :aria-label="copy.fileTitle"
              >
                <h1>{{ copy.fileTitle }}</h1>
                <p v-if="!state.imported.length">{{ copy.noFiles }}</p>
                <SituateButton
                  v-for="path in state.imported"
                  :key="path"
                  variant="plain"
                  @click="
                    ($event.currentTarget as HTMLElement).focus();
                    read(path);
                  "
                  >{{ path }} ↗</SituateButton
                >
                <SituateButton
                  variant="secondary"
                  @click="act({ type: 'pane', value: 'setup' })"
                  >{{ copy.title }}</SituateButton
                >
              </section>
              <ChatView
                v-else
                :state="{ ...state.developmentChat, empty: false }"
                :conversation="{
                  title: copy.developmentTitle,
                  events: state.developmentChat.transcript ?? [],
                  working: '',
                  stopped: '',
                  error: '',
                }"
                :send-enabled="true"
                :show-navigation="navigation.showNavigation"
                :navigation-id="navigation.navigationId"
                :navigation-open="navigation.navigationOpen"
                @open-navigation="navigation.openNavigation"
                @update:state="act({ type: 'development-chat', state: $event })"
                @send="act({ type: 'development-send' })"
              />
            </div>
          </main>
        </template>
      </AppShell>
    </div>
    <SetupFrame
      v-if="state.view === 'guided' || celebrating"
      class="guided-setup"
      :class="{
        'with-conversation':
          preparationStep === undefined && state.phase !== 'brief',
      }"
      continuous
      :workspace="preparationStep === 0 ? undefined : workspaceName"
      :step="frame?.activeStep ?? step"
      :progress-reveal="opening?.reveal ?? 1"
      :transition="!celebrating ? frame : undefined"
      :opening="opening"
      :paused="state.motionPaused || entry?.paused || entry?.step === 'paused'"
      :blocked="!!state.error || entry?.check === 'failed'"
      :finale-time="celebrating ? finale.time.value : undefined"
    >
      <template #actions>
        <SituateButton
          v-if="
            preparationStep !== undefined &&
            entry?.created &&
            entry.step !== 'paused'
          "
          variant="plain"
          class="finish-later"
          @click="emit('entry-action', { type: 'pause-setup' })"
          >{{ setupCopy.pause }}</SituateButton
        >
        <SituateButton
          v-else-if="preparationStep === undefined"
          variant="secondary"
          :disabled="!state.confirmed"
          @click="act({ type: 'open-app' })"
          >{{ copy.openApp }} ↗</SituateButton
        ></template
      >
      <template #finale-actions>
        <SituateButton
          variant="plain"
          class="finale-pause"
          :aria-pressed="state.finale.paused"
          @click="act({ type: 'finale-pause' })"
          >{{
            state.finale.paused ? finaleCopy.resume : finaleCopy.pause
          }}</SituateButton
        >
        <SituateButton
          variant="plain"
          class="finale-skip"
          @click="finale.finish"
          >{{ finaleCopy.skip }}
          <span aria-hidden="true">↗</span></SituateButton
        >
      </template>
      <div
        v-if="shownPreparation !== undefined"
        class="transition-panel preparation-panel"
        :inert="frame && !frame.incoming ? true : undefined"
        :style="
          frame
            ? {
                opacity: frame.panelOpacity,
                transform: `translateY(${frame.panelY}px)`,
              }
            : undefined
        "
      >
        <slot name="preparation" :step="shownPreparation" />
      </div>
      <form
        v-else-if="state.phase === 'brief'"
        class="starting-details"
        @submit.prevent="act({ type: 'start' })"
      >
        <h1>{{ copy.briefTitle }}</h1>
        <p>{{ copy.briefHelp }}</p>
        <label v-if="!state.fresh" for="setup-sources"
          >{{ copy.sourceLabel
          }}<SituateTextarea
            id="setup-sources"
            :value="state.sources"
            :placeholder="copy.sourcePlaceholder"
            rows="2"
            required
            @input="
              act({
                type: 'details',
                patch: {
                  sources: ($event.target as HTMLTextAreaElement).value,
                },
              })
            "
        /></label>
        <label class="fresh-choice"
          ><SituateCheckbox
            :checked="state.fresh"
            @change="
              act({
                type: 'details',
                patch: { fresh: ($event.target as HTMLInputElement).checked },
              })
            "
          />{{ copy.fresh }}</label
        >
        <fieldset>
          <legend>{{ copy.intentLabel }}</legend>
          <label
            v-for="intent in ['keep', 'change', 'help'] as const"
            :key="intent"
            class="intent-choice"
            :class="{ selected: state.intent === intent }"
            ><SituateRadio
              name="setup-intent"
              :value="intent"
              :checked="state.intent === intent"
              @change="act({ type: 'details', patch: { intent } })"
            />{{ copy[intent] }}</label
          >
        </fieldset>
        <label for="setup-preferences"
          >{{ copy.preferences
          }}<SituateTextarea
            id="setup-preferences"
            aria-describedby="setup-preferences-hint"
            :value="state.preferences"
            rows="2"
            @input="
              act({
                type: 'details',
                patch: {
                  preferences: ($event.target as HTMLTextAreaElement).value,
                },
              })
            "
        /></label>
        <span id="setup-preferences-hint" class="hint">{{
          copy.preferencesHint
        }}</span>
        <SituateButton
          type="submit"
          :disabled="!state.fresh && !state.sources.trim()"
          >{{ copy.start }}</SituateButton
        >
      </form>
      <div v-else class="guided-conversation">
        <SetupConversationChat
          ref="guidedChat"
          hide-header
          :state="state"
          @action="act"
          @read="read"
        />
      </div>
    </SetupFrame>
    <SituateDialog
      ref="reader"
      class="import-reader"
      :aria-label="file?.path"
      @cancel="act({ type: 'close-reader' })"
      @close="act({ type: 'close-reader' })"
    >
      <template v-if="file"
        ><header>
          <h2 data-dialog-title>{{ file.path }}</h2>
          <SituateButton variant="plain" @click="reader?.element?.close()">{{
            copy.close
          }}</SituateButton>
        </header>
        <MarkdownContent
          data-dialog-document
          :content="file.text"
          readonly
          :readonly-description="copy.readOnly"
      /></template>
    </SituateDialog>
  </div>
</template>
<style scoped>
.conversation-setup {
  height: 100%;
  min-height: 0;
  position: relative;
  background: var(--situate-paper);
}
.app-destination {
  position: absolute;
  inset: 0;
  transform-origin: center;
}
.guided-setup {
  position: absolute;
  inset: 0;
  z-index: 2;
}
.transition-panel {
  min-width: 0;
}
.finish-later {
  min-height: 44px;
  border: 1px solid var(--situate-control-line);
  border-radius: 99px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  padding: 10px 20px;
  font: inherit;
  cursor: pointer;
}
.starting-details {
  display: grid;
  gap: 14px;
}
.guided-setup:not(.with-conversation) :deep(.setup-panel) {
  padding: 28px 32px;
}
.starting-details :deep(textarea) {
  font-weight: 400;
}
.starting-details h1 {
  font-size: clamp(24px, 2.8vw, 36px);
  line-height: 1.15;
  letter-spacing: -0.035em;
  margin: 0;
}
.starting-details p {
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
  background: var(--workspace-accent-soft, var(--situate-paper));
}
.intent-choice input {
  accent-color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.hint {
  color: var(--situate-muted);
  font-size: 12px !important;
  font-weight: 400;
  line-height: 1.5;
}
.guided-conversation {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.guided-conversation > .setup-conversation {
  flex: 1;
  min-height: 0;
}
.with-conversation :deep(.frame-stage) {
  width: 100%;
  align-items: stretch;
}
.with-conversation :deep(.setup-panel) {
  width: 100%;
  padding: 0;
  height: 100%;
  overflow: hidden;
}
.setup-sidebar {
  display: flex;
  flex-direction: column;
  padding: 8px 12px;
  gap: 6px;
}
.setup-sidebar p {
  margin: 20px 8px 4px;
  color: var(--situate-muted);
  font-size: 12px;
}
.setup-sidebar button {
  background: transparent;
  border: 0;
  color: var(--situate-ink);
  font: inherit;
  min-height: 44px;
  text-align: left;
  padding: 10px;
  border-radius: 8px;
  font-size: 13px;
}
.setup-sidebar button[aria-current] {
  background: var(--situate-paper);
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.setup-sidebar small {
  display: block;
  color: var(--situate-muted);
  margin-top: 6px;
  font-size: 11px;
}
.app-content {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.setup-tabs {
  display: flex;
  border-bottom: 1px solid var(--situate-line);
  padding: 0 12px;
  gap: 16px;
}
.setup-tabs button {
  background: transparent;
  border: 0;
  color: var(--situate-ink);
  font: inherit;
  padding: 12px 4px;
  font-size: 12px;
  border-bottom: 2px solid transparent;
}
.setup-tabs button[aria-current] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  border-bottom-color: currentColor;
}
.setup-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 20px;
  background: var(--situate-paper);
  border-bottom: 1px solid var(--situate-line);
  font-size: 12px;
}
.setup-status button {
  border: 0;
  background: transparent;
  font: inherit;
  padding: 8px 0;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  flex: none;
}
.app-pane {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.parallel-help {
  color: var(--situate-muted);
  font-size: 14px;
  line-height: 1.6;
}
.file-list {
  padding: 28px;
  display: grid;
  gap: 18px;
  align-content: start;
  height: 100%;
  overflow: auto;
}
.file-list h1 {
  font-size: 22px;
  margin: 0;
}
.file-list button:not(.situate-button) {
  border: 0;
  background: transparent;
  font: inherit;
  padding: 12px;
}
.import-reader header button {
  border: 0;
  background: transparent;
  font: inherit;
  padding: 10px;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.file-list button {
  text-align: left;
  overflow-wrap: anywhere;
}
.finale-skip,
.finale-pause {
  min-height: 44px;
  padding: 10px 18px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  border: 1px solid var(--situate-line);
  border-radius: 999px;
}
.finale-skip {
  background: var(--situate-plum);
  color: var(--situate-paper);
  margin-left: 10px;
}
.import-reader {
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  padding: 24px;
  overflow: auto;
}
.import-reader header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
@media (max-height: 500px) and (max-width: 700px) {
  .guided-setup.with-conversation:not(.finale-frame) {
    overflow: auto;
  }
  .with-conversation :deep(.frame-header),
  .with-conversation :deep(.progress-reveal) {
    flex-shrink: 0;
  }
  .with-conversation:not(.finale-frame) :deep(.frame-stage) {
    flex: 0 0 320px;
    min-height: 320px;
  }
}
@media (max-width: 700px) {
  .with-conversation:not(.finale-frame) :deep(.frame-art) {
    display: none;
  }
  .with-conversation :deep(.frame-stage) {
    flex: 1;
    min-height: 0;
  }
  .with-conversation :deep(.setup-panel) {
    min-height: 0;
  }
  .guided-setup.with-conversation {
    display: flex;
    flex-direction: column;
  }
  .setup-status {
    padding-inline: 12px;
  }
  .setup-tabs {
    gap: 10px;
  }
}
</style>
