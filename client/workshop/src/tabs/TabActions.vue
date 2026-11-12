<script setup lang="ts">
import { ref, useId } from "vue";
import SituateMenu from "../ui/SituateMenu.vue";
import { SituateIcon, SituateButton } from "../ui";
import copy from "../localization/en.tabs.json";

withDefaults(
  defineProps<{
    label: string;
    surface?: boolean;
    includeLayout?: boolean;
    bulk?: boolean;
    canCloseOthers?: boolean;
  }>(),
  { includeLayout: true },
);
const emit = defineEmits<{
  rename: [trigger: HTMLButtonElement];
  close: [];
  closeOthers: [];
  closeAll: [];
  layout: [trigger: HTMLButtonElement];
  create: [];
}>();
const trigger = ref<InstanceType<typeof SituateButton>>();
const expanded = ref(false);
const initialFocus = ref<"first" | "last">("first");
const id = useId();
function dismiss(restore = true) {
  expanded.value = false;
  if (restore) trigger.value?.element?.focus({ preventScroll: true });
}
function show(last = false) {
  initialFocus.value = last ? "last" : "first";
  expanded.value = true;
}
function toggle() {
  if (expanded.value) dismiss();
  else show();
}
function rename() {
  dismiss(false);
  if (trigger.value?.element) emit("rename", trigger.value?.element);
}
function layout() {
  dismiss(false);
  if (trigger.value?.element) emit("layout", trigger.value?.element);
}
function create() {
  dismiss(false);
  emit("create");
}
function closeTab() {
  dismiss(false);
  emit("close");
}
</script>

<template>
  <div class="tab-actions">
    <SituateButton
      variant="plain"
      ref="trigger"
      type="button"
      class="tab-actions-trigger"
      :aria-label="label"
      :title="label"
      aria-haspopup="menu"
      :aria-expanded="expanded"
      :aria-controls="expanded ? id : undefined"
      :popovertarget="id"
      @click.prevent="toggle"
      @keydown.down.prevent="show()"
      @keydown.up.prevent="show(true)"
    >
      <SituateIcon name="more" />
    </SituateButton>
    <SituateMenu
      :id="id"
      :open="expanded"
      :anchor="trigger?.element"
      :label="label"
      :initial-focus="initialFocus"
      class="tab-action-menu"
      @close="expanded = false"
    >
      <template v-if="surface">
        <SituateButton
          variant="plain"
          v-if="includeLayout"
          type="button"
          role="menuitem"
          tabindex="-1"
          @click="layout"
        >
          {{ copy.paneOptions }}
        </SituateButton>
        <div v-if="includeLayout" role="separator" class="action-separator" />
        <SituateButton
          variant="plain"
          type="button"
          role="menuitem"
          tabindex="-1"
          @click="create"
        >
          {{ copy.newTab }}
        </SituateButton>
      </template>
      <SituateButton
        variant="plain"
        type="button"
        role="menuitem"
        tabindex="-1"
        @click="rename"
      >
        {{ surface ? copy.rename : copy.renameAction }}
      </SituateButton>
      <SituateButton
        variant="plain"
        v-if="!bulk || surface"
        type="button"
        role="menuitem"
        tabindex="-1"
        @click="closeTab"
      >
        {{ copy.closeTab }}
      </SituateButton>
      <template v-if="bulk">
        <SituateButton
          variant="plain"
          type="button"
          role="menuitem"
          tabindex="-1"
          :disabled="!canCloseOthers"
          @click="
            dismiss(false);
            emit('closeOthers');
          "
        >
          {{ copy.closeOtherTabs }}
        </SituateButton>
        <SituateButton
          variant="plain"
          type="button"
          role="menuitem"
          tabindex="-1"
          @click="
            dismiss(false);
            emit('closeAll');
          "
        >
          {{ copy.closeAllTabs }}
        </SituateButton>
      </template>
    </SituateMenu>
  </div>
</template>

<style scoped>
.tab-actions {
  position: relative;
  flex: 0 0 44px;
}
.tab-actions-trigger {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 10px;
  padding: 12px;
  color: var(--situate-muted);
  background: transparent;
}
.tab-actions-trigger:hover,
.tab-actions-trigger[aria-expanded="true"] {
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-ink);
}
.tab-action-menu {
  width: 180px;
}
</style>
