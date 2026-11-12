<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import "../../../../design/brand/bend/mini/mini.js";

const props = defineProps<{ label: string }>();
const root = ref<HTMLElement>();
const kit = (
  globalThis as typeof globalThis & {
    SituateBendMini: {
      render(): string;
      create(element: Element): {
        setBusy(busy: boolean): void;
        pause(): void;
        resume(): void;
        destroy(): void;
      };
    };
  }
).SituateBendMini;
let controller: ReturnType<typeof kit.create> | undefined;
let observer: MutationObserver | undefined;
function suspendForDialog() {
  if (
    [
      ...document.querySelectorAll(
        'dialog[open], [role="dialog"][aria-modal="true"]',
      ),
    ].some((dialog) => !dialog.contains(root.value!))
  )
    controller?.pause();
  else controller?.resume();
}
onMounted(() => {
  controller = kit.create(root.value!.firstElementChild!);
  suspendForDialog();
  controller.setBusy(true);
  observer = new MutationObserver(suspendForDialog);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open", "aria-modal"],
  });
});
onBeforeUnmount(() => {
  observer?.disconnect();
  controller?.destroy();
});
</script>

<template>
  <span
    ref="root"
    class="working-indicator"
    role="img"
    :aria-label="props.label"
    :title="props.label"
    v-html="kit.render()"
  />
</template>

<style scoped>
.working-indicator {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: inherit;
}
.working-indicator :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
