<script setup lang="ts">
import { computed } from "vue";
import { SituateDisclosure, SituateIcon } from "@situate/ui";
import { t } from "@situate/localization";
import type { ToolView } from "./transcript";
import type { ToolCategory } from "./work-history";
import ChatToolCard from "./ChatToolCard.vue";
const props = defineProps<{
  calls: ToolView[];
  category: ToolCategory;
  scope: string;
}>();
const complete = computed(() =>
  props.calls.every((call) => ["completed", "succeeded"].includes(call.state)),
);
const paths = computed(() =>
  props.calls.map((call) =>
    call.args &&
    typeof call.args === "object" &&
    "path" in call.args &&
    typeof call.args.path === "string" &&
    call.args.path.trim()
      ? call.args.path
      : undefined,
  ),
);
const label = computed(() => {
  if (props.category === "web")
    return t("chat.historyWebFetches", { count: props.calls.length });
  if (
    props.category === "read" &&
    complete.value &&
    paths.value.every((path) => path !== undefined)
  )
    return new Set(paths.value).size === 1
      ? t("chat.historyReadFile")
      : t("chat.historyReadFiles", { count: new Set(paths.value).size });
  if (complete.value && props.category === "search")
    return props.calls.length === 1
      ? t("chat.historySearchedSource")
      : t("chat.historySearchedSources", { count: props.calls.length });
  if (complete.value && props.category === "other")
    return props.calls.length === 1
      ? t("chat.historyUsedTool")
      : t("chat.historyUsedTools", { count: props.calls.length });
  if (props.category === "read")
    return props.calls.length === 1
      ? t("chat.historyFileRead")
      : t("chat.historyFileReads", { count: props.calls.length });
  if (props.category === "search")
    return props.calls.length === 1
      ? t("chat.historySearch")
      : t("chat.historySearches", { count: props.calls.length });
  return props.calls.length === 1
    ? t("chat.historyToolCall")
    : t("chat.historyToolCalls", { count: props.calls.length });
});
const state = computed(() =>
  props.calls.some((call) => ["failed", "error"].includes(call.state))
    ? t("chat.failed")
    : props.calls.some((call) =>
          ["running", "started", "pending", "intent"].includes(call.state),
        )
      ? t("chat.running")
      : props.calls.some((call) =>
            ["cancelled", "aborted", "interrupted"].includes(call.state),
          )
        ? t("chat.interrupted")
        : "",
);
</script>
<template>
  <SituateDisclosure class="history-tools">
    <template #label>
      <SituateIcon
        :name="
          category === 'web'
            ? 'globe'
            : category === 'read'
              ? 'notes'
              : 'folder'
        "
      />
      <span>{{ label }}</span
      ><span v-if="state" class="group-state">{{ state }}</span>
      <span class="history-chevron" aria-hidden="true" />
    </template>
    <div class="history-calls">
      <ChatToolCard
        v-for="call in calls"
        :key="call.key"
        :call="call"
        :scope="scope"
      />
    </div>
  </SituateDisclosure>
</template>
<style scoped>
.history-tools {
  margin: 4px 0;
  min-width: 0;
  color: var(--situate-muted);
}
.history-tools > :deep(summary) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  list-style: none;
  border-radius: 6px;
  padding: 4px 6px;
  cursor: pointer;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.history-tools > :deep(summary::-webkit-details-marker) {
  display: none;
}
.history-chevron::before {
  content: "›";
}
.history-chevron {
  display: inline-block;
  font-size: 18px;
  line-height: 1;
  margin-inline-start: 2px;
}
.history-tools[open] > :deep(summary) > .history-chevron {
  transform: rotate(90deg);
}
.history-tools > :deep(summary svg) {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.history-calls {
  margin-inline-start: 22px;
  padding-inline-start: 12px;
  border-inline-start: 1px solid var(--situate-line);
}
.group-state {
  margin-inline-start: auto;
  font-size: 11px;
}
@media (hover: hover) {
  .history-tools > :deep(summary:hover) {
    background: var(--situate-paper);
  }
}
.history-tools > :deep(summary):focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
  border-radius: 6px;
}
</style>
