<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import ChatWelcome from "../chat/ChatWelcome.vue";
import ChatModeSurface from "../chat/ChatModeSurface.vue";
import ChatTranscript from "../chat/ChatTranscript.vue";
import type { Event } from "../chat/model";
import ChatModelChoice from "../chat/ChatModelChoice.vue";
import NavigationComposer from "../navigation/NavigationComposer.vue";
import { chatGuard } from "../ai/model";
import copy from "../localization/en.tabs.json";
import type { Conversation, TabsAction } from "./model";
const props = defineProps<{ conversation: Conversation; active: boolean }>();
const emit = defineEmits<{ action: [action: TabsAction] }>();
const empty = computed(
  () =>
    !props.conversation.messages.length &&
    props.conversation.activity === "ready",
);
const guard = computed(() => chatGuard(props.conversation.ai));
const events = computed(() =>
  props.conversation.messages.map((text, index): Event => ({
    kind: "message",
    id: `message-${index}`,
    speaker: "user",
    text,
  })),
);
const composer = ref<InstanceType<typeof NavigationComposer>>();
const welcome = ref<InstanceType<typeof ChatWelcome>>();
function focus() {
  if (empty.value) welcome.value?.focus();
  else composer.value?.focus();
}
watch(empty, () => nextTick(focus));
</script>

<template>
  <section class="chat-screen" :aria-label="conversation.title">
    <ChatModeSurface
      :title="conversation.title"
      :session-key="`tabs:${conversation.id}`"
      :draft="conversation.draft"
      :working="conversation.activity === 'working'"
      :empty="empty"
      :events="events"
      content-selector=".chat-thread, .welcome"
      @draft="
        emit('action', { type: 'draft', id: conversation.id, value: $event })
      "
    >
      <template #default="{ developmentEvents }">
        <ChatWelcome
          v-if="empty && !developmentEvents.length"
          ref="welcome"
          :active="active"
          :draft="conversation.draft"
          :greeting="conversation.greeting"
          :ai="conversation.ai"
          :thinking="conversation.thinking"
          :send-enabled="!guard"
          :send-unavailable-reason="guard || copy.replyPlaceholder"
          @draft="
            emit('action', {
              type: 'draft',
              id: conversation.id,
              value: $event,
            })
          "
          @ai="
            emit('action', {
              type: 'conversation-ai',
              id: conversation.id,
              value: $event,
            })
          "
          @thinking="
            emit('action', {
              type: 'conversation-thinking',
              id: conversation.id,
              value: $event,
            })
          "
          @send="emit('action', { type: 'send', id: conversation.id })"
        />
        <template v-else>
          <div
            class="chat-scroll"
            role="region"
            tabindex="0"
            :aria-label="copy.conversationHistory"
          >
            <div class="chat-thread">
              <article
                v-for="(message, index) in conversation.messages"
                :key="index"
                class="chat-message user sent-message"
              >
                <span class="speaker">{{ copy.chatYou }}</span>
                <p>{{ message }}</p>
              </article>
              <ChatTranscript
                v-if="developmentEvents.length"
                :events="developmentEvents"
              />
              <p
                v-if="conversation.activity === 'working'"
                class="work-status"
                role="status"
              >
                {{ copy.working }}
              </p>
            </div>
          </div>
          <footer class="chat-footer">
            <div class="composer-area">
              <NavigationComposer
                ref="composer"
                :working="conversation.activity === 'working'"
                :model-value="conversation.draft"
                :send-enabled="!guard"
                :send-unavailable-reason="guard || copy.replyPlaceholder"
                @update:model-value="
                  emit('action', {
                    type: 'draft',
                    id: conversation.id,
                    value: $event,
                  })
                "
                @send="emit('action', { type: 'send', id: conversation.id })"
                @stop="
                  emit('action', {
                    type: 'activity',
                    id: conversation.id,
                    value: 'ready',
                  })
                "
              />
              <ChatModelChoice
                :active="active"
                :state="conversation.ai"
                :thinking="conversation.thinking"
                @update:state="
                  emit('action', {
                    type: 'conversation-ai',
                    id: conversation.id,
                    value: $event,
                  })
                "
                @thinking="
                  emit('action', {
                    type: 'conversation-thinking',
                    id: conversation.id,
                    value: $event,
                  })
                "
                @focus-draft="composer?.focus()"
              />
            </div>
          </footer>
        </template>
      </template>
    </ChatModeSurface>
  </section>
</template>

<style scoped src="../chat/chat.css"></style>
