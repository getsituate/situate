<script setup lang="ts">
import { localizeError, t } from "@situate/localization";
import type { RetainedQuestion } from "../../ai/question";
import type { HistoryEntry } from "./work-history";
import ChatMarkdown from "./ChatMarkdown.vue";
import ChatImage from "./ChatImage.vue";
import ChatDuration from "./ChatDuration.vue";
import ChatToolCard from "./ChatToolCard.vue";
import ChatToolGroup from "./ChatToolGroup.vue";
import QuestionPrompt from "./QuestionPrompt.vue";
import ChatSystemMessage from "./ChatSystemMessage.vue";
defineProps<{ entries: HistoryEntry[]; scope: string }>();
const emit = defineEmits<{
  preview: [preview: NonNullable<RetainedQuestion["preview"]>];
}>();
</script>
<template>
  <template v-for="entry in entries" :key="entry.key">
    <ChatDuration
      v-if="entry.kind === 'duration' && entry.work.durationMs !== undefined"
      :duration-ms="entry.work.durationMs"
      :outcome="entry.work.outcome"
    />
    <p v-else-if="entry.kind === 'duration'" class="duration">
      {{
        entry.work.outcome === "cancelled"
          ? t("chat.stoppedState")
          : entry.work.outcome === "complete"
            ? t("chat.completed")
            : t("chat.interrupted")
      }}
    </p>
    <ChatSystemMessage
      v-else-if="entry.kind === 'notice'"
      :message="
        t('chat.pluginAvailable', { pluginName: entry.notice.pluginName })
      "
      :label="t('chat.systemNotice')"
    />
    <section v-else-if="entry.kind === 'question'" class="retained-question">
      <QuestionPrompt
        :question="entry.question"
        :enabled="false"
        @preview="emit('preview', $event)"
      />
    </section>
    <article
      v-else-if="entry.kind === 'message'"
      :class="['message', entry.role]"
    >
      <strong class="sr-only">{{
        entry.role === "user" ? t("navigation.you") : t("navigation.ai")
      }}</strong>
      <template v-for="(part, index) in entry.content" :key="index">
        <ChatMarkdown
          v-if="part.type === 'text' && part.text && entry.role === 'assistant'"
          :content="part.text"
          :final="!entry.streaming"
        />
        <p
          v-else-if="part.type === 'text' && part.text"
          data-localization-content="user"
        >
          {{ part.text }}
        </p>
        <ChatImage
          v-else-if="part.type === 'image'"
          :scope="scope"
          :image="part"
        />
      </template>
    </article>
    <div
      v-else-if="entry.kind === 'reasoning'"
      class="history-reasoning"
      role="note"
      :aria-label="t('chat.modelReasoning')"
    >
      <ChatMarkdown :content="entry.text" :final="!entry.streaming" eager />
    </div>
    <p v-else-if="entry.kind === 'failure'" class="history-failure">
      {{ localizeError(entry.error) }}
    </p>
    <ChatToolGroup
      v-else-if="entry.kind === 'tools'"
      :calls="entry.calls"
      :category="entry.category"
      :scope="scope"
    />
    <ChatToolCard
      v-else-if="entry.kind === 'change' || entry.kind === 'call'"
      :call="entry.call"
      :scope="scope"
    />
  </template>
</template>
<style scoped>
.message {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  font-size: 16px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.message.user {
  align-self: flex-end;
  max-width: 92%;
  margin-inline-start: 48px;
  padding: 18px 22px;
  border-radius: 22px 22px 5px 22px;
  background: var(--situate-accent-soft, var(--situate-lilac));
}
p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.retained-question {
  padding: 16px;
  border: 1px solid var(--situate-line);
  border-radius: 14px;
}
.history-reasoning {
  color: var(--situate-muted);
  font-size: 13px;
  line-height: 1.7;
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.history-reasoning :deep(strong),
.history-reasoning :deep(h1),
.history-reasoning :deep(h2),
.history-reasoning :deep(h3),
.history-reasoning :deep(h4),
.history-reasoning :deep(h5),
.history-reasoning :deep(h6) {
  font-weight: 500;
  font-size: 1em;
}
.history-reasoning :deep(.node-slot:first-child :is(h1, h2, h3, h4, h5, h6)) {
  margin-block-start: 0;
}
.history-reasoning :deep(.chat-markdown) {
  --ms-text-body: 1em;
  --ms-leading-body: 1.7;
  min-width: 0;
}
.history-reasoning :deep(p) {
  margin: 0 0 10px;
}
.history-reasoning :deep(:is(h1, h2, h3, h4, h5, h6)) {
  line-height: inherit;
  margin: 18px 0 8px;
}
.history-reasoning :deep(:is(ul, ol)) {
  margin: 8px 0 12px;
  padding-inline-start: 22px;
}
.history-reasoning :deep(li) {
  margin-block: 4px;
}
.history-reasoning :deep(blockquote) {
  margin: 12px 0;
  padding-inline-start: 14px;
  border-inline-start: 2px solid var(--situate-line);
  color: inherit;
}
.history-failure {
  color: var(--situate-muted);
  font-size: 13px;
  line-height: 1.7;
  margin: 12px 0;
}
@container (max-width:540px) {
  .message {
    font-size: 15px;
  }
  .message.user {
    margin-inline-start: 22px;
    padding: 16px;
  }
}
</style>
