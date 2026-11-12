<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import resultCopy from "../localization/en.import-result.json";
import folderArtwork from "../brand/assets/collection-folder.svg";
import { importHandoffDuration, importHandoffFrame } from "./import-result";
import { useFinalePlayback } from "../workspaces/setup-journey/finale/use-finale-playback";
import ChatView from "../chat/ChatView.vue";
import { createChatState } from "../chat/model";
import { SituateButton } from "../ui";
import copy from "../localization/en.import-preparation.json";
import { f } from "./flow-content";
import type { OnboardingAction, OnboardingState } from "./model";
import type { SourceAction } from "./source-conversation";
const props = defineProps<{
  state: OnboardingState;
  showNavigation?: boolean;
  navigationId?: string;
  navigationOpen?: boolean;
}>();
const emit = defineEmits<{
  action: [action: OnboardingAction];
  "open-navigation": [event: MouseEvent];
}>();
const root = ref<HTMLElement>();
const skipControl = ref<InstanceType<typeof SituateButton>>();
const skip = computed(() => skipControl.value?.element);
const view = ref<InstanceType<typeof ChatView>>();
const transitioning = computed(
  () =>
    props.state.importHandoff.status === "playing" &&
    props.state.sourceConversation.ready &&
    props.state.importState === "ready" &&
    !props.state.sourceConversation.draft.trim(),
);
const clock = useFinalePlayback(
  root,
  () =>
    transitioning.value
      ? props.state.importHandoff
      : { ...props.state.importHandoff, status: "idle" },
  () => props.state.motionPaused,
  () =>
    emit("action", {
      type: "finish-import-handoff",
      run: props.state.importHandoff.run,
    }),
  importHandoffDuration,
);
const frame = computed(() => importHandoffFrame(clock.time.value));
watch(
  transitioning,
  async (active) => {
    if (active) {
      await nextTick();
      skip.value?.focus({ preventScroll: true });
    }
  },
  { immediate: true },
);
const base = createChatState("chat-existing");
const chat = computed(() => ({
  ...base,
  phase: props.state.sourceConversation.phase,
  draft: props.state.sourceConversation.draft,
}));
const act = (action: OnboardingAction) => emit("action", action);
const source = (action: SourceAction) => act({ type: "source-chat", action });
onMounted(() => {
  if (!transitioning.value) void nextTick(() => view.value?.focusTitle());
});
</script>
<template>
  <div
    ref="root"
    class="source-conversation"
    :data-handoff-time="transitioning ? clock.time.value : undefined"
  >
    <div
      class="conversation-content"
      :inert="transitioning || undefined"
      :aria-hidden="transitioning || undefined"
      :style="
        transitioning
          ? {
              opacity: frame.chatOpacity,
              transform: `scale(${frame.chatScale})`,
            }
          : undefined
      "
    >
      <ChatView
        ref="view"
        :state="chat"
        :conversation="{
          title: copy.title,
          events: state.sourceConversation.messages,
          working: copy.working,
          stopped: copy.stopped,
          error: state.importConflict ? resultCopy.conflict : copy.error,
        }"
        :send-enabled="state.connected"
        hide-model-choice
        :show-navigation="showNavigation"
        :navigation-id="navigationId"
        :navigation-open="navigationOpen"
        @open-navigation="emit('open-navigation', $event)"
        @update:state="source({ type: 'draft', value: $event.draft })"
        @send="source({ type: 'send' })"
        @stop="source({ type: 'stop' })"
      >
        <template #actions>
          <SituateButton
            variant="plain"
            class="source-back"
            @click="act({ type: 'close-source-chat' })"
            >{{ copy.back }}</SituateButton
          >
        </template>
        <template #thread-start>
          <aside
            v-if="state.sourceIntent !== 'initial'"
            class="import-guidance"
          >
            <p>
              {{
                state.sourceIntent === "changes"
                  ? resultCopy.changesHelp
                  : resultCopy.additionalHelp
              }}
            </p>
          </aside>
        </template>
        <template #thread-end>
          <section class="conversation-actions">
            <template
              v-if="
                state.importState === 'partial' &&
                state.sourceConversation.phase !== 'working'
              "
            >
              <ul>
                <li v-for="file in state.imported" :key="file.key">
                  {{ [file.folder, file.name].filter(Boolean).join("/") }}
                </li>
              </ul>
              <SituateButton
                class="secondary"
                :disabled="
                  !state.connected || !!state.sourceConversation.draft.trim()
                "
                @click="
                  source({ type: 'draft', value: copy.retryRequest });
                  source({ type: 'send' });
                "
                >{{ copy.retryPartial }}</SituateButton
              >
            </template>
            <template v-if="!state.connected">
              <p role="status">{{ copy.offline }}</p>
              <SituateButton
                class="secondary"
                @click="
                  act({
                    type: 'patch',
                    patch: { step: 'access', resumeStep: 'source-chat' },
                  })
                "
                >{{ copy.reconnect }}</SituateButton
              >
            </template>
            <SituateButton
              v-if="
                ['error', 'cancelled'].includes(state.sourceConversation.phase)
              "
              class="secondary"
              :disabled="!state.connected"
              @click="source({ type: 'retry' })"
              >{{ copy.retry }}</SituateButton
            >
            <SituateButton
              v-if="
                state.sourceConversation.ready &&
                state.importState === 'ready' &&
                state.sourceConversation.phase === 'complete'
              "
              :disabled="!state.connected"
              @click="act({ type: 'review-source' })"
              >{{ copy.review }}</SituateButton
            >
            <template
              v-if="
                state.importApproved &&
                state.importState !== 'ready' &&
                !state.importConflict
              "
            >
              <p role="status">
                {{
                  state.importState === "partial" &&
                  state.sourceConversation.phase !== "working"
                    ? copy.partialStatus
                    : f.importStates[state.importState]
                }}
              </p>
              <p>{{ f.availableCount(state.imported.length) }}</p>
              <SituateButton
                v-if="
                  ['failed', 'blocked', 'paused', 'deferred'].includes(
                    state.importState,
                  )
                "
                class="secondary"
                :disabled="!state.connected"
                @click="act({ type: 'resume-import' })"
                >{{ f.retryImport }}</SituateButton
              >
            </template>
          </section>
        </template>
      </ChatView>
      <nav
        v-if="!state.confirmed"
        class="import-navigation"
        :aria-label="copy.title"
      >
        <div class="import-navigation-inner">
          <span v-if="state.imported.length" class="added-count">{{
            state.imported.length === 1
              ? copy.addedOne
              : copy.added.replace("{count}", String(state.imported.length))
          }}</span>
          <SituateButton
            variant="plain"
            class="next-step"
            :class="{
              'skip-link':
                !state.imported.length &&
                state.sourceConversation.phase !== 'working',
            }"
            @click="act({ type: 'defer' })"
            >{{
              state.sourceConversation.phase === "working"
                ? copy.pauseNext
                : state.imported.length
                  ? copy.next
                  : copy.later
            }}</SituateButton
          >
        </div>
      </nav>
    </div>
    <section
      v-if="transitioning"
      class="import-handoff"
      :style="{
        backgroundColor: `color-mix(in srgb, var(--situate-paper) ${(1 - frame.chatOpacity) * 100}%, transparent)`,
      }"
      :aria-label="resultCopy.title"
    >
      <div
        class="handoff-message"
        :style="{
          opacity: frame.reveal,
          transform: `translateY(${frame.lift}px)`,
        }"
      >
        <img :src="folderArtwork" alt="" />
        <h2 role="status">{{ resultCopy.title }}</h2>
        <p>{{ resultCopy.handoffDetail }}</p>
      </div>
      <div class="handoff-actions">
        <SituateButton
          variant="plain"
          ref="skipControl"
          class="view-files"
          @click="act({ type: 'review-source' })"
        >
          {{ resultCopy.ready }}
        </SituateButton>
      </div>
    </section>
  </div>
