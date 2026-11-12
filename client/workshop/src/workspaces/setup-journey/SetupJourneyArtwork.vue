<script setup lang="ts">
import { computed } from "vue";
import JourneyStage from "./JourneyStage.vue";
import { arrivalFrame, journeyFrame, type JourneyInput } from "./journey";
const props = defineProps<JourneyInput & { arrivalProgress?: number }>();
const frame = computed(() =>
  props.arrivalProgress === undefined
    ? journeyFrame(props)
    : arrivalFrame(props.arrivalProgress),
);
</script>
<template><JourneyStage :frame="frame" /></template>
