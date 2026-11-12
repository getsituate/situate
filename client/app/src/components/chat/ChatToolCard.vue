<script setup lang="ts">
import { SituateDisclosure } from "@situate/ui";
import { computed, ref, watch } from "vue";
import { t } from "@situate/localization";
import ChatToolDetails from "./ChatToolDetails.vue";
import ChatFileChanges from "./ChatFileChanges.vue";
import ChatBatchChanges from "./ChatBatchChanges.vue";
import { toolCaption } from "./work-history";

import {
  verifiedChange,
  importChangeReceipts,
  type ToolView,
} from "./transcript";

const props = defineProps<{ call: ToolView; scope: string }>();
const batch = computed(() => importChangeReceipts(props.call));
const isBatch = computed(() => props.call.name === "create_batch");
const batchOpen = ref(false);
const technicalOpen = ref(false);
watch(batchOpen, () => {
  technicalOpen.value = false;
});
const changes = computed(() => {
  const direct = verifiedChange(props.call);
  return direct ? [direct] : [];
});
function stateLabel(): string {
  if (["running", "started", "pending", "intent"].includes(props.call.state))
    return t("chat.running");
  if (["completed", "succeeded"].includes(props.call.state))
    return t("chat.completed");
  if (["failed", "error"].includes(props.call.state)) return t("chat.failed");
  if (["cancelled", "aborted"].includes(props.call.state))
    return t("chat.cancelled");
  return t("chat.interrupted");
}
const plugin = computed(() => props.call.pluginName);
</script>

<template>
  <article
    :class="['tool-card', { 'change-card': isBatch || changes.length > 0 }]"
  >
    <ChatFileChanges
      v-if="!isBatch"
      :changes="changes"
      :is-error="call.result?.isError"
    />
    <SituateDisclosure v-model:open="batchOpen" class="call-details">
      <template #label>
        <span class="tool-name" data-localization-content="user">{{
          isBatch && batch
            ? t(
                batch.files.length === 1 ? "files.countOne" : "files.countMany",
                {
                  count: batch.files.length,
                },
              )
            : toolCaption(call)
        }}</span>
        <span
          v-if="plugin"
          class="plugin-name"
          :aria-label="t('chat.usingPlugin', { name: plugin })"
          data-localization-content="identity"
          >{{ plugin }}</span
        >
        <span
          v-if="isBatch || !['completed', 'succeeded'].includes(call.state)"
          class="tool-state"
          >{{ stateLabel() }}</span
        >
        <span class="history-chevron" aria-hidden="true" />
      </template>
      <ChatBatchChanges
        v-if="isBatch && batchOpen && batch"
        :scope="scope"
        :batch="batch"
        :is-error="call.result?.isError"
      />
      <SituateDisclosure
        v-if="isBatch && batchOpen"
        v-model:open="technicalOpen"
        class="batch-technical"
      >
        <template #label>{{ t("chat.technicalDetails") }}</template>
        <ChatToolDetails v-if="technicalOpen" :call="call" :scope="scope" />
      </SituateDisclosure>
      <ChatToolDetails v-if="!isBatch" :call="call" :scope="scope" />
    </SituateDisclosure>
  </article>
</template>

<style scoped>
.tool-card {
  min-width: 0;
}
.call-details > :deep(summary) {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 6px;
  cursor: pointer;
  min-height: 44px;
  font-size: 12px;
  color: var(--situate-muted);
  border-radius: 6px;
  list-style: none;
}
.call-details > :deep(summary::-webkit-details-marker) {
  display: none;
}
.history-chevron::before {
  content: "›";
}
.history-chevron {
  display: inline-block;
  flex: none;
  width: 18px;
  text-align: center;
  font-size: 18px;
  line-height: 1;
  margin-inline-start: 2px;
}
.call-details[open] > :deep(summary) > .history-chevron {
  transform: rotate(90deg);
}
.tool-name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.tool-state {
  margin-inline-start: auto;
  color: var(--situate-muted);
  white-space: nowrap;
  font-size: 11px;
}
.plugin-name {
  color: var(--situate-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.batch-technical {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--situate-muted);
}
.batch-technical :deep(.tool-content) {
  max-height: 360px;
  overflow: auto;
}
@media (hover: hover) {
  .call-details > :deep(summary:hover) {
    background: var(--situate-paper);
  }
}
.change-card {
  border: 1px solid var(--situate-line);
  border-radius: 12px;
  background: var(--situate-surface);
  overflow: hidden;
}
:deep(summary):focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
</style>
