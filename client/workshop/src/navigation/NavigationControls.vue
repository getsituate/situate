<script setup lang="ts">
import { SituateSelect, SituateButton, SituateTextarea } from "../ui";
import { computed, useId } from "vue";
import {
  addChat,
  createNavigationState,
  navigationScreenLabel,
  updateDraft,
  type NavigationScene,
  type NavigationState,
} from "./model";
import { useNavigationState } from "./use-navigation-state";
const props = defineProps<{ state: NavigationState }>();
const emit = defineEmits<{ "update:state": [state: NavigationState] }>();
const { state, update } = useNavigationState(
  () => props.state,
  (value) => emit("update:state", value),
);
const id = useId();
const active = computed(() =>
  state.value.tabs.find((tab) => tab.id === state.value.activeTab),
);
function status(conversationId: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  update({
    ...state.value,
    conversations: state.value.conversations.map((item) =>
      item.id === conversationId ? { ...item, status: value } : item,
    ),
  });
}
</script>
<template>
  <section class="navigation-controls" :aria-labelledby="`${id}-heading`">
    <h2 :id="`${id}-heading`">{{ navigationScreenLabel(state) }}</h2>
    <p v-if="state.pendingClose">
      Keep the tab or discard its draft in the preview.
    </p>
    <template v-else>
      <p>
        Conversation names can be edited through their options button. Enter
        saves; Escape cancels. Changes are simulated in memory.
      </p>
      <label :for="`${id}-scene`">Arrangement</label
      ><SituateSelect
        :id="`${id}-scene`"
        :value="state.scene"
        @change="
          update(
            createNavigationState(
              ($event.target as HTMLSelectElement).value as NavigationScene,
            ),
          )
        "
      >
        <option value="chat">New chat</option>
        <option value="dashboard">Dashboard + chat</option>
        <option value="empty">No open tabs</option>
        <option value="draft">Unsent draft</option>
      </SituateSelect>
      <div class="actions">
        <SituateButton
          variant="secondary"
          size="small"
          type="button"
          @click="update(createNavigationState(state.scene))"
        >
          Reset arrangement</SituateButton
        ><SituateButton
          variant="secondary"
          size="small"
          type="button"
          @click="update(addChat(state))"
          >New chat</SituateButton
        >
      </div>
      <template v-if="active?.kind === 'chat'"
        ><label :for="`${id}-draft`">Draft message</label
        ><SituateTextarea
          :id="`${id}-draft`"
          :value="active.draft"
          @input="
            update(
              updateDraft(
                state,
                active!.id,
                ($event.target as HTMLTextAreaElement).value,
              ),
            )
          "
        />
      </template>
      <SituateButton
        variant="secondary"
        size="small"
        v-if="state.tabs.some((tab) => tab.id === 'day' || tab.id === 'tasks')"
        type="button"
        @click="
          update({
            ...state,
            completedTasks: state.completedTasks.map(() => false),
          })
        "
      >
        Reset tasks
      </SituateButton>
      <template
        v-for="item in state.conversations.filter((item) => !item.archived)"
        :key="item.id"
        ><label :for="`${id}-${item.id}`">{{ item.title }}</label
        ><SituateSelect
          :id="`${id}-${item.id}`"
          :value="item.status"
          @change="status(item.id, $event)"
        >
          <option value="working">Working · Reading notes</option>
          <option value="approval">Needs approval</option>
          <option value="Yesterday">Yesterday</option>
          <option value="Done">Done</option>
        </SituateSelect></template
      >
    </template>
  </section>
</template>
<style scoped>
.navigation-controls {
  min-width: 0;
}
h2 {
  font-size: 18px;
}
label {
  display: block;
  margin: 16px 0 6px;
  font-size: 14px;
  font-weight: 600;
}
span:where(.situate-select),
textarea {
  width: 100%;
}
textarea {
  resize: vertical;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0;
}
</style>
