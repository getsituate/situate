<script setup lang="ts">
import { computed } from "vue";
import JourneyStage from "./setup-journey/JourneyStage.vue";
import { journeyFrame } from "./setup-journey/journey";
import type { OpeningFrame } from "./setup-journey/opening";
import type { FinaleFrame } from "./setup-journey/finale/score";
import type { SetupTransitionFrame } from "./setup-transition";
const props = defineProps<{
  step: number;
  paused?: boolean;
  blocked?: boolean;
  transition?: SetupTransitionFrame;
  opening?: OpeningFrame;
  finale?: FinaleFrame;
}>();
const frame = computed(
  () =>
    props.finale?.art ??
    props.opening?.art ??
    journeyFrame({
      step: props.transition?.to ?? props.step,
      fromStep: props.transition?.from ?? props.step,
      travel: props.transition?.journeyProgress ?? 1,
      reaction: props.transition?.reaction ?? 0,
      blocked: props.blocked,
    }),
);
</script>
<template>
  <JourneyStage :frame="frame" :finale="finale" />
</template>
