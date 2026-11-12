<script setup lang="ts">
import { ref } from "vue";
import { SituateIcon, SituateButton } from "@situate/ui";
import { t } from "@situate/localization";
defineProps<{ back?: boolean }>();
const emit = defineEmits<{ back: [] }>();
const heading = ref<HTMLElement>();
defineExpose({ focusTitle: () => heading.value?.focus() });
</script>
<template>
  <header class="plugin-files-header">
    <h2 ref="heading" tabindex="-1">{{ t("pluginDevelopment.files") }}</h2>
    <SituateButton
      variant="plain"
      v-if="back"
      type="button"
      class="files-back"
      @click="emit('back')"
    >
      <SituateIcon name="chevron" />{{ t("pluginDevelopment.backToFiles") }}
    </SituateButton>
  </header>
</template>
<style scoped>
.plugin-files-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 12px;
  min-height: 64px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--situate-line);
}
.plugin-files-header h2 {
  font-size: 14px;
}
.files-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px;
  border: 0;
  border-radius: var(--situate-radius-control);
  background: transparent;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font: inherit;
  font-size: 13px;
}
.files-back:hover {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.files-back svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  transform: rotate(90deg);
}
.files-back:dir(rtl) svg {
  transform: rotate(-90deg);
}
:is(button, [tabindex]):focus:where(
    html:not([data-input-modality="pointer"]) *
  ) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
</style>
