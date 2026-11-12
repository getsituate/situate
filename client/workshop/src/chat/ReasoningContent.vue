<script setup lang="ts">
import type { ReasoningEvent } from "./model";
import { historyCopy } from "./work-history";
import ChatMarkdown from "./ChatMarkdown.vue";
withDefaults(defineProps<{ event: ReasoningEvent; locale?: "en" | "de" }>(), {
  locale: "en",
});
</script>

<template>
  <div
    class="history-reasoning"
    role="note"
    :aria-label="historyCopy[locale].reasoning"
  >
    <ChatMarkdown
      :content="event.text"
      :final="event.status !== 'working'"
      eager
    />
  </div>
</template>

<style scoped>
.history-reasoning {
  color: var(--situate-muted);
  font-size: 13px;
  line-height: 1.7;
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.history-reasoning :deep(strong) {
  font-weight: 500;
}
.history-reasoning :deep(h1),
.history-reasoning :deep(h2),
.history-reasoning :deep(h3),
.history-reasoning :deep(h4),
.history-reasoning :deep(h5),
.history-reasoning :deep(h6) {
  font-size: 1em;
  font-weight: 500;
}
.history-reasoning :deep(.node-slot:first-child :is(h1, h2, h3, h4, h5, h6)) {
  margin-block-start: 0;
}
</style>
