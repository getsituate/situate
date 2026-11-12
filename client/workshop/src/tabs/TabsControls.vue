<script setup lang="ts">
import { SituateSelect, SituateButton } from "../ui";
import { computed } from "vue";
import {
  applyOutcome,
  availableOutcomes,
  chatGuard,
  cloneAiState,
} from "../ai/model";
import {
  activeTab,
  paneTitle,
  conversationId,
  type Conversation,
  type Availability,
  type TabsAction,
  type TabsState,
} from "./model";
const props = defineProps<{ state: TabsState; modelChoices: boolean }>();
const emit = defineEmits<{ action: [action: TabsAction] }>();
const tab = computed(() => activeTab(props.state));
const conversation = computed(
  () =>
    props.state.conversations[
      tab.value ? conversationId(tab.value.panes[tab.value.active]!) : ""
    ] ?? props.state.conversations.garden,
);
function modelOutcome(id: string) {
  if (!conversation.value || !props.modelChoices) return;
  const value = cloneAiState(conversation.value.ai);
  applyOutcome(value, id);
  emit("action", { type: "conversation-ai", id: conversation.value.id, value });
}
</script>

<template>
  <div class="tabs-controls">
    <p>
      Proposal · window tabs contain pane arrangements. All content and outcomes
      are synthetic; no files or AI services are connected.
    </p>
    <p>
      The tab row stays visible with one or many tabs. A single pane fills the
      content area and keeps its history and layout actions in that row.
      Splitting adds local pane headers; opening another tab does not. The tab
      overview appears when the desktop strip overflows.
    </p>
    <p>
      Maximized panes: history, the pane title with a chevron, Restore
      arrangement and Pane layout share one compact toolbar. The title opens a
      numbered switch list with full labels. Restore returns to the existing
      pane arrangement without changing the operating-system window. Move pane
      uses the standard Situate dropdowns. Try both tablet orientations and
      keyboard dismissal.
    </p>
    <p>
      Views: More opens additional views inline from the section heading. When
      every view is pinned, the control disappears. Without pins, every view is
      directly visible. Filled pins mark views that stay visible; outline pins
      add views from the separated More views group. Compare the starting states
      with all or no pins, then try pinning and unpinning in the navigation.
    </p>
    <template v-if="tab">
      <label for="pane-availability"
        >Active pane · {{ paneTitle(tab.panes[tab.active]!, state) }}</label
      >
      <SituateSelect
        id="pane-availability"
        :value="tab.panes[tab.active]!.availability"
        @change="
          emit('action', {
            type: 'availability',
            value: ($event.target as HTMLSelectElement).value as Availability,
          })
        "
      >
        <option value="ready">Ready</option>
        <option value="loading">Loading</option>
        <option value="unavailable">Unavailable</option>
      </SituateSelect>
    </template>
    <template v-if="conversation">
      <label for="topic-activity">{{
        conversation.id === "garden"
          ? "Garden conversation"
          : `Conversation · ${conversation.title}`
      }}</label>
      <SituateSelect
        id="topic-activity"
        :value="conversation.activity"
        @change="
          emit('action', {
            type: 'activity',
            id: conversation.id,
            value: ($event.target as HTMLSelectElement)
              .value as Conversation['activity'],
          })
        "
      >
        <option value="ready">Ready</option>
        <option
          value="working"
          :disabled="
            conversation.activity !== 'working' && !!chatGuard(conversation.ai)
          "
        >
          Working
        </option>
      </SituateSelect>
    </template>
    <section
      v-if="modelChoices && conversation"
      aria-label="Model choice outcomes"
    >
      <SituateButton
        variant="secondary"
        size="small"
        v-for="outcome in availableOutcomes(conversation.ai).filter(
          (outcome) => !outcome.id.startsWith('model-response-'),
        )"
        :key="outcome.id"
        type="button"
        @click="modelOutcome(outcome.id)"
      >
        {{ outcome.label }}
      </SituateButton>
      <p v-if="conversation.run" data-active-request>
        Active request: {{ conversation.run.model }} · Thinking:
        {{ conversation.run.thinking ?? "Not adjustable" }}
      </p>
      <p>
        Model selections advance with these simulated outcomes. Drafts and
        choices stay with the conversation; no provider is contacted.
      </p>
    </section>
    <p>
      Pin or unpin views in the main menu, then open a new tab. Its suggestions
      use the same list and order. Navigation opens in the active pane; Back
      returns to its previous view. Each new conversation retains its own draft
      and messages. Sending only changes simulated activity.
    </p>
    <p>
      Try naming a tab, splitting a pane, dragging its grip onto another pane,
      and resizing a divider. Pane layout offers the same placement choices
      without dragging. Arrow keys resize focused dividers.
    </p>
    <p>
      Resize below 660 px of available content or select Mobile: swipe the pane
      titles or tap a neighboring title. The pane switcher appears only when
      multiple panes exist. Their history and layout controls sit alongside the
      pane switcher. With a single pane, history stays in the tab row and the
      overflow menu separates pane layout from tab actions. Widen again to
      restore the arrangement. Reset restores the fixtures and clears drafts.
    </p>
    <p>
      Review question: can someone put tasks below a note, place chat beside
      both, and find the same work again after switching tabs?
    </p>
  </div>
</template>

<style scoped>
.tabs-controls {
  display: grid;
  gap: 8px;
}
.tabs-controls label {
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
}
.tabs-controls span:where(.situate-select) {
  width: 100%;
}
.tabs-controls p {
  font-size: 13px;
  color: var(--situate-muted);
  margin: 4px 0 12px;
}
</style>
