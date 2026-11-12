<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  SituateIcon,
  SituateIconButton,
  SituateTextarea,
  SituateButton,
} from "../ui";
import ChatPaneHeader from "../components/ChatPaneHeader.vue";
import bend from "../brand/bend/svg/wave-welcome.svg";
import {
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
const input = ref<InstanceType<typeof SituateTextarea>>();
const references = computed(() =>
  props.chat.references.map((reference) => ({
    reference,
    ...resolveReference(props.state, reference),
  })),
);
function fit() {
  const element = input.value?.element;
  if (element?.clientWidth) {
    element.style.height = "44px";
    element.style.height = `${element.scrollHeight}px`;
  }
}
watch(
  () => [props.chat.draft, props.visible],
  () => nextTick(fit),
);
onMounted(() => {
  if (props.visible) input.value?.element?.focus();
  fit();
});
function focus() {
  input.value?.element?.focus();
}
defineExpose({ focus });
</script>
<template>
  <section class="chat-pane" :aria-label="chat.title + ' pane'">
    <ChatPaneHeader :title="chat.title">
      <template #navigation>
        <SituateIconButton
          v-if="showNavigation"
          icon="menu"
          label="Open navigation"
          :aria-controls="navigationId"
          :aria-expanded="navigationOpen"
          @click="emit('openNavigation', $event)"
        />
      </template>
      <SituateIconButton
        icon="split"
        label="Split pane"
        disabled
        unavailable-reason="Pane resizing is not available."
      />
      <SituateIconButton
        icon="close"
        :label="'Close pane — ' + chat.title"
        @click="emit('close')"
      />
    </ChatPaneHeader>
    <div class="empty-chat">
      <div class="welcome">
        <div class="greeting">
          <img :src="bend" width="128" height="128" alt="" />
          <h3>Good to see you.</h3>
        </div>
        <div class="composer">
          <div class="input-line">
            <SituateTextarea
              appearance="plain"
              ref="input"
              :value="chat.draft"
              rows="1"
              aria-label="Message"
              placeholder="Message…"
              spellcheck="false"
              @input="
                emit('draft', ($event.target as HTMLTextAreaElement).value)
              "
            />
            <div class="input-actions">
              <SituateIconButton
                icon="mic"
                label="Dictate text"
                disabled
                unavailable-reason="Dictation is not connected."
              /><SituateIconButton
                icon="arrow"
                label="Send message"
                variant="primary"
                disabled
                unavailable-reason="Chat processing is not connected."
              />
            </div>
          </div>
          <div class="composer-bottom">
            <div
              v-for="(item, index) in references"
              :key="
                item.reference.fileKey +
                ':' +
                (item.reference.version?.key || 'live')
              "
              class="attachment-chip"
              :data-state="item.state"
            >
              <SituateButton
                variant="plain"
                class="attachment-link"
                type="button"
                :disabled="item.state === 'missing'"
                :title="item.name + ' — ' + item.detail"
                :aria-label="'Open ' + item.name + ', ' + item.detail"
                @click="emit('open', item.reference)"
              >
                <SituateIcon name="notes" /><span
                  ><strong>{{ item.name }}</strong
                  ><small>{{ item.detail }}</small></span
                >
              </SituateButton>
              <SituateIconButton
                class="remove-reference"
                icon="close"
                :label="'Remove reference to ' + item.name"
                @click="
                  emit('remove', index);
                  focus();
                "
              />
            </div>
            <SituateButton
              variant="plain"
              class="attach-file"
              type="button"
              @click="emit('attach')"
            >
              <SituateIcon name="attach" />Attach file
            </SituateButton>
          </div>
        </div>
      </div>
    </div>
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
.input-line {
  display: flex;
  align-items: flex-end;
  padding: 8px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-control);
}
.input-line textarea {
  flex: 1;
  min-width: 0;
  max-height: 35dvh;
  resize: none;
  border: 0;
  outline: none;
  padding: 12px 8px;
  font: inherit;
  background: transparent;
  color: var(--situate-ink);
}
.input-actions {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.composer-bottom {
  display: flex;
  flex-wrap: wrap;
  gap: var(--situate-space-2);
  align-items: stretch;
  margin-top: var(--situate-space-2);
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
.remove-reference {
  height: auto;
  align-self: stretch;
  border-radius: 0 var(--situate-radius-control) var(--situate-radius-control) 0;
}
.attach-file {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: var(--situate-radius-control);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  background: transparent;
  color: var(--situate-muted);
}
.composer-bottom :deep(svg) {
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
  .attachment-link:not(:disabled):hover,
  .attach-file:hover {
    background: var(--situate-accent-soft, var(--situate-lilac));
    color: var(--situate-ink);
  }
}
@container (max-width: 400px) {
  .empty-chat {
    padding: 16px;
  }
  .input-actions {
    flex-direction: column;
  }
}
</style>
