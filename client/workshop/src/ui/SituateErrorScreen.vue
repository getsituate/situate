<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<template>
  <div class="situate-error-screen">
    <p role="alert">{{ message }}</p>
  </div>
</template>

<style scoped>
.situate-error-screen {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  flex: 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: max(24px, var(--app-safe-area-top, env(safe-area-inset-top))) 18px
    max(24px, var(--app-safe-area-bottom, env(safe-area-inset-bottom)));
  color: var(--situate-ink);
}
.situate-error-screen p {
  max-width: 40rem;
  margin: auto;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
</style>
