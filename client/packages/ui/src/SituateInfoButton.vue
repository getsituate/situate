<script setup lang="ts">
import { ref, useId } from "vue";
import SituateIconButton from "./SituateIconButton.vue";
import SituatePopover from "./SituatePopover.vue";

defineProps<{ label: string; text: string }>();
const id = useId();
const trigger = ref<InstanceType<typeof SituateIconButton>>();
const open = ref(false);
</script>

<template>
  <SituateIconButton
    ref="trigger"
    class="situate-info-button"
    icon="info"
    :label="label"
    :show-tooltip="false"
    data-press-feedback="none"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-controls="id"
    :popovertarget="id"
    @click.prevent="open = !open"
  />
  <SituatePopover
    :id="id"
    class="situate-info-popover"
    :open="open"
    align="start"
    static-surface
    :anchor="trigger?.element"
    :label="label"
    :aria-describedby="`${id}-text`"
    @close="open = false"
  >
    <p :id="`${id}-text`">{{ text }}</p>
  </SituatePopover>
</template>

<style scoped>
.situate-info-button,
.situate-info-button.situate-icon-button:hover:not(:disabled) {
  background: transparent;
}
.situate-info-button:is(:active, [aria-expanded="true"]) :deep(.situate-icon) {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.situate-info-button :deep(.situate-icon) {
  width: 18px;
  height: 18px;
}
@media (forced-colors: active) {
  .situate-info-button[aria-expanded="true"] {
    border: 1px solid Highlight;
  }
}
.situate-info-popover {
  padding: var(--situate-space-3);
  font-size: var(--situate-text-small);
  overflow-wrap: anywhere;
}
.situate-info-popover p {
  margin: 0;
}
</style>
