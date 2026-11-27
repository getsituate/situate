<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { SituateIcon, SituateIconButton, SituateButton } from "../ui";
import ChatComposer from "../components/ChatComposer.vue";
import ChatModeSurface from "../chat/ChatModeSurface.vue";
import ChatTranscript from "../chat/ChatTranscript.vue";
import type { Event } from "../chat/model";
import ChatMessage from "../components/ChatMessage.vue";
import FilePreviewButton from "../components/FilePreviewButton.vue";
import bend from "../brand/bend/svg/wave-welcome.svg";
import {
  attachmentKey,
  resolveReference,
  type EditorChat,
  type EditorState,
  type FileReference,
} from "./model";
const props = defineProps<{
  state: EditorState;
  chat: EditorChat;
  navigationId?: string;
  navigationOpen?: boolean;
  showNavigation: boolean;
  visible: boolean;
}>();
const emit = defineEmits<{
  draft: [value: string];
  attach: [];
  remove: [index: number];
  open: [reference: FileReference];
  close: [];
  openNavigation: [event: MouseEvent];
}>();
const composer = ref<InstanceType<typeof ChatComposer>>();
const attachments = computed(() =>
  props.chat.attachments.map((attachment) => {
    const key = attachmentKey(attachment);
    return "fileKey" in attachment
      ? {
          key,
          kind: "reference" as const,
          reference: attachment,
          ...resolveReference(props.state, attachment),
        }
      : { key, kind: "image" as const, ...attachment };
  }),
);
const replyFile = computed(() => {
  const exchange = props.chat.exchange;
  return exchange ? resolveReference(props.state, exchange.file) : null;
});
const events = computed<Event[]>(() =>
  props.chat.exchange
    ? [
        {
          kind: "message",
          speaker: "user",
          id: "editor-request",
          text: props.chat.exchange.request,
        },
        {
          kind: "message",
          speaker: "assistant",
          id: "editor-reply",
          text: props.chat.exchange.reply,
        },
      ]
    : [],
);
onMounted(() => {
  if (props.visible && !props.chat.exchange) focus();
});
function focus() {
  composer.value?.focus();
}
defineExpose({ focus });
</script>
<template>
  <section class="chat-pane" :aria-label="chat.title + ' pane'">
    <ChatModeSurface
      :title="chat.title"
      :session-key="`editor:${chat.key}`"
      :draft="chat.draft"
      :events="events"
      :empty="!chat.exchange"
      :close-label="'Close pane — ' + chat.title"
      :navigation-open="navigationOpen"
      content-selector=".transcript, .welcome"
      @draft="emit('draft', $event)"
      @close="emit('close')"
    >
      <template v-if="showNavigation" #navigation>
        <SituateIconButton
          v-if="showNavigation"
          icon="menu"
          label="Open navigation"
          :aria-controls="navigationId"
          :aria-expanded="navigationOpen"
          @click="emit('openNavigation', $event)"
        />
      </template>
      <template #default="{ developmentEvents }">
        <div
          :class="
            chat.exchange || developmentEvents.length
              ? 'active-chat'
              : 'empty-chat'
          "
        >
          <div
            v-if="(chat.exchange && replyFile) || developmentEvents.length"
            class="transcript-scroll"
          >
            <div class="transcript">
              <template v-if="chat.exchange && replyFile">
                <ChatMessage speaker="user" hide-speaker>
                  <p>{{ chat.exchange.request }}</p>
                </ChatMessage>
                <ChatMessage speaker="assistant" hide-speaker>
                  <p>{{ chat.exchange.reply }}</p>
                  <FilePreviewButton
                    class="reply-file"
                    :name="replyFile.name"
                    :appearance="chat.exchange.appearance"
                    :disabled="replyFile.state === 'missing'"
                    :excerpt="
                      replyFile.state === 'missing'
                        ? replyFile.detail
                        : chat.exchange.excerpt
                    "
                    @click="emit('open', chat.exchange.file)"
                  />
                </ChatMessage>
              </template>
              <ChatTranscript
                v-if="developmentEvents.length"
                :events="developmentEvents"
              />
            </div>
          </div>
          <div
            :class="
              chat.exchange || developmentEvents.length
                ? 'chat-footer'
                : 'welcome'
            "
          >
            <div
              v-if="!chat.exchange && !developmentEvents.length"
              class="greeting"
            >
              <img :src="bend" width="128" height="128" alt="" />
              <h3>Good to see you.</h3>
            </div>
            <ChatComposer
              ref="composer"
              class="file-chat-composer"
              :model-value="chat.draft"
              :readonly="false"
              attach-dialog
              unavailable-reason="Chat processing is not connected."
              @update:model-value="emit('draft', $event)"
              @attach="emit('attach')"
            >
              <template #attachments>
                <ul
                  v-if="attachments.length"
                  class="attachments"
                  aria-label="Attachments"
                  role="list"
                >
                  <li
                    v-for="(item, index) in attachments"
                    :key="item.key"
                    class="attachment-chip"
                    :data-state="
                      item.kind === 'reference' ? item.state : 'ready'
                    "
                  >
                    <img
                      v-if="item.kind === 'image'"
                      class="attachment-preview"
                      :src="item.previewUrl"
                      :alt="item.name"
                      :title="item.name"
                    />
                    <SituateButton
                      v-else
                      variant="plain"
                      class="attachment-link"
                      type="button"
                      :disabled="item.state === 'missing'"
                      :title="item.name + ' — ' + item.detail"
                      :aria-label="'Open ' + item.name + ', ' + item.detail"
                      @click="emit('open', item.reference)"
                    >
                      <SituateIcon name="notes" />
                      <span>
                        <strong>{{ item.name }}</strong>
                        <small>{{ item.detail }}</small>
                      </span>
                    </SituateButton>
                    <SituateIconButton
                      class="remove-attachment"
                      icon="close"
                      :label="
                        (item.kind === 'reference'
                          ? 'Remove reference to '
                          : 'Remove attachment ') + item.name
                      "
                      @click="
                        emit('remove', index);
                        focus();
                      "
                    />
                  </li>
                </ul>
              </template>
            </ChatComposer>
          </div>
        </div>
      </template>
    </ChatModeSurface>
  </section>
