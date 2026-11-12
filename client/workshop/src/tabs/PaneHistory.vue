<script setup lang="ts">
import { SituateIconButton } from "../ui";
import copy from "../localization/en.tabs.json";
import type { Pane } from "./model";

defineProps<{ pane: Pane }>();
const emit = defineEmits<{ navigate: [delta: -1 | 1] }>();
</script>

<template>
  <div class="pane-history" role="group" :aria-label="copy.paneHistory">
    <SituateIconButton
      icon="back"
      :label="copy.back"
      :disabled="pane.cursor === 0"
      :unavailable-reason="copy.noBack"
      @click="emit('navigate', -1)"
    />
    <SituateIconButton
      icon="forward"
      :label="copy.forward"
      :disabled="pane.cursor === pane.history.length - 1"
      :unavailable-reason="copy.noForward"
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
