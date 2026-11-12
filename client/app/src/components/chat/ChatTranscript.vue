<script setup lang="ts">
import type { ActiveWorkBlock, WorkBlock } from "../../ai/work-blocks";
import { computed } from "vue";
import { SituateButton } from "@situate/ui";
import { t } from "@situate/localization";
import type { AgentMessage } from "../../ai/contracts";
import type { PluginNotice } from "../../ai/plugin-notices";
import type { RetainedQuestion } from "../../ai/question";
import type { ToolActivity } from "./transcript";
import { conversationHistory } from "./work-history";
import TranscriptEntries from "./TranscriptEntries.vue";
import ChatWorkHistory from "./ChatWorkHistory.vue";
import ChatSystemAnnouncement from "./ChatSystemAnnouncement.vue";
const props = defineProps<{
  messages: AgentMessage[];
  messageOffset?: number;
  historyBefore?: string | null;
  historyLoading?: boolean;
  workBlocks?: WorkBlock[];
  activeWork?: ActiveWorkBlock;
  workError?: unknown;
  activity: ToolActivity[];
  running: boolean;
  scope: string;
  notices?: PluginNotice[];
  questions?: RetainedQuestion[];
  announcement?: PluginNotice;
}>();
const emit = defineEmits<{
  loadOlder: [];
  preview: [preview: NonNullable<RetainedQuestion["preview"]>];
}>();
const blocks = computed(() =>
  conversationHistory(
    props.messages,
    props.activity,
    props.running,
    props.notices,
    props.questions,
    props.workBlocks,
    props.activeWork,
    props.workError,
    props.messageOffset,
  ),
);
</script>
<template>
  <SituateButton
    v-if="historyBefore"
    variant="ghost"
    :disabled="historyLoading"
    data-chat-disclosure
    @click="emit('loadOlder')"
    >{{
      t(
        historyLoading
          ? "chat.loadingEarlierMessages"
          : "chat.loadEarlierMessages",
      )
    }}</SituateButton
  >
  <div
    v-if="blocks.length"
    class="messages"
    :aria-label="t('navigation.conversation')"
  >
    <template v-for="block in blocks" :key="block.key">
      <ChatWorkHistory
        v-if="block.kind === 'history'"
        :period="block"
        :scope="scope"
        @preview="emit('preview', $event)"
      />
      <TranscriptEntries
        v-else
        :entries="[block]"
        :scope="scope"
        @preview="emit('preview', $event)"
      />
    </template>
  </div>
  <ChatSystemAnnouncement
    :id="announcement?.id"
    :message="
      announcement
        ? t('chat.pluginAvailable', { pluginName: announcement.pluginName })
        : ''
    "
  />
</template>
<style scoped>
.messages {
  --chat-block-gap: 20px;
  display: flex;
  flex-direction: column;
  gap: var(--chat-block-gap);
  min-width: 0;
}
.messages > :deep(.duration) {
  margin-block-start: calc(8px - var(--chat-block-gap));
}
</style>
