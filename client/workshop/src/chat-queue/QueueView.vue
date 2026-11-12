<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import ChatView from "../chat/ChatView.vue";
import { changePhase, createChatState } from "../chat/model";
import MiniBendPlayful from "../mini-bend-playful/MiniBendPlayful.vue";
import {
  SituateIcon,
  SituateIconButton,
  SituateButton,
  SituateTextarea,
} from "../ui";
import { isRunning, type QueueAction, type QueueState } from "./model";
const props = defineProps<{
  state: QueueState;
  showNavigation?: boolean;
  navigationId?: string;
  navigationOpen?: boolean;
}>();
const emit = defineEmits<{
  action: [action: QueueAction];
  "open-navigation": [event: MouseEvent];
}>();
const field = ref<InstanceType<typeof SituateTextarea>>();
const paused = ref(false);
const pendingExpanded = ref(false);
const pendingDetailsId = useId();
watch(
  () => props.state.pending.length,
  (count) => {
    if (!count) pendingExpanded.value = false;
  },
);
const commentIndex = ref(0);
const comments = [
  "A little room for a good conversation.",
  "Keeping the thread in view.",
];
const running = computed(() => isRunning(props.state));
const historyState = computed(() =>
  changePhase(
    createChatState("chat-working"),
    props.state.phase === "stopped"
      ? "cancelled"
      : props.state.phase === "complete"
        ? "complete"
        : "working",
  ),
);
let timer: ReturnType<typeof setInterval> | undefined;
watch(
  running,
  (value) => {
    clearInterval(timer);
    commentIndex.value = 0;
    if (value)
      timer = setInterval(() => {
        commentIndex.value = (commentIndex.value + 1) % comments.length;
      }, 6000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(timer));
function fit() {
  const element = field.value?.element;
  if (!element) return;
  element.style.height = "44px";
  element.style.height = `${element.scrollHeight}px`;
}
watch(
  () => props.state.draft,
  () => nextTick(fit),
  { immediate: true },
);
function restore() {
  if (!props.state.pending.length) return;
  emit("action", { type: "restore" });
  void nextTick(() => {
    field.value?.element?.focus();
    field.value?.element?.setSelectionRange(0, 0);
  });
}
function removeAttachment(index: number) {
  emit("action", { type: "remove-attachment", index });
  void nextTick(() => field.value?.element?.focus());
}
function stop() {
  emit("action", { type: "phase", phase: "stopped" });
  void nextTick(() => {
    field.value?.element?.focus();
    field.value?.element?.setSelectionRange(0, 0);
  });
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.ctrlKey || event.metaKey) return;
  if (event.altKey && !event.shiftKey && event.key === "ArrowUp") {
    event.preventDefault();
    restore();
  } else if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    emit("action", {
      type: "submit",
      kind: event.altKey ? "follow-up" : "steering",
    });
  }
}
</script>

