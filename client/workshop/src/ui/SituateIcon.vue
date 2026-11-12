<script setup lang="ts">
import { icons, type IconName } from "./icons";

defineProps<{ name: IconName }>();
</script>

<template>
  <svg
    class="situate-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="icons[name]" />
  </svg>
</template>

<style scoped>
.situate-icon {
  display: block;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
</style>
