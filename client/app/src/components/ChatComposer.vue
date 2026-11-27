<script setup lang="ts">
import { t } from "@situate/localization";
import { computed, useTemplateRef, nextTick, useId, watch } from "vue";
import {
  SituateTextarea,
  SituateButton,
  SituateIcon,
  SituateIconButton,
} from "@situate/ui";

import {
  isImageAttachment,
  mayHaveImagePreview,
} from "../ai/attachment-runtime";
import type { AttachmentRef } from "../ai/queue-runtime";
import DictationActivity from "../dictation/DictationActivity.vue";
import ChatAttachmentPreview from "./chat/ChatAttachmentPreview.vue";
import type { Phase } from "../dictation/runtime";

const props = defineProps<{
  draft?: string;
  question?: boolean;
  description?: string;
  dictationPhase?: Phase;
  dictationLevel?: number;
  dictationReady?: boolean;
  dictationSupported?: boolean;
  dictationElsewhere?: boolean;
  dictationCovered?: boolean;
  dictationStatus?: string;
  connected?: boolean;
  modelSelected?: boolean;
  running?: boolean;
  busy?: boolean;
  attachments?: AttachmentRef[];
  attachmentScope?: string;
  attaching?: boolean;
  hasPending?: boolean;
  hasReferences?: boolean;
}>();
const emit = defineEmits<{
  "update:draft": [value: string];
  send: [kind: "steering" | "followUp"];
  stop: [];
  dictate: [];
  stopDictation: [];
  recall: [];
  attach: [];
  removeAttachment: [id: string];
}>();
const fieldControl =
  useTemplateRef<InstanceType<typeof SituateTextarea>>("fieldControl");
const field = computed(() => fieldControl.value?.element);
const id = useId();
const primaryDisabled = computed(
  () =>
    props.dictationPhase !== "recording" &&
    (props.draft === undefined ||
      !!props.dictationPhase ||
      (!props.question && !props.connected) ||
      (!props.question && !props.modelSelected) ||
      props.busy ||
      props.attaching ||
      (!props.draft.trim() &&
        !props.attachments?.length &&
        !props.hasReferences)),
);
function focus(): void {
  field.value?.focus();
}
defineExpose({ focus });
function fit(): void {
  if (!field.value) return;
  field.value.style.height = "44px";
  field.value.style.height = `${Math.min(field.value.scrollHeight, 160)}px`;
}
watch(
  () => props.draft,
  () => {
    void nextTick(fit);
  },
  { immediate: true },
);
function submit(kind: "steering" | "followUp" = "steering"): void {
  if (
    !props.dictationPhase &&
    !props.busy &&
    !props.attaching &&
    (props.question || (props.connected && props.modelSelected)) &&
    (props.draft?.trim() || props.attachments?.length || props.hasReferences)
  )
    emit("send", kind);
}
function keydown(event: KeyboardEvent): void {
  if (event.isComposing || event.ctrlKey || event.metaKey) return;
  if (
    props.hasPending &&
    event.altKey &&
    !event.shiftKey &&
    event.key === "ArrowUp"
  ) {
    event.preventDefault();
    emit("recall");
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit(event.altKey ? "followUp" : "steering");
  }
}
</script>

