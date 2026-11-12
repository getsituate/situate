<script setup lang="ts">
import { computed } from "vue";
import ReasoningContent from "./ReasoningContent.vue";
import ChatMarkdown from "./ChatMarkdown.vue";
import { historyCopy } from "./work-history";
import { workDurationText } from "./work-time";
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { SituateButton } from "../ui";
import ChatMessage from "../components/ChatMessage.vue";
import ChatSystemMessage from "../components/ChatSystemMessage.vue";
import { groupEvents, type Event } from "./model";
import {
  pluginAvailableText,
  systemMessageCopy,
  type SystemMessageLocale,
} from "./system-message";
import c from "../localization/en.chat-transcript.json";
const props = withDefaults(
  defineProps<{
    events: Event[];
    locale?: SystemMessageLocale;
    plain?: boolean;
  }>(),
  { locale: "en" },
);
const emit = defineEmits<{
  file: [path: string];
}>();
const blocks = computed(() => groupEvents(props.events));
</script>
<template>
  <template v-for="block in blocks" :key="block.id">
    <ReasoningContent
      v-if="block.kind === 'reasoning'"
      :event="block"
      :locale="locale"
    />
    <ChatMessage
      v-else-if="block.kind === 'message'"
      :speaker="block.speaker"
      :label="block.answer ? historyCopy[locale].answer : undefined"
      :hide-speaker="block.answer || plain"
    >
      <ChatMarkdown
        v-if="block.answer || (plain && block.speaker === 'assistant')"
        :content="block.text"
        :final="true"
      />
      <p v-else>{{ block.text }}</p>
      <p
        v-if="
          block.workDuration && workDurationText(block.workDuration, locale)
        "
        class="work-duration"
      >
        {{ workDurationText(block.workDuration, locale) }}
      </p>
      <div v-if="block.files?.length" class="message-files">
        <SituateButton
          v-for="file in block.files"
          :key="file.path"
          variant="plain"
          class="message-file"
          @click="
            ($event.currentTarget as HTMLElement).focus();
            emit('file', file.path);
          "
          >{{ file.label ?? file.path }}
          <span aria-hidden="true">↗</span></SituateButton
        >
      </div>
    </ChatMessage>
    <ChatMessage
      v-else-if="block.kind === 'question'"
      speaker="assistant"
      class="chat-question"
      :hide-speaker="plain"
      :data-question-id="block.id"
    >
      <p class="question-text">{{ block.text }}</p>
    </ChatMessage>
    <ChatSystemMessage
      v-else-if="block.kind === 'system'"
      :message="pluginAvailableText(block.pluginName, locale)"
      :label="systemMessageCopy[locale].label"
    />
    <div v-else-if="block.kind === 'activity'" class="activity-wrap">
      <SituateDisclosure class="activity">
        <template #label>
          <span class="disclosure" aria-hidden="true">›</span
          ><span>{{ c.activity }}</span
          ><span class="activity-count">{{
            (block.calls.length === 1 ? c.step : c.steps).replace(
              "{count}",
              String(block.calls.length),
            )
          }}</span>
        </template>
        <div class="activity-list">
          <SituateDisclosure
            v-for="call in block.calls"
            :key="call.id"
            class="call-detail"
          >
            <template #label>
              <span class="call-check" aria-hidden="true">✓</span
              ><span>{{ call.label }}</span
              ><span class="disclosure" aria-hidden="true">›</span>
            </template>
            <div class="call-data">
              <span class="tool-name">{{ call.tool }}</span>
              <h3>{{ c.input }}</h3>
              <pre>{{ call.input }}</pre>
              <h3>{{ c.result }}</h3>
              <pre>{{ call.result }}</pre>
            </div>
          </SituateDisclosure>
        </div>
      </SituateDisclosure>
      <span
        v-if="block.calls.some((call) => call.tool === 'books.search')"
        class="plugin-use"
        >{{ c.bookShelf }}</span
      >
    </div>
    <article
      v-else
      class="change-card"
      :aria-label="`${block.label}: ${block.file}`"
    >
      <header>
        <span class="file-icon" aria-hidden="true">≡</span
        ><strong>{{ block.file }}</strong
        ><span class="change-state"
          >{{ block.label }} <span aria-hidden="true">✓</span></span
        >
      </header>
      <p v-if="block.contentNotice" class="write-content" role="note">
        {{ block.contentNotice }}
      </p>
      <div v-else-if="block.before" class="edit-content">
        <section class="removed">
          <h3><span aria-hidden="true">−</span> {{ c.removed }}</h3>
          <pre>{{ block.before }}</pre>
        </section>
        <section class="added">
          <h3><span aria-hidden="true">+</span> {{ c.added }}</h3>
          <pre>{{ block.after }}</pre>
        </section>
      </div>
      <pre v-else class="write-content">{{ block.after }}</pre>
      <SituateDisclosure class="change-details">
        <template #label
          >{{ c.details }} <span aria-hidden="true">›</span></template
        >
        <div class="call-data">
          <span class="tool-name">{{ block.tool }}</span>
          <h3>{{ c.input }}</h3>
          <pre>{{ block.input }}</pre>
          <h3>{{ c.result }}</h3>
          <pre>{{ block.result }}</pre>
        </div>
      </SituateDisclosure>
    </article>
  </template>
</template>
<style scoped src="./transcript.css"></style>
