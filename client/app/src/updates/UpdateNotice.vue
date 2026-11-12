<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { SituateButton } from "@situate/ui";
import { t } from "@situate/localization";
import UpdateSymbol from "./UpdateSymbol.vue";
import { updateReady } from "./runtime";
const emit = defineEmits<{ open: [] }>();
const bottom = ref(16);
let frame = 0;
let resize: ResizeObserver | undefined;
let mutation: MutationObserver | undefined;
function measure(): void {
  frame = 0;
  let inset = 16;
  const right = window.innerWidth - 16;
  if (window.innerWidth <= 1000) {
    for (const composer of document.querySelectorAll<HTMLElement>(
      ".chat-composer",
    )) {
      resize?.observe(composer);
      const bounds = composer.getBoundingClientRect();
      if (
        bounds.width &&
        bounds.height &&
        bounds.right > right - 44 &&
        bounds.left < right &&
        bounds.bottom > window.innerHeight - 16 - 44 &&
        bounds.top < window.innerHeight - 16
      )
        inset = Math.max(inset, window.innerHeight - bounds.top + 12);
    }
  }
  bottom.value = inset;
}
function schedule(): void {
  if (!frame) frame = requestAnimationFrame(measure);
}
onMounted(() => {
  resize = new ResizeObserver(schedule);
  mutation = new MutationObserver(schedule);
  mutation.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  schedule();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  resize?.disconnect();
  mutation?.disconnect();
  window.removeEventListener("resize", schedule);
});
</script>
<template>
  <SituateButton
    v-if="updateReady()"
    variant="plain"
    class="update-notice"
    :style="{ bottom: `max(${bottom}px, var(--app-safe-area-bottom, 0px))` }"
    :aria-label="t('updates.notice')"
    :aria-description="t('updates.open')"
    @click="emit('open')"
  >
    <span class="notice-label" aria-hidden="true">{{
      t("updates.notice")
    }}</span>
    <span class="notice-mark"><UpdateSymbol /></span>
  </SituateButton>
</template>
<style scoped>
.update-notice {
  position: fixed;
  right: max(16px, var(--app-safe-area-right, 0px));
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
.update-notice:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@media (prefers-reduced-motion: reduce) {
  .notice-label {
    transform: none;
    transition: none;
  }
}
</style>
