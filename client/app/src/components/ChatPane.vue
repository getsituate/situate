<script setup lang="ts">
import { t, localizeError } from "@situate/localization";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { workspaceChat } from "../ai/chat";
import { modelRequestError } from "../ai/request-errors";
import { isRetiredSetupQuestion } from "../onboarding/questions";
import {
  referenceKey,
  resolveReference,
  mergeReferences,
  type ContentReference,
} from "../ai/content-references";
import type { PresentationValue, ViewTarget } from "../layout/navigation";
import {
  SituateButton,
  SituateIcon,
  SituateIconButton,
  SituateDialog,
} from "@situate/ui";
import ChatGreeting from "./chat/ChatGreeting.vue";
import { chooseGreeting } from "./chat/greetings";
import { useChatScroll } from "./chat/use-chat-scroll";
import QuestionPrompt from "./chat/QuestionPrompt.vue";
import ChatSystemAnnouncement from "./chat/ChatSystemAnnouncement.vue";
import ChatMarkdown from "./chat/ChatMarkdown.vue";
import type { ConversationQuestion, QuestionResponse } from "../ai/question";
import ChatComposer from "./ChatComposer.vue";
import ChatModelPicker from "../ai/ChatModelPicker.vue";
import { workspaceAiSettings } from "../ai/settings";
import ChatTranscript from "./chat/ChatTranscript.vue";
import ChatPending from "./chat/ChatPending.vue";
import ChatActivity from "./chat/ChatActivity.vue";
import DictationNotice from "../dictation/DictationNotice.vue";
import {
  dictation,
  dictationLevel,
  confirmation,
  dictationSettingsRequested,
  noticePresentation,
  dismissedPermission,
  ownsDictation,
  stopRecording,
  type Notice,
} from "../dictation/runtime";
const PluginDevelopment = defineAsyncComponent(
  () => import("../plugins/PluginDevelopment.vue"),
);
import ErrorActions from "../errors/ErrorActions.vue";
import { captureIncident } from "../errors/runtime";

