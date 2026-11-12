<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { SituateIcon } from "@situate/ui";
const props = withDefaults(
  defineProps<{
    title: string;
    titleId?: string;
    context?: string;
    showChatIcon?: boolean;
  }>(),
  { showChatIcon: true },
);
const id = useId();
const heading = ref<HTMLElement>();
const clipped = ref(false);
let observer: ResizeObserver | undefined;
function measureTitle() {
  const el = heading.value;
  clipped.value = !!el && el.scrollWidth > el.clientWidth;
}
watch(
  () => props.title,
  () => {
    void nextTick(measureTitle);
  },
);
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(measureTitle);
    observer.observe(heading.value!);
  }
  measureTitle();
});
onBeforeUnmount(() => observer?.disconnect());
defineExpose({ focusTitle: () => heading.value?.focus() });
</script>
<template>
  <header class="chat-pane-header pane-header">
    <div class="pane-heading">
      <slot name="navigation" />
      <SituateIcon v-if="showChatIcon" class="chat-icon" name="chat" />
      <h1
        :id="titleId ?? id"
        ref="heading"
        class="pane-title"
        data-localization-content="user"
        :tabindex="clipped ? 0 : -1"
        :aria-describedby="context ? `${id}-context` : undefined"
      >
        {{ title }}
      </h1>
      <span v-if="clipped" class="full-title" aria-hidden="true">{{
        title
      }}</span>
    </div>
    <span v-if="context" class="chat-context">
      <span :id="`${id}-context`" class="context-label">{{ context }}</span
      ><slot name="context-actions" />
    </span>
    <div class="pane-tools"><slot /></div>
  </header>
</template>
<style scoped>
.chat-pane-header {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 16px;
  min-height: 80px;
  padding: max(16px, var(--app-safe-area-top, env(safe-area-inset-top, 0px)))
    24px 16px 30px;
  border-bottom: 1px solid var(--situate-line);
}
.pane-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.chat-icon {
  flex-shrink: 0;
  color: var(--situate-muted);
}
.chat-pane-header .pane-title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--situate-text-small);
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: normal;
}
.pane-title:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.full-title {
  display: none;
  position: absolute;
  inset-block-start: 100%;
  inset-inline: 12px;
  z-index: 5;
  width: fit-content;
  max-width: calc(100% - 24px);
  padding: 12px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-small);
  background: var(--situate-surface);
  color: var(--situate-ink);
  font-size: 14px;
  overflow-wrap: anywhere;
  pointer-events: none;
}
.pane-title:is(
    :hover,
    :focus:where(html:not([data-input-modality="pointer"]) *)
  )
  + .full-title {
  display: block;
}
.chat-context {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.pane-tools {
  margin-inline-start: auto;
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
@container (max-width: 600px) {
  .chat-pane-header {
    min-height: 60px;
    padding: max(8px, var(--app-safe-area-top, env(safe-area-inset-top, 0px)))
      12px 8px;
    gap: 4px;
  }
  .pane-heading {
    gap: 8px;
  }
  .chat-icon {
    display: none;
  }
  .context-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
