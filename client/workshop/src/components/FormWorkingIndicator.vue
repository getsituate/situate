<script setup lang="ts">
import { computed, ref } from "vue";
import ChatWorkingIndicator from "./ChatWorkingIndicator.vue";
import SituateProgress from "../ui/SituateProgress.vue";
import { estimatedProgress, useEstimatedProgress } from "./estimated-progress";
const props = defineProps<{
  label: string;
  paused?: boolean;
  covered?: boolean;
  timeMs?: number | null;
}>();
const root = ref<HTMLElement>();
const motionPaused = ref(false);
const clock = useEstimatedProgress(
  root,
  () => motionPaused.value || !!props.paused || !!props.covered,
  () => props.timeMs ?? null,
);
const fill = computed(() => estimatedProgress(clock.time.value));
</script>
<template>
  <div ref="root" class="form-working" :data-progress-time="clock.time.value">
    <ChatWorkingIndicator
      :comment="label"
      :status="label"
      :covered="clock.suspended.value"
      @pause="motionPaused = $event"
    />
    <SituateProgress class="working-progress" :label="label" :estimate="fill" />
  </div>
</template>
<style scoped>
.form-working {
  min-width: 0;
  padding: 12px 0;
}
.form-working :deep(.bend-status) {
  padding: 0;
  gap: 10px;
}
.form-working :deep(.bend-motion) {
  width: 44px;
  min-height: 44px;
}
.form-working :deep(.bend-motion:focus-visible) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.form-working :deep(.bend-comment) {
  white-space: normal;
  overflow: visible;
  font-size: 14px;
  line-height: 1.5;
  color: var(--situate-ink);
}
.working-progress {
  width: auto;
  margin: 8px 0 0 54px;
}
</style>