const props = withDefaults(
  defineProps<{
    navigationId?: string;
    navigationOpen?: boolean;
    navigationInline?: boolean;
    showNavigation?: boolean;
    workspaceScope?: string;
    conversationId?: string;
    embedded?: boolean;
    presentation?: PresentationValue;
  }>(),
  { navigationOpen: false },
);
const emit = defineEmits<{
  openNavigation: [event: MouseEvent];
  presentation: [value: PresentationValue];
  navigate: [target: ViewTarget, presentation?: PresentationValue];
}>();
const chat = computed(() =>
  props.workspaceScope
    ? workspaceChat(props.workspaceScope, props.conversationId)
    : undefined,
);
function retiredSetupQuestion(question: ConversationQuestion) {
  return (
    !!props.workspaceScope &&
    isRetiredSetupQuestion(
      props.workspaceScope,
      props.conversationId ?? "legacy",
      question,
    )
  );
}
const questions = computed(
  () =>
    chat.value?.state.questions?.map((question) =>
      question.status === "pending" && retiredSetupQuestion(question)
        ? { ...question, status: "superseded" as const }
        : question,
    ) ?? [],
);
const questionActionPending = computed(() => {
  const id = chat.value?.state.questionActionPending;
  const question = chat.value?.state.questions?.find(
    (question) => question.id === id,
  );
  return question && retiredSetupQuestion(question) ? undefined : id;
});
const activeQuestion = computed(() =>
  questions.value.find((q) => q.status === "pending"),
);
const questionTextId = useId();
const questionPanelId = useId();
const questionCollapsed = ref(false);
watch([chat, () => activeQuestion.value?.id], () => {
  questionCollapsed.value = false;
});
const questionPreview = shallowRef<ConversationQuestion["preview"]>();
const previewTitleId = useId();
watch(chat, () => {
  questionPreview.value = undefined;
});
async function answerQuestion(response: QuestionResponse) {
  try {
    actionError.value = "";
    chatScroll.follow();
    await chat.value?.answerQuestion(response);
  } catch (error) {
    actionError.value = error;
  }
}
async function sendMessage(kind: "steering" | "followUp") {
  if (activeQuestion.value)
    await answerQuestion({
      questionId: activeQuestion.value.id,
      text: chat.value!.state.draft,
    });
  else {
    if (!chat.value?.state.running) chatScroll.follow();
    await chat.value?.send(kind);
  }
}
async function retryQuestionAction() {
  try {
    actionError.value = "";
    await chat.value?.retryQuestionAction(questionActionPending.value!);
  } catch (error) {
    actionError.value = error;
  }
}
const saveFailureDismissed = ref(false);
const saveRetryError = ref<unknown>("");
const retryingSave = ref(false);
const unsaved = computed(() => !!chat.value?.state.unsaved);
watch([chat, unsaved], ([owner], [previous]) => {
  saveFailureDismissed.value = false;
  saveRetryError.value = "";
  if (owner !== previous) retryingSave.value = false;
});
async function retryConversationSave() {
  if (retryingSave.value) return;
  const owner = chat.value;
  saveFailureDismissed.value = false;
  retryingSave.value = true;
  saveRetryError.value = "";
  try {
    await owner?.retrySave();
  } catch (cause) {
    if (chat.value === owner) saveRetryError.value = cause;
  } finally {
    if (chat.value === owner) retryingSave.value = false;
  }
}
const dictationPhase = computed(() =>
  props.workspaceScope &&
  ownsDictation(props.workspaceScope, props.conversationId ?? "legacy")
    ? dictation.owner?.phase
    : undefined,
);
const localNotice = ref<Notice | null>(null);
const noticeId = Symbol();
const notice = computed(
  () =>
    chat.value?.state.dictationNotice ??
    localNotice.value ??
    (dictationPhase.value === "permission" &&
    dismissedPermission.value !== dictation.owner?.id
      ? "permission"
      : null),
);
watch(
  [notice, confirmation, noticePresentation, () => props.navigationOpen],
  () => {
    if (notice.value && !confirmation.value && !props.navigationOpen) {
      if (!noticePresentation.value) noticePresentation.value = noticeId;
    } else if (noticePresentation.value === noticeId)
      noticePresentation.value = null;
  },
  { immediate: true },
);
const dictationStatus = computed(() =>
  dictationPhase.value
    ? t(
        dictationPhase.value === "recording"
          ? "dictation.recording"
          : dictationPhase.value === "transcribing"
            ? "dictation.transcribing"
            : "dictation.permission",
      )
    : chat.value?.state.dictationInserted
      ? t("dictation.inserted")
      : "",
);
async function dictate() {
  if (dictation.model !== "ready") {
    localNotice.value = "model";
    return;
  }
  await chat.value?.dictate();
}
async function dismissNotice() {
  if (chat.value) chat.value.state.dictationNotice = null;
  localNotice.value = null;
  if (dictationPhase.value === "permission")
    dismissedPermission.value = dictation.owner?.id ?? null;
  await nextTick();
  composer.value?.focus();
  restoreSelection();
}
const development = computed(() => chat.value?.state.development);
const developmentCovered = ref(false);
const loadError = computed(() => chat.value?.state.loadError);
watch(
  loadError,
  (failure) => {
    if (failure) captureIncident("conversation", failure, props.workspaceScope);
  },
  { immediate: true },
);
const settings = computed(() =>
  props.workspaceScope
    ? workspaceAiSettings(
        props.workspaceScope,
        chat.value?.state.status?.config?.connectionId,
      )
    : undefined,
);
const pending = computed(
  () =>
    chat.value?.state.pending.filter(
      (message) => message.state === "pending",
    ) ?? [],
);
const pendingReferences = computed(() =>
  mergeReferences(pending.value.flatMap((message) => message.references ?? [])),
);
const submittedReferences = computed(() =>
  mergeReferences([
    ...(chat.value?.state.runReferences ?? []),
    ...(chat.value?.state.pending
      .filter((input) => input.state === "consumed")
      .flatMap((input) => input.references ?? []) ?? []),
  ]),
);
const hasHistory = computed(
  () =>
    !!(
      chat.value?.state.questions?.length ||
      chat.value?.state.transcript.length ||
      chat.value?.state.activeWork ||
      chat.value?.state.workBlocks?.length ||
      chat.value?.state.pluginNotices?.length
    ),
);
const showModel = computed(
  () =>
    settings.value?.state.settings?.showInlineModel ||
    settings.value?.state.error ||
    chat.value?.state.status?.modelError ||
    chat.value?.state.selectionError ||
    chat.value?.state.selectionUncertain ||
    (chat.value?.state.status?.modelInherited === false &&
      !chat.value.state.status.available) ||
    (chat.value?.state.status?.available &&
      !chat.value.state.status.selectedModel),
);
const root = useTemplateRef<HTMLElement>("root");
const scroll = useTemplateRef<HTMLElement>("scroll");
const transcriptContent = useTemplateRef<HTMLElement>("transcriptContent");
const composer = useTemplateRef<InstanceType<typeof ChatComposer>>("composer");
const actionError = ref<unknown>("");
const errorDismissed = ref(false);
const representedWorkError = computed(() => {
  const state = chat.value?.state;
  const work = state?.workBlocks?.at(-1);
  return !state?.running &&
    !questionActionPending.value &&
    work?.outcome === "error" &&
    work.startMessageCount !== undefined &&
    work.messageCount === state?.transcript.length &&
    typeof state?.error === "string" &&
    ((state.error.startsWith("native.ai.protocol.") &&
      modelRequestError(state?.error) !== undefined) ||
      [
        "native.ai.response.interrupted",
        "native.ai.response.idleTimeout",
        "ai.theResponseFailedCheckAIAccessReconnectIfYour",
      ].includes(String(state?.error)))
    ? state?.error
    : undefined;
});
const presentedError = computed(() => {
  if (actionError.value) return actionError.value;
  const state = chat.value?.state;
  if (
    state?.selectionUncertain &&
    state.error === "ai.aiAccessOrConversationHistoryCouldNotBeRead"
  )
    return undefined;
  if (representedWorkError.value) return undefined;
  return !unsaved.value && state?.error;
});
watch([chat, presentedError], () => {
  errorDismissed.value = false;
});
watch(chat, () => {
  actionError.value = "";
});
async function dismissError() {
  errorDismissed.value = true;
  await nextTick();
  composer.value?.focus();
}
const initial =
  props.presentation &&
  typeof props.presentation === "object" &&
  !Array.isArray(props.presentation)
    ? (props.presentation as Record<string, PresentationValue>)
    : {};
