<script setup lang="ts">
defineProps<{ title?: string; description?: string }>();
</script>

<template>
  <div class="situate-empty-state">
    <slot name="title"
      ><h2 v-if="title">{{ title }}</h2></slot
    >
    <p v-if="description">{{ description }}</p>
    <slot />
    <div v-if="$slots.actions" class="situate-empty-state-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.situate-empty-state {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  padding: var(--situate-space-6);
  color: var(--situate-ink);
}
.situate-empty-state :where(p) {
  color: var(--situate-muted);
}
.situate-empty-state-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--situate-space-3);
}
</style>
