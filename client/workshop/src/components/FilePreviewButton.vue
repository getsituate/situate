<script setup lang="ts">
import { SituateButton, SituateIcon } from "../ui";

withDefaults(
  defineProps<{
    name: string;
    excerpt?: string;
    appearance?: "neutral" | "icon" | "preview";
    disabled?: boolean;
  }>(),
  { appearance: "preview" },
);
</script>

<template>
  <SituateButton
    variant="plain"
    type="button"
    class="file-preview"
    :data-appearance="appearance"
    :disabled="disabled"
  >
    <span class="file-preview-icon" aria-hidden="true">
      <SituateIcon name="notes" />
    </span>
    <span class="file-preview-text">
      <strong>{{ name }}</strong>
      <small v-if="excerpt">{{ excerpt }}</small>
    </span>
  </SituateButton>
</template>

<style scoped>
.file-preview {
  display: flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  min-height: var(--situate-target-min);
  gap: 12px;
  padding: 8px 14px 8px 10px;
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-paper);
  color: var(--situate-ink);
  text-align: start;
  white-space: normal;
}
.file-preview-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--situate-surface);
}
.file-preview-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.file-preview-text strong,
.file-preview-text small {
  display: block;
}
.file-preview-text strong {
  font-size: 14px;
  line-height: 1.4;
}
.file-preview-text small {
  margin-top: 2px;
  color: var(--situate-muted);
  font-size: 12px;
  line-height: 1.45;
}
.file-preview[data-appearance="icon"]:not(:disabled) .file-preview-icon {
  background: var(--situate-content-accent);
}
.file-preview[data-appearance="preview"]:not(:disabled) {
  background: var(--situate-content-tint);
}
.file-preview[data-appearance="preview"]:not(:disabled) .file-preview-icon {
  background: var(--situate-content-wash);
}
@media (hover: hover) {
  .file-preview:not(:disabled):hover strong {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
}
</style>