const greetingKey = chooseGreeting(initial.greetingKey);
const greetingSeen = initial.greetingSeen === true;
const greetingText = computed(
  () =>
    ({
      "navigation.goodToSeeYou": t("navigation.goodToSeeYou"),
      "chat.greetingOnYourMind": t("chat.greetingOnYourMind"),
      "chat.greetingBegin": t("chat.greetingBegin"),
      "chat.greetingRoom": t("chat.greetingRoom"),
      "chat.greetingThread": t("chat.greetingThread"),
      "chat.greetingSpace": t("chat.greetingSpace"),
    })[greetingKey],
);
const position = (value: PresentationValue | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
let scrollTop = position(initial.scrollTop);
let selectionStart = position(initial.selectionStart);
let selectionEnd = position(initial.selectionEnd);
let selectionDirection: "forward" | "backward" | "none" =
  initial.selectionDirection === "forward" ||
  initial.selectionDirection === "backward"
    ? initial.selectionDirection
    : "none";
let lastPresentation = "";
const developmentPresentation = shallowRef<PresentationValue>(
  initial.development ?? null,
);
function publishPresentation(): void {
  const value = {
    scrollTop,
    selectionStart,
    selectionEnd,
    selectionDirection,
    greetingKey,
    greetingSeen: true,
    ...(developmentPresentation.value !== null
      ? { development: developmentPresentation.value }
      : {}),
  };
  const encoded = JSON.stringify(value);
  if (encoded === lastPresentation) return;
  lastPresentation = encoded;
  emit("presentation", value);
}
function captureSelection(event: Event): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return;
  selectionStart = event.target.selectionStart;
  selectionEnd = event.target.selectionEnd;
  selectionDirection = event.target.selectionDirection;
  if (
    chat.value &&
    (event.type !== "select" || document.activeElement === event.target)
  )
    chat.value.state.draftSelection = {
      start: selectionStart,
      end: selectionEnd,
      direction: selectionDirection,
    };
  publishPresentation();
}
const chatScroll = useChatScroll(
  scroll,
  transcriptContent,
  hasHistory,
  Object.hasOwn(initial, "scrollTop") ? scrollTop : undefined,
  (top) => {
    scrollTop = top;
    publishPresentation();
  },
);
const captureScroll = chatScroll.capture;
function scrollToEnd() {
  scroll.value?.focus({ preventScroll: true });
  chatScroll.follow();
}
function restoreSelection(): void {
  const field = root.value?.querySelector("textarea");
  const retained =
    dictationPhase.value || chat.value?.state.dictationInserted
      ? chat.value?.state.draftSelection
      : null;
  field?.setSelectionRange(
    retained?.start ?? selectionStart,
    retained?.end ?? selectionEnd,
    retained?.direction ?? selectionDirection,
  );
}
watch(
  settings,
  (service) => {
    if (service && !service.state.settings) void service.refresh();
  },
  { immediate: true },
);
onMounted(async () => {
  void chat.value?.refresh();
  await nextTick();
  restoreSelection();
});
onBeforeUnmount(() => {
  if (noticePresentation.value === noticeId) noticePresentation.value = null;
  captureScroll();
  publishPresentation();
});
watch(
  () => chat.value?.state.draft,
  async () => {
    await nextTick();
    restoreSelection();
  },
  { flush: "post" },
);
watch(
  () => settings.value?.state.settings?.chat?.model,
  () => {
    if (chat.value && !chat.value.state.running) void chat.value.refresh();
  },
);
async function recall(): Promise<void> {
  await chat.value?.recallPending();
  composer.value?.focus();
}
async function attach(files: File[]): Promise<void> {
  for (const file of files) await chat.value?.addAttachment(file);
}
let referenceNavigation = 0;
async function openReference(reference: ContentReference): Promise<void> {
  const scope = props.workspaceScope,
    owner = chat.value;
  const navigation = ++referenceNavigation;
  actionError.value = "";
  errorDismissed.value = false;
  if (!scope || reference.workspaceId !== scope) {
    actionError.value = "references.invalid";
    return;
  }
  const current = () =>
    !!root.value && chat.value === owner && navigation === referenceNavigation;
  try {
    const path =
      reference.kind === "live"
        ? (await resolveReference(scope, reference)).path
        : reference.path;
    if (!current()) return;
    const target: ViewTarget = {
      kind: "view",
      viewId: "files",
      contentId: path,
      ...(reference.kind === "historical"
        ? { revision: reference.revision }
        : {}),
    };
    if (reference.kind === "live") emit("navigate", target, { reference });
    else emit("navigate", target);
  } catch (error) {
    if (current()) actionError.value = error;
  }
}
async function removeReference(reference: ContentReference): Promise<void> {
  const owner = chat.value;
  actionError.value = "";
  errorDismissed.value = false;
  try {
    await owner?.removeReference(reference);
  } catch (error) {
    if (chat.value === owner) actionError.value = error;
  }
}
const titleId = useId();
const title = useTemplateRef<HTMLElement>("title");
const developmentView =
  useTemplateRef<InstanceType<typeof PluginDevelopment>>("developmentView");
