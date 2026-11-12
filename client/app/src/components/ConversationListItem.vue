<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from "vue";
import { t } from "@situate/localization";
import {
  SituateButton,
  SituateIconButton,
  SituateMenu,
  SituateInput,
  SituateTooltip,
} from "@situate/ui";
import WorkingIndicator from "./WorkingIndicator.vue";
import { workspaceChat } from "../ai/chat";
import type { ConversationSummary } from "../ai/conversation-record";

const props = defineProps<{
  item: ConversationSummary;
  scope: string;
  selected: boolean;
  running: boolean;
}>();
const emit = defineEmits<{ open: [] }>();
const title = computed(() => props.item.title || t("navigation.newChat"));
const menuId = useId();
const inputId = useId();
const menuOpen = ref(false);
const editing = ref(false);
const saving = ref(false);
const error = ref(false);
const draft = ref("");
const trigger =
  useTemplateRef<InstanceType<typeof SituateIconButton>>("trigger");
const anchor = computed(() => trigger.value?.element);
const input = useTemplateRef<InstanceType<typeof SituateInput>>("input");
async function rename() {
  menuOpen.value = false;
  draft.value = props.item.title.replace(/[\r\n\u2028\u2029]+/g, " ");
  error.value = false;
  editing.value = true;
  await nextTick();
  input.value?.element?.focus();
  input.value?.element?.select();
}
async function cancel() {
  if (saving.value) return;
  editing.value = false;
  await nextTick();
  trigger.value?.element?.focus();
}
function keyboard(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Enter" && event.target === input.value?.element) {
    event.preventDefault();
    void save();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    void cancel();
  }
}
function paste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text/plain");
  const element = input.value?.element;
  if (!text || !element || saving.value) return;
  event.preventDefault();
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? start;
  const remaining = element.maxLength - (element.value.length - (end - start));
  element.setRangeText(
    text.replace(/[\r\n\u2028\u2029]+/g, " ").slice(0, Math.max(0, remaining)),
    start,
    end,
    "end",
  );
  draft.value = element.value;
}
async function save() {
  if (saving.value || !draft.value.trim()) return;
  saving.value = true;
  error.value = false;
  try {
    await workspaceChat(props.scope, props.item.id).renameTitle(draft.value);
    saving.value = false;
    await cancel();
  } catch {
    error.value = true;
    saving.value = false;
    await nextTick();
    input.value?.focus();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="conversation-row" :class="{ selected, editing }">
    <form
      v-if="editing"
      class="title-form"
      @submit.prevent="save"
      :aria-busy="saving"
      @keydown="keyboard"
    >
      <div class="title-entry">
        <SituateInput
          :id="inputId"
          ref="input"
          v-model="draft"
          type="text"
          :maxlength="256"
          :disabled="saving"
          :aria-label="t('chat.conversationTitle')"
          aria-keyshortcuts="Enter Escape"
          :aria-invalid="error || undefined"
          :aria-describedby="`${inputId}-help${error ? ` ${inputId}-error` : ''}`"
          @paste="paste"
        />
        <WorkingIndicator v-if="running" :label="t('navigation.responding')" />
        <SituateIconButton
          class="save-title"
          :label="t('chat.saveTitle')"
          :disabled="saving || !draft.trim()"
          :unavailable-reason="
            t(saving ? 'chat.titleSaving' : 'chat.titleInvalid')
          "
          @click="save"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
        </SituateIconButton>
        <SituateIconButton
          icon="close"
          :label="t('chat.cancelRename')"
          :disabled="saving"
          :unavailable-reason="t('chat.titleSaving')"
          @click="cancel"
        />
      </div>
      <span :id="`${inputId}-help`" class="sr-only">{{
        t("chat.titleRenameHelp")
      }}</span>
      <p v-if="error" :id="`${inputId}-error`" class="title-error" role="alert">
        {{ t("chat.titleSaveFailed") }}
      </p>
    </form>
    <template v-else>
      <SituateTooltip :text="title" v-slot="{ triggerAttrs }">
        <SituateButton
          v-bind="triggerAttrs"
          variant="plain"
          class="conversation-destination"
          :aria-current="selected ? 'page' : undefined"
          @click="emit('open')"
        >
          <span
            class="conversation-title"
            :data-localization-content="item.title ? 'user' : undefined"
            >{{ title }}</span
          >
          <span class="conversation-activity">
            <WorkingIndicator
              v-if="running"
              :label="t('navigation.responding')"
            />
          </span>
        </SituateButton>
      </SituateTooltip>
      <SituateIconButton
        ref="trigger"
        icon="more"
        class="conversation-actions"
        :label="t('chat.conversationActions', { title })"
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        :aria-controls="menuId"
        :popovertarget="menuId"
        @click.prevent="menuOpen = !menuOpen"
        @keydown.down.prevent="menuOpen = true"
      />
      <SituateMenu
        :id="menuId"
        :open="menuOpen"
        :anchor="anchor"
        :label="t('chat.renameConversation')"
        @close="menuOpen = false"
      >
        <SituateButton
          variant="plain"
          role="menuitem"
          tabindex="-1"
          @click="rename"
          >{{ t("chat.renameConversation") }}</SituateButton
        >
      </SituateMenu>
    </template>
  </div>
</template>

<style scoped>
.conversation-row {
  display: flex;
  align-items: center;
  min-width: 0;
  position: relative;
  border-radius: var(--situate-radius-control);
}
.conversation-row.selected,
.conversation-row.editing {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.conversation-destination {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  min-height: var(--situate-row-compact);
  padding: 12px;
  border: 0;
  background: transparent;
  text-align: left;
  font-size: var(--situate-text-small);
}
.conversation-title {
  flex: 1;
  min-width: 0;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selected .conversation-destination {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.selected::before {
  content: "";
  position: absolute;
  left: 0;
  top: 12px;
  width: 3px;
  height: 20px;
  border-radius: 3px;
  background: var(--situate-accent-strong, var(--situate-violet-deep));
}
.conversation-activity {
  display: inline-flex;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  color: var(--situate-muted);
}
.conversation-actions {
  flex: none;
}
.title-form {
  width: 100%;
  min-width: 0;
  font-size: var(--situate-text-small);
}
.title-entry {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  min-height: var(--situate-row-compact);
  padding: 2px 4px 2px 12px;
}
.title-entry input {
  flex: 1;
  width: 0;
  min-width: 0;
  height: var(--situate-target-min);
  padding: 6px 8px;
}
.save-title:not(:disabled) {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.save-title svg {
  width: 20px;
  height: 20px;
}
.title-error {
  margin: 0;
  padding: 4px 12px 12px;
}
</style>
