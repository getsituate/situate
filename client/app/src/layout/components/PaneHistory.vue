<script setup lang="ts">
import { SituateIconButton } from "@situate/ui";
import { t } from "@situate/localization";
import type { Pane } from "../model";

defineProps<{ pane: Pane }>();
const emit = defineEmits<{ navigate: [delta: -1 | 1] }>();
</script>

<template>
  <div
    class="pane-history"
    role="group"
    :aria-label="t('layoutUi.paneHistory')"
  >
    <SituateIconButton
      icon="back"
      :label="t('layoutUi.back')"
      :disabled="pane.navigation.cursor === 0"
      :unavailable-reason="t('layoutUi.noBack')"
      @click="emit('navigate', -1)"
    />
    <SituateIconButton
      icon="forward"
      :label="t('layoutUi.forward')"
      :disabled="pane.navigation.cursor === pane.navigation.entries.length - 1"
      :unavailable-reason="t('layoutUi.noForward')"
      @click="emit('navigate', 1)"
    />
  </div>
</template>

<style scoped>
.pane-history {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
}
.pane-history :deep(button:disabled) {
  opacity: 0.4;
}
</style>
