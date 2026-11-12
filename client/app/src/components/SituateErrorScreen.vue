<script setup lang="ts">
import ErrorActions from "../errors/ErrorActions.vue";
defineProps<{ message: string }>();
</script>

<template>
  <div class="situate-error-screen">
    <p role="alert">{{ message }}</p>
    <ErrorActions boundary="view" />
  </div>
</template>

<style scoped>
.situate-error-screen {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  flex: none;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: auto;
  overflow: auto;
  padding: max(24px, var(--app-safe-area-top, env(safe-area-inset-top))) 18px
    max(24px, var(--app-safe-area-bottom, env(safe-area-inset-bottom)));
  color: var(--situate-ink);
}
.situate-error-screen p {
  max-width: 40rem;
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
