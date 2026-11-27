<script setup lang="ts">
import { ref, useId } from "vue";
import { t } from "@situate/localization";
import { SituateButton, SituateIconButton, SituateMenu } from "@situate/ui";

defineProps<{
  development?: boolean;
  modeUnavailable?: string;
  changesVisible?: boolean;
  canSwitch: boolean;
}>();
const emit = defineEmits<{ changeMode: []; toggleChanges: [] }>();
const trigger = ref<InstanceType<typeof SituateIconButton>>();
const id = useId();
const open = ref(false);
const initialFocus = ref<"first" | "last">("first");
function show(focus: "first" | "last" = "first") {
  initialFocus.value = focus;
  open.value = true;
}
defineExpose({
  focus: () => trigger.value?.element?.focus({ preventScroll: true }),
});
</script>

<template>
  <div class="chat-corner-actions">
    <SituateIconButton
      ref="trigger"
      icon="more"
      :label="t('pluginDevelopment.chatActions')"
      aria-haspopup="menu"
      :aria-expanded="open"
      :popovertarget="id"
      @click.prevent="open ? (open = false) : show()"
      @keydown.down.prevent="show()"
      @keydown.up.prevent="show('last')"
    />
    <SituateMenu
      :id="id"
      :open="open"
      :anchor="trigger?.element"
      :initial-focus="initialFocus"
      :label="t('pluginDevelopment.chatActions')"
      @close="open = false"
    >
      <SituateButton
        v-if="canSwitch"
        variant="plain"
        role="menuitem"
        tabindex="-1"
        :aria-disabled="!!modeUnavailable || undefined"
        :aria-description="modeUnavailable"
        @click="!modeUnavailable && emit('changeMode')"
        >{{
          t(
            development
              ? "pluginDevelopment.switchToChat"
              : "pluginDevelopment.switchToDevelopment",
          )
        }}</SituateButton
      >
      <SituateButton
        v-if="changesVisible !== undefined"
        variant="plain"
        role="menuitem"
        tabindex="-1"
        @click="emit('toggleChanges')"
        >{{
          t(
            changesVisible
              ? "pluginDevelopment.hideChanges"
              : "pluginDevelopment.showChanges",
          )
        }}</SituateButton
      >
    </SituateMenu>
  </div>
</template>
