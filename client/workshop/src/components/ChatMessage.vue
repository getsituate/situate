<script setup lang="ts">
import { chatContent as c } from "./chat-content";
defineProps<{
  speaker: "user" | "assistant";
  label?: string;
  hideSpeaker?: boolean;
}>();
</script>
<template>
  <article
    :class="['chat-message', speaker]"
    :aria-label="label ?? (speaker === 'user' ? c.you : c.assistant)"
  >
    <span v-if="!hideSpeaker" class="speaker">{{
      label ?? (speaker === "user" ? c.you : c.assistant)
    }}</span>
    <div class="message-content"><slot /></div>
  </article>
</template>
<style scoped>
.chat-message {
  font-size: 16px;
  line-height: 1.65;
  margin: 28px 0 18px;
  overflow-wrap: anywhere;
}
.speaker + .message-content {
  margin-top: 7px;
}
.message-content :deep(p) {
  margin: 0;
  white-space: pre-wrap;
}
.speaker {
  font-size: 12px;
  font-weight: 650;
}
.user {
  background: var(--situate-accent-soft, var(--situate-lilac));
  padding: 18px 22px;
  border-radius: 22px 22px 5px 22px;
  margin: 0 0 28px 48px;
  margin-inline: 48px 0;
}
.user .speaker {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
@container (max-width: 540px) {
  .chat-message {
    font-size: 15px;
  }
  .user {
    margin-inline-start: 22px;
    padding: 16px;
  }
}
</style>
