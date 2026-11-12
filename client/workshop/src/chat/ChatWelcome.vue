<script setup lang="ts">
import { ref } from "vue";
import NavigationGreeting from "../navigation/NavigationGreeting.vue";
import NavigationComposer from "../navigation/NavigationComposer.vue";
import ChatModelChoice from "./ChatModelChoice.vue";
import type { AiState } from "../ai/model";
import type { ThinkingChoices, ThinkingSelection } from "./thinking";
withDefaults(
  defineProps<{
    draft: string;
    greeting: string;
    ai: AiState;
    thinking: ThinkingChoices;
    active?: boolean;
    locale?: "en" | "de";
    covered?: boolean;
    sendEnabled?: boolean;
    sendUnavailableReason?: string;
  }>(),
  { active: true, covered: false, sendEnabled: false },
);
defineEmits<{
  draft: [value: string];
  ai: [value: AiState];
  thinking: [level: ThinkingSelection];
  send: [];
}>();
const composer = ref<InstanceType<typeof NavigationComposer>>();
defineExpose({ focus: () => composer.value?.focus() });
</script>

<template>
  <div class="empty-chat">
    <div class="welcome">
      <NavigationGreeting
        :active="active"
        :covered="covered || ai.dialog === 'model'"
        :text="greeting"
      />
      <NavigationComposer
        ref="composer"
        compact
        :model-value="draft"
        :send-enabled="sendEnabled"
        :send-unavailable-reason="sendUnavailableReason"
        @update:model-value="$emit('draft', $event)"
        @send="$emit('send')"
      />
      <ChatModelChoice
        :active="active"
        :state="ai"
        :thinking="thinking"
        :locale="locale"
        @update:state="$emit('ai', $event)"
        @thinking="$emit('thinking', $event)"
        @focus-draft="composer?.focus()"
      />
    </div>
  </div>
</template>

<style scoped>
.empty-chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 38px;
}
.welcome {
  width: 100%;
  max-width: 640px;
  flex: 0 0 auto;
  margin: auto;
  padding-bottom: 56px;
}
@container (max-width:840px) {
  .empty-chat {
    padding: 24px;
  }
  .welcome {
    padding-bottom: 0;
  }
}
@media (max-height: 480px) {
  .empty-chat {
    padding-block: 12px;
  }
  .welcome {
    padding-bottom: 0;
  }
}
</style>
