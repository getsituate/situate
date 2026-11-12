<script setup lang="ts">
import { sendWorkTimeMessage, finishWorkTime } from "./work-time";
import ConversationTranscript from "./ConversationTranscript.vue";
import QuestionPrompt from "./QuestionPrompt.vue";
import { activeQuestion, type QuestionResponse } from "./question";
import questionCopy from "../localization/en.chat-question.json";
import transcriptCopy from "../localization/en.chat-transcript.json";
import scrollCopyEn from "../localization/en.chat-scroll.json";
import scrollCopyDe from "../localization/de.chat-scroll.json";
import ChatTranscript from "./ChatTranscript.vue";
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import {
  changePhase,
  chooseThinking,
  commentRequest,
  events,
  simulatedComment,
  type ChatState,
  type Event,
} from "./model";
import ChatModelChoice from "./ChatModelChoice.vue";
import {
  chatGuard,
  cloneAiState,
  currentWorkspace,
  sendMessage,
} from "../ai/model";
import NavigationComposer from "../navigation/NavigationComposer.vue";

import ChatSystemAnnouncement from "../components/ChatSystemAnnouncement.vue";
import { systemMessageCopy } from "./system-message";
import ChatPaneHeader from "../components/ChatPaneHeader.vue";
import ChatWorkingIndicator from "../components/ChatWorkingIndicator.vue";
import ChatWelcome from "./ChatWelcome.vue";
import { SituateButton, SituateIconButton } from "../ui";
const props = defineProps<{
  state: ChatState;
  conversation?: {
    title: string;
    events: Event[];
    working: string;
    stopped: string;
    error: string;
  };
  sendEnabled?: boolean;
  hideModelChoice?: boolean;
  hideHeader?: boolean;
  retryEnabled?: boolean;
  startAtLatest?: boolean;
  showNavigation?: boolean;
  navigationId?: string;
  navigationOpen?: boolean;
}>();
const emit = defineEmits<{
  "update:state": [state: ChatState];
  "open-navigation": [event: MouseEvent];
  send: [];
  stop: [];
  retry: [];
  answer: [response: QuestionResponse];
  file: [path: string];
}>();
const transcript = computed(() => {
  if (props.conversation) return props.conversation.events;
  if (props.state.empty && !props.state.transcript) return [];
  return [
    ...(props.state.transcript ??
      (props.state.phase === "complete" ? events : events.slice(0, -1))),
    ...currentWorkspace(props.state.ai).history.map((text, index) => ({
      kind: "message" as const,
      speaker: "assistant" as const,
      id: `received-${index}`,
      text,
    })),
  ];
});
const dockedQuestion = computed(() => activeQuestion(transcript.value));
const transcriptEvents = computed(() =>
  dockedQuestion.value
    ? transcript.value.filter((event) => event.id !== dockedQuestion.value!.id)
    : transcript.value,
);
const questionTextId = useId();
const questionPanelId = useId();
const questionCollapsed = ref(false);
watch(
  () => dockedQuestion.value?.id,
  () => {
    questionCollapsed.value = false;
  },
);
function send() {
  if (props.conversation) emit("send");
  else submit();
}
function submit() {
  if (props.state.workTimeMs !== undefined) {
    emit("update:state", sendWorkTimeMessage(props.state));
    return;
  }
  const question = activeQuestion(props.state.transcript ?? []);
  if (question) {
    if (props.state.draft.trim())
      emit("answer", { questionId: question.id, text: props.state.draft });
    return;
  }
  const ai = cloneAiState(props.state.ai);
  currentWorkspace(ai).draft = props.state.draft;
  sendMessage(ai);
  emit("update:state", { ...props.state, ai });
}
const composer = ref<InstanceType<typeof NavigationComposer>>();
const heading = ref<InstanceType<typeof ChatPaneHeader>>();
const history = ref<HTMLElement>();
const thread = ref<HTMLElement>();
const awayFromEnd = ref(false);
const scrollCopy = computed(() =>
  props.state.composerLocale === "de" ? scrollCopyDe : scrollCopyEn,
);
let following = true;
function trackScroll() {
  const el = history.value;
  if (!el) return;
  awayFromEnd.value = el.scrollHeight - el.scrollTop - el.clientHeight > 48;
  following = !awayFromEnd.value;
}
function scrollToEnd() {
  const el = history.value;
  if (!el) return;
  el.focus({ preventScroll: true });
  following = true;
  el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  trackScroll();
}
watch(
  [history, thread],
  ([el, body], _previous, cleanup) => {
    if (!el || !body) return;
    following =
      !!props.startAtLatest ||
      el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
    awayFromEnd.value = !following;
    const observer = new ResizeObserver(() => {
      if (!el.clientHeight) return;
      if (following) el.scrollTop = el.scrollHeight;
      awayFromEnd.value = el.scrollHeight - el.scrollTop - el.clientHeight > 48;
    });
    observer.observe(el);
    observer.observe(body);
    cleanup(() => observer.disconnect());
  },
  { flush: "post" },
);
watch(
  () => props.conversation?.events.length ?? props.state.transcript?.length,
  async (_count, previousCount) => {
    const sent = (props.conversation?.events ?? props.state.transcript)
      ?.slice(previousCount ?? 0)
      .some((event) => event.kind === "message" && event.speaker === "user");
    const follow = following || sent;
    await nextTick();
    if (follow && history.value)
      history.value.scrollTop = history.value.scrollHeight;
  },
  { immediate: props.startAtLatest },
);
defineExpose({
  focusTitle: () =>
    props.hideHeader
      ? history.value?.focus({ preventScroll: true })
      : heading.value?.focusTitle(),
});
function answer(response: QuestionResponse) {
  emit("answer", response);
  if (response.optionId) void nextTick(() => composer.value?.focus());
}
const comment = ref(0);
const commentText = computed(() => {
  if (props.conversation) return props.conversation.working;
  const request = commentRequest(props.state);
  return request ? simulatedComment(request, comment.value) : "";
});
let timer: ReturnType<typeof setInterval> | undefined;
watch(
  () => props.state.phase,
  (phase) => {
    clearInterval(timer);
    comment.value = 0;
    if (phase === "working" && !props.conversation)
      timer = setInterval(() => {
        comment.value = comment.value + 1;
      }, 6000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section class="chat-screen" aria-label="Conversation">
    <ChatPaneHeader
      v-if="!hideHeader"
      ref="heading"
      class="chat-heading"
      :title="
        conversation?.title ??
        state.title ??
        (state.transcript
          ? systemMessageCopy[state.systemMessageLocale].title
          : state.empty
            ? 'New chat'
            : 'A plan for Thursday')
      "
      :show-chat-icon="false"
    >
      <template #navigation>
        <SituateIconButton
          v-if="showNavigation"
          icon="menu"
          label="Open navigation"
          aria-haspopup="dialog"
          :aria-controls="navigationId"
          :aria-expanded="navigationOpen"
          @click="emit('open-navigation', $event)"
        />
      </template>
      <slot name="actions"
        ><div class="pane-tools">
          <SituateIconButton
            icon="split"
            :label="`Split pane — ${state.empty ? 'New chat' : 'A plan for Thursday'}`"
            disabled
            unavailable-reason="Additional split panes are unavailable."
          /><SituateIconButton
            icon="close"
            :label="`Close pane — ${state.empty ? 'New chat' : 'A plan for Thursday'}`"
            disabled
            unavailable-reason="Closing this preview pane is unavailable."
          /></div
      ></slot>
    </ChatPaneHeader>
    <ChatWelcome
      v-if="state.empty"
      :draft="state.draft"
      :greeting="state.greeting"
      :ai="state.ai"
      :thinking="state.thinking"
      :locale="state.composerLocale"
      :covered="!!navigationOpen"
      :send-enabled="!chatGuard(state.ai)"
      :send-unavailable-reason="chatGuard(state.ai)"
      @send="submit"
      @draft="emit('update:state', { ...state, draft: $event })"
      @ai="emit('update:state', { ...state, ai: $event })"
      @thinking="emit('update:state', chooseThinking(state, $event))"
    />
    <div
      v-else
      ref="history"
      class="chat-scroll"
      @scroll="trackScroll"
      tabindex="0"
      aria-label="Conversation history"
    >
      <div
        ref="thread"
        class="chat-thread"
        :aria-live="conversation ? 'polite' : undefined"
        aria-relevant="additions text"
      >
        <slot name="thread-start" />
        <ConversationTranscript
          v-if="
            !conversation &&
            (state.workHistory || state.transcriptStyle === 'history')
          "
          :events="transcriptEvents"
          :history="state.workHistory"
          :phase="state.phase"
          :milliseconds="state.workTimeMs"
          :started-at="state.workClockStartedAt"
          :locale="
            state.transcript?.some((event) => event.kind === 'system')
              ? state.systemMessageLocale
              : state.composerLocale
          "
          @file="emit('file', $event)"
        />
        <ChatTranscript
          v-else
          :events="transcriptEvents"
          :locale="
            state.workTimeMs !== undefined
              ? state.composerLocale
              : state.systemMessageLocale
          "
          @file="emit('file', $event)"
        />
        <p
          v-if="
            state.phase === 'cancelled' &&
            state.workTimeMs === undefined &&
            !state.workHistory &&
            state.transcriptStyle !== 'history'
          "
          class="chat-error"
          role="status"
        >
          {{
            conversation?.stopped ??
            "Stopped. The note changes shown above were saved."
          }}
        </p>
        <p
          v-if="
            state.phase === 'error' &&
            state.workTimeMs === undefined &&
            !state.workHistory &&
            state.transcriptStyle !== 'history'
          "
          class="chat-error"
          role="alert"
        >
          {{
            conversation?.error ??
            "The response was interrupted. The note changes shown above were saved."
          }}
        </p>
        <SituateButton
          v-if="retryEnabled && ['error', 'cancelled'].includes(state.phase)"
          variant="secondary"
          size="small"
          @click="emit('retry')"
          >{{ transcriptCopy.retry }}</SituateButton
        >
        <slot name="thread-end" />
      </div>
    </div>
    <ChatSystemAnnouncement
      :message="dockedQuestion?.text ?? state.systemAnnouncement"
    />
    <footer
      v-if="!state.empty"
      class="chat-footer"
      :class="{
        'has-question-dock': dockedQuestion,
        'is-scrolled-back': awayFromEnd,
      }"
    >
      <SituateIconButton
        v-if="awayFromEnd"
        class="chat-scroll-to-end"
        :label="scrollCopy.toEnd"
        @click="scrollToEnd"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5v14m-6-6 6 6 6-6" />
        </svg>
      </SituateIconButton>
      <div
        class="composer-area"
        :class="{
          'question-dock': dockedQuestion,
          'question-dock--collapsed': dockedQuestion && questionCollapsed,
        }"
      >
        <SituateIconButton
          v-if="dockedQuestion"
          class="question-disclosure"
          icon="chevron"
          :label="
            questionCollapsed
              ? questionCopy.showQuestion
              : questionCopy.hideQuestion
          "
          :aria-expanded="!questionCollapsed"
          :aria-controls="questionPanelId"
          @click="questionCollapsed = !questionCollapsed"
        />
        <span
          v-if="dockedQuestion && questionCollapsed"
          class="question-summary"
          >{{ questionCopy.pending }}</span
        >
        <div
          v-show="!dockedQuestion || !questionCollapsed"
          :id="questionPanelId"
          class="composer-body"
          :class="{ 'question-body': dockedQuestion }"
        >
          <QuestionPrompt
            v-if="dockedQuestion"
            :key="dockedQuestion.id"
            :question="dockedQuestion"
            :text-id="questionTextId"
            :enabled="state.phase !== 'working'"
            @answer="answer"
          />
          <slot name="composer"
            ><NavigationComposer
              ref="composer"
              compact
              :working="state.phase === 'working'"
              :allow-followup="state.workTimeMs !== undefined"
              :label="dockedQuestion ? questionCopy.answerLabel : undefined"
              :show-label="!!dockedQuestion"
              :description="dockedQuestion ? questionTextId : undefined"
              :model-value="state.draft"
              :placeholder="
                dockedQuestion ? questionCopy.ownPlaceholder : undefined
              "
              :send-enabled="
                dockedQuestion
                  ? state.phase !== 'working'
                  : conversation
                    ? sendEnabled
                    : state.workTimeMs !== undefined || !chatGuard(state.ai)
              "
              :send-unavailable-reason="
                dockedQuestion || conversation || state.workTimeMs !== undefined
                  ? undefined
                  : chatGuard(state.ai)
              "
              @send="send"
              @update:model-value="
                emit('update:state', { ...state, draft: $event })
              "
              @stop="
                conversation
                  ? emit('stop')
                  : emit(
                      'update:state',
                      state.workTimeMs !== undefined
                        ? finishWorkTime(state, 'cancelled')
                        : changePhase(state, 'cancelled'),
                    )
              "
            />
          </slot>
          <ChatWorkingIndicator
            v-if="hideModelChoice && state.phase === 'working'"
            :comment="commentText"
            :covered="!!navigationOpen"
            :variant="state.motion"
          />
          <ChatModelChoice
            v-if="!hideModelChoice"
            :state="state.ai"
            :thinking="state.thinking"
            :locale="state.composerLocale"
            @update:state="emit('update:state', { ...state, ai: $event })"
            @thinking="emit('update:state', chooseThinking(state, $event))"
            @focus-draft="composer?.focus()"
          >
            <ChatWorkingIndicator
              v-if="state.phase === 'working'"
              :comment="commentText"
              :covered="!!navigationOpen"
              :variant="state.motion"
            />
          </ChatModelChoice>
        </div>
      </div>
    </footer>
  </section>
</template>

<style scoped src="./chat.css"></style>
