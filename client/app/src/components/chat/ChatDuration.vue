<script setup lang="ts">
import { formatNumber, t } from "@situate/localization";
import type { WorkBlock } from "../../ai/work-blocks";

defineProps<{
  durationMs?: number;
  outcome: WorkBlock["outcome"] | "active";
  inline?: boolean;
}>();
function duration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 1) return t("chat.durationLessThanSecond");
  if (seconds < 60)
    return t("chat.durationSeconds", { seconds: formatNumber(seconds) });
  return t("chat.durationMinutesSeconds", {
    minutes: formatNumber(Math.floor(seconds / 60)),
    seconds: formatNumber(seconds % 60),
  });
}
</script>

<template>
  <component
    :is="inline ? 'span' : 'p'"
    v-if="
      durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0
    "
    class="duration"
    :role="outcome === 'active' ? 'timer' : undefined"
    :aria-live="outcome === 'active' ? 'off' : undefined"
  >
    {{
      t(
        outcome === "active"
          ? "chat.workInProgress"
          : outcome === "cancelled"
            ? "chat.workStopped"
            : outcome === "error" || outcome === "interrupted"
              ? "chat.workFailed"
              : "chat.workDuration",
        { duration: duration(durationMs) },
      )
    }}
  </component>
</template>

<style scoped>
.duration {
  margin: 8px 0 0;
  color: var(--situate-muted);
  font-size: 12px;
  line-height: 1.5;
}
.duration[role="timer"] {
  font-variant-numeric: tabular-nums;
}
</style>
