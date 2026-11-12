<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { SituateButton, SituateIcon } from "@situate/ui";
import { t } from "@situate/localization";
import type { RetainedQuestion, QuestionResponse } from "../../ai/question";
const questionPreviewLimit = 6;
const props = withDefaults(
  defineProps<{
    question: RetainedQuestion;
    enabled?: boolean;
    textId?: string;
  }>(),
  { enabled: true },
);
const emit = defineEmits<{
  answer: [response: QuestionResponse];
  preview: [preview: NonNullable<RetainedQuestion["preview"]>];
}>();
const expanded = ref(false);
const optionsId = useId();
const shown = computed(() =>
  expanded.value
    ? (props.question.suggestions ?? [])
    : (props.question.suggestions ?? []).slice(0, questionPreviewLimit),
);
const overflow = computed(() =>
  Math.max(0, (props.question.suggestions ?? []).length - questionPreviewLimit),
);
const stacked = computed(() =>
  (props.question.suggestions ?? []).some((option) => option.label.length > 48),
);
watch(
  () => props.question.id,
  () => {
    expanded.value = false;
  },
);
</script>
<template>
  <div class="chat-question question-prompt" :data-question-id="question.id">
    <div class="question-heading">
      <span class="question-symbol" aria-hidden="true"
        ><SituateIcon name="chat"
      /></span>
      <p :id="textId" class="question-text">
        <span data-localization-content="external">{{ question.prompt }}</span>
      </p>
    </div>
    <SituateButton
      v-if="question.preview"
      variant="ghost"
      size="small"
      class="question-preview"
      @click="emit('preview', question.preview)"
      >{{ t("chatQuestion.viewDetails") }}</SituateButton
    >
    <div
      v-if="question.status === 'pending' && question.suggestions?.length"
      class="question-choices-scroll"
    >
      <div
        :id="optionsId"
        class="question-options"
        :class="{ 'question-options--list': stacked }"
        role="group"
        :aria-label="question.prompt"
      >
        <SituateButton
          v-for="option in shown"
          :key="option.id"
          variant="secondary"
          size="small"
          :disabled="!enabled"
          @click="
            emit('answer', { questionId: question.id, choiceId: option.id })
          "
        >
          <span class="question-option-label"
            ><span data-localization-content="external">{{
              option.label
            }}</span></span
          >
          <SituateIcon name="arrow" class="question-option-arrow" />
        </SituateButton>
      </div>
      <SituateButton
        v-if="overflow"
        variant="plain"
        class="question-more"
        :aria-expanded="expanded"
        :aria-controls="optionsId"
        @click="expanded = !expanded"
        >{{
          expanded
            ? t("chatQuestion.fewer")
            : t("chatQuestion.more", { count: overflow })
        }}</SituateButton
      >
    </div>
  </div>
</template>
<style scoped>
.question-prompt {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 4px;
  margin: 0 -4px;
}
.question-preview {
  align-self: flex-start;
  justify-self: start;
  margin-left: 44px;
}
.question-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-shrink: 0;
  min-width: 0;
}
.question-symbol {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.question-text {
  margin: 0;
  padding: 3px 0;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 17px;
  line-height: 1.45;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.question-choices-scroll {
  flex: 0 0 auto;
  margin-top: 12px;
}
.question-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.question-options button {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 12px;
  text-align: left;
  font-size: 14px;
  line-height: 1.45;
  font-weight: 500;
  background: var(--situate-surface);
}
.question-option-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.question-options .question-option-arrow {
  width: 16px;
  height: 16px;
  color: var(--situate-muted);
  transform: rotate(90deg);
}
.question-options--list {
  flex-direction: column;
  align-items: stretch;
}
.question-options--list button {
  width: 100%;
}
@media (hover: hover) {
  .question-options button:not(:disabled):hover {
    background: var(--situate-accent-soft, var(--situate-lilac));
    border-color: var(--situate-accent-strong, var(--situate-violet-deep));
    color: var(--situate-ink);
  }
  .question-options button:not(:disabled):hover .question-option-arrow {
    color: var(--situate-accent-strong, var(--situate-violet-deep));
  }
}
.question-options
  button:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -3px;
}
.question-more {
  display: block;
  border: 0;
  background: transparent;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font: inherit;
  font-size: 13px;
  min-height: var(--situate-target-min);
  padding: 8px 0;
  text-align: left;
  cursor: pointer;
}
.question-more:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -3px;
}
@container (max-width: 360px) {
  .question-symbol {
    display: none;
  }
}
@media (max-height: 480px) {
  .question-choices-scroll {
    margin-top: 8px;
  }
}
</style>
