<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { localizeError, t } from "@situate/localization";
import { ref } from "vue";
import ErrorDialog from "../../errors/ErrorDialog.vue";
import { isWebLink, splitWebLinks } from "./chat-links";
import type { RetainedQuestion } from "../../ai/question";
import type { HistoryEntry } from "./work-history";
import ChatMarkdown from "./ChatMarkdown.vue";
import ChatImage from "./ChatImage.vue";
import ChatImportedFiles from "./ChatImportedFiles.vue";
import type { ContentReference } from "../../files/content-reference";
import ChatDuration from "./ChatDuration.vue";
import ChatToolCard from "./ChatToolCard.vue";
import ChatToolGroup from "./ChatToolGroup.vue";
import QuestionPrompt from "./QuestionPrompt.vue";
import ChatSystemMessage from "./ChatSystemMessage.vue";
defineProps<{
  entries: HistoryEntry[];
  scope: string;
  openReference?: (reference: ContentReference) => void;
}>();
const emit = defineEmits<{
  preview: [preview: NonNullable<RetainedQuestion["preview"]>];
}>();
const linkError = ref("");
async function followLink(event: MouseEvent): Promise<void> {
  const href =
    event.target instanceof Element
      ? event.target.closest("a")?.getAttribute("href")
      : null;
  if (!href) return;
  event.preventDefault();
  if (event.button > 1 || !isWebLink(href)) return;
  try {
    await invoke("open_web_link", { href });
  } catch {
    linkError.value = t("native.files.external.openFailed");
  }
}
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
      @click.capture="followLink"
      @auxclick.capture="followLink"
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
        <p v-else-if="part.type === 'text' && part.text">
          <template
            v-for="(segment, index) in splitWebLinks(part.text)"
            :key="index"
          >
            <a
              v-if="index % 2 === 1 && isWebLink(segment)"
              :href="segment"
              data-localization-content="user"
              >{{ segment }}</a
            >
            <span v-else data-localization-content="user">{{ segment }}</span>
          </template>
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
      @click.capture="followLink"
      @auxclick.capture="followLink"
    >
      <ChatMarkdown :content="entry.text" :final="!entry.streaming" eager />
    </div>
    <p v-else-if="entry.kind === 'failure'" class="history-failure">
      {{ localizeError(entry.error) }}
    </p>
    <ChatImportedFiles
      v-else-if="entry.kind === 'imported-files' && openReference"
      :references="entry.references"
      :linked="entry.linked"
      :scope="scope"
      @open="openReference"
    />
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
  <ErrorDialog
    :open="!!linkError"
    :message="linkError"
    @dismiss="linkError = ''"
  />
</template>
<style scoped>
.message {
  display: flex;
  flex-direction: column;
  gap: var(--situate-space-3-5);
  min-width: 0;
  font-size: var(--situate-text-body);
  line-height: var(--situate-leading-reading);
  overflow-wrap: anywhere;
}
.message.user {
  align-self: flex-end;
  max-width: 92%;
  margin-inline-start: var(--situate-space-12);
  padding: var(--situate-space-4-5) 22px;
  border-radius: 22px 22px 5px 22px;
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.message.user a {
  color: var(--situate-link);
  text-decoration: underline;
  text-underline-offset: 3px;
}
p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.retained-question {
  padding: var(--situate-space-4);
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-panel-compact);
}
.history-reasoning {
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
  line-height: var(--situate-leading-reading);
  margin: var(--situate-space-3) 0;
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
  margin: 0 0 var(--situate-space-2-5);
}
.history-reasoning :deep(:is(h1, h2, h3, h4, h5, h6)) {
  line-height: inherit;
  margin: var(--situate-space-4-5) 0 var(--situate-space-2);
}
.history-reasoning :deep(:is(ul, ol)) {
  margin: var(--situate-space-2) 0 var(--situate-space-3);
  padding-inline-start: 22px;
}
.history-reasoning :deep(li) {
  margin-block: var(--situate-space-1);
}
.history-reasoning :deep(blockquote) {
  margin: var(--situate-space-3) 0;
  padding-inline-start: var(--situate-space-3-5);
  border-inline-start: 2px solid var(--situate-line);
  color: inherit;
}
.history-failure {
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
  line-height: var(--situate-leading-reading);
  margin: var(--situate-space-3) 0;
}
@container (max-width:540px) {
  .message {
    font-size: var(--situate-text-control);
  }
  .message.user {
    margin-inline-start: 22px;
    padding: var(--situate-space-4);
  }
}
</style>
