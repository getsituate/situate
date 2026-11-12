<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { elapsedWorkTime, workClockText } from "./work-clock";
import { SituateButton, SituateIcon } from "../ui";
import type { Event, Phase } from "./model";
import {
  historyCopy,
  historyLabel,
  historySections,
  isWorkDetail,
  type WorkHistoryState,
} from "./work-history";
import ChatTranscript from "./ChatTranscript.vue";
import WorkHistoryEntries from "./WorkHistoryEntries.vue";

const props = withDefaults(
  defineProps<{
    events: Event[];
    history: WorkHistoryState;
    phase: Phase;
    startedAt?: number;
    locale?: "en" | "de";
  }>(),
  { locale: "en" },
);
const emit = defineEmits<{ file: [path: string] }>();
const id = useId();
const expanded = ref(false);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
watch(
  () => [props.phase, props.startedAt] as const,
  ([phase, startedAt]) => {
    clearInterval(clock);
    now.value = Date.now();
    if (phase === "working" && startedAt !== undefined)
      clock = setInterval(() => {
        now.value = Date.now();
      }, 1000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(clock));
const elapsed = computed(() =>
  workClockText(
    elapsedWorkTime(props.history.milliseconds, props.startedAt, now.value),
  ),
);
const sections = computed(() => historySections(props.events, props.phase));
const targets = computed(() =>
  sections.value.segments
    .filter((segment) => segment.collapsible)
    .map((segment) => `${id}-${segment.id}`),
);
const label = computed(() =>
  historyLabel(props.history, props.phase, props.locale),
);
</script>

<template>
  <ChatTranscript
    :events="sections.before"
    :locale="locale"
    plain
    @file="emit('file', $event)"
  />
  <section class="work-history" :aria-label="historyCopy[locale].history">
    <div class="work-history-heading">
      <SituateButton
        v-if="targets.length"
        variant="plain"
        class="work-history-toggle"
        :aria-expanded="expanded"
        :aria-controls="targets.join(' ')"
        @click="expanded = !expanded"
      >
        <span>{{ label }}</span
        ><SituateIcon name="chevron" :class="{ expanded }" />
      </SituateButton>
      <p v-else class="work-history-time">{{ label }}</p>
      <span
        v-if="phase === 'working' && elapsed"
        class="work-history-clock"
        role="timer"
        aria-live="off"
        :aria-label="historyCopy[locale].elapsed"
        >{{ elapsed }}</span
      >
    </div>
    <div
      v-for="segment in sections.segments"
      :id="`${id}-${segment.id}`"
      :key="segment.id"
      :hidden="segment.collapsible && !expanded"
      :class="[
        'history-segment',
        { 'history-detail': isWorkDetail(segment.events[0]) },
      ]"
    >
      <WorkHistoryEntries
        v-if="isWorkDetail(segment.events[0])"
        :events="segment.events"
        :locale="locale"
      />
      <ChatTranscript
        v-else
        :events="segment.events"
        :locale="locale"
        plain
        @file="emit('file', $event)"
      />
    </div>
  </section>
  <ChatTranscript
    :events="sections.after"
    :locale="locale"
    plain
    @file="emit('file', $event)"
  />
</template>

<style scoped>
.work-history {
  margin: 18px 0 26px;
  min-width: 0;
}
.work-history-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 16px;
  border-bottom: 1px solid var(--situate-line);
  margin-bottom: 14px;
}
.work-history-toggle,
.work-history-time {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--situate-target-min);
  border: 0;
  padding: 6px 0;
  margin: 0;
  background: transparent;
  color: var(--situate-muted);
  font: 14px/1.5 var(--situate-font-body);
  text-align: start;
}
.work-history-clock {
  flex-basis: 100%;
  margin: -2px 0 10px;
  color: var(--situate-muted);
  font: 13px/1.5 var(--situate-font-body);
  font-variant-numeric: tabular-nums;
}
.work-history-toggle {
  cursor: pointer;
  border-radius: 6px;
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
.history-detail {
  padding-inline-start: 12px;
}
@media (hover: hover) {
  .work-history-toggle:hover {
    color: var(--situate-ink);
  }
}
@container (max-width: 540px) {
  .history-detail {
    padding-inline-start: 4px;
  }
}
</style>
