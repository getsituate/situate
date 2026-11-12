<script setup lang="ts">
import { SituateSelect, SituateButton } from "../ui";
import copy from "../localization/en.import-preparation.json";
import type {
  SourceAction,
  SourceConversation,
  SourceReply,
} from "./source-conversation";
defineProps<{ state: SourceConversation }>();
const emit = defineEmits<{ action: [action: SourceAction] }>();
</script>
<template>
  <section>
    <p>{{ copy.controls.intro }}</p>
    <label
      >{{ copy.controls.outcome }}
      <SituateSelect
        :value="state.outcome"
        :aria-label="copy.controls.outcome"
        @change="
          emit('action', {
            type: 'outcome',
            value: ($event.target as HTMLSelectElement)
              .value as SourceConversation['outcome'],
          })
        "
      >
        <option value="success">{{ copy.controls.success }}</option>
        <option value="failure">{{ copy.controls.failure }}</option>
        <option value="wait">{{ copy.controls.wait }}</option>
      </SituateSelect>
    </label>
    <label
      >{{ copy.controls.reply }}
      <SituateSelect
        :value="state.reply"
        :aria-label="copy.controls.reply"
        @change="
          emit('action', {
            type: 'reply',
            value: ($event.target as HTMLSelectElement).value as SourceReply,
          })
        "
      >
        <option value="appleNotes">{{ copy.controls.appleNotes }}</option>
        <option value="access">{{ copy.controls.access }}</option>
        <option value="scope">{{ copy.controls.scope }}</option>
        <option value="review">{{ copy.controls.review }}</option>
        <option value="partial">{{ copy.controls.partial }}</option>
      </SituateSelect>
    </label>
    <template v-if="state.phase === 'working'">
      <SituateButton
        variant="plain"
        @click="emit('action', { type: 'complete', attempt: state.attempt })"
      >
        {{ copy.controls.complete }}
      </SituateButton>
      <SituateButton
        variant="plain"
        @click="emit('action', { type: 'fail', attempt: state.attempt })"
      >
        {{ copy.controls.fail }}
      </SituateButton>
    </template>
  </section>
</template>
<style scoped>
section,
label {
  display: grid;
  gap: 8px;
}
section {
  gap: 12px;
}
select,
button {
  font: inherit;
  min-height: 40px;
}
p {
  font-size: 0.875rem;
  line-height: 1.5;
}
</style>