defineExpose({
  focusTitle: () =>
    development.value
      ? developmentView.value?.focusTitle()
      : props.embedded
        ? composer.value?.focus()
        : title.value?.focus(),
});
</script>

<template>
  <component
    :is="embedded ? 'div' : 'main'"
    ref="root"
    class="chat-pane"
    :aria-labelledby="embedded || development ? undefined : titleId"
    @select.capture="captureSelection"
    @input.capture="captureSelection"
    @keyup.capture="captureSelection"
    @pointerup.capture="captureSelection"
    @focusout.capture="captureSelection"
  >
    <header v-if="!embedded && !development" class="pane-header">
      <div class="pane-heading">
        <SituateIconButton
          class="open-navigation"
          :class="{ 'navigation-visible': showNavigation }"
          icon="menu"
          :label="t('navigation.openNavigation')"
          :aria-haspopup="navigationInline ? undefined : 'dialog'"
          :aria-controls="navigationInline ? undefined : navigationId"
          :aria-expanded="navigationInline ? undefined : navigationOpen"
          @click="$emit('openNavigation', $event)"
        />
        <SituateIcon class="chat-icon" name="chat" />
        <h1
          :id="titleId"
          ref="title"
          tabindex="-1"
          :data-localization-content="chat?.state.title ? 'user' : undefined"
        >
          {{ chat?.state.title || t("navigation.newChat") }}
        </h1>
      </div>
      <div class="pane-tools">
        <SituateIconButton
          icon="split"
          :label="t('navigation.splitPane')"
          disabled
        />
        <SituateIconButton
          icon="close"
          :label="t('navigation.closePane')"
          disabled
        />
      </div>
    </header>
    <component
      :is="development ? PluginDevelopment : 'div'"
      ref="developmentView"
      :key="
        development
          ? `${workspaceScope}:${conversationId ?? 'development'}`
          : 'chat'
      "
      class="chat-body"
      @covered="developmentCovered = $event"
      @presentation="
        developmentPresentation = $event;
        publishPresentation();
      "
      v-bind="
        development
          ? {
              title: chat?.state.title || t('navigation.newChat'),
              scope: workspaceScope!,
              conversation: conversationId,
              activity: chat?.state.toolActivity ?? [],
              presentation: developmentPresentation,
              failed: !!loadError,
            }
          : {}
      "
    >
      <template #navigation>
        <SituateIconButton
          v-if="development && showNavigation"
          icon="menu"
          :label="t('navigation.openNavigation')"
          :aria-controls="navigationInline ? undefined : navigationId"
          :aria-expanded="navigationInline ? undefined : navigationOpen"
          @click="$emit('openNavigation', $event)"
        />
      </template>
      <div v-if="loadError" class="chat-load-error" role="alert">
        <span>{{ localizeError(loadError) }}</span>
        <ErrorActions
          boundary="conversation"
          :error="loadError"
          :scope="workspaceScope"
        />
      </div>
      <div
        class="empty-chat"
        :class="{ 'has-history': hasHistory, 'development-chat': development }"
      >
        <div class="welcome">
          <ChatGreeting
            v-if="!hasHistory"
            :text="development ? t('pluginDevelopment.welcome') : greetingText"
            :active="!greetingSeen"
            :covered="navigationOpen || (!!development && developmentCovered)"
          />
          <div
            v-if="chat"
            v-show="hasHistory"
            ref="scroll"
            class="transcript-scroll"
            :class="{
              'transcript-scroll--faded': chatScroll.awayFromEnd.value,
            }"
            tabindex="-1"
            @scroll="captureScroll"
            @wheel.passive="chatScroll.wheel"
            @click.capture="chatScroll.inspect"
          >
            <div ref="transcriptContent">
              <div
                v-if="submittedReferences.length"
                class="content-references submitted-references"
                :aria-label="t('references.submitted')"
              >
                <SituateButton
                  variant="plain"
                  v-for="reference in submittedReferences"
                  :key="referenceKey(reference)"
                  type="button"
                  class="reference-open"
                  :aria-label="t('references.open', { path: reference.path })"
                  @click="openReference(reference)"
                >
                  <span data-localization-content="user">{{
                    reference.path
                  }}</span>
                  <span v-if="reference.kind === 'historical'">{{
                    t("references.historical")
                  }}</span>
                </SituateButton>
              </div>
              <ChatTranscript
                :key="`${workspaceScope}:${conversationId ?? ''}`"
                :messages="chat.state.transcript"
                :message-offset="chat.state.messageOffset"
                :history-before="chat.state.historyBefore"
                :history-loading="chat.state.historyLoading"
                @load-older="chat.loadOlder()"
                @preview="questionPreview = $event"
                :questions="questions"
                :notices="chat.state.pluginNotices"
                :announcement="chat.state.pluginNoticeAnnouncement"
                :activity="chat.state.toolActivity"
                :work-blocks="chat.state.workBlocks"
                :active-work="chat.state.activeWork"
                :work-error="representedWorkError"
                :running="chat.state.running"
                :scope="workspaceScope!"
              />
            </div>
          </div>
          <div
            v-if="hasHistory && chatScroll.awayFromEnd.value"
            class="chat-scroll-controls"
          >
            <div class="chat-scroll-controls-inner">
              <SituateIconButton
                class="chat-scroll-to-end"
                :label="t('chat.scrollToEnd')"
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
            </div>
          </div>
          <div
            class="chat-footer"
            :class="{
              'unsaved-conversation': chat?.state.unsaved,
              'has-question-dock': activeQuestion,
            }"
          >
            <SituateDialog
              v-if="presentedError && !unsaved && !loadError"
              :open="!errorDismissed"
              :aria-labelledby="`${titleId}-error-title`"
              :aria-describedby="`${titleId}-error-description`"
              @cancel.prevent="dismissError"
            >
              <template #header>
                <h2 :id="`${titleId}-error-title`">
                  {{ t("chat.actionFailed") }}
                </h2>
              </template>
              <p :id="`${titleId}-error-description`" role="alert">
                {{ localizeError(presentedError) }}
              </p>
              <template #actions>
                <SituateButton
                  variant="secondary"
                  autofocus
                  @click="dismissError"
                >
                  {{ t("settings.ai.dismiss") }}
                </SituateButton>
              </template>
            </SituateDialog>
            <SituateDialog
              v-if="unsaved"
              :open="unsaved && !saveFailureDismissed"
              :aria-labelledby="`${titleId}-save-title`"
              :aria-describedby="`${titleId}-save-description`"
              @cancel.prevent="saveFailureDismissed = true"
            >
              <template #header>
                <h2 :id="`${titleId}-save-title`">
                  {{ t("navigation.conversationNotSaved") }}
                </h2>
              </template>
              <p :id="`${titleId}-save-description`" role="alert">
                {{
                  localizeError(
                    saveRetryError ||
                      chat?.state.error ||
                      "ai.theConversationCouldNotBeSavedKeepThisWorkspace",
                  )
                }}
              </p>
              <template #actions>
                <SituateButton
                  variant="secondary"
                  autofocus
                  @click="saveFailureDismissed = true"
                >
                  {{ t("settings.ai.dismiss") }}
                </SituateButton>
                <SituateButton
                  :busy="retryingSave"
                  @click="retryConversationSave"
                >
                  {{ t("navigation.retrySavingConversation") }}
                </SituateButton>
              </template>
            </SituateDialog>
            <div v-if="unsaved && saveFailureDismissed" class="save-recovery">
              <p role="status">{{ t("navigation.conversationNotSaved") }}</p>
              <SituateButton
                variant="secondary"
                size="small"
                :busy="retryingSave"
                @click="retryConversationSave"
              >
                {{ t("navigation.retrySavingConversation") }}
              </SituateButton>
            </div>
            <ChatPending :messages="pending" @recall="recall" />
            <div
              v-if="pendingReferences.length"
              class="content-references pending-references"
              :aria-label="t('references.pending')"
            >
              <SituateButton
                variant="plain"
                v-for="reference in pendingReferences"
                :key="referenceKey(reference)"
                type="button"
                class="reference-open"
                :aria-label="t('references.open', { path: reference.path })"
                @click="openReference(reference)"
              >
                <span data-localization-content="user">{{
                  reference.path
                }}</span>
                <span v-if="reference.kind === 'historical'">{{
                  t("references.historical")
                }}</span>
              </SituateButton>
            </div>
            <div
              v-if="chat?.state.draftReferences.length"
              class="content-references draft-references"
              :aria-label="t('references.draft')"
            >
              <span
                v-for="reference in chat.state.draftReferences"
                :key="referenceKey(reference)"
                class="reference-chip"
              >
                <SituateButton
                  variant="plain"
                  type="button"
                  class="reference-open"
                  :aria-label="t('references.open', { path: reference.path })"
                  @click="openReference(reference)"
                >
                  <span data-localization-content="user">{{
                    reference.path
                  }}</span>
                  <span v-if="reference.kind === 'historical'">{{
                    t("references.historical")
                  }}</span>
                </SituateButton>
                <SituateButton
                  variant="plain"
                  type="button"
                  class="reference-remove"
                  :aria-label="t('references.remove', { path: reference.path })"
                  @click="removeReference(reference)"
                >
                  <SituateIcon name="close" />
                </SituateButton>
              </span>
            </div>
            <ChatSystemAnnouncement
              :id="chat?.state.questionAnnouncement?.id"
              :message="chat?.state.questionAnnouncement?.prompt ?? ''"
            />
            <div v-if="chat && questionActionPending" class="question-retry">
              <p>{{ t("chatQuestion.interrupted") }}</p>
              <SituateButton
                :disabled="chat.state.questionBusy || chat.state.unsaved"
                @click="retryQuestionAction"
                >{{ t("chatQuestion.retry") }}</SituateButton
              >
            </div>
            <div
              :class="{
                'question-dock': activeQuestion,
                'question-dock--collapsed': activeQuestion && questionCollapsed,
              }"
            >
              <SituateIconButton
                v-if="activeQuestion"
                class="question-disclosure"
                icon="chevron"
                :label="
                  t(
                    questionCollapsed
                      ? 'chatQuestion.show'
                      : 'chatQuestion.collapse',
                  )
                "
                :aria-expanded="!questionCollapsed"
                :aria-controls="questionPanelId"
                @click="questionCollapsed = !questionCollapsed"
              />
              <span
                v-if="activeQuestion && questionCollapsed"
                class="question-summary"
                >{{ t("chatQuestion.pending") }}</span
              >
              <div
                v-show="!activeQuestion || !questionCollapsed"
                :id="questionPanelId"
                class="composer-body"
                :class="{ 'question-body': activeQuestion }"
              >
                <QuestionPrompt
                  v-if="activeQuestion"
                  :question="activeQuestion"
                  :text-id="questionTextId"
                  :enabled="
                    !chat?.state.running &&
                    !chat?.state.questionBusy &&
                    !chat?.state.unsaved &&
                    !dictationPhase
                  "
                  @answer="answerQuestion"
                  @preview="questionPreview = $event"
                />
                <ChatComposer
                  v-if="chat"
                  ref="composer"
                  v-model:draft="chat.state.draft"
                  :dictation-phase="dictationPhase"
                  :dictation-level="
                    dictationPhase === 'recording' ? dictationLevel : 0
                  "
                  :dictation-ready="dictation.model === 'ready'"
                  :dictation-supported="dictation.supported && !loadError"
                  :dictation-elsewhere="dictation.busy && !dictationPhase"
                  :dictation-covered="
                    navigationOpen ||
                    !!notice ||
                    !!confirmation ||
                    (!!development && developmentCovered)
                  "
                  :dictation-status="dictationStatus"
                  @dictate="dictate"
                  @stop-dictation="stopRecording"
                  :attachments="chat.state.draftAttachments"
                  :attaching="chat.state.attachmentBusy"
                  :has-pending="!!pending.length"
                  :has-references="!!chat.state.draftReferences.length"
                  @recall="recall"
                  @attach="attach"
                  @remove-attachment="chat.removeAttachment"
                  :question="!!activeQuestion"
                  :description="activeQuestion ? questionTextId : undefined"
                  :connected="chat.state.status?.available"
                  :model-selected="
                    !!chat.state.status?.selectedModel &&
                    !chat.state.status?.modelError
                  "
                  :running="chat.state.running"
                  :busy="
                    !!loadError ||
                    chat.state.questionBusy ||
                    chat.state.submitting ||
                    !!questionActionPending ||
                    (activeQuestion && chat.state.running) ||
                    chat.state.selectingModel ||
                    chat.state.selectionUncertain ||
                    chat.state.unsaved ||
                    (!activeQuestion &&
                      (settings?.state.loading ||
                        settings?.state.saving ||
                        !!settings?.state.error))
                  "
                  @send="sendMessage"
                  @stop="chat.abort"
                >
                  <template #model
                    ><ChatModelPicker
                      v-if="showModel"
                      :workspace-scope="workspaceScope"
                      :status="chat.state.status"
                      :saving="chat.state.selectingModel"
                      :running="chat.state.running"
                      :unsaved="chat.state.unsaved"
                      :load-error="!chat.state.status && !!chat.state.error"
                      :select-model="chat.selectModel"
                      :select-thinking="chat.selectThinking"
                      :selection-error="chat.state.selectionError"
                      :selection-uncertain="chat.state.selectionUncertain"
                      @focus-draft="composer?.focus()"
                      @retry="chat.refresh"
                    />
                  </template>
                  <template #activity
                    ><ChatActivity
                      v-if="chat.state.running"
                      :comment="chat.state.activityComment"
                      :compacting="chat.state.compacting"
                      :suspended="
                        navigationOpen || (!!development && developmentCovered)
                      "
                  /></template>
                </ChatComposer>
                <ChatComposer v-else />
              </div>
            </div>
          </div>
        </div>
      </div>
    </component>
    <SituateDialog
      v-if="questionPreview"
      class="question-preview-dialog"
      :open="true"
      :aria-labelledby="previewTitleId"
      @cancel.prevent="questionPreview = undefined"
    >
      <template #header
        ><h2 :id="previewTitleId" data-localization-content="external">
          {{ questionPreview.title }}
        </h2></template
      >
      <div
        class="question-preview-content"
        data-dialog-document
        tabindex="0"
        role="region"
        :aria-labelledby="previewTitleId"
      >
        <p
          v-if="questionPreview.summary"
          class="question-preview-summary"
          data-localization-content="external"
        >
          {{ questionPreview.summary }}
        </p>
        <ChatMarkdown :content="questionPreview.text" :final="true" />
      </div>
      <template #actions
        ><SituateButton
          variant="secondary"
          autofocus
          @click="questionPreview = undefined"
          >{{ t("settings.ai.dismiss") }}</SituateButton
        ></template
      >
    </SituateDialog>
    <DictationNotice
      v-if="
        notice &&
        noticePresentation === noticeId &&
        !confirmation &&
        !navigationOpen
      "
      :notice="notice"
      @dismiss="dismissNotice"
      @settings="
        dismissNotice();
        dictationSettingsRequested++;
      "
    />
  </component>
