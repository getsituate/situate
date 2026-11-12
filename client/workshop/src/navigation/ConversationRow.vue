<script setup lang="ts">
import { nextTick, ref, useId } from "vue";
import {
  SituateButton,
  SituateIconButton,
  SituateInput,
  SituatePopover,
} from "../ui";
import copy from "../localization/en.conversation-list.json";

const props = withDefaults(
  defineProps<{
    title: string;
    status: string;
    working?: boolean;
    needsApproval?: boolean;
    selected?: boolean;
    archivable?: boolean;
    navigable?: boolean;
  }>(),
  { navigable: true },
);
const emit = defineEmits<{
  open: [];
  rename: [title: string];
  archive: [];
}>();
const id = useId();
const options = ref<InstanceType<typeof SituateIconButton>>();
const input = ref<InstanceType<typeof SituateInput>>();
const menuOpen = ref(false);
const editing = ref(false);
const draft = ref("");
const feedback = ref("");
async function startRename() {
  menuOpen.value = false;
  draft.value = props.title;
  editing.value = true;
  await nextTick();
  input.value?.focus();
  input.value?.select();
}
async function finish(save: boolean) {
  const title = draft.value.trim();
  if (save && !title) return;
  if (save) emit("rename", title);
  editing.value = false;
  feedback.value = save ? copy.saved : copy.cancelled;
  await nextTick();
  options.value?.focus();
}
function keyboard(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Enter" && event.target === input.value?.element) {
    event.preventDefault();
    void finish(true);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    void finish(false);
  }
}
function paste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text/plain");
  const element = input.value?.element;
  if (!text || !element) return;
  event.preventDefault();
  element.setRangeText(
    text.replace(/[\r\n\u2028\u2029]+/g, " "),
    element.selectionStart ?? 0,
    element.selectionEnd ?? 0,
    "end",
  );
  draft.value = element.value;
}
</script>

<template>
  <div
    class="conversation-row"
    :class="{ selected, editing }"
    @keydown="keyboard"
  >
    <template v-if="editing">
      <SituateInput
        ref="input"
        v-model="draft"
        type="text"
        class="title-input"
        :aria-label="copy.titleLabel"
        :aria-describedby="`${id}-help`"
        :aria-keyshortcuts="'Enter Escape'"
        @paste="paste"
      />
      <SituateIconButton
        class="confirm"
        :label="copy.save"
        :disabled="!draft.trim()"
        :unavailable-reason="copy.empty"
        @click="finish(true)"
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
        :label="copy.cancel"
        @click="finish(false)"
      />
      <span :id="`${id}-help`" class="sr-only">{{
        draft.trim() ? copy.help : copy.empty
      }}</span>
    </template>
    <template v-else>
      <component
        :is="navigable ? SituateButton : 'div'"
        v-bind="navigable ? { variant: 'plain' } : {}"
        class="conversation-title"
        :title="title"
        :aria-current="selected ? 'page' : undefined"
        @click="emit('open')"
        >{{ title }}<span class="sr-only"> · {{ status }}</span></component
      >
      <SituateIconButton
        ref="options"
        icon="more"
        :label="copy.options.replace('{title}', title)"
        aria-haspopup="dialog"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      />
    </template>
    <span
      v-if="needsApproval"
      class="approval"
      role="img"
      :aria-label="status"
      :title="status"
      >!</span
    >
    <span
      v-if="working"
      class="conversation-activity"
      role="img"
      :aria-label="status"
      :title="status"
    />
    <SituatePopover
      :open="menuOpen"
      :anchor="options?.element"
      :label="copy.actions"
      style="width: 216px"
      @close="menuOpen = false"
    >
      <div class="action-list">
        <SituateButton variant="plain" @click="startRename">{{
          copy.rename
        }}</SituateButton>
        <SituateButton
          v-if="archivable"
          variant="plain"
          @click="
            menuOpen = false;
            emit('archive');
          "
          >{{ copy.archive }}</SituateButton
        >
      </div>
    </SituatePopover>
    <span class="sr-only" aria-live="polite" aria-atomic="true">{{
      feedback
    }}</span>
  </div>
</template>

<style scoped>
.conversation-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: 52px;
  padding: 2px 4px 2px 12px;
  border-radius: var(--situate-radius-control);
  color: var(--situate-ink);
  font-size: var(--situate-text-small);
}
.conversation-row.selected,
.conversation-row.editing {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.conversation-row :deep(.conversation-title) {
  border: 0;
  background: transparent;
  border-radius: 8px;
  display: block;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 10px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: start;
  color: inherit;
  font: inherit;
}
.selected :deep(.conversation-title) {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.title-input {
  flex: 1;
  width: 0;
  min-width: 0;
  height: 44px;
  padding: 6px 8px;
  font: inherit;
}
.confirm:not(:disabled) {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.confirm svg {
  width: 20px;
  height: 20px;
}
.approval {
  order: -1;
  margin-right: 4px;
  font-weight: 700;
}
.conversation-activity {
  order: -1;
  flex: 0 0 6px;
  height: 6px;
  margin-right: 4px;
  border-radius: 50%;
  background: var(--situate-accent-strong, var(--situate-violet-deep));
}
.action-list :deep(button) {
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  display: block;
  width: 100%;
  min-height: 44px;
  text-align: start;
  padding: 8px 12px;
}
button:focus-visible,
:deep(button:focus-visible) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: -3px;
}
@media (hover: hover) {
  .action-list :deep(button:hover) {
    background: var(--situate-accent-soft, var(--situate-lilac));
  }
  .conversation-row:hover {
    background: var(--situate-accent-soft, var(--situate-lilac));
  }
}
</style>
