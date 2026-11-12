<script setup lang="ts">
import { computed } from "vue";
import ViewChooser from "./ViewChooser.vue";
import ConversationBody from "./ConversationBody.vue";
import NavigationDashboard from "../navigation/NavigationDashboard.vue";
import {
  SituateIcon,
  SituateIconButton,
  SituateButton,
  SituateCheckbox,
  SituateTextarea,
} from "../ui";
import copy from "../localization/en.tabs.json";
import {
  currentView,
  conversationId,
  viewNames,
  type Pane,
  type TabsAction,
  type TabsState,
} from "./model";
import { plan, tasks, chat, files } from "./fixtures";
const props = defineProps<{ pane: Pane; state: TabsState; active: boolean }>();
const conversation = computed(
  () => props.state.conversations[conversationId(props.pane)],
);
const dashboardView = computed(() => {
  const view = currentView(props.pane);
  return view === "day" ||
    view === "calendar" ||
    view === "reading" ||
    view === "documents" ||
    view === "review"
    ? view
    : null;
});
const emit = defineEmits<{ action: [action: TabsAction] }>();
function send() {
  if (conversation.value)
    emit("action", { type: "send", id: conversation.value.id });
}
</script>

<template>
  <div v-if="pane.availability !== 'ready'" class="pane-message">
    <template v-if="pane.availability === 'loading'">
      <span class="loading-mark" aria-hidden="true">···</span>
      <p role="status">{{ copy.loading }}</p>
    </template>
    <template v-else>
      <SituateIcon name="notes" />
      <h2>{{ copy.unavailable }}</h2>
      <p>{{ copy.unavailableHelp }}</p>
      <SituateButton
        variant="secondary"
        size="small"
        @click="emit('action', { type: 'open', id: pane.id, view: 'empty' })"
      >
        {{ copy.openView }}
      </SituateButton>
    </template>
  </div>
  <ViewChooser
    v-else-if="currentView(pane) === 'empty' || currentView(pane) === 'views'"
    :pane="pane"
    :state="state"
    :all="currentView(pane) === 'views'"
    @action="emit('action', $event)"
  />
  <NavigationDashboard
    v-else-if="dashboardView"
    :view="dashboardView"
    :completed-tasks="state.dashboardCompleted"
    @toggle-task="emit('action', { type: 'dashboard-task', index: $event })"
  />
  <article
    v-else-if="currentView(pane) === 'note'"
    class="note-content pane-scroll"
  >
    <p class="eyebrow">{{ copy.noteSection }}</p>
    <h2>{{ plan.title }}</h2>
    <p class="note-intro">{{ plan.intro }}</p>
    <h3>{{ plan.section }}</h3>
    <p v-for="paragraph in plan.paragraphs" :key="paragraph">{{ paragraph }}</p>
    <aside>{{ plan.reminder }}</aside>
  </article>
  <section
    v-else-if="currentView(pane) === 'tasks'"
    class="task-content pane-scroll"
  >
    <div class="content-heading">
      <h2>{{ copy.taskSection }}</h2>
      <small
        >{{ state.completed.length }} / {{ tasks.length }}
        {{ copy.completed }}</small
      >
    </div>
    <label
      v-for="(task, index) in tasks"
      :key="task"
      class="task-row"
      :class="{ checked: state.completed.includes(index) }"
    >
      <SituateCheckbox
        appearance="plain"
        type="checkbox"
        :checked="state.completed.includes(index)"
        @change="emit('action', { type: 'task', index })"
      />
      <span>{{ task }}</span>
    </label>
  </section>
  <section
    v-else-if="currentView(pane) === 'files' || currentView(pane) === 'notes'"
    class="files-content pane-scroll"
  >
    <h2>
      {{ currentView(pane) === "notes" ? copy.views.notes : copy.fileSection }}
    </h2>
    <SituateButton
      variant="plain"
      v-for="(file, index) in files"
      :key="file"
      class="file-row"
      @click="
        emit('action', {
          type: 'open',
          id: pane.id,
          view: index === 1 ? 'tasks' : 'note',
        })
      "
    >
      <SituateIcon name="notes" /><span>{{ file }}</span
      ><SituateIcon name="forward" />
    </SituateButton>
  </section>
  <ConversationBody
    v-else-if="conversation && conversation.id !== 'garden'"
    :key="conversation.id"
    :conversation="conversation"
    :active="active"
    @action="emit('action', $event)"
  />
  <section v-else-if="conversation" class="chat-content">
    <div class="chat-scroll pane-scroll">
      <template v-if="conversation.id === 'garden'">
        <div class="user-message">
          <small>{{ copy.chatYou }}</small>
          <p>{{ chat.request }}</p>
        </div>
        <div class="assistant-message">
          <strong class="assistant-label"
            ><SituateIcon name="chat" />{{ copy.chatAssistant }}</strong
          >
          <p>{{ chat.response }}</p>
          <ul>
            <li v-for="point in chat.points" :key="point">{{ point }}</li>
          </ul>
          <SituateButton
            variant="plain"
            class="note-link"
            @click="emit('action', { type: 'open', id: pane.id, view: 'note' })"
          >
            <SituateIcon name="notes" />{{ viewNames.note
            }}<SituateIcon name="forward" />
          </SituateButton>
        </div>
      </template>
      <div
        v-for="(message, index) in conversation.messages"
        :key="index"
        class="user-message sent-message"
      >
        <small>{{ copy.chatYou }}</small>
        <p>{{ message }}</p>
      </div>
      <p
        v-if="conversation.activity === 'working'"
        role="status"
        class="work-status"
      >
        {{ conversation.id === "garden" ? copy.workingHelp : copy.working }}
      </p>
    </div>
    <form class="chat-compose" @submit.prevent="send">
      <label :for="`message-${pane.id}`" class="sr-only">{{
        copy.reply
      }}</label>
      <SituateTextarea
        appearance="plain"
        :id="`message-${pane.id}`"
        :value="conversation.draft"
        :placeholder="copy.replyPlaceholder"
        rows="2"
        @input="
          emit('action', {
            type: 'draft',
            id: conversation.id,
            value: ($event.target as HTMLTextAreaElement).value,
          })
        "
        @keydown.enter.exact.prevent="send"
      />
      <div class="composer-bottom">
        <small>{{ copy.draftHelp }}</small>
        <SituateButton
          variant="secondary"
          size="small"
          v-if="conversation.activity === 'working'"
          type="button"
          @click="
            emit('action', {
              type: 'activity',
              id: conversation.id,
              value: 'ready',
            })
          "
        >
          {{ copy.stop }}
        </SituateButton>
        <SituateIconButton
          v-else
          icon="arrow"
          :label="copy.send"
          variant="primary"
          :disabled="!conversation.draft.trim()"
          :unavailable-reason="copy.replyPlaceholder"
          @click="send"
        />
      </div>
    </form>
  </section>
