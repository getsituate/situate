<script setup lang="ts">
import { computed, useTemplateRef, ref, useId } from "vue";
import { SituateButton, SituateIcon, SituateMenu } from "@situate/ui";
import { t } from "@situate/localization";

withDefaults(
  defineProps<{
    label: string;
    surface?: boolean;
    includeLayout?: boolean;
    canReopen?: boolean;
    bulk?: boolean;
    canCloseOthers?: boolean;
  }>(),
  { includeLayout: true },
);
const emit = defineEmits<{
  rename: [trigger: HTMLButtonElement];
  close: [];
  closeAll: [];
  closeOthers: [];
  layout: [trigger: HTMLButtonElement];
  create: [];
  reopen: [];
}>();
const triggerControl =
  useTemplateRef<InstanceType<typeof SituateButton>>("triggerControl");
const trigger = computed(() => triggerControl.value?.element);
const expanded = ref(false);
const initialFocus = ref<"first" | "last">("first");
const id = useId();
function dismiss(restore = true) {
  expanded.value = false;
  if (restore) trigger.value?.focus({ preventScroll: true });
}
function show(last = false) {
  initialFocus.value = last ? "last" : "first";
  expanded.value = true;
}
function toggle() {
  if (expanded.value) dismiss();
  else void show();
}
function rename() {
  dismiss(false);
  if (trigger.value) emit("rename", trigger.value);
}
function layout() {
  dismiss(false);
  if (trigger.value) emit("layout", trigger.value);
}
function create() {
  dismiss(false);
  emit("create");
}
function closeTab() {
  dismiss(false);
  emit("close");
}
function back(): boolean {
  if (!expanded.value) return false;
  dismiss();
  return true;
}
defineExpose({ back });
</script>

<template>
  <div class="tab-actions">
    <SituateButton
      variant="plain"
      ref="triggerControl"
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
      :anchor="trigger"
      :initial-focus="initialFocus"
      :label="label"
      class="tab-action-menu"
      @close="dismiss(false)"
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
          {{ t("layoutUi.paneOptions") }}
        </SituateButton>
        <div v-if="includeLayout" role="separator" class="action-separator" />
        <SituateButton
          variant="plain"
          type="button"
          role="menuitem"
          tabindex="-1"
          @click="create"
        >
          {{ t("layoutUi.newTab") }}
        </SituateButton>
      </template>
      <SituateButton
        variant="plain"
        type="button"
        role="menuitem"
        tabindex="-1"
        @click="rename"
      >
        {{ surface ? t("layoutUi.rename") : t("layoutUi.renameAction") }}
      </SituateButton>
      <SituateButton
        variant="plain"
        v-if="!bulk || surface"
        type="button"
        role="menuitem"
        tabindex="-1"
        @click="closeTab"
      >
        {{ t("layoutUi.closeTab") }}
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
          {{ t("layoutUi.closeOtherTabs") }}
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
          {{ t("layoutUi.closeAllTabs") }}
        </SituateButton>
      </template>
      <SituateButton
        variant="plain"
        v-if="canReopen"
        type="button"
        role="menuitem"
        tabindex="-1"
        @click="
          dismiss(false);
          emit('reopen');
        "
      >
        {{ t("layoutUi.reopenTab") }}
      </SituateButton>
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
.action-separator {
  height: 1px;
  margin: 4px 8px;
  background: var(--situate-line);
}
.tab-action-menu button {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  text-align: start;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 14px;
}
.tab-action-menu button:disabled {
  color: var(--situate-muted);
  opacity: 0.5;
}
.tab-action-menu button:hover:not(:disabled),
.tab-action-menu
  button:focus:where(html:not([data-input-modality="pointer"]) *) {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  background: var(--situate-accent-soft, var(--situate-lilac));
  outline-offset: var(--situate-focus-offset);
}
</style>
