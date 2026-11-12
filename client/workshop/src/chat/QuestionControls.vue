<script setup lang="ts">
import { SituateSelect } from "../ui";
import type { ChatState } from "./model";
import {
  questionExamples,
  setQuestionExample,
  type QuestionExample,
} from "./question-examples";
import copy from "../localization/en.conversation-presets.json";
defineProps<{ state: ChatState }>();
const emit = defineEmits<{ "update:state": [state: ChatState] }>();
</script>
<template>
  <label for="question-example">{{ copy.questionExample }}</label>
  <SituateSelect
    id="question-example"
    :value="state.questionVariant"
    @change="
      emit(
        'update:state',
        setQuestionExample(
          state,
          ($event.target as HTMLSelectElement).value as QuestionExample,
        ),
      )
    "
  >
    <option
      v-for="example in questionExamples"
      :key="example.id"
      :value="example.id"
    >
      {{ example.label.replace(/^Question · /, "") }}
    </option>
  </SituateSelect>
  <p>{{ copy.questionNote }}</p>
</template>
