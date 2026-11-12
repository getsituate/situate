<script setup lang="ts">
import { computed } from "vue";
import { SituateDisclosure, SituateIcon } from "../ui";
import type { Call } from "./model";
import {
  historyCallLabel,
  historyCopy,
  historyToolLabel,
} from "./work-history";

const props = withDefaults(
  defineProps<{
    calls: Call[];
    category: NonNullable<Call["category"]>;
    locale?: "en" | "de";
  }>(),
  { locale: "en" },
);
const groupState = computed(() =>
  props.calls.some((call) => call.state === "error")
    ? "failed"
    : props.calls.some((call) => call.state === "working")
      ? "running"
      : props.calls.some((call) => call.state === "cancelled")
        ? "stoppedState"
        : undefined,
);
</script>

<template>
  <SituateDisclosure class="history-tools">
    <template #label>
      <SituateIcon :name="category === 'read' ? 'notes' : 'folder'" />
      <span>{{ historyToolLabel(calls, category, locale) }}</span>
      <span v-if="groupState" class="group-state">{{
        historyCopy[locale][groupState]
      }}</span>
      <span class="history-chevron" aria-hidden="true">›</span>
    </template>
    <div class="history-calls">
      <SituateDisclosure
        v-for="call in calls"
        :key="call.id"
        class="history-call"
      >
        <template #label>
          <span class="call-label">{{ historyCallLabel(call, locale) }}</span>
          <span
            v-if="call.pluginName"
            class="call-plugin"
            :aria-label="
              historyCopy[locale].pluginSource.replace(
                '{plugin}',
                call.pluginName,
              )
            "
            >{{ call.pluginName }}</span
          >
          <span
            v-if="
              call.state === 'error' ||
              call.state === 'working' ||
              call.state === 'cancelled'
            "
            class="call-state"
            >{{
              historyCopy[locale][
                call.state === "error"
                  ? "failed"
                  : call.state === "working"
                    ? "running"
                    : "stoppedState"
              ]
            }}</span
          >
          <span class="history-chevron" aria-hidden="true">›</span>
        </template>
        <div class="history-call-data">
          <code class="history-tool-name">{{ call.tool }}</code>
          <h3>{{ historyCopy[locale].input }}</h3>
          <pre>{{ call.input }}</pre>
          <h3>{{ historyCopy[locale].result }}</h3>
          <pre>{{ call.result || historyCopy[locale].waiting }}</pre>
        </div>
      </SituateDisclosure>
    </div>
  </SituateDisclosure>
</template>

<style scoped>
.history-tools {
  margin: 4px 0;
  min-width: 0;
}
.history-tools :deep(summary) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--situate-target-min);
  list-style: none;
  color: var(--situate-muted);
  font-size: 13px;
  border-radius: 6px;
  padding: 4px 6px;
}
.history-tools :deep(summary::-webkit-details-marker) {
  display: none;
}
.history-tools :deep(svg) {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}
.history-chevron {
  display: inline-block;
  font-size: 18px;
  line-height: 1;
  margin-inline-start: 2px;
}
.history-tools[open] > :deep(summary) > .history-chevron,
.history-call[open] > :deep(summary) > .history-chevron {
  transform: rotate(90deg);
}
.history-calls {
  margin-inline-start: 22px;
  padding-inline-start: 12px;
  border-inline-start: 1px solid var(--situate-line);
}
.history-call :deep(summary) {
  font-size: 12px;
  flex-wrap: wrap;
}
.call-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.call-plugin {
  color: var(--situate-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.group-state,
.call-state {
  margin-inline-start: auto;
  font-size: 11px;
}
.history-call-data {
  padding: 12px;
  margin: 4px 0 12px;
  border-radius: 8px;
  background: var(--situate-paper);
  color: var(--situate-muted);
  overflow-wrap: anywhere;
}
.history-tool-name {
  font: 12px var(--situate-font-mono);
}
.history-call-data h3 {
  font-size: 11px;
  font-weight: 500;
  margin: 12px 0 5px;
}
.history-call-data pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12px/1.6 var(--situate-font-mono);
}
@media (hover: hover) {
  .history-tools :deep(summary:hover) {
    background: var(--situate-paper);
  }
}
</style>