</template>

<style scoped>
.chat-load-error {
  padding: 16px;
  flex: none;
}
.question-preview-dialog {
  width: min(760px, calc(100% - 36px));
}
.question-preview-dialog[open] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.question-preview-content {
  overflow: auto;
  min-height: 0;
}
.question-preview-content:focus:where(
    html:not([data-input-modality="pointer"]) *
  ) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -3px;
}
.question-preview-summary {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.chat-pane .chat-footer.has-question-dock {
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
  max-height: 70%;
  min-height: 0;
}
.question-dock {
  position: relative;
  flex: 1 1 auto;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  padding: 20px;
  border: 1px solid
    color-mix(
      in srgb,
      var(--situate-accent-strong, var(--situate-violet-deep)) 18%,
      var(--situate-line)
    );
  border-radius: var(--situate-radius-dialog);
  background: linear-gradient(
    135deg,
    color-mix(
      in srgb,
      var(--situate-accent-soft, var(--situate-lilac)) 55%,
      var(--situate-surface)
    ),
    var(--situate-surface) 85%
  );
  box-shadow: 0 4px 20px color-mix(in srgb, var(--situate-ink) 5%, transparent);
}
.composer-body {
  display: contents;
}
.question-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.question-disclosure {
  position: absolute;
  inset-block-start: 10px;
  inset-inline-end: 10px;
  z-index: 1;
}
.question-body :deep(.question-heading) {
  padding-inline-end: 44px;
}
.question-dock--collapsed {
  min-height: 66px;
  justify-content: center;
}
.question-dock--collapsed .question-disclosure :deep(svg) {
  transform: rotate(180deg);
}
.question-summary {
  padding-inline-end: 44px;
  font-size: 13px;
  color: var(--situate-muted);
}
.question-dock :deep(.chat-composer) {
  flex-shrink: 0;
  margin-top: 16px;
}
@container (max-width: 540px) {
  .question-dock {
    padding: 16px;
  }
}
@media (max-height: 480px) {
  .question-body {
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
  .question-body :deep(.question-prompt) {
    flex: 0 0 auto;
    overflow: visible;
  }
}
@media (max-height: 700px) {
  .has-history .transcript-scroll {
    padding-block: 8px;
  }
  .chat-pane .chat-footer.has-question-dock {
    max-height: 100%;
  }
  .question-dock {
    padding: 12px;
    border-radius: var(--situate-radius-note);
  }
  .question-dock :deep(.chat-composer) {
    margin-top: 8px;
  }
}

.chat-pane {
  container-type: inline-size;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--situate-surface);
}
.chat-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.development-chat {
  background: transparent;
}
.development-chat .transcript-scroll {
  padding: 32px 32px 40px;
}
.development-chat .transcript-scroll :deep(.messages) {
  max-width: 688px;
}
.development-chat.has-history .chat-footer {
  max-width: 744px;
  padding: 12px 28px
    max(22px, var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px)));
}
.content-references {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-block: 8px;
}
.reference-chip {
  display: inline-flex;
  max-width: 100%;
}
.content-references button,
.inherit-model {
  min-height: 44px;
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-paper);
  color: var(--situate-ink);
  font: inherit;
  font-size: var(--situate-text-caption);
  padding: 6px 10px;
}
.reference-open {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  overflow-wrap: anywhere;
  min-width: 0;
}
.content-references
  button:focus:where(html:not([data-input-modality="pointer"]) *),
