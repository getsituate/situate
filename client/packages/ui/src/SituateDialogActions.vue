<template>
  <div class="situate-dialog-actions">
    <slot />
  </div>
</template>

<style scoped>
.situate-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--situate-space-3);
  margin-top: var(--situate-space-6);
}
.situate-dialog-actions :deep(> *) {
  max-width: 100%;
}
</style>
