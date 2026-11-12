<script setup lang="ts">
import { SituateCheckbox } from "../ui";
import { computed } from "vue";
import SituateIcon from "./NavigationIcon.vue";
import { events, tasks } from "./fixtures";
import type { ViewId } from "./model";
const props = defineProps<{ view: ViewId; completedTasks: boolean[] }>();
defineEmits<{ toggleTask: [index: number] }>();
const remaining = computed(
  () => props.completedTasks.filter((value) => !value).length,
);
</script>
<template>
  <div class="dashboard">
    <template v-if="view === 'day'">
      <p class="date">Wednesday, 14 October</p>
      <h2>Your day at a glance</h2>
      <p class="dashboard-sub">
        2 events · {{ remaining }} planned
        {{ remaining === 1 ? "task" : "tasks" }}
      </p>
    </template>
    <section v-if="view === 'day' || view === 'calendar'" class="module">
      <div class="module-heading">
        <h3>Calendar</h3>
        <span class="calendar-period"
          ><strong>Today</strong><span>Week</span></span
        >
      </div>
      <div v-for="event in events" :key="event.time" class="row">
        <time :datetime="event.time">{{ event.time }}</time>
        <div class="event">
          {{ event.title }}<small>{{ event.detail }}</small>
        </div>
      </div>
    </section>
    <div v-if="view === 'day'" class="inbox" aria-label="Inbox counts">
      <div><strong>8</strong>Unread emails</div>
      <div><strong>3</strong>New messages</div>
      <div><strong>5</strong>Inbox items</div>
    </div>
    <section v-if="view === 'day' || view === 'tasks'" class="module">
      <div class="module-heading">
        <h3>Planned for today</h3>
        <span v-if="view === 'day'">All tasks ↗</span>
      </div>
      <label v-for="(task, index) in tasks" :key="task" class="row task-row"
        ><SituateCheckbox
          appearance="plain"
          type="checkbox"
          :checked="completedTasks[index]"
          @change="$emit('toggleTask', index)"
        /><span>{{ task }}</span></label
      >
    </section>
    <section v-if="view === 'day'" class="module">
      <div class="module-heading"><h3>Needs attention</h3></div>
      <p class="attention">
        <SituateIcon name="attention" /><span
          >Autumn workshop<small
            >Venue not confirmed · Decision due tomorrow</small
          ></span
        >
      </p>
    </section>
    <p v-if="!['day', 'calendar', 'tasks'].includes(view)" class="read-only">
      This view is read-only. No items to display.
    </p>
  </div>
</template>
<style scoped>
.dashboard {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 32px 38px 38px;
}
.date {
  color: var(--situate-muted);
  font-size: 13px;
  margin: 0 0 12px;
}
h2 {
  margin: 0;
  font-size: 32px;
  line-height: 1.12;
  font-weight: 600;
  letter-spacing: var(--situate-tracking-heading);
}
.dashboard-sub {
  color: var(--situate-muted);
  font-size: 13px;
  margin-top: 8px;
}
.module {
  margin-top: 28px;
}
.module-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.module-heading > span {
  font-size: 12px;
  color: var(--situate-muted);
}
.calendar-period {
  display: flex;
  align-items: center;
  gap: 12px;
}
.calendar-period strong {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  text-decoration: underline;
  text-underline-offset: 5px;
}
.row {
  display: flex;
  align-items: baseline;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--situate-line);
  font-size: 14px;
}
.row:last-child {
  border-bottom: 0;
}
time {
  color: var(--situate-muted);
  font-size: 13px;
  min-width: 44px;
  font-variant-numeric: tabular-nums;
}
.event {
  border-left: 2px solid var(--situate-accent, var(--situate-violet));
  padding-left: 12px;
}
small {
  display: block;
  color: var(--situate-muted);
  font-size: 12px;
  margin-top: 4px;
}
.inbox {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 24px;
  padding: 16px 0;
  border-block: 1px solid var(--situate-line);
}
.inbox div {
  font-size: 12px;
  color: var(--situate-muted);
}
.inbox strong {
  display: block;
  color: var(--situate-ink);
  font-size: 26px;
  font-weight: 600;
}
.task-row {
  align-items: flex-start;
  min-height: 52px;
  gap: 14px;
  cursor: pointer;
}
input {
  flex: 0 0 21px;
  width: 21px;
  height: 21px;
  margin: 1px 0 0;
  accent-color: var(--situate-accent-strong, var(--situate-violet-deep));
}
input:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.task-row:has(input:checked) span {
  text-decoration: line-through;
  color: var(--situate-muted);
}
.attention {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: var(--situate-radius-note);
  background: var(--situate-note);
  font-size: 14px;
}
.read-only {
  color: var(--situate-muted);
}
@container (max-width: 520px) {
  .dashboard {
    padding: 28px 24px;
  }
}
</style>
