<script setup lang="ts">
import { computed } from "vue";
import { SituateIconButton, SituateIcon, SituateButton } from "../ui";
import NavigationIcon from "../navigation/NavigationIcon.vue";
import copy from "../localization/en.tabs.json";
import { catalogView, viewCatalog } from "./catalog";
import type { Pane, TabsState, TabsAction } from "./model";
const props = defineProps<{ pane: Pane; state: TabsState; all?: boolean }>();
defineEmits<{ action: [action: TabsAction] }>();
const choices = computed(() =>
  props.all ? viewCatalog : props.state.pinnedViews.map(catalogView),
);
</script>

<template>
  <div class="view-chooser pane-scroll">
    <div class="chooser-content">
      <SituateButton
        variant="plain"
        v-if="all && pane.cursor > 0"
        class="chooser-back"
        @click="$emit('action', { type: 'history', id: pane.id, delta: -1 })"
      >
        <SituateIcon name="back" />{{ copy.back }}
      </SituateButton>
      <h2>{{ all ? copy.allViews : copy.chooseView }}</h2>
      <SituateButton
        variant="plain"
        v-if="!all"
        class="new-conversation"
        @click="$emit('action', { type: 'new-conversation', id: pane.id })"
      >
        <SituateIcon name="chat" /><span>{{ copy.newConversation }}</span
        ><SituateIcon name="plus" />
      </SituateButton>
      <section :aria-label="all ? copy.allViews : copy.pinnedViews">
        <h3 v-if="!all">{{ copy.pinnedViews }}</h3>
        <div class="view-choices">
          <div v-for="view in choices" :key="view.id" class="chooser-row">
            <SituateButton
              variant="plain"
              class="choose-view"
              @click="
                $emit('action', { type: 'open', id: pane.id, view: view.id })
              "
            >
              <NavigationIcon :name="view.icon" /><span>{{ view.label }}</span
              ><SituateIcon name="forward" />
            </SituateButton>
            <SituateIconButton
              v-if="all"
              :label="
                (state.pinnedViews.includes(view.id)
                  ? copy.unpinView
                  : copy.pinView
                ).replace('{view}', view.label)
              "
              :aria-pressed="state.pinnedViews.includes(view.id)"
              @click="$emit('action', { type: 'pin-view', view: view.id })"
              ><NavigationIcon name="pin"
            /></SituateIconButton>
          </div>
        </div>
        <template v-if="!all && !choices.length"
          ><p>{{ copy.noPinnedViews }}</p>
          <p class="chooser-help">{{ copy.noPinnedHelp }}</p></template
        >
      </section>
      <SituateButton
        variant="plain"
        v-if="!all"
        class="all-views"
        @click="$emit('action', { type: 'open', id: pane.id, view: 'views' })"
      >
        {{ copy.allViews }}<SituateIcon name="forward" />
      </SituateButton>
    </div>
  </div>
</template>

<style scoped>
.view-chooser {
  height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  display: flex;
  padding: 32px 24px;
}
.chooser-content {
  width: min(440px, 100%);
  margin: auto;
}
h2 {
  margin: 0 0 24px;
  font-size: 24px;
  line-height: 1.25;
  letter-spacing: var(--situate-tracking-heading);
}
h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--situate-muted);
}
.new-conversation {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 56px;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 32px;
  border: 1px solid var(--situate-control-line);
  border-radius: 12px;
  background: var(--situate-surface);
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  text-align: start;
  font-weight: 600;
}
.new-conversation span {
  flex: 1;
}
.chooser-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.choose-view {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
  min-height: 52px;
  padding: 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: start;
}
.choose-view span {
  flex: 1;
}
.choose-view svg {
  flex-shrink: 0;
  color: var(--situate-muted);
}
button {
  font-size: 14px;
}
button:hover {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.all-views,
.chooser-back {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  border: 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: transparent;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.all-views {
  margin-top: 16px;
}
.chooser-back {
  margin-bottom: 16px;
}
p {
  font-size: 14px;
  margin: 8px 0;
}
.chooser-help {
  color: var(--situate-muted);
}
@container pane (max-width: 360px) {
  .view-chooser {
    padding: 24px 20px;
  }
  h2 {
    font-size: 21px;
  }
}
.situate-icon-button[aria-pressed="true"]:not(:disabled) {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
</style>
