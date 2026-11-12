<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { SituateButton, SituateIcon } from "@situate/ui";
import { t } from "@situate/localization";
import type { RetainedQuestion } from "../../ai/question";
import {
  historySections,
  isHistoryDetail,
  elapsedClock,
  type HistoryPeriod,
} from "./work-history";
import ChatDuration from "./ChatDuration.vue";
import TranscriptEntries from "./TranscriptEntries.vue";
const props = defineProps<{ period: HistoryPeriod; scope: string }>();
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
  () => props.period.active?.startedAt,
  (startedAt) => {
    clearInterval(timer);
    now.value = performance.now();
    if (startedAt !== undefined)
      timer = setInterval(() => {
        now.value = performance.now();
      }, 1000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(timer));
const elapsed = computed(() =>
  elapsedClock(
    Math.max(now.value, performance.now()) -
      (props.period.active?.startedAt ?? now.value),
  ),
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
        @click="expanded = !expanded"
      >
        <span v-if="period.active">{{ t("chat.workingLabel") }}</span>
        <ChatDuration
          v-else-if="period.durationMs !== undefined"
          inline
          :duration-ms="period.durationMs"
          :outcome="period.outcome ?? 'complete'"
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
      <span
        v-if="period.active"
        class="work-history-clock"
        role="timer"
        aria-live="off"
        :aria-label="t('chat.elapsedWorkTime')"
        data-localization-content="formatted"
        >{{ elapsed }}</span
      >
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
  margin: 0 0 6px;
}
.work-history-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 16px;
  border-bottom: 1px solid var(--situate-line);
}
.work-history-toggle,
.work-history-time {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  border: 0;
  padding: 6px 0;
  margin: 0;
  background: transparent;
  color: var(--situate-muted);
  font: 14px/1.5 var(--situate-font-body);
  text-align: start;
}
.work-history-toggle {
  cursor: pointer;
  border-radius: 6px;
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
.work-history-clock {
  flex-basis: 100%;
  margin: -2px 0 10px;
  color: var(--situate-muted);
  font: 13px/20px var(--situate-font-body);
  font-variant-numeric: tabular-nums;
}
.history-segment {
  min-width: 0;
}
.history-segment:not([hidden]) {
  display: flex;
  flex-direction: column;
}
.history-detail {
  padding-inline-start: 12px;
}
@container (max-width:540px) {
  .history-detail {
    padding-inline-start: 4px;
  }
}
</style>
