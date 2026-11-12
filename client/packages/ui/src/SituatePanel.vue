<script setup lang="ts">
withDefaults(defineProps<{ appearance?: "default" | "plain" }>(), {
  appearance: "default",
});
</script>

<template>
  <div :class="appearance === 'plain' ? undefined : 'situate-panel'">
    <slot />
  </div>
</template>

<style scoped>
.situate-panel {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  padding: var(--situate-space-6);
  border: var(--situate-stroke-divider) solid var(--situate-line);
  border-radius: var(--situate-space-6);
  background: var(--situate-surface);
  color: var(--situate-ink);
}
</style>
