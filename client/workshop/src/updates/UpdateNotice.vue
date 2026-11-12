<script setup lang="ts">
import { SituateButton, SituateIcon } from "../ui";
import copy from "../localization/en.updates.json" with { type: "json" };
import { updateReady, type UpdateState } from "./model";
defineProps<{ state: UpdateState; aboveComposer?: boolean }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <SituateButton
    v-if="updateReady(state)"
    variant="plain"
    class="update-notice"
    :class="{ 'above-composer': aboveComposer }"
    :aria-label="copy.notice"
    :aria-description="copy.open"
    @click="emit('open')"
  >
    <span class="notice-label" aria-hidden="true">{{ copy.notice }}</span>
    <span class="notice-mark"><SituateIcon name="update" /></span>
  </SituateButton>
</template>

<style scoped>
.update-notice {
  position: absolute;
  right: max(16px, var(--app-safe-area-right, env(safe-area-inset-right, 0px)));
  bottom: max(
    16px,
    var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px))
  );
  z-index: 2;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--situate-radius-pill);
  background: transparent;
  color: var(--situate-accent-strong);
  font: inherit;
  cursor: pointer;
}
.notice-mark {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--situate-line);
  border-radius: 50%;
  background: var(--situate-paper);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--situate-ink) 8%, transparent);
}
.notice-mark :deep(svg) {
  width: 18px;
  height: 18px;
}
.notice-label {
  position: absolute;
  inset: 0 0 0 auto;
  display: flex;
  align-items: center;
  width: max-content;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  padding: 0 48px 0 16px;
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-pill);
  background: var(--situate-paper);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--situate-ink) 8%, transparent);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transform: translateX(8px);
  transition:
    opacity 160ms ease-out,
    transform 160ms ease-out,
    visibility 160ms;
}
.update-notice:is(:hover, :focus) .notice-label {
  opacity: 1;
  visibility: visible;
  transform: translateX(0);
}
.update-notice:is(:hover, :focus) .notice-mark {
  border-color: transparent;
  box-shadow: none;
}
.update-notice:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@media (max-width: 1000px) {
  .update-notice.above-composer {
    bottom: calc(
      120px + var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px))
    );
  }
}
@media (prefers-reduced-motion: reduce) {
  .notice-label {
    transform: none;
    transition: none;
  }
}
</style>
