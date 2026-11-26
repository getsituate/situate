<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { SituateButton, SituateIcon } from "@situate/ui";
import { t } from "@situate/localization";
import type { RetainedQuestion } from "../../ai/question";
import type { ContentReference } from "../../files/content-reference";
import {
  historySections,
  isHistoryDetail,
  type HistoryPeriod,
} from "./work-history";
import ChatDuration from "./ChatDuration.vue";
import TranscriptEntries from "./TranscriptEntries.vue";
const props = defineProps<{
  period: HistoryPeriod;
  scope: string;
  openReference?: (reference: ContentReference) => void;
}>();
const emit = defineEmits<{
  preview: [preview: NonNullable<RetainedQuestion["preview"]>];
}>();
const id = useId();
const expanded = ref(false);
const sections = computed(() => historySections(props.period.entries));
const targets = computed(() =>
  sections.value.segments
    .filter((segment) => segment.collapsible)
    .map((segment) => `${id}-${segment.entry.key}`),
);
const now = ref(performance.now());
let timer: ReturnType<typeof setInterval> | undefined;
watch(
  () => props.period.active?.id,
  (id) => {
    clearInterval(timer);
    now.value = performance.now();
    if (id !== undefined)
      timer = setInterval(() => {
        now.value = performance.now();
      }, 1000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(timer));
const elapsed = computed(() =>
  props.period.active
    ? Math.max(
        0,
        Math.max(now.value, performance.now()) - props.period.active.startedAt,
      )
    : undefined,
);
</script>
<template>
  <TranscriptEntries
    :entries="sections.before"
    :scope="scope"
    @preview="emit('preview', $event)"
  />
  <section class="work-history" :aria-label="t('chat.workHistory')">
    <div class="work-history-heading">
      <component
        :is="targets.length ? SituateButton : 'div'"
        :variant="targets.length ? 'plain' : undefined"
        :class="targets.length ? 'work-history-toggle' : 'work-history-time'"
        :data-chat-disclosure="targets.length ? '' : undefined"
        :aria-expanded="targets.length ? expanded : undefined"
        :aria-controls="targets.length ? targets.join(' ') : undefined"
        :aria-labelledby="
          targets.length && period.active ? `${id}-elapsed` : undefined
        "
        @click="expanded = !expanded"
      >
        <ChatDuration
          v-if="elapsed !== undefined || period.durationMs !== undefined"
          :id="period.active ? `${id}-elapsed` : undefined"
          inline
          :duration-ms="elapsed ?? period.durationMs"
          :outcome="period.active ? 'active' : (period.outcome ?? 'complete')"
        />
        <span v-else>{{
          period.outcome === "cancelled"
            ? t("chat.stoppedState")
            : period.outcome === "error" || period.outcome === "interrupted"
              ? t("chat.interrupted")
              : t("chat.workHistory")
        }}</span>
        <SituateIcon
          v-if="targets.length"
          name="chevron"
          :class="{ expanded }"
        />
      </component>
    </div>
    <div
      v-for="segment in sections.segments"
      :id="`${id}-${segment.entry.key}`"
      :key="segment.entry.key"
      :hidden="segment.collapsible && !expanded"
      :class="[
        'history-segment',
        { 'history-detail': isHistoryDetail(segment.entry) },
      ]"
    >
      <TranscriptEntries
        :entries="[segment.entry]"
        :scope="scope"
        :open-reference="openReference"
        @preview="emit('preview', $event)"
      />
    </div>
  </section>
</template>
<style scoped>
.work-history {
  display: flex;
  flex-direction: column;
  gap: var(--chat-block-gap);
  min-width: 0;
  margin: 0 0 var(--situate-space-1-5);
}
.work-history-heading {
  border-bottom: 1px solid var(--situate-line);
}
.work-history-toggle,
.work-history-time {
  display: flex;
  align-items: center;
  gap: var(--situate-space-2-5);
  min-height: 44px;
  border: 0;
  padding: var(--situate-space-1-5) 0;
  margin: 0;
  background: transparent;
  color: var(--situate-muted);
  font: var(--situate-text-small)/1.5 var(--situate-font-body);
  text-align: start;
}
.work-history-toggle {
  cursor: pointer;
  border-radius: var(--situate-radius-tight);
}
.work-history-heading :deep(.duration) {
  margin: 0;
  color: inherit;
  font: inherit;
}
.work-history-toggle :deep(svg) {
  width: 14px;
  height: 14px;
  transform: rotate(-90deg);
  flex: 0 0 14px;
}
.work-history-toggle :deep(svg.expanded) {
  transform: rotate(0);
}
.work-history-toggle:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.history-segment {
  min-width: 0;
}
.history-segment:not([hidden]) {
  display: flex;
  flex-direction: column;
}
.history-detail {
  padding-inline-start: var(--situate-space-3);
}
@container (max-width:540px) {
  .history-detail {
    padding-inline-start: var(--situate-space-1);
  }
}
</style>