<template>
  <section class="queue-chat" aria-label="Chat with pending messages">
    <ChatView
      class="queue-history"
      :class="{ 'queue-stopped': state.phase === 'stopped' }"
      :state="historyState"
      :show-navigation="showNavigation"
      :navigation-id="navigationId"
      :navigation-open="navigationOpen"
      @open-navigation="emit('open-navigation', $event)"
    />
    <footer class="queue-footer">
      <div class="queue-column">
        <SituateDisclosure v-if="state.consumed.length" class="received">
          <template #label>
            {{ state.consumed.length }}
            {{ state.consumed.length === 1 ? "message" : "messages" }} received
            by Situate
          </template>
          <div
            class="received-list"
            tabindex="0"
            aria-label="Received messages"
          >
            <article v-for="item in state.consumed" :key="item.id">
              <p>{{ item.text }}</p>
              <span
                v-for="(attachment, index) in item.attachments"
                :key="index"
                class="attachment"
                >{{ attachment.name }}</span
              >
            </article>
          </div>
        </SituateDisclosure>
        <section
          v-if="state.pending.length"
          class="pending"
          aria-label="Pending messages"
        >
          <header>
            <SituateButton
              variant="plain"
              type="button"
              class="pending-toggle"
              :aria-expanded="pendingExpanded"
              :aria-controls="pendingDetailsId"
              @click="pendingExpanded = !pendingExpanded"
            >
              <span
                class="pending-chevron"
                :class="{ expanded: pendingExpanded }"
                aria-hidden="true"
                >›</span
              >{{ state.pending.length }} pending
              {{
                state.pending.length === 1 ? "message" : "messages"
              }}</SituateButton
            ><SituateButton
              variant="plain"
              type="button"
              class="edit-pending"
              aria-keyshortcuts="Alt+ArrowUp"
              @click="restore"
            >
              Edit all pending
            </SituateButton>
          </header>
          <div
            v-show="pendingExpanded"
            :id="pendingDetailsId"
            class="pending-list"
          >
            <section
              v-for="kind in ['steering', 'follow-up'] as const"
              :key="kind"
              class="pending-group"
            >
              <template v-if="state.pending.some((item) => item.kind === kind)">
                <h3>
                  {{ kind === "steering" ? "Steering" : "Follow-up" }} ·
                  {{
                    state.pending.filter((item) => item.kind === kind).length
                  }}
                  <span
                    >·
                    {{
                      kind === "steering"
                        ? "At the next opportunity"
                        : "After this task"
                    }}</span
                  >
                </h3>
                <div
                  class="pending-items"
                  tabindex="0"
                  :aria-label="
                    kind === 'steering'
                      ? 'Pending steering messages'
                      : 'Pending follow-up messages'
                  "
                >
                  <SituateDisclosure
                    v-for="item in state.pending.filter(
                      (item) => item.kind === kind,
                    )"
                    :key="item.id"
                    class="pending-message"
                  >
                    <template #label>
                      <span class="pending-preview">{{
                        item.text || "Attachment"
                      }}</span
                      ><span
                        v-if="item.attachments.length"
                        class="attachment-count"
                        >{{ item.attachments.length }}
                        {{
                          item.attachments.length === 1 ? "file" : "files"
                        }}</span
                      >
                    </template>
                    <div class="pending-body">
                      <p>{{ item.text }}</p>
                      <span
                        v-for="(attachment, index) in item.attachments"
                        :key="index"
                        class="attachment"
                        >{{ attachment.name }}</span
                      >
                    </div>
                  </SituateDisclosure>
                </div>
              </template>
            </section>
          </div>
        </section>
        <form
          class="queue-composer"
          @submit.prevent="emit('action', { type: 'submit', kind: 'steering' })"
        >
          <div
            v-if="state.attachments.length"
            class="draft-attachments"
            aria-label="Draft attachments"
          >
            <span
              v-for="(attachment, index) in state.attachments"
              :key="index"
              class="attachment removable"
              ><span>{{ attachment.name }}</span
              ><SituateButton
                variant="plain"
                type="button"
                class="remove-attachment"
                :aria-label="`Remove attachment ${attachment.name}`"
                @click="removeAttachment(index)"
              >
                <SituateIcon name="close" /></SituateButton
            ></span>
          </div>
          <div class="input-line">
            <SituateIconButton
              icon="plus"
              label="Attach file"
              disabled
              unavailable-reason="File attachment selection is unavailable."
            />
            <label class="sr-only" for="queue-message">Message</label>
            <SituateTextarea
              appearance="plain"
              id="queue-message"
              ref="field"
              :value="state.draft"
              rows="1"
              placeholder="Message…"
              @input="
                emit('action', {
                  type: 'draft',
                  text: ($event.target as HTMLTextAreaElement).value,
                })
              "
              @keydown="keydown"
            />
            <SituateButton
              variant="plain"
              v-if="running"
              type="button"
              class="stop-action"
              aria-label="Stop"
              title="Stop"
              @click="stop"
            >
              <span aria-hidden="true" />
            </SituateButton>
            <SituateIconButton
              icon="arrow"
              :label="running ? 'Queue steering' : 'Send message'"
              variant="primary"
              :disabled="!state.draft.trim() && !state.attachments.length"
              @click="emit('action', { type: 'submit', kind: 'steering' })"
            />
          </div>
        </form>
        <div v-if="running" class="bend-status">
          <SituateButton
            variant="plain"
            class="bend-motion"
            :aria-label="paused ? 'Resume animation' : 'Pause animation'"
            :aria-pressed="paused"
            @click="paused = !paused"
          >
            <MiniBendPlayful
              busy
              :paused="paused || navigationOpen"
              variant="mixed"
            />
          </SituateButton>
          <span class="sr-only">{{
            state.phase === "compacting"
              ? "Situate is compacting the conversation"
              : "Situate is working"
          }}</span>
          <span class="bend-comment">{{
            state.phase === "compacting"
              ? "Making room to keep going."
              : comments[commentIndex]
          }}</span>
        </div>
        <p v-if="state.phase === 'stopped'" class="phase-status">Stopped</p>
        <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {{ state.notice }}
        </p>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.queue-chat {
  height: 100%;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--situate-surface);
  container-type: inline-size;
}
.queue-history {
  flex: 1;
  min-height: 100px;
}
/* Keep the baseline history and disclosures; the queue owns the composer. */
.queue-history :deep(.chat-footer) {
  display: none;
}
.queue-stopped :deep(.chat-error[role="status"]) {
  display: none;
}
.queue-footer {
  flex: none;
  max-height: 75%;
  overflow: auto;
  padding: 8px 28px 16px;
}
.queue-column {
  max-width: 688px;
  margin: auto;
}
.pending {
  margin-bottom: 10px;
  border: 1px solid var(--situate-line);
  border-radius: 14px;
  background: var(--situate-paper);
  overflow: hidden;
}
.pending > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px;
}
.pending-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-height: 44px;
  padding: 8px 4px;
  border: 0;
  background: transparent;
  color: var(--situate-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.pending-toggle:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
  border-radius: 8px;
}
.pending-chevron {
  font-size: 20px;
  line-height: 1;
}
.pending-chevron.expanded {
  transform: rotate(90deg);
}
.edit-pending {
  background: transparent;
  border: 0;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  min-height: 44px;
  padding: 8px;
  font: inherit;
  font-size: 13px;
}
.pending-list {
  border-top: 1px solid var(--situate-line);
  padding: 12px 16px;
  max-height: min(320px, 40dvh);
  overflow: auto;
  scrollbar-gutter: stable;
}
.pending-items {
  min-width: 0;
}
.pending-message > :deep(summary) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  cursor: pointer;
  font-size: 14px;
}
.pending-message > :deep(summary::before) {
  content: "›";
  flex: none;
  font-size: 20px;
}
.pending-message[open] > :deep(summary::before) {
  transform: rotate(90deg);
}
.pending-message > :deep(summary::-webkit-details-marker) {
  display: none;
}
.pending-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attachment-count {
  flex: none;
  font-size: 12px;
  color: var(--situate-muted);
}
.pending-body {
  padding: 0 0 12px 16px;
}
.pending-group h3 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 650;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.pending-group h3 span {
  font-weight: 400;
  color: var(--situate-muted);
}
.pending-group:has(h3) + .pending-group:has(h3) {
  border-top: 1px solid var(--situate-line);
  margin-top: 12px;
  padding-top: 12px;
}
.pending-message + .pending-message {
  border-top: 1px solid var(--situate-line);
}
.pending-message p,
.received p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.55;
}
.attachment {
  display: inline-block;
  max-width: 100%;
  overflow-wrap: anywhere;
  margin: 6px 6px 0 0;
  padding: 3px 8px;
  border: 1px solid var(--situate-line);
  border-radius: 8px;
  color: var(--situate-muted);
  font-size: 12px;
}
.attachment.removable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 0 0 8px;
}
.removable > span {
  min-width: 0;
}
.remove-attachment {
  display: grid;
  place-items: center;
  width: 28px;
  min-height: 28px;
  flex: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--situate-muted);
  padding: 6px;
  cursor: pointer;
}
.remove-attachment:hover {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.remove-attachment:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.remove-attachment :deep(svg) {
  width: 14px;
  height: 14px;
}
@media (pointer: coarse) {
  .remove-attachment {
    width: 44px;
    min-height: 44px;
  }
}
.draft-attachments {
  max-height: 68px;
  overflow: auto;
  padding: 0 12px 6px;
}
.queue-composer {
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-control);
}
.queue-composer:focus-within {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
.input-line {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 6px;
}
textarea {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 44px;
  min-height: 44px;
  max-height: 110px;
  resize: none;
  overflow: auto;
  border: 0;
  background: transparent;
  color: var(--situate-ink);
  font: inherit;
  line-height: 24px;
  padding: 10px 2px;
}
textarea:focus-visible {
  outline: none;
}
.stop-action {
  display: grid;
  place-items: center;
  width: 44px;
  min-height: 44px;
  flex: none;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-pill);
  background: transparent;
  color: var(--situate-ink);
}
.stop-action span {
  width: 11px;
  height: 11px;
  background: currentColor;
  border-radius: 2px;
}
.phase-status {
  font-size: 12px;
  color: var(--situate-muted);
  line-height: 1.5;
  margin: 8px 2px;
}
.bend-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--situate-muted);
}
.bend-motion {
  display: grid;
  place-items: center;
  width: 32px;
  min-height: 32px;
  flex: none;
  border: 0;
  border-radius: 8px;
  background: transparent;
  padding: 0;
  --mini-bend-playful-size: 28px;
}
.bend-motion[aria-pressed="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.received {
  font-size: 12px;
  color: var(--situate-muted);
  margin-bottom: 8px;
}
.received :deep(summary) {
  cursor: pointer;
  min-height: 44px;
  display: flex;
  align-items: center;
}
.received-list {
  max-height: 120px;
  overflow: auto;
}
.received article {
  padding: 8px;
  border-left: 2px solid var(--situate-line);
  margin-bottom: 8px;
}
@container (max-width:540px) {
  .queue-footer {
    padding: 8px 16px 12px;
  }
  .pending-list {
    padding: 10px 12px;
  }
}
@media (max-height: 600px) {
  .queue-footer {
    max-height: 70%;
  }
}
</style>