</template>
<style scoped>
.source-conversation,
.conversation-content {
  height: 100%;
  min-height: 0;
}
.conversation-content {
  display: flex;
  flex-direction: column;
}
.conversation-content :deep(.chat-screen) {
  flex: 1;
  height: auto;
}
.conversation-content :deep(.chat-footer) {
  padding-bottom: 12px;
}
.source-back {
  min-height: 44px;
  padding: 8px 12px;
  border: 0;
  border-radius: 99px;
  background: transparent;
  color: var(--situate-ink);
  font: inherit;
  cursor: pointer;
}
.import-navigation {
  flex: none;
  padding: 0 28px 16px;
  background: var(--situate-surface);
}
.import-navigation-inner {
  max-width: 688px;
  margin-inline: auto;
  border-top: 1px solid var(--situate-line);
  padding-top: 12px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.added-count {
  color: var(--situate-muted);
  font-size: 13px;
}
.next-step {
  margin-left: auto;
  min-height: 44px;
  padding: 9px 17px;
  border: 1px solid var(--situate-control-line);
  border-radius: 99px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  font: inherit;
  cursor: pointer;
}
.next-step.skip-link {
  border-color: transparent;
  color: var(--situate-muted);
  text-decoration: underline;
  text-underline-offset: 4px;
}
.source-back:hover,
.next-step:hover {
  background: var(--situate-paper);
}
.source-back:focus-visible,
.next-step:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -3px;
}
@media (max-width: 700px) {
  .import-navigation {
    padding-inline: 16px;
    padding-bottom: 12px;
  }
}
@media (max-height: 400px) {
  .import-navigation {
    padding-bottom: 6px;
  }
  .import-navigation-inner {
    padding-top: 4px;
  }
}
.source-conversation {
  position: relative;
  overflow: hidden;
}
.import-handoff {
  position: absolute;
  inset: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  padding: 24px;
}
.handoff-message {
  text-align: center;
  max-width: 440px;
}
.handoff-message img {
  width: 150px;
  height: 120px;
  object-fit: contain;
}
.handoff-message h2 {
  font-size: clamp(26px, 4vw, 38px);
  line-height: 1.15;
  letter-spacing: -0.035em;
  margin: 20px 0 12px;
}
.handoff-message p {
  color: var(--situate-muted);
}
.handoff-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.handoff-actions button {
  min-height: 44px;
  padding: 10px 18px;
  border: 1px solid var(--situate-control-line);
  border-radius: 99px;
  font: inherit;
  background: var(--situate-surface);
  color: var(--situate-ink);
  cursor: pointer;
}
.handoff-actions .view-files {
  background: var(--situate-violet-deep);
  color: var(--situate-surface);
  border-color: var(--situate-violet-deep);
}
.handoff-actions button:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@media (max-height: 400px) {
  .import-handoff {
    gap: 16px;
    padding: 16px;
  }
  .handoff-message img {
    width: 80px;
    height: 55px;
  }
  .handoff-message h2 {
    margin: 8px 0;
    font-size: 26px;
  }
}
.secondary {
  min-height: 44px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  border: 1px solid var(--situate-control-line);
}
.secondary:hover:not(:disabled) {
  background: var(--situate-paper);
  color: var(--situate-ink);
}
.import-guidance {
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--situate-line);
  font-size: 14px;
}
.import-guidance h2 {
  margin: 0 0 8px;
  font-size: 16px;
  line-height: 1.4;
}
.import-guidance p {
  color: var(--situate-muted);
}
.conversation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.conversation-actions:empty {
  display: none;
}
p {
  flex-basis: 100%;
  margin: 0;
  line-height: 1.6;
}
</style>
