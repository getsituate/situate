<script setup lang="ts">
import { SituateButton, SituateSelect } from "../ui";
import type { ChatState } from "./model";
import {
  advanceHistory,
  continueHistory,
  historyCopy,
  historyExamples,
  type HistoryExample,
} from "./work-history";

import { setConversationExample } from "./conversation-examples";
import presetCopy from "../localization/en.conversation-presets.json";

defineProps<{ state: ChatState }>();
const emit = defineEmits<{ "update:state": [state: ChatState] }>();
const labels = {
  mixed: "mixed",
  fragments: "fragments",
  long: "long",
  "no-reasoning": "noReasoning",
  unclassified: "unclassified",
  changes: "changes",
  question: "question",
  approval: "approval",
  "text-only": "textOnly",
  plugin: "plugin",
} as const;
</script>

<template>
  <p>{{ historyCopy.en.controlsNote }}</p>
  <label for="work-history-example">{{ historyCopy.en.controlsLabel }}</label>
  <SituateSelect
    id="work-history-example"
    :value="
      state.workTimeMs !== undefined ? 'followup' : state.workHistory?.example
    "
    @change="
      emit(
        'update:state',
        setConversationExample(
          state,
          ($event.target as HTMLSelectElement).value as
            HistoryExample | 'followup',
        ),
      )
    "
  >
    <option value="followup">{{ presetCopy.followup }}</option>
    <option v-for="example in historyExamples" :key="example" :value="example">
      {{ historyCopy.en[labels[example]] }}
    </option>
  </SituateSelect>
  <template v-if="state.phase === 'working' && state.workHistory">
    <SituateButton
      variant="secondary"
      size="small"
      @click="emit('update:state', advanceHistory(state))"
      >{{ historyCopy.en.advance }}</SituateButton
    >
    <SituateButton
      v-if="
        state.workHistory?.example !== 'no-reasoning' &&
        state.workHistory?.example !== 'text-only'
      "
      variant="secondary"
      size="small"
      @click="emit('update:state', continueHistory(state))"
      >{{ historyCopy.en.append }}</SituateButton
    >
  </template>
</template>
