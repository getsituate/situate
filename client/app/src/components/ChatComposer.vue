<script setup lang="ts">
import { t } from "@situate/localization";
import { computed, useTemplateRef, nextTick, ref, useId, watch } from "vue";
import {
  SituateTextarea,
  SituateButton,
  SituateIcon,
  SituateIconButton,
} from "@situate/ui";

import DictationActivity from "../dictation/DictationActivity.vue";
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
  attachments?: { id: string; name: string }[];
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
  attach: [files: File[]];
  removeAttachment: [id: string];
}>();
const fieldControl =
  useTemplateRef<InstanceType<typeof SituateTextarea>>("fieldControl");
const field = computed(() => fieldControl.value?.element);
const picker = ref<HTMLInputElement>();
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
  if (event.altKey && !event.shiftKey && event.key === "ArrowUp") {
    event.preventDefault();
    if (props.hasPending) emit("recall");
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    submit(event.altKey ? "followUp" : "steering");
  }
}
function selected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (files.length) emit("attach", files);
  focus();
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
    <div
      v-if="attachments?.length"
      class="draft-attachments"
      :aria-label="t('chat.attachments')"
    >
      <span
        v-for="attachment in attachments"
        :key="attachment.id"
        class="draft-attachment"
      >
        <span data-localization-content="user">{{ attachment.name }}</span>
        <SituateButton
          variant="plain"
          type="button"
          :aria-label="t('chat.removeAttachment', { name: attachment.name })"
          @click="
            emit('removeAttachment', attachment.id);
            focus();
          "
        >
          <SituateIcon name="close" />
        </SituateButton>
      </span>
    </div>
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
        @click="picker?.click()"
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
      <input
        ref="picker"
        type="file"
        class="file-input"
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp,text/plain,text/markdown,application/json,.txt,.md,.markdown,.json"
        tabindex="-1"
        :aria-label="t('navigation.attachFile')"
        @change="selected"
      />
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
  gap: 8px;
  padding: 6px 6px 6px 12px;
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
  padding: 10px 0;
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
  gap: 4px;
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
  gap: 8px;
  margin-top: 4px;
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
.file-input {
  display: none;
}
.draft-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 8px;
}
.draft-attachment {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 4px;
  padding-inline-start: 10px;
  border: 1px solid var(--situate-line);
  border-radius: 10px;
  background: var(--situate-paper);
  font-size: 12px;
}
.draft-attachment > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.draft-attachment button {
  display: grid;
  place-items: center;
  width: 36px;
  min-height: 44px;
  flex: none;
  border: 0;
  background: transparent;
  color: var(--situate-muted);
}
.draft-attachment :deep(svg) {
  width: 14px;
  height: 14px;
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
