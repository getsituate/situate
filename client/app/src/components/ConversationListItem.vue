<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from "vue";
import { t } from "@situate/localization";
import {
  SituateButton,
  SituateIconButton,
  SituateMenu,
  SituateInput,
  SituateTooltip,
  SituateDialog,
} from "@situate/ui";
import WorkingIndicator from "./WorkingIndicator.vue";
import { workspaceChat, workspaceConversations } from "../ai/chat";
import ErrorDialog from "../errors/ErrorDialog.vue";
import { ownsDictation } from "../dictation/runtime";
import type { ConversationSummary } from "../ai/conversation-record";

const props = defineProps<{
  item: ConversationSummary;
  scope: string;
  selected: boolean;
  running: boolean;
  announceArchiveChange?: (scope: string, archived: boolean) => void;
}>();
const emit = defineEmits<{ open: []; openInNewTab: [] }>();
const title = computed(() => props.item.title || t("navigation.newChat"));
const interruptsWork = computed(
  () => props.running || ownsDictation(props.scope, props.item.id),
);
const menuId = useId();
const inputId = useId();
const deleteId = useId();
const confirmingDelete = ref(false);
const deleting = ref(false);
const deleteError = ref(false);
const cancelDeleteButton =
  useTemplateRef<InstanceType<typeof SituateButton>>("cancelDeleteButton");
const menuOpen = ref(false);
const menuPoint = ref<{ x: number; y: number }>();
const editing = ref(false);
const saving = ref(false);
const error = ref(false);
const draft = ref("");
const moving = ref(false);
const archiveError = ref(false);
const trigger =
  useTemplateRef<InstanceType<typeof SituateIconButton>>("trigger");
