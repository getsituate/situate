<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "neutral" | "info" | "success" | "warning" | "danger";
  }>(),
  { tone: "neutral" },
);
</script>

<template>
  <span class="situate-badge" :data-tone="tone"><slot /></span>
</template>

<style scoped>
.situate-badge {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  display: inline-flex;
  padding: var(--situate-space-1) var(--situate-space-2);
  border: var(--situate-stroke-divider) solid var(--situate-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-paper);
  color: var(--situate-ink);
  font-size: var(--situate-text-small);
}
.situate-badge:where([data-tone="info"]) {
  background: var(--situate-lilac);
}
.situate-badge:where([data-tone="success"]) {
  border-color: var(--situate-violet-deep);
}
.situate-badge:where([data-tone="warning"]) {
  background: var(--situate-note);
}
.situate-badge:where([data-tone="danger"]) {
  border-color: var(--situate-ink);
}
</style>
