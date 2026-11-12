<script setup lang="ts">
import { SituateIcon } from "../ui";
defineProps<{
  filled?: boolean;
  name:
    | "sun"
    | "book"
    | "documents"
    | "pin"
    | "archive"
    | "restore"
    | "clock"
    | "attention"
    | "calendar"
    | "tasks"
    | "notes";
}>();
const paths = {
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5",
  book: "M12 5C8 3 5 3 2 4v15c3-1 6-1 10 1 4-2 7-2 10-1V4c-3-1-6-1-10 1zm0 0v15",
  documents:
    "M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  pin: "M8 3h8l-1 7 3 4H6l3-4zm4 11v7",
  archive: "M4 8v12h16V8M3 3h18v5H3zm6 5h6",
  restore: "M4 8v12h16V8M3 3h18v5H3zm9 14v-7m-3 3 3-3 3 3",
  clock: "M12 7v5l3 2",
  attention: "M12 7v6m0 3h.01",
};
</script>
<template>
  <SituateIcon
    v-if="name === 'calendar' || name === 'tasks' || name === 'notes'"
    :name="name"
  />
  <svg
    v-else
    viewBox="0 0 24 24"
    width="20"
    height="20"
    :fill="name === 'pin' && filled ? 'currentColor' : 'none'"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <circle
      v-if="name === 'sun' || name === 'clock' || name === 'attention'"
      cx="12"
      cy="12"
      :r="name === 'sun' ? 4 : 9"
    />
    <path :d="paths[name]" />
  </svg>
</template>
