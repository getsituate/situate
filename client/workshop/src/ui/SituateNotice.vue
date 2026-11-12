<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "neutral" | "info" | "success" | "warning" | "danger";
  }>(),
  { tone: "neutral" },
);
</script>

<template>
  <div class="situate-notice" :data-tone="tone"><slot /></div>
</template>

<style scoped>
.situate-notice {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  padding: var(--situate-space-4);
  border: var(--situate-stroke-divider) solid var(--situate-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-paper);
  color: var(--situate-ink);
}
.situate-notice:where([data-tone="info"]) {
  background: var(--situate-lilac);
}
.situate-notice:where([data-tone="success"]) {
  border-color: var(--situate-violet-deep);
}
.situate-notice:where([data-tone="warning"]) {
  background: var(--situate-note);
}
.situate-notice:where([data-tone="danger"]) {
  border-color: var(--situate-ink);
}
</style>
