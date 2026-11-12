<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import {
  SituateIcon,
  SituateIconButton,
  SituateButton,
  SituateDialog,
} from "../ui";
import copy from "../localization/en.tabs.json";
import PaneHistory from "./PaneHistory.vue";
import type { Pane } from "./model";

const props = defineProps<{
  pane: Pane;
  panes: { id: string; title: string }[];
}>();
const emit = defineEmits<{
  select: [id: string];
  restore: [];
  history: [delta: -1 | 1];
  options: [event: MouseEvent];
}>();
const dialog = ref<InstanceType<typeof SituateDialog>>();
const trigger = ref<InstanceType<typeof SituateButton>>();
const current = computed(() =>
  props.panes.findIndex((item) => item.id === props.pane.id),
);
const title = computed(() => props.panes[current.value]?.title ?? "");
function open() {
  dialog.value?.element?.showModal();
  void nextTick(() =>
    dialog.value?.element
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.focus(),
  );
}
function close() {
  dialog.value?.element?.close();
  trigger.value?.element?.focus();
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const buttons = [
    ...(dialog.value?.element?.querySelectorAll<HTMLButtonElement>("button") ??
      []),
  ];
  const first = buttons[0];
  const last = buttons.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
function select(id: string) {
  emit("select", id);
  dialog.value?.element?.close();
  void nextTick(() => trigger.value?.element?.focus());
}
onBeforeUnmount(() => dialog.value?.element?.close());
</script>

<template>
  <header class="maximized-pane-header">
    <div class="maximized-pane-toolbar">
      <PaneHistory :pane="pane" @navigate="emit('history', $event)" />
      <SituateButton
        variant="plain"
        ref="trigger"
        type="button"
        class="maximized-pane-title switch-pane"
        :aria-label="`${copy.switchPane}: ${title}`"
        :title="title"
        aria-haspopup="dialog"
        @click="open"
      >
        <span>{{ title }}</span
        ><SituateIcon name="chevron" />
      </SituateButton>
      <SituateButton
        variant="plain"
        type="button"
        class="restore-pane"
        :aria-label="copy.restore"
        :title="copy.restore"
        @click="emit('restore')"
      >
        <SituateIcon name="restore" />
      </SituateButton>
      <SituateIconButton
        icon="more"
        :label="`${copy.paneOptions}: ${title}`"
        @click="emit('options', $event)"
      />
    </div>
    <SituateDialog
      ref="dialog"
      class="maximized-pane-dialog"
      aria-labelledby="switch-pane-title"
      @cancel.prevent="close"
      @keydown="trapFocus"
      @click="$event.target === dialog?.element && close()"
    >
      <header>
        <h2 id="switch-pane-title" data-dialog-title>{{ copy.switchPane }}</h2>
        <SituateIconButton icon="close" :label="copy.close" @click="close" />
      </header>
      <ol class="maximized-pane-list">
        <li v-for="(item, index) in panes" :key="item.id">
          <SituateButton
            variant="plain"
            type="button"
            :aria-current="item.id === pane.id ? 'true' : undefined"
            @click="select(item.id)"
          >
            <span class="pane-number">{{ index + 1 }}</span>
            <span>{{ item.title }}</span>
            <small v-if="item.id === pane.id">{{ copy.currentPane }}</small>
          </SituateButton>
        </li>
      </ol>
    </SituateDialog>
  </header>
</template>

<style scoped>
.maximized-pane-header {
  flex: 0 0 auto;
  min-width: 0;
  padding: 4px;
  background: color-mix(
    in srgb,
    var(--situate-accent-soft, var(--situate-lilac)) 60%,
    var(--situate-surface)
  );
  border-bottom: 1px solid var(--situate-line);
}
.maximized-pane-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.restore-pane,
.switch-pane {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  min-width: 44px;
  padding: 8px;
  border: 0;
  border-radius: 8px;
  color: var(--situate-ink);
  background: transparent;
  font: inherit;
  font-size: 13px;
}
.switch-pane {
  flex: 1;
  text-align: start;
  font-weight: 600;
}
.switch-pane span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.maximized-pane-toolbar svg {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}
.restore-pane {
  flex-shrink: 0;
  width: 44px;
  justify-content: center;
}
.maximized-pane-toolbar :deep(.situate-icon-button) {
  width: 44px;
  height: 44px;
  flex-basis: 44px;
  padding: 12px;
  border-radius: 8px;
}
@media (hover: hover) {
  .switch-pane:hover,
  .restore-pane:hover {
    background: var(--situate-accent-soft, var(--situate-lilac));
  }
}
.maximized-pane-dialog {
  width: min(480px, calc(100% - 32px));
  max-height: min(80dvh, var(--app-content-height, 80dvh));
  padding: 20px;
  border: 1px solid var(--situate-line);
  border-radius: 24px;
  color: var(--situate-ink);
  background: var(--situate-surface);
  overflow: auto;
}
.maximized-pane-dialog::backdrop {
  background: color-mix(in srgb, var(--situate-ink) 30%, transparent);
}
.maximized-pane-dialog > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.maximized-pane-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.maximized-pane-list li + li {
  margin-top: 8px;
}
.maximized-pane-list button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 12px;
  border: 1px solid var(--situate-line);
  border-radius: 12px;
  color: var(--situate-ink);
  background: var(--situate-paper);
  font: inherit;
  text-align: start;
  overflow-wrap: anywhere;
}
.maximized-pane-list button > span:nth-child(2) {
  flex: 1;
  min-width: 0;
}
.maximized-pane-list button[aria-current="true"] {
  border-color: var(--situate-accent-strong, var(--situate-violet-deep));
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.pane-number {
  color: var(--situate-muted);
  font-variant-numeric: tabular-nums;
}
.maximized-pane-list small {
  font-size: 12px;
}
</style>
