<script setup lang="ts">
import { computed } from "vue";
import type { Event } from "./model";
import { historyCopy, historyEntries } from "./work-history";
import ReasoningContent from "./ReasoningContent.vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import ChatTranscript from "./ChatTranscript.vue";
import WorkHistoryTools from "./WorkHistoryTools.vue";

const props = withDefaults(
  defineProps<{ events: Event[]; locale?: "en" | "de" }>(),
  { locale: "en" },
);
const entries = computed(() => historyEntries(props.events));
</script>

<template>
  <template v-for="entry in entries" :key="entry.id">
    <ReasoningContent
      v-if="entry.kind === 'reasoning'"
      :event="entry"
      :locale="locale"
    />
    <article
      v-else-if="entry.kind === 'message' && entry.purpose === 'progress'"
      class="history-progress"
      :aria-label="historyCopy[locale].progress"
    >
      <ChatMarkdown :content="entry.text" :final="true" eager />
    </article>
    <WorkHistoryTools
      v-else-if="entry.kind === 'tools'"
      :calls="entry.calls"
      :category="entry.category"
      :locale="locale"
    />
    <ChatTranscript v-else :events="[entry]" :locale="locale" plain />
  </template>
</template>

<style scoped>
.history-progress {
  color: var(--situate-ink);
  font-size: 14px;
  line-height: 1.7;
  margin: 16px 0;
}
</style>
