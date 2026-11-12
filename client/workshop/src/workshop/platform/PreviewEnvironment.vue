<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from "vue";
import { selectEnvironment } from "../../ui/select-context";
import { contentEnvelope, type PlatformState, type ViewSize } from "./model";

const props = defineProps<{ state: PlatformState }>();
const surface = ref<HTMLElement>();
const content = ref<HTMLElement>();
provide(selectEnvironment, {
  popupTarget: surface,
  popupBoundary: content,
  mobile: computed(
    () => props.state.profile === "ios" || props.state.profile === "android",
  ),
});
const size = ref<ViewSize>();
const envelope = computed(() => contentEnvelope(props.state, size.value));
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect;
    if (rect) size.value = { width: rect.width, height: rect.height };
  });
  observer.observe(surface.value!);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="surface" class="preview-environment">
    <div
      ref="content"
      class="environment-content"
      :style="{
        top: `${envelope.top}px`,
        bottom: `${envelope.bottom + envelope.keyboard}px`,
        '--app-content-height': `${envelope.height}px`,
        '--app-content-top': `calc(var(--app-viewport-top, 0px) + ${envelope.top}px)`,
      }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.preview-environment {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--situate-surface);
}
.environment-content {
  position: absolute;
  left: 0;
  right: 0;
  min-width: 0;
  min-height: 0;
  contain: layout;
  --app-safe-area-top: 0px;
  --app-safe-area-right: 0px;
  --app-safe-area-bottom: 0px;
  --app-safe-area-left: 0px;
}
.environment-content
  :deep(dialog:not(.navigation-drawer):not(.menu):not(.situate-select-popup)) {
  position: fixed;
  top: calc(var(--app-content-top) + var(--app-content-height) / 2);
  bottom: auto;
  margin-block: 0;
  max-height: max(
    0px,
    calc(var(--app-content-height) - var(--dialog-block-inset, 24px))
  );
  transform: translateY(-50%);
}
</style>
