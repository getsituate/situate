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
  gap: 12px;
  margin-top: 24px;
}
.situate-dialog-actions :slotted(*) {
  max-width: 100%;
}
</style>