const anchor = computed(() => trigger.value?.element);
const input = useTemplateRef<InstanceType<typeof SituateInput>>("input");
function openMenu(open: boolean, point?: { x: number; y: number }) {
  if (moving.value) return;
  menuPoint.value = point;
  menuOpen.value = open;
}
function contextMenu(event: MouseEvent) {
  if (editing.value) return;
  event.preventDefault();
  openMenu(
    true,
    event.clientX || event.clientY
      ? { x: event.clientX, y: event.clientY }
      : undefined,
  );
}
async function changeArchive() {
  if (moving.value) return;
  const archived = !props.item.archived;
  const { scope, announceArchiveChange } = props;
  const button = trigger.value?.element;
  const row = button?.closest(".conversation-row");
  const entry = row?.closest("li");
  const neighbor = entry?.nextElementSibling ?? entry?.previousElementSibling;
  const summary = row
    ?.closest(".conversations")
    ?.querySelector<HTMLElement>("summary");
  menuOpen.value = false;
  button?.focus();
  moving.value = true;
  try {
    await workspaceConversations(scope).setArchived(props.item.id, archived);
    announceArchiveChange?.(scope, archived);
    await nextTick();
    if (document.activeElement === document.body) {
      const target = neighbor?.querySelector<HTMLElement>(
        ".conversation-actions",
      );
      if (target?.isConnected) target.focus();
      else if (summary?.isConnected) summary.focus();
    }
  } catch {
    archiveError.value = true;
  } finally {
    moving.value = false;
  }
}
async function dismissArchiveError() {
  archiveError.value = false;
  await nextTick();
  trigger.value?.focus();
}
async function confirmDelete() {
  menuOpen.value = false;
  deleteError.value = false;
  confirmingDelete.value = true;
  await nextTick();
  cancelDeleteButton.value?.focus();
}
async function cancelDelete() {
  if (deleting.value) return;
  confirmingDelete.value = false;
  await nextTick();
  trigger.value?.element?.focus();
}
async function remove() {
  if (deleting.value) return;
  const section = trigger.value?.element?.closest(".conversations");
  deleting.value = true;
  deleteError.value = false;
  try {
    await workspaceChat(props.scope, props.item.id).deleteConversation();
    confirmingDelete.value = false;
    await nextTick();
    section
      ?.querySelector<HTMLButtonElement>(".section-heading button")
      ?.focus();
  } catch {
    deleteError.value = true;
  } finally {
    deleting.value = false;
  }
}
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
  <div
    class="conversation-row"
    :class="{ selected, editing }"
    @contextmenu="contextMenu"
  >
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
          @mousedown.middle.prevent="emit('openInNewTab')"
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
        v-if="!item.archived"
        class="quick-archive"
        icon="archive"
        :label="t('chat.archiveConversationNamed', { title })"
        :aria-disabled="moving || undefined"
        @click="changeArchive"
      />
      <SituateIconButton
        ref="trigger"
        icon="more"
        class="conversation-actions"
        :label="t('chat.conversationActions', { title })"
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        :aria-controls="menuId"
        :popovertarget="menuId"
        :aria-disabled="moving || undefined"
        @click.prevent="openMenu(!menuOpen)"
        @keydown.down.prevent="openMenu(true)"
      />
      <SituateMenu
        :id="menuId"
        :open="menuOpen"
        :anchor="anchor"
        :point="menuPoint"
        @contextmenu.stop.prevent
        :label="t('chat.conversationActions', { title })"
        @close="menuOpen = false"
      >
        <SituateButton
          variant="plain"
          role="menuitem"
          tabindex="-1"
          @click="rename"
          >{{ t("chat.renameConversation") }}</SituateButton
        >
        <SituateButton
          variant="plain"
          role="menuitem"
          tabindex="-1"
          @click="changeArchive"
          >{{
            t(
              item.archived
                ? "chat.restoreConversation"
                : "chat.archiveConversation",
            )
          }}</SituateButton
        >
        <SituateButton
          variant="plain"
          role="menuitem"
          tabindex="-1"
          @click="confirmDelete"
          >{{ t("chat.deleteConversation") }}</SituateButton
        >
      </SituateMenu>
    </template>
    <SituateDialog
      :open="confirmingDelete"
      :aria-labelledby="`${deleteId}-title`"
      :aria-describedby="`${deleteId}-description`"
      :aria-busy="deleting"
      @cancel.prevent="cancelDelete"
    >
      <h2 :id="`${deleteId}-title`">{{ t("chat.deleteTitle") }}</h2>
      <p :data-localization-content="item.title ? 'user' : undefined">
        {{ title }}
      </p>
      <p :id="`${deleteId}-description`" aria-live="polite">
        {{
          t(
            interruptsWork
              ? "chat.deleteRunningConfirmation"
              : "chat.deleteConfirmation",
          )
        }}
      </p>
      <p v-if="deleteError" role="alert">{{ t("chat.deleteFailed") }}</p>
      <template #actions>
        <SituateButton
          ref="cancelDeleteButton"
          variant="secondary"
          :disabled="deleting"
          :unavailable-reason="t('chat.deleting')"
          @click="cancelDelete"
          >{{ t("navigation.cancel") }}</SituateButton
        >
        <SituateButton variant="danger" :busy="deleting" @click="remove">
          {{ t(deleting ? "chat.deleting" : "chat.confirmDelete") }}
        </SituateButton>
      </template>
    </SituateDialog>
    <ErrorDialog
      :open="archiveError"
      :message="t('chat.archiveChangeFailed')"
      @dismiss="dismissArchiveError"
    />
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
  gap: var(--situate-space-2);
  flex: 1;
  min-width: 0;
  min-height: var(--situate-row-compact);
  padding: var(--situate-space-3);
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
.quick-archive.situate-icon-button {
  display: none;
}
@media (hover: hover) and (pointer: fine) {
  @container conversation-list (min-width: 14rem) {
    .quick-archive.situate-icon-button {
      display: inline-grid;
      opacity: 0;
      pointer-events: none;
    }
    .conversation-row:hover .quick-archive.situate-icon-button,
    .conversation-row:has(:focus-visible) .quick-archive.situate-icon-button {
      opacity: 1;
      pointer-events: auto;
    }
  }
}
.title-form {
  width: 100%;
  min-width: 0;
  font-size: var(--situate-text-small);
}
.title-entry {
  display: flex;
  align-items: center;
  gap: var(--situate-space-0-5);
  min-width: 0;
  min-height: var(--situate-row-compact);
  padding: var(--situate-space-0-5) var(--situate-space-1)
    var(--situate-space-0-5) var(--situate-space-3);
}
.title-entry input {
  flex: 1;
  width: 0;
  min-width: 0;
  height: var(--situate-target-min);
  padding: var(--situate-space-1-5) var(--situate-space-2);
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
  padding: var(--situate-space-1) var(--situate-space-3) var(--situate-space-3);
}
</style>
