<script setup lang="ts">
import { ref, useId } from "vue";
import { SituateButton, SituateIconButton, SituateMenu } from "../ui";
import ChatModeAction from "./ChatModeAction.vue";
import { c } from "./content";
import type { ChatMode } from "./model";

defineProps<{
  mode: ChatMode;
  working?: boolean;
  changesVisible?: boolean;
  statusId?: string;
  closeLabel?: string;
  fixedMode?: boolean;
}>();
const emit = defineEmits<{
  "change-mode": [];
  "toggle-changes": [];
  close: [];
}>();
const menuId = useId();
const open = ref(false);
const initialFocus = ref<"first" | "last">("first");
const element = ref<HTMLElement>();
const trigger = ref<InstanceType<typeof SituateIconButton>>();
function show(focus: "first" | "last" = "first") {
  initialFocus.value = focus;
  open.value = true;
}
function focus() {
  const target =
    trigger.value?.element ??
    element.value?.querySelector<HTMLButtonElement>("button:not(:disabled)");
  target?.focus({ preventScroll: true });
  return !!target;
}
defineExpose({ element, focus });
</script>

<template>
  <div ref="element" class="chat-corner-actions">
    <slot />
    <SituateIconButton
      v-if="!fixedMode || closeLabel"
      ref="trigger"
      icon="more"
      :label="c.chatMode.actions"
      :show-tooltip="!open"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="menuId"
      :aria-describedby="statusId"
      :popovertarget="menuId"
      @click.prevent="open ? (open = false) : show()"
      @keydown.down.prevent="show()"
      @keydown.up.prevent="show('last')"
    />
    <SituateMenu
      v-if="!fixedMode || closeLabel"
      :id="menuId"
      :open="open"
      :anchor="trigger?.element"
      :initial-focus="initialFocus"
      :label="c.chatMode.actions"
      @close="open = false"
    >
      <ChatModeAction
        v-if="!fixedMode"
        placement="corner"
        :mode="mode"
        :working="!!working"
        @change="emit('change-mode')"
      />
      <SituateButton
        v-if="mode === 'development'"
        variant="plain"
        role="menuitem"
        tabindex="-1"
        @click="emit('toggle-changes')"
        >{{
          changesVisible ? c.chatMode.hideChanges : c.chatMode.showChanges
        }}</SituateButton
      >
      <SituateButton
        v-if="closeLabel"
        variant="plain"
        role="menuitem"
        tabindex="-1"
        @click="emit('close')"
        >{{ closeLabel }}</SituateButton
      >
    </SituateMenu>
  </div>
</template>

<style scoped>
.chat-corner-actions {
  display: flex;
  gap: 4px;
  inline-size: max-content;
}
</style>
