<script setup lang="ts">
import { computed } from "vue";
import type { Event, Phase } from "./model";
import { isWorkDetail, type WorkHistoryState } from "./work-history";
import { conversationBlocks } from "./conversation-transcript";
import ChatTranscript from "./ChatTranscript.vue";
import WorkHistory from "./WorkHistory.vue";

const props = withDefaults(
  defineProps<{
    events: Event[];
    phase: Phase;
    history?: WorkHistoryState;
    milliseconds?: number;
    startedAt?: number;
    locale?: "en" | "de";
  }>(),
  { locale: "en" },
);
const emit = defineEmits<{ file: [path: string] }>();
const blocks = computed(() =>
  conversationBlocks(props.events, props.phase, props.milliseconds),
);
</script>

<template>
  <WorkHistory
    v-if="history"
    :events="events"
    :phase="phase"
    :history="history"
    :started-at="startedAt"
    :locale="locale"
    @file="emit('file', $event)"
  />
  <template v-else v-for="block in blocks" :key="block.id">
    <WorkHistory
      v-if="
        block.events.some(isWorkDetail) ||
        Number.isFinite(block.history.milliseconds)
      "
      :events="block.events"
      :phase="block.phase"
      :history="block.history"
      :started-at="block.phase === 'working' ? startedAt : undefined"
      :locale="locale"
      @file="emit('file', $event)"
    />
    <ChatTranscript
      v-else
      :events="block.events"
      :locale="locale"
      plain
      @file="emit('file', $event)"
    />
  </template>
</template>
