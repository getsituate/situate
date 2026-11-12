<script setup lang="ts">
import ConversationRow from "../navigation/ConversationRow.vue";
import { c } from "./content";
import {
  clonePluginState,
  developmentWorking,
  openPluginScreen,
  type PluginState,
} from "./model";
const props = defineProps<{ state: PluginState; active?: boolean }>();
const emit = defineEmits<{
  "update:state": [state: PluginState];
  navigate: [];
}>();
function rename(id: string, title: string) {
  const s = clonePluginState(props.state);
  const development = s.developments.find((item) => item.id === id);
  if (development) development.title = title;
  emit("update:state", s);
}
function open(id: string) {
  const s = clonePluginState(props.state);
  s.developmentId = id;
  openPluginScreen(s, "development");
  emit("update:state", s);
  emit("navigate");
}
</script>
<template>
  <div
    v-if="state.developments.length"
    class="plugin-sidebar"
    :aria-label="c.conversations"
  >
    <ConversationRow
      v-for="d in state.developments"
      :key="d.id"
      :title="d.title"
      :status="developmentWorking(d) ? c.working : c.phases[d.phase]"
      :working="developmentWorking(d)"
      :selected="
        active && state.screen === 'development' && state.developmentId === d.id
      "
      @open="open(d.id)"
      @rename="rename(d.id, $event)"
    />
  </div>
</template>