<template>
  <div
    class="chat-composer"
    :class="{
      recording: dictationPhase === 'recording',
      dictating: !!dictationPhase,
    }"
  >
    <ul
      v-if="attachments?.length || (hasReferences && $slots.references)"
      class="draft-attachments"
      :class="{ 'draft-references': hasReferences }"
      role="list"
      :aria-label="t('chat.attachments')"
    >
      <slot name="references" />
      <li
        v-for="attachment in attachments"
        :key="attachment.id"
        class="draft-attachment"
      >
        <ChatAttachmentPreview
          :scope="attachmentScope"
          :enabled="
            isImageAttachment(attachment.mimeType) ||
            mayHaveImagePreview(attachment.name)
          "
          :target="{ kind: 'attachment', id: attachment.id }"
          :name="attachment.name"
        >
          <span class="draft-file">
            <SituateIcon name="notes" />
            <span data-localization-content="user">{{ attachment.name }}</span>
          </span>
        </ChatAttachmentPreview>
        <SituateIconButton
          class="remove-attachment"
          icon="close"
          :label="t('chat.removeAttachment', { name: attachment.name })"
          @click="
            emit('removeAttachment', attachment.id);
            focus();
          "
        />
      </li>
    </ul>
    <label :class="{ 'sr-only': !question }" :for="id">{{
      question ? t("chatQuestion.answer") : t("navigation.message")
    }}</label>
    <div class="input-line">
      <SituateIconButton
        class="attach-action"
        icon="plus"
        :label="t('navigation.attachFile')"
        :disabled="draft === undefined || attaching"
        :aria-busy="attaching"
        @click="emit('attach')"
      />
      <SituateTextarea
        appearance="plain"
        :id="id"
        ref="fieldControl"
        rows="1"
        :placeholder="
          question
            ? t('chatQuestion.placeholder')
            : t('navigation.messageDetail')
        "
        :value="draft"
        :readonly="draft === undefined"
        :aria-describedby="
          [description, dictationStatus ? `${id}-dictation` : undefined]
            .filter(Boolean)
            .join(' ') || undefined
        "
        @input="
          emit('update:draft', ($event.target as HTMLTextAreaElement).value)
        "
        @keydown="keydown"
      />
      <div class="input-actions">
        <DictationActivity
          v-if="
            dictationPhase === 'recording' || dictationPhase === 'transcribing'
          "
          :phase="dictationPhase"
          :level="dictationLevel"
          :covered="!!dictationCovered"
          :title="dictationStatus"
        />
        <SituateIconButton
          v-else
          :icon="
            draft === undefined ||
            dictationSupported === false ||
            dictationReady
              ? 'mic'
              : 'info'
          "
          :label="
            t(
              draft === undefined || dictationSupported === false
                ? 'navigation.dictateText'
                : dictationReady
                  ? 'dictation.record'
                  : 'dictation.settings',
            )
          "
          :disabled="
            draft === undefined ||
            dictationSupported === false ||
            dictationElsewhere ||
            dictationPhase === 'permission'
          "
          :class="{
            'dictation-unavailable':
              dictationElsewhere || dictationPhase === 'permission',
          }"
          :unavailable-reason="
            dictationElsewhere ? t('dictation.elsewhere') : dictationStatus
          "
          @click="emit('dictate')"
        />
        <SituateButton
          variant="plain"
          v-if="running"
          type="button"
          class="stop-action"
          :aria-label="t('navigation.stopResponse')"
          :title="t('navigation.stopResponse')"
          @click="emit('stop')"
        >
          <span aria-hidden="true" />
        </SituateButton>
        <SituateIconButton
          :icon="dictationPhase === 'recording' ? undefined : 'arrow'"
          :label="
            dictationPhase === 'recording'
              ? t('dictation.stop')
              : running
                ? t('chat.queueSteering')
                : t('navigation.sendMessage')
          "
          variant="primary"
          :disabled="primaryDisabled"
          :aria-disabled="primaryDisabled"
          :unavailable-reason="
            dictationPhase
              ? t('dictation.busySend')
              : draft === undefined
                ? t('navigation.messagingIsUnavailable')
                : !question && !connected
                  ? t('dictation.offline')
                  : undefined
          "
          @click="
            dictationPhase === 'recording' ? emit('stopDictation') : submit()
          "
          ><span
            v-if="dictationPhase === 'recording'"
            class="stop-mark"
            aria-hidden="true"
        /></SituateIconButton>
      </div>
    </div>
    <span
      :id="`${id}-dictation`"
      class="sr-only"
      role="status"
      aria-atomic="true"
      >{{ dictationStatus }}</span
    >
    <div class="composer-bottom">
      <slot name="activity" />
      <div class="composer-selectors"><slot name="model" /></div>
    </div>
  </div>
