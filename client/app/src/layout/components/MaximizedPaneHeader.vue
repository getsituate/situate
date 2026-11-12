<script setup lang="ts">
import {
  useTemplateRef,
  computed,
  nextTick,
  onBeforeUnmount,
  useId,
} from "vue";
import {
  SituateDialog,
  SituateButton,
  SituateIcon,
  SituateIconButton,
} from "@situate/ui";
import { t } from "@situate/localization";
import PaneHistory from "./PaneHistory.vue";
import type { Pane } from "../model";

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
const dialogControl =
  useTemplateRef<InstanceType<typeof SituateDialog>>("dialogControl");
const dialog = computed(() => dialogControl.value?.element);
const headingId = `${useId()}-switch-pane-title`;
const triggerControl =
  useTemplateRef<InstanceType<typeof SituateButton>>("triggerControl");
const trigger = computed(() => triggerControl.value?.element);
const current = computed(() =>
  props.panes.findIndex((item) => item.id === props.pane.id),
);
const title = computed(() => props.panes[current.value]?.title ?? "");
function open() {
  dialog.value?.showModal();
  void nextTick(() =>
    dialog.value?.querySelector<HTMLElement>('[aria-current="true"]')?.focus(),
  );
}
function close() {
  dialog.value?.close();
  trigger.value?.focus();
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const buttons = [
    ...(dialog.value?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ];
  if (!buttons.length) return;
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    index < 0
      ? event.shiftKey
        ? buttons.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
}
function select(id: string) {
  emit("select", id);
  dialog.value?.close();
  void nextTick(() => trigger.value?.focus());
}
function back(): boolean {
  if (!dialog.value?.open) return false;
  close();
  return true;
}
defineExpose({ back });
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <header class="maximized-pane-header">
    <div class="maximized-pane-toolbar">
      <PaneHistory :pane="pane" @navigate="emit('history', $event)" />
      <SituateButton
        variant="plain"
        ref="triggerControl"
        type="button"
        class="maximized-pane-title switch-pane"
        :aria-label="t('layoutUi.namedSwitchPane', { title })"
        :title="t('layoutUi.title', { title })"
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
        :aria-label="t('layoutUi.restore')"
        :title="t('layoutUi.restore')"
        @click="emit('restore')"
      >
        <SituateIcon name="restore" />
      </SituateButton>
      <SituateIconButton
        icon="more"
        :label="t('layoutUi.namedPaneOptions', { title })"
        @click="emit('options', $event)"
      />
    </div>
    <SituateDialog
      ref="dialogControl"
      class="maximized-pane-dialog"
      :aria-labelledby="headingId"
      @cancel.prevent="close"
      @keydown="trapFocus"
      @click="$event.target === dialog && close()"
    >
      <template #header>
        <h2 :id="headingId">{{ t("layoutUi.switchPane") }}</h2>
        <SituateIconButton
          icon="close"
          :label="t('layoutUi.close')"
          @click="close"
        />
      </template>
      <ol class="maximized-pane-list">
        <li v-for="(item, index) in panes" :key="item.id">
          <SituateButton
            variant="plain"
            type="button"
            :aria-current="item.id === pane.id ? 'true' : undefined"
            @click="select(item.id)"
          >
            <span class="pane-number">{{ index + 1 }}</span>
            <span data-localization-content="user">{{ item.title }}</span>
            <small v-if="item.id === pane.id">{{
              t("layoutUi.currentPane")
            }}</small>
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
  top: calc(
    var(--app-viewport-top, 0px) + var(--app-viewport-height, 100dvh) / 2
  );
  bottom: auto;
  margin-block: 0;
  transform: translateY(-50%);
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