</template>

<style scoped>
.pane-scroll {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.pane-message {
  height: 100%;
  overflow: auto;
  padding: 36px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  text-align: center;
}
.pane-message h2 {
  font-size: 20px;
  margin: 12px 0 0;
}
.pane-message p {
  max-width: 40ch;
  color: var(--situate-muted);
  font-size: 14px;
}
.loading-mark {
  font-size: 40px;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.sent-message {
  margin-top: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.note-content,
.task-content,
.files-content {
  height: 100%;
  padding: 24px 32px;
}
.eyebrow {
  font-size: 12px;
  color: var(--situate-muted);
  margin: 0 0 12px;
}
.note-content h2 {
  font: 600 28px/1.15 var(--situate-font-display);
  letter-spacing: -0.035em;
  margin: 0 0 16px;
}
.note-content h3 {
  font-size: 16px;
  margin: 24px 0 10px;
}
.note-content p {
  font-size: 14px;
  max-width: 64ch;
}
.note-intro {
  color: var(--situate-muted);
}
.note-content aside {
  background: var(--situate-note);
  padding: 16px;
  border-radius: 12px;
  margin: 24px 0 0;
  font-size: 14px;
}
.content-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 16px;
  justify-content: space-between;
  margin-bottom: 12px;
}
.task-content h2,
.files-content h2 {
  font-size: 19px;
  margin: 0;
}
.content-heading small {
  color: var(--situate-muted);
  font-size: 12px;
}
.task-row {
  min-height: 52px;
  display: flex;
  align-items: start;
  gap: 12px;
  padding: 12px 0;
  font-size: 14px;
  border-bottom: 1px solid var(--situate-line);
}
.task-row input {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  margin: 1px 0 0;
  accent-color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.checked span {
  color: var(--situate-muted);
  text-decoration: line-through;
}
.file-row {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  min-height: 60px;
  border: 0;
  border-bottom: 1px solid var(--situate-line);
  background: transparent;
  text-align: start;
}
.file-row span {
  flex: 1;
}
.chat-content {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.chat-scroll {
  flex: 1;
  padding: 24px;
  font-size: 14px;
}
.user-message {
  background: var(--situate-paper);
  padding: 16px 20px;
  border-radius: 18px 18px 4px 18px;
  margin-inline-start: 24px;
}
.user-message p {
  margin: 4px 0 0;
}
.user-message small {
  color: var(--situate-muted);
}
.assistant-message {
  margin-top: 28px;
}
.assistant-label {
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-size: 13px;
}
.assistant-message ul {
  padding-inline-start: 20px;
}
.assistant-message li {
  padding-bottom: 8px;
}
.note-link {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--situate-note);
  border: 1px solid var(--situate-line);
  border-radius: 12px;
  padding: 16px;
  text-align: start;
}
.note-link svg:last-child {
  margin-inline-start: auto;
}
.chat-compose {
  margin: 12px 20px 20px;
  border: 1px solid var(--situate-control-line);
  border-radius: 18px;
  padding: 12px;
}
.chat-compose:focus-within {
  outline: 2px solid var(--situate-accent-strong, var(--situate-violet-deep));
  outline-offset: var(--situate-focus-offset);
}
.chat-compose textarea {
  width: 100%;
  border: 0;
  resize: vertical;
  max-height: 160px;
  background: transparent;
  font-size: 16px;
  outline: none;
}
.composer-bottom {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.composer-bottom small {
  font-size: 11px;
  color: var(--situate-muted);
  margin-inline-end: auto;
}
.work-status {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
@container pane (max-width: 360px) {
  .note-content,
  .task-content,
  .files-content,
  .chat-scroll {
    padding: 20px;
  }
  .note-content h2 {
    font-size: 24px;
  }
  .composer-bottom small {
    display: none;
  }
  .chat-compose {
    margin: 8px 12px 12px;
  }
}
</style>
