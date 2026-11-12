<script setup lang="ts">
import { computed } from "vue";
import { SituateButton, SituateIcon, SituateIconButton } from "@situate/ui";
import { t } from "@situate/localization";
import PaneHistory from "./PaneHistory.vue";
import type { Pane, TopicTab, LayoutIntent } from "../model";
import { currentEntry, type ViewTarget } from "../navigation";
import type { PaneEdge } from "../tree";
import { edges, edgeTitle } from "./edges";
const props = defineProps<{
  pane: Pane;
  tab: TopicTab;
  titleFor: (target: ViewTarget) => string;
  active: boolean;
  dragging: string | null;
  maximized: boolean;
  compact?: boolean;
}>();
defineSlots<{
  pane(props: { pane: Pane; tab: TopicTab; active: boolean }): unknown;
}>();
const emit = defineEmits<{
  intent: [intent: LayoutIntent];
  options: [id: string, event: MouseEvent];
  drag: [id: string | null];
}>();
const title = computed(() =>
  props.titleFor(currentEntry(props.pane.navigation).target),
);
function dragStart(event: DragEvent) {
  event.dataTransfer?.setData("application/x-situate-pane", props.pane.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  emit("drag", props.pane.id);
}
function drop(edge: PaneEdge) {
  if (props.dragging)
    emit("intent", {
      type: "move",
      tabId: props.tab.id,
      paneId: props.dragging,
      targetPaneId: props.pane.id,
      edge,
    });
  emit("drag", null);
}
function activate() {
  if (!props.active)
    emit("intent", {
      type: "select-pane",
      tabId: props.tab.id,
      paneId: props.pane.id,
    });
}
</script>

<template>
  <section
    class="pane-tile"
    :class="{ active, compact }"
    :data-pane="pane.id"
    :aria-label="t('layoutUi.namedPane', { title })"
    @focusin="activate"
    @pointerdown="activate"
  >
    <header v-if="!compact" class="pane-toolbar">
      <SituateButton
        variant="plain"
        class="pane-grip"
        draggable="true"
        :aria-label="t('layoutUi.drag')"
        :title="t('layoutUi.drag')"
        @dragstart="dragStart"
        @dragend="emit('drag', null)"
        @click="emit('options', pane.id, $event)"
      >
        <SituateIcon name="grip" />
      </SituateButton>
      <PaneHistory
        :pane="pane"
        @navigate="
          emit('intent', {
            type: 'history',
            tabId: tab.id,
            paneId: pane.id,
            delta: $event,
          })
        "
      />
      <SituateButton
        variant="plain"
        class="pane-title"
        :title="t('layoutUi.title', { title })"
        @click="emit('options', pane.id, $event)"
      >
        <span data-localization-content="user">{{ title }}</span>
      </SituateButton>
      <SituateIconButton
        icon="more"
        :label="t('layoutUi.namedPaneOptions', { title })"
        @click="emit('options', pane.id, $event)"
      />
    </header>
    <div class="pane-body">
      <div :key="currentEntry(pane.navigation).id" class="pane-view">
        <slot name="pane" :pane="pane" :tab="tab" :active="active" />
      </div>
    </div>
    <div
      v-if="dragging && dragging !== pane.id && !maximized"
      class="drop-targets"
      aria-hidden="true"
    >
      <div
        v-for="edge in edges"
        :key="edge"
        :class="`drop-${edge}`"
        @dragover.prevent
        @drop.prevent.stop="drop(edge)"
      >
        {{ edgeTitle(edge) }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.pane-tile {
  height: 100%;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--situate-line);
  border-radius: 12px;
  background: var(--situate-surface);
}
.pane-tile:not(.compact) {
  overflow: clip;
}
.pane-tile.active {
  border-color: var(--situate-accent-strong, var(--situate-violet-deep));
}
/* Paint above child backgrounds without extending beyond the pane. */
.pane-tile.active:not(.compact)::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  border: 1px solid var(--situate-accent-strong, var(--situate-violet-deep));
  border-radius: 11px;
  pointer-events: none;
}
.pane-tile.compact {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.pane-toolbar {
  display: flex;
  gap: 0;
  flex: 0 0 auto;
  align-items: center;
  padding: 4px;
  border-bottom: 1px solid var(--situate-line);
  border-radius: 11px 11px 0 0;
  background: var(--situate-paper);
}
.active .pane-toolbar {
  background: color-mix(
    in srgb,
    var(--situate-accent-soft, var(--situate-lilac)) 60%,
    var(--situate-surface)
  );
}
.pane-toolbar :deep(.situate-icon-button) {
  width: 32px;
  height: 36px;
  flex-basis: 32px;
  padding: 8px;
  border-radius: 8px;
}
.pane-grip {
  display: grid;
  place-items: center;
  width: 26px;
  flex: 0 0 26px;
  height: 36px;
  border: 0;
  padding: 4px;
  background: transparent;
  color: var(--situate-muted);
  cursor: grab;
}
.pane-title {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  text-align: start;
  font-size: 13px;
  font-weight: 600;
}
.pane-title span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pane-title svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--situate-muted);
}
.pane-view {
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.pane-body {
  flex: 1;
  min-height: 0;
  container: pane / inline-size;
}
.drop-targets {
  position: absolute;
  inset: 48px 4px 4px;
  display: grid;
  grid-template-columns: 1fr 1.5fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  gap: 4px;
  padding: 8px;
  background: color-mix(in srgb, var(--situate-surface) 92%, transparent);
}
.drop-targets div {
  display: grid;
  place-items: center;
  border: 2px dashed var(--situate-accent-strong, var(--situate-violet-deep));
  border-radius: 8px;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  background: var(--situate-accent-soft, var(--situate-lilac));
  font-size: 14px;
}
.drop-left {
  grid-area: 2 / 1;
}
.drop-right {
  grid-area: 2 / 3;
}
.drop-top {
  grid-area: 1 / 2;
}
.drop-bottom {
  grid-area: 3 / 2;
}
.drop-targets div:hover {
  background: var(--situate-accent-strong, var(--situate-violet-deep));
  color: var(--situate-surface);
}
@media (pointer: coarse) {
  .pane-toolbar :deep(.situate-icon-button),
  .pane-title,
  .pane-grip {
    height: 44px;
  }
  .pane-toolbar :deep(.situate-icon-button) {
    width: 44px;
    flex-basis: 44px;
  }
}
</style>