</template>
<style scoped>
.chat-pane {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--situate-surface);
}
.empty-chat {
  display: flex;
  padding: 24px;
  overflow: auto;
  min-height: 0;
  flex: 1;
}
.welcome {
  margin: auto;
  width: 100%;
  max-width: 680px;
  min-width: 0;
}
.active-chat {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.transcript-scroll {
  flex: 1;
  overflow: auto;
}
.transcript,
.chat-footer {
  width: min(100%, 728px);
  margin-inline: auto;
  padding: 24px;
}
.chat-footer {
  padding-block-start: 12px;
}
.reply-file {
  margin-block-start: 16px;
}
.attachment-chip[data-state="ready"] {
  background: var(--situate-content-wash);
}
.greeting {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 32px;
}
.greeting h3 {
  font-family: var(--situate-font-display);
  font-size: clamp(24px, 3vw, 34px);
  font-weight: 600;
  letter-spacing: -0.04em;
}
.file-chat-composer {
  margin-top: 0;
}
.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--situate-space-2);
  margin: 0 0 var(--situate-space-2);
  padding: 0;
  list-style: none;
}
.attachment-chip {
  display: flex;
  align-items: stretch;
  min-height: 52px;
  max-width: 100%;
  min-width: 0;
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-control);
  background: var(--situate-paper);
}
.attachment-link {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 44px;
  min-height: 50px;
  padding: 6px 12px;
  border: 0;
  border-radius: calc(var(--situate-radius-control) - 1px) 0 0
    calc(var(--situate-radius-control) - 1px);
  text-align: start;
  background: transparent;
  color: inherit;
}
.attachment-link > span {
  min-width: 0;
}
.attachment-link strong,
.attachment-link small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachment-link strong {
  font-size: var(--situate-text-caption);
  line-height: 1.4;
  font-weight: 600;
}
.attachment-link small {
  font-size: 0.625rem;
  line-height: 1.4;
  color: var(--situate-muted);
}
.attachment-preview {
  display: block;
  width: 72px;
  height: 50px;
  object-fit: contain;
  border-radius: calc(var(--situate-radius-control) - 1px) 0 0
    calc(var(--situate-radius-control) - 1px);
}
.remove-attachment {
  height: auto;
  align-self: stretch;
  border-radius: 0 var(--situate-radius-control) var(--situate-radius-control) 0;
}
.attachment-link :deep(svg) {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
button:not(:disabled) {
  cursor: pointer;
}
button:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.attachment-chip[data-state="error"],
.attachment-chip[data-state="missing"] {
  border-color: var(--situate-book-line);
  background: var(--situate-note);
}
@media (hover: hover) {
  .attachment-link:not(:disabled):hover {
    background: var(--situate-accent-soft, var(--situate-lilac));
    color: var(--situate-ink);
  }
}
@container (max-width: 400px) {
  .empty-chat {
    padding: 16px;
  }
  .transcript,
  .chat-footer {
    padding-inline: 16px;
  }
}
</style>
