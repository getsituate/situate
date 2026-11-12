<script setup lang="ts">
import { SituateButton, SituateMenu } from "@situate/ui";
import { t, localizeProvidedText } from "@situate/localization";
import { computed, ref, useId, useTemplateRef } from "vue";
import { displayWorkspaceName, type Workspace } from "./api";
const props = defineProps<{
  workspace: Workspace;
  open: boolean;
  listed: boolean;
  current: boolean;
  busy: boolean;
  mobile?: boolean;
}>();
const emit = defineEmits<{
  open: [event: MouseEvent];
  close: [];
  remove: [];
}>();
const expanded = ref(false);
const triggerControl =
  useTemplateRef<InstanceType<typeof SituateButton>>("triggerControl");
const trigger = computed(() => triggerControl.value?.element);
const menuId = useId();
const initialFocus = ref<"first" | "last">("first");
function show(last = false): void {
  if (props.busy) return;
  initialFocus.value = last ? "last" : "first";
  expanded.value = true;
}
function dismiss(): void {
  expanded.value = false;
}
function choose(action: "remove" | "close"): void {
  dismiss();
  if (action === "remove") emit("remove");
  else emit("close");
}
defineExpose({
  focus: () => trigger.value?.focus(),
  dismiss,
  back: () => {
    if (!expanded.value) return false;
    dismiss();
    return true;
  },
});
</script>

<template>
  <li class="workspace-row">
    <SituateButton
      variant="plain"
      type="button"
      class="workspace-select"
      :disabled="busy"
      @click="emit('open', $event)"
    >
      <strong data-localization-content="user">{{
        displayWorkspaceName(props.workspace)
      }}</strong
      ><span class="location" data-localization-content="user">{{
        localizeProvidedText(workspace.display)
      }}</span>
      <span v-if="open" class="workspace-state">{{
        current
          ? t("workspace.current")
          : mobile
            ? t("workspace.open")
            : t("workspace.openBringToFront")
      }}</span>
    </SituateButton>
    <div class="workspace-row-actions">
      <SituateButton
        variant="plain"
        ref="triggerControl"
        type="button"
        class="row-actions"
        :aria-label="
          t('workspace.actionsFor', { name: displayWorkspaceName(workspace) })
        "
        aria-haspopup="menu"
        :aria-expanded="expanded"
        :aria-controls="menuId"
        :disabled="busy"
        :popovertarget="menuId"
        @click.prevent="expanded ? dismiss() : show()"
        @keydown.down.prevent="show()"
        @keydown.up.prevent="show(true)"
      >
        ⋯
      </SituateButton>
      <SituateMenu
        :id="menuId"
        :open="expanded"
        :anchor="trigger"
        :initial-focus="initialFocus"
        :label="
          t('workspace.actionsFor', { name: displayWorkspaceName(workspace) })
        "
        class="workspace-action-menu"
        @close="dismiss"
      >
        <SituateButton
          variant="plain"
          v-if="open"
          role="menuitem"
          type="button"
          tabindex="-1"
          @click="choose('close')"
        >
          {{ t("workspace.closeWorkspace") }}
        </SituateButton>
        <SituateButton
          variant="plain"
          v-if="listed"
          role="menuitem"
          type="button"
          tabindex="-1"
          @click="choose('remove')"
        >
          {{ t("workspace.removeFromList") }}
        </SituateButton>
      </SituateMenu>
    </div>
  </li>
</template>