.inherit-model:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: 2px solid var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
.inherit-model:disabled {
  opacity: 0.55;
}
.unsaved-conversation .inherit-model {
  align-self: flex-start;
}
.unsaved-conversation :deep(.model-picker) {
  flex-wrap: wrap;
}
.save-recovery {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.save-recovery p {
  margin: 0;
  font-size: var(--situate-text-small);
}
.pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 16px;
  min-height: 80px;
  padding: max(16px, env(safe-area-inset-top, 0px)) 24px 16px 30px;
  border-bottom: 1px solid var(--situate-line);
}
.pane-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.chat-icon {
  color: var(--situate-muted);
}
h1 {
  margin: 0;
  font-size: var(--situate-text-small);
  font-weight: 600;
  overflow-wrap: anywhere;
}
h1:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
.pane-tools {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.pane-tools button {
  min-height: 44px;
  border: 0;
  border-radius: var(--situate-radius-control);
  background: var(--situate-paper);
  color: var(--situate-ink);
  padding: 8px;
}
.open-navigation {
  display: none;
}
.open-navigation.navigation-visible {
  display: inline-grid;
}
.empty-chat {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 38px;
}
.welcome {
  width: 100%;
  max-width: 640px;
  flex: 0 0 auto;
  margin: auto;
  padding-bottom: 56px;
}
.has-history {
  padding: 0;
  overflow: hidden;
}
.has-history .welcome {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  max-width: none;
  margin: 0;
  padding: 0;
}
.transcript-scroll {
  overflow-anchor: none;
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 28px 38px;
}
.transcript-scroll :deep(.messages) {
  max-width: 640px;
  margin-inline: auto;
}
.chat-scroll-controls {
  position: relative;
  flex: none;
  height: 0;
  z-index: 1;
  pointer-events: none;
}
@media (forced-colors: none) {
  .transcript-scroll--faded {
    /* The second layer keeps the 8px scrollbar outside the fade. */
    -webkit-mask-image:
      linear-gradient(to bottom, #000 calc(100% - 72px), transparent),
      linear-gradient(to left, #000 8px, transparent 8px);
    mask-image:
      linear-gradient(to bottom, #000 calc(100% - 72px), transparent),
      linear-gradient(to left, #000 8px, transparent 8px);
    mask-mode: alpha;
  }
}
.chat-scroll-controls-inner {
  position: relative;
  max-width: 716px;
  margin-inline: auto;
}
.chat-scroll-to-end {
  position: absolute;
  inset-inline-end: 38px;
  inset-block-start: -52px;
  width: 44px;
  height: 44px;
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-pill);
  background: var(--situate-surface);
  color: var(--situate-ink);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--situate-ink) 8%, transparent);
  pointer-events: auto;
}
.development-chat .chat-scroll-controls-inner {
  max-width: 744px;
}
.development-chat .chat-scroll-to-end {
  inset-inline-end: 28px;
}
.has-history .chat-footer {
  flex: none;
  width: 100%;
  max-width: 716px;
  margin-inline: auto;
  padding: 0 38px max(12px, env(safe-area-inset-bottom, 0px));
}
@media not all and (min-width: 1184px) {
  .open-navigation {
    display: inline-grid;
  }
  .chat-icon {
    display: none;
  }
  .pane-header {
    min-height: 64px;
    padding: max(8px, env(safe-area-inset-top, 0px)) 16px 8px;
    background: var(--situate-paper);
  }
  .welcome {
    padding-bottom: 0;
  }
}
@container (max-width: 520px) {
  .has-history {
    padding: 0 !important;
  }
  .transcript-scroll {
    padding: 20px;
  }
  .has-history .chat-footer {
    padding-inline: 20px;
  }
  .chat-scroll-to-end {
    inset-inline-end: 20px;
  }
  .empty-chat {
    padding: 24px;
  }
}
@container development (max-width: 540px) {
  .development-chat .transcript-scroll {
    padding: 24px 18px;
  }
  .development-chat.has-history .chat-footer {
    padding: 10px 16px 16px;
  }
  .development-chat .chat-scroll-to-end {
    inset-inline-end: 16px;
  }
}
@container (max-width: 359px) {
  .empty-chat {
    padding: 20px;
  }
  .pane-header {
    padding-inline: 8px;
    gap: 8px;
  }
}
@media (max-height: 480px) {
  .has-history {
    overflow-y: auto;
  }
  .has-history .welcome {
    flex: 0 0 auto;
  }
  .has-history .transcript-scroll {
    flex: none;
    max-height: 35vh;
  }
  .has-history .chat-footer {
    padding-bottom: 12px;
  }
  .empty-chat {
    padding-block: 12px;
  }
  .welcome {
    padding-bottom: 0;
  }
}
</style>
