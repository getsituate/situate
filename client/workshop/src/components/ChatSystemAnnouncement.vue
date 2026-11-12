<script setup lang="ts">
import { ref, watch } from "vue";
const props = defineProps<{ message: string }>();
const announcement = ref("");
// Mounting restored history must not announce earlier deliveries.
watch(
  () => props.message,
  (message) => {
    announcement.value = message;
  },
);
</script>

<template>
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {{ announcement }}
  </div>
</template>
