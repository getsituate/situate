<script setup lang="ts">
import { computed } from "vue";
import JourneyStage from "./JourneyStage.vue";
import { arrivalFrame } from "./journey";
const props = defineProps<{ progress: number }>();
const frame = computed(() => arrivalFrame(props.progress));
</script>
<template><JourneyStage :frame="frame" /></template>
