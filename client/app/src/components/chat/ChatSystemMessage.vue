<script setup lang="ts">
defineProps<{ message: string; label: string }>();
</script>

<template>
  <p class="chat-system-message" role="note" :aria-label="label">
    {{ message }}
  </p>
</template>

<style scoped>
.chat-system-message {
  margin: 20px 0;
  color: var(--situate-muted);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
</style>
