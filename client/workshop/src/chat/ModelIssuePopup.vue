<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { SituateIcon, SituateButton, SituateDialog } from "../ui";
import type { ModelIssue, ModelRecovery } from "./model-issue";
const props = defineProps<{ issue: ModelIssue | null; workspace: string }>();
const emit = defineEmits<{
  "before-open": [];
  recover: [action: ModelRecovery];
  "focus-draft": [];
}>();
const id = useId();
const trigger = ref<InstanceType<typeof SituateButton>>();
const popup = ref<InstanceType<typeof SituateDialog>>();
const dismiss = ref<InstanceType<typeof SituateButton>>();
const opened = ref(false);
let observer: ResizeObserver | undefined;
let active = true;
function position() {
  const dialog = popup.value?.element;
  const anchor = trigger.value?.element
    ?.closest(".chat-choices")
    ?.getBoundingClientRect();
  const area = trigger.value?.element
    ?.closest(".chat-screen")
    ?.getBoundingClientRect();
  if (!dialog?.open || !anchor || !area) return;
  dialog.style.transform = "none";
  dialog.style.maxHeight = `${Math.max(0, anchor.top - area.top - 16)}px`;
  dialog.style.width = `${Math.min(304, area.width - 24)}px`;
  dialog.style.left = `${Math.max(area.left + 12, Math.min(area.right - dialog.offsetWidth - 12, anchor.right - dialog.offsetWidth))}px`;
  dialog.style.top = `${Math.max(area.top + 12, anchor.top - dialog.offsetHeight - 4)}px`;
}
function show() {
  if (!active || !props.issue || !popup.value?.element) return;
  emit("before-open");
  if (!popup.value?.element.open) popup.value?.element.showModal();
  opened.value = true;
  position();
  dismiss.value?.element?.focus({ preventScroll: true });
}
function close(restoreFocus = true) {
  popup.value?.element?.close();
  opened.value = false;
  if (restoreFocus) trigger.value?.element?.focus({ preventScroll: true });
}
function recover(action: ModelRecovery) {
  close(false);
  emit("recover", action);
}
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const buttons = [
    ...popup.value!.element!.querySelectorAll<HTMLButtonElement>("button"),
  ];
  const first = buttons[0],
    last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
watch(
  () => JSON.stringify([props.workspace, props.issue]),
  () => {
    if (props.issue) show();
    else if (opened.value) {
      close(false);
      void nextTick(() => {
        if (active) emit("focus-draft");
      });
    }
  },
  { flush: "post" },
);
onMounted(() => {
  if (props.issue?.kind !== "access") show();
  observer = new ResizeObserver(position);
  const area = popup.value?.element?.closest(".chat-screen");
  if (area) observer.observe(area);
  if (popup.value?.element) observer.observe(popup.value?.element);
  window.addEventListener("resize", position);
});
onBeforeUnmount(() => {
  active = false;
  observer?.disconnect();
  window.removeEventListener("resize", position);
  close(false);
});
</script>

<template>
  <SituateButton
    variant="plain"
    v-if="issue"
    ref="trigger"
    type="button"
    class="issue-trigger"
    :aria-label="`Model issue: ${issue.title}`"
    aria-haspopup="dialog"
    :aria-expanded="opened"
    :aria-controls="id"
    @click="show"
  >
    <span aria-hidden="true">!</span>
  </SituateButton>
  <SituateDialog
    appearance="plain"
    :id="id"
    ref="popup"
    class="issue-dialog"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="issue?.detail ? `${id}-detail` : undefined"
    @cancel.prevent.stop="close()"
    @keydown="keyboard"
  >
    <template v-if="issue">
      <header>
        <h2 :id="`${id}-title`">{{ issue.title }}</h2>
        <SituateButton
          variant="plain"
          ref="dismiss"
          type="button"
          class="issue-close"
          aria-label="Close model issue"
          @click="close()"
        >
          <SituateIcon name="close" />
        </SituateButton>
      </header>
      <div v-if="issue.detail" class="issue-body">
        <p :id="`${id}-detail`">{{ issue.detail }}</p>
      </div>
      <footer v-if="issue.actions.length">
        <SituateButton
          variant="secondary"
          size="small"
          v-for="action in issue.actions"
          :key="action.id"
          type="button"
          @click="recover(action.id)"
        >
          {{ action.label }}
        </SituateButton>
      </footer>
    </template>
  </SituateDialog>
</template>

<style scoped>
.issue-trigger {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  min-height: 44px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  background: transparent;
  cursor: pointer;
}
.issue-trigger > span {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font: 600 11px/1 var(--situate-font-body);
}
.issue-dialog {
  box-sizing: border-box;
  position: fixed;
  max-width: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--situate-line);
  border-radius: 10px;
  background: var(--situate-surface);
  color: var(--situate-ink);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--situate-ink) 10%, transparent);
  overflow: hidden;
  font: 13px/1.5 var(--situate-font-body);
}
.issue-dialog[open] {
  display: flex;
  flex-direction: column;
}
.issue-dialog::backdrop {
  background: transparent;
}
header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 14px;
  flex: none;
}
h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
button:not(:where(.situate-button)) {
  min-height: 44px;
  border: 1px solid var(--situate-control-line);
  border-radius: 7px;
  padding: 8px 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.issue-close {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  padding: 12px;
  border: 0;
  color: var(--situate-muted);
}
.issue-close :deep(svg) {
  width: 16px;
  height: 16px;
}
.issue-body {
  min-height: 0;
  overflow: auto;
  padding: 0 14px 12px;
}
p {
  margin: 0;
  overflow-wrap: anywhere;
}
footer {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 14px 12px;
  flex: none;
}
:focus-visible {
  outline: 2px solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@media (hover: hover) {
  button:not(:where(.situate-button)):hover {
    background: var(--situate-paper);
  }
}
</style>