</template>

<style scoped>
.chat-composer {
  container-type: inline-size;
}
.recording .input-line {
  border-color: var(--situate-accent-strong);
}
.dictation-unavailable {
  opacity: 0.45;
}
.stop-mark {
  width: 12px;
  height: 12px;
  background: currentColor;
  border-radius: 2px;
}
.input-line {
  display: flex;
  align-items: flex-end;
  gap: var(--situate-space-2);
  padding: var(--situate-space-1-5) var(--situate-space-1-5)
    var(--situate-space-1-5) var(--situate-space-3);
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-surface);
}
.input-line:focus-within:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
textarea {
  display: block;
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 44px;
  min-height: 44px;
  max-height: 160px;
  resize: none;
  border: 0;
  padding: var(--situate-space-2-5) 0;
  background: transparent;
  color: var(--situate-ink);
  font: inherit;
  line-height: 24px;
}
textarea::placeholder {
  color: var(--situate-muted);
  opacity: 1;
}
textarea:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: none;
}
.dictating .input-actions :deep(.primary:disabled) {
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-muted);
}
.input-actions {
  display: flex;
  gap: var(--situate-space-1);
  flex-shrink: 0;
}
.stop-action {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: var(--situate-paper);
  color: var(--situate-ink);
}
.stop-action span {
  width: 12px;
  height: 12px;
  background: currentColor;
  border-radius: 2px;
}
.composer-bottom {
  display: flex;
  align-items: center;
  gap: var(--situate-space-2);
  margin-top: var(--situate-space-1);
  min-width: 0;
}
.composer-selectors {
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
  margin-left: auto;
  max-width: min(100%, 260px);
}
.composer-bottom:has(> .chat-activity) .composer-selectors {
  max-width: min(45%, 260px);
}
.composer-bottom > :deep(.chat-activity .activity-comment) {
  white-space: normal;
  overflow-wrap: anywhere;
}
@container (max-width: 480px) {
  .composer-bottom:has(> .chat-activity) {
    flex-wrap: wrap;
    gap: 0;
  }
  .composer-bottom > :deep(.chat-activity) {
    flex-basis: 100%;
  }
  .composer-bottom:has(> .chat-activity) .composer-selectors {
    max-width: min(100%, 260px);
  }
}
.draft-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--situate-space-2);
  margin: 0 0 var(--situate-space-2);
  padding: 0;
  list-style: none;
}
.draft-attachments :deep(.draft-attachment) {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  min-height: 52px;
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-content-wash, var(--situate-paper));
  font-size: var(--situate-text-caption);
}
.draft-attachments :deep(.draft-file) {
  display: flex;
  align-items: center;
  gap: var(--situate-space-2);
  min-width: 0;
  padding-block: var(--situate-space-1-5);
  padding-inline-start: var(--situate-space-3);
  overflow-wrap: anywhere;
  font-weight: 600;
}
.draft-attachments :deep(.draft-file svg) {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.draft-attachments :deep(.reference-open) {
  display: flex;
  align-items: center;
  min-width: 0;
  align-self: stretch;
  padding: 0;
  border: 0;
  border-radius: var(--situate-radius-control) 0 0 var(--situate-radius-control);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
}
.draft-attachments :deep(.reference-open:hover) {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.draft-attachments :deep(.reference-open:focus-visible) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
.draft-attachments :deep(.remove-attachment) {
  align-self: stretch;
  height: auto;
  border-radius: 0 var(--situate-radius-control) var(--situate-radius-control) 0;
}
button:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
@container (max-width: 340px) {
  .input-line {
    flex-wrap: wrap;
  }
  textarea {
    flex-basis: calc(100% - var(--situate-target-min) - 8px);
  }
  .input-actions {
    margin-inline-start: auto;
  }
}
</style>
