<script setup lang="ts">
import { computed, nextTick } from "vue";
import ChatView from "../chat/ChatView.vue";
import { createChatState, type Event } from "../chat/model";
import { SituateIconButton } from "../ui";
import DictationComposer from "./DictationComposer.vue";
import DictationNotice from "./DictationNotice.vue";
import { copy } from "./content";
import {
  titleFor,
  visibleFeedback,
  type DictationState,
  type DictationAction,
} from "./model";
const props = defineProps<{
  state: DictationState;
  workspace: string;
  mobile: boolean;
  showNavigation: boolean;
  navigationId: string;
  navigationOpen: boolean;
  covered: boolean;
}>();
const emit = defineEmits<{
  action: [action: DictationAction];
  settings: [];
  openNavigation: [event: MouseEvent];
}>();
const c = computed(() => copy(props.state.language));
const owners = computed(() =>
  (props.state.split && !props.mobile
    ? ["a", "b"]
    : [props.state.selected[props.workspace] ?? "a"]
  ).map((id) => `${props.workspace}/${id}`),
);
const feedback = computed(() =>
  props.covered || props.navigationOpen
    ? null
    : visibleFeedback(props.state, props.workspace, props.mobile),
);
const composers = new Map<string, InstanceType<typeof DictationComposer>>();
async function restoreFocus(owner: string) {
  await nextTick();
  if (!props.covered && !props.navigationOpen && !feedback.value)
    composers.get(owner)?.focus();
}
const base = createChatState("chat-empty");
function conversation(owner: string) {
  const draft = props.state.drafts[owner]!;
  return {
    title: titleFor(props.state, owner),
    events: [
      {
        kind: "message",
        speaker: "user",
        id: "opening",
        text: owner.endsWith("/a") ? c.value.openingA : c.value.openingB,
      },
      {
        kind: "message",
        speaker: "assistant",
        id: "reply",
        text: owner.endsWith("/a") ? c.value.replyA : c.value.replyB,
      },
      ...draft.messages.map((text, index): Event => ({
        kind: "message",
        speaker: "user",
        id: String(index),
        text,
      })),
    ] as Event[],
    working: draft.working ? c.value.agentWorking : "",
    stopped: "",
    error: "",
  };
}
</script>
<template>
  <div class="dictation-panes" :class="{ split: owners.length > 1 }">
    <ChatView
      v-for="(owner, index) in owners"
      :key="owner"
      :state="{
        ...base,
        empty: false,
        draft: state.drafts[owner]!.text,
        phase: state.drafts[owner]!.working ? 'working' : 'complete',
      }"
      :conversation="conversation(owner)"
      hide-model-choice
      :show-navigation="index === 0 && showNavigation"
      :navigation-id="navigationId"
      :navigation-open="navigationOpen"
      @open-navigation="emit('openNavigation', $event)"
    >
      <template #actions>
        <SituateIconButton
          v-if="!mobile && !state.split"
          icon="split"
          :label="c.split"
          @click="emit('action', { type: 'split', value: true })"
        />
        <SituateIconButton
          icon="close"
          :label="`${c.close} — ${titleFor(state, owner)}`"
          @click="
            ($event.currentTarget as HTMLElement).focus();
            emit('action', {
              type: 'close-pane',
              workspace,
              chat: owner.endsWith('/a') ? 'a' : 'b',
            });
          "
        />
      </template>
      <template #composer>
        <DictationComposer
          :ref="
            (element) => {
              if (element)
                composers.set(
                  owner,
                  element as InstanceType<typeof DictationComposer>,
                );
              else composers.delete(owner);
            }
          "
          :state="state"
          :owner="owner"
          :covered="covered || navigationOpen || !!feedback"
          @action="emit('action', $event)"
        />
      </template>
    </ChatView>
    <DictationNotice
      v-if="feedback"
      :state="state"
      :feedback="feedback"
      @dismiss="
        emit('action', { type: 'dismiss-feedback', owner: feedback.owner })
      "
      @settings="
        emit('action', { type: 'dismiss-feedback', owner: feedback.owner });
        emit('settings');
      "
      @closed="restoreFocus"
    />
  </div>
</template>
<style scoped>
.dictation-panes {
  display: grid;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.dictation-panes.split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.split > :nth-child(2) {
  border-inline-start: 1px solid var(--situate-line);
}
.dictation-panes :deep(.chat-screen) {
  min-width: 0;
}
</style>
