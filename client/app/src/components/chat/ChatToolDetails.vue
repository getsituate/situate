<script setup lang="ts">
import { t, isMessageKey, localizeError } from "@situate/localization";
import { gmailRequestError } from "../../plugins/gmail-errors";
import ChatImage from "./ChatImage.vue";
import { pretty, type ToolView } from "./transcript";
const props = defineProps<{ call: ToolView; scope: string }>();
function resultText(text: string): string {
  return props.call.result?.isError &&
    (isMessageKey(text) || gmailRequestError(text))
    ? localizeError(text)
    : text;
}
</script>

<template>
  <div class="tool-content">
    <code class="tool-identifier" data-localization-content="identity">{{
      call.name
    }}</code>
    <section v-if="call.args !== undefined">
      <h4>{{ t("chat.input") }}</h4>
      <pre data-localization-content="user">{{ pretty(call.args) }}</pre>
    </section>
    <section v-if="call.result">
      <h4>{{ t("chat.result") }}</h4>
      <template v-for="(block, index) in call.result.content" :key="index">
        <pre v-if="block.type === 'text'" data-localization-content="user">{{
          resultText(block.text)
        }}</pre>
        <ChatImage
          v-else-if="block.type === 'image'"
          :scope="scope"
          :image="block"
        />
      </template>
    </section>
    <section v-else-if="call.progress !== undefined">
      <h4>{{ t("chat.progress") }}</h4>
      <pre data-localization-content="user">{{ pretty(call.progress) }}</pre>
    </section>
  </div>
</template>

<style scoped>
.tool-content {
  padding: var(--situate-space-3);
  margin: var(--situate-space-1) 0 var(--situate-space-3);
  border-radius: var(--situate-radius-small);
  background: var(--situate-paper);
  color: var(--situate-muted);
  overflow-wrap: anywhere;
}
.tool-identifier {
  font: var(--situate-text-label) var(--situate-font-mono);
}
h4 {
  font-weight: 500;
  color: var(--situate-muted);
  font-size: var(--situate-text-fine);
  margin: var(--situate-space-3) 0 5px;
}
pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: var(--situate-text-label)/1.6 var(--situate-font-mono);
}
</style>
