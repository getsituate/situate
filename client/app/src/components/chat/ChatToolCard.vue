<script setup lang="ts">
import { SituateButton, SituateDisclosure } from "@situate/ui";
import { computed, ref, watch } from "vue";
import { t } from "@situate/localization";
import ChatToolDetails from "./ChatToolDetails.vue";
import ChatFileChanges from "./ChatFileChanges.vue";
import ChatBatchChanges from "./ChatBatchChanges.vue";
import { toolCaption } from "./work-history";
import { workspaceCoordinator } from "../../layout/registry";
import type { DocumentReference } from "../../ai/document-sources/contract.js";

import {
  verifiedChange,
  documentLinks,
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
const links = computed(() =>
  batchOpen.value ? documentLinks(props.call) : [],
);
function openDocument(document: DocumentReference) {
  void workspaceCoordinator(props.scope)?.open(
    { kind: "view", viewId: "documents" },
    undefined,
    undefined,
    { document: { ...document } },
  );
}
</script>

<template>
  <article
    :class="['tool-card', { 'change-card': isBatch || changes.length > 0 }]"
  >
    <ChatFileChanges
      v-if="!isBatch"
      :changes="changes"
      :line-diff="call.name === 'edit'"
      :is-error="call.result?.isError"
    />
    <SituateDisclosure
      v-model:open="batchOpen"
      class="call-details"
      custom-indicator
    >
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
      <ul v-if="links.length">
        <li v-for="{ ref, title } in links" :key="ref.id">
          <SituateButton
            type="button"
            variant="ghost"
            @click="openDocument(ref)"
          >
            <span v-if="title" data-localization-content="external">{{
              title
            }}</span>
            <span v-else>{{ t("documents.openReference") }}</span>
          </SituateButton>
        </li>
      </ul>
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
  gap: var(--situate-space-2);
  padding: var(--situate-space-1) var(--situate-space-1-5);
  cursor: pointer;
  min-height: 44px;
  font-size: var(--situate-text-label);
  color: var(--situate-muted);
  border-radius: var(--situate-radius-tight);
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
  font-size: var(--situate-text-subheading);
  line-height: 1;
  margin-inline-start: var(--situate-space-0-5);
}
@media (prefers-reduced-motion: no-preference) {
  .history-chevron {
    transition: transform var(--situate-duration-feedback)
      var(--situate-ease-settle);
  }
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
  font-size: var(--situate-text-fine);
}
.plugin-name {
  color: var(--situate-muted);
  font-size: var(--situate-text-fine);
  overflow-wrap: anywhere;
  max-width: 100%;
}
.batch-technical {
  padding: var(--situate-space-2) var(--situate-space-3-5);
  font-size: var(--situate-text-label);
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
  border-radius: var(--situate-radius-control);
  background: var(--situate-surface);
  overflow: hidden;
}
:deep(summary):focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
}
</style>
