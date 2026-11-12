<script setup lang="ts">
import { SituateButton } from "../ui";
import { ref, useId, useTemplateRef, watch } from "vue";
import SituateMenu from "../ui/SituateMenu.vue";
import type { Workspace } from "./api";
const props = defineProps<{
  workspace: Workspace;
  open: boolean;
  listed: boolean;
  current: boolean;
  busy: boolean;
  mobile?: boolean;
}>();
const emit = defineEmits<{ open: []; close: []; remove: [] }>();
const expanded = ref(false);
const trigger = useTemplateRef<InstanceType<typeof SituateButton>>("trigger");
const menuId = useId();
const initialFocus = ref<"first" | "last">("first");
function show(last = false) {
  if (props.busy) return;
  initialFocus.value = last ? "last" : "first";
  expanded.value = true;
}
function dismiss() {
  expanded.value = false;
}
watch(
  () => props.busy,
  (busy) => {
    if (busy) dismiss();
  },
);
function choose(action: "remove" | "close"): void {
  dismiss();
  if (action === "remove") emit("remove");
  else emit("close");
}
defineExpose({ focus: () => trigger.value?.element?.focus(), dismiss });
</script>

<template>
  <li class="workspace-row" @keydown.esc.stop.prevent="dismiss()">
    <SituateButton
      variant="plain"
      type="button"
      class="workspace-select"
      :disabled="busy"
      @click="emit('open')"
    >
      <strong>{{ props.workspace.name }}</strong
      ><span class="location">{{ workspace.display }}</span>
      <span v-if="open" class="workspace-state">{{
        current ? "Current" : mobile ? "Open" : "Open · Bring to front"
      }}</span>
    </SituateButton>
    <div class="workspace-row-actions">
      <SituateButton
        variant="plain"
        ref="trigger"
        type="button"
        class="row-actions"
        :aria-label="'Actions for ' + workspace.name"
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
        :anchor="trigger?.element"
        :label="'Actions for ' + workspace.name"
        :initial-focus="initialFocus"
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
          Close workspace
        </SituateButton>
        <SituateButton
          variant="plain"
          v-if="listed"
          role="menuitem"
          type="button"
          tabindex="-1"
          @click="choose('remove')"
        >
          Remove from list
        </SituateButton>
      </SituateMenu>
    </div>
  </li>
</template>
