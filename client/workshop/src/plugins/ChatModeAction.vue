<script setup lang="ts">
import { SituateButton } from "../ui";
import { c } from "./content";
import type { ChatMode, ChatModePlacement } from "./model";

defineProps<{
  mode: ChatMode;
  working: boolean;
  placement: ChatModePlacement;
}>();
const emit = defineEmits<{ change: [] }>();
</script>

<template>
  <SituateButton
    :variant="placement === 'composer' ? 'ghost' : 'plain'"
    :class="{ 'composer-mode-action': placement === 'composer' }"
    size="small"
    :role="
      placement === 'pane' || placement === 'corner' ? 'menuitem' : undefined
    "
    :tabindex="placement === 'pane' || placement === 'corner' ? -1 : undefined"
    :aria-disabled="working || undefined"
    :aria-description="working ? c.chatMode.busy : undefined"
    :title="working && placement === 'composer' ? c.chatMode.busy : undefined"
    @click="!working && emit('change')"
  >
    {{
      mode === "chat" ? c.chatMode.switchToDevelopment : c.chatMode.switchToChat
    }}
  </SituateButton>
</template>

<style scoped>
.composer-mode-action {
  color: var(--situate-muted);
  font-size: var(--situate-text-small);
  font-weight: 500;
}
.composer-mode-action[aria-disabled="true"] {
  opacity: 0.55;
  cursor: default;
}
</style>
