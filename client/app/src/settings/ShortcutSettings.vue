<script setup lang="ts">
import {
  computed,
  nextTick,
  ref,
  shallowRef,
  useId,
  useTemplateRef,
} from "vue";
import { localizeError, t } from "@situate/localization";
import {
  SituateButton,
  SituateDialog,
  SituateDialogActions,
  SituateIcon,
  SituateIconButton,
  SituateInput,
} from "@situate/ui";
import ErrorDialog from "../errors/ErrorDialog.vue";
import { keyCombination, validCombination } from "../layout/shortcut-keys";
import type {
  BindingChange,
  ShortcutRow,
  WorkspaceShortcuts,
} from "../layout/workspace-shortcuts";

const { shortcuts } = defineProps<{ shortcuts: WorkspaceShortcuts }>();
const titleId = useId();
const inputId = useId();
const errorId = useId();
const search = defineModel<string>("search", { required: true });
const updated = ref(false);
const editing = shallowRef<ShortcutRow>();
const change = ref<BindingChange>();
const error = ref("");
const saveError = shallowRef<unknown>();
const revision = ref<string | null>(null);
const dialog = useTemplateRef<InstanceType<typeof SituateDialog>>("dialog");
const searchField =
  useTemplateRef<InstanceType<typeof SituateInput>>("searchField");
const recorder = useTemplateRef<InstanceType<typeof SituateInput>>("recorder");
let invoker: HTMLElement | null = null;
const groups = [
  { id: "tabs", title: () => t("shortcuts.groups.tabs") },
  { id: "panes", title: () => t("shortcuts.groups.panes") },
  { id: "chat", title: () => t("shortcuts.groups.chat") },
  { id: "plugins", title: () => t("shortcuts.groups.plugins") },
] as const;
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return groups
    .map((group) => ({
      ...group,
      rows: shortcuts.rows.value.filter(
        (row) =>
          row.group === group.id &&
          `${row.title} ${row.plugin ?? ""} ${group.title()}`
            .toLocaleLowerCase()
            .includes(query),
      ),
    }))
    .filter((group) => group.rows.length);
});
const draft = computed(() =>
  change.value?.kind === "set"
    ? change.value.keys
    : change.value?.kind === "remove"
      ? null
      : change.value?.kind === "restore"
        ? editing.value?.standard
        : editing.value?.keys,
);
const modifierLabels: Readonly<Record<string, () => string>> = {
  Control: () => t("shortcuts.keys.control"),
  Alt: () => t("shortcuts.keys.alt"),
  Shift: () => t("shortcuts.keys.shift"),
  Meta: () => t("shortcuts.keys.command"),
  Space: () => t("shortcuts.keys.space"),
  ArrowLeft: () => t("shortcuts.keys.left"),
  ArrowRight: () => t("shortcuts.keys.right"),
  ArrowUp: () => t("shortcuts.keys.up"),
  ArrowDown: () => t("shortcuts.keys.down"),
};
const arrows: Readonly<Record<string, string>> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Plus: "+",
};
const mac: Readonly<Record<string, string>> = {
  Control: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Meta: "⌘",
};
function displayKey(key: string, visual: boolean) {
  if (visual)
    return (
      (shortcuts.platform === "macos" ? mac[key] : undefined) ??
      arrows[key] ??
      spokenKey(key)
    );
  return spokenKey(key);
}
function spokenKey(key: string) {
  if (key === "Alt" && shortcuts.platform === "macos")
    return t("shortcuts.keys.option");
  const translateKey = modifierLabels[key];
  return translateKey ? translateKey() : (arrows[key] ?? key);
}
function bindingDescription(keys: string | null | undefined, visual = false) {
  return keys
    ? keys
        .split("+")
        .map((key) => displayKey(key, visual))
        .join(" + ")
    : t("shortcuts.unassigned");
}
async function edit(row: ShortcutRow, event: MouseEvent) {
  if (!shortcuts.state.snapshot || shortcuts.state.loadError) return;
  invoker = event.currentTarget as HTMLElement;
  revision.value = shortcuts.state.snapshot.revision;
  editing.value = row;
  updated.value = false;
  change.value = undefined;
  error.value = "";
  await nextTick();
  dialog.value?.element?.showModal();
  recorder.value?.focus();
}
function close() {
  if (shortcuts.state.saving) return;
  dialog.value?.element?.close();
  editing.value = undefined;
  invoker?.focus();
}
function setChange(value: BindingChange) {
  change.value = value;
  error.value = "";
}
function record(event: KeyboardEvent) {
  if (
    event.key === "Escape" ||
    event.isComposing ||
    event.getModifierState("AltGraph")
  )
    return;
  const keys = keyCombination(event);
  if (!keys && ["Tab", "Control", "Alt", "Shift", "Meta"].includes(event.key))
    return;
  event.preventDefault();
  if (keys && shortcuts.platform && validCombination(keys, shortcuts.platform))
    setChange({ kind: "set", keys });
  else error.value = t("shortcuts.invalidKey");
}
async function save() {
  const item = editing.value;
  if (!item || !change.value || error.value || shortcuts.state.saving) return;
  const conflict =
    draft.value &&
    shortcuts.rows.value.find(
      (row) => row.id !== item.id && row.keys === draft.value,
    );
  if (conflict) {
    error.value = t("shortcuts.conflict", { action: conflict.title });
    recorder.value?.focus();
    return;
  }
  try {
    await shortcuts.update(item.id, change.value, revision.value);
    close();
    updated.value = true;
  } catch (failure) {
    saveError.value = failure;
  }
}
async function dismissError() {
  saveError.value = undefined;
  await nextTick();
  recorder.value?.focus();
}
async function reload() {
  await shortcuts.load();
  const item = editing.value;
  const current = shortcuts.rows.value.find((row) => row.id === item?.id);
  if (
    item &&
    current &&
    item.keys === current.keys &&
    item.modified === current.modified &&
    !shortcuts.state.loadError
  )
    revision.value = shortcuts.state.snapshot?.revision ?? null;
}
async function clear() {
  search.value = "";
  await nextTick();
  searchField.value?.focus();
}
</script>

<template>
  <p class="sr-only" role="status">{{ updated ? t("shortcuts.saved") : "" }}</p>
  <p v-if="shortcuts.state.loading" role="status">
    {{ t("shortcuts.loading") }}
  </p>
  <template v-else-if="shortcuts.state.loadError">
    <p role="alert">{{ t("shortcuts.loadError") }}</p>
    <SituateButton variant="secondary" size="small" @click="reload">{{
      t("shortcuts.retry")
    }}</SituateButton>
  </template>
  <template v-else>
    <div class="shortcut-search">
      <SituateIcon name="search" />
      <SituateInput
        ref="searchField"
        v-model="search"
        type="search"
        maxlength="128"
        :aria-label="t('shortcuts.search')"
        :placeholder="t('shortcuts.search')"
      />
    </div>
    <section
      v-for="group in filtered"
      :key="group.id"
      class="shortcut-group"
      :aria-label="group.title()"
    >
      <h3>{{ group.title() }}</h3>
      <ul>
        <li v-for="row in group.rows" :key="row.id">
          <SituateButton
            variant="plain"
            class="shortcut-row"
            aria-haspopup="dialog"
            :aria-label="t('shortcuts.change', { action: row.title })"
            :aria-description="
              [
                bindingDescription(row.keys),
                row.modified ? t('shortcuts.modified') : '',
                row.plugin,
              ]
                .filter(Boolean)
                .join('. ')
            "
            @click="edit(row, $event)"
          >
            <span class="shortcut-name"
              ><span data-localization-content="user">{{ row.title }}</span
              ><small v-if="row.plugin" data-localization-content="user">{{
                row.plugin
              }}</small></span
            >
            <span class="shortcut-binding" aria-hidden="true">
              <small v-if="row.modified">{{ t("shortcuts.modified") }}</small>
              <template v-if="row.keys"
                ><kbd
                  v-for="(key, index) in row.keys.split('+')"
                  :key="index"
                  >{{ displayKey(key, true) }}</kbd
                ></template
              >
              <small v-else>{{ t("shortcuts.unassigned") }}</small>
            </span>
          </SituateButton>
        </li>
      </ul>
    </section>
    <p v-if="!filtered.length" role="status">{{ t("shortcuts.empty") }}</p>
    <SituateButton
      v-if="!filtered.length"
      variant="secondary"
      size="small"
      @click="clear"
      >{{ t("shortcuts.clearSearch") }}</SituateButton
    >
  </template>
  <SituateDialog
    v-if="editing"
    ref="dialog"
    :aria-labelledby="titleId"
    @cancel.prevent="close"
  >
    <template #header>
      <h2 :id="titleId">
        {{ t("shortcuts.edit", { action: editing.title }) }}
      </h2>
      <SituateIconButton
        icon="close"
        :label="t('shortcuts.close')"
        :disabled="shortcuts.state.saving"
        @click="close"
      />
    </template>
    <label :for="inputId">{{ t("shortcuts.record") }}</label>
    <SituateInput
      :id="inputId"
      ref="recorder"
      readonly
      autofocus
      :model-value="bindingDescription(draft, true)"
      :aria-invalid="!!error"
      :aria-describedby="error ? errorId : undefined"
      @keydown="record"
    />
    <p class="sr-only" role="status">{{ bindingDescription(draft) }}</p>
    <p v-if="error" :id="errorId" role="alert">{{ error }}</p>
    <div class="shortcut-draft-actions">
      <SituateButton
        variant="ghost"
        size="small"
        :disabled="shortcuts.state.saving"
        @click="setChange({ kind: 'restore' })"
        >{{ t("shortcuts.restore") }}</SituateButton
      >
      <SituateButton
        variant="ghost"
        size="small"
        :disabled="shortcuts.state.saving"
        @click="setChange({ kind: 'remove' })"
        >{{ t("shortcuts.remove") }}</SituateButton
      >
      <SituateButton
        v-if="
          revision !== shortcuts.state.snapshot?.revision ||
          shortcuts.state.loadError
        "
        variant="ghost"
        size="small"
        @click="reload"
        >{{ t("shortcuts.retry") }}</SituateButton
      >
    </div>
    <SituateDialogActions>
      <SituateButton
        variant="secondary"
        size="small"
        :disabled="shortcuts.state.saving"
        @click="close"
        >{{ t("shortcuts.cancel") }}</SituateButton
      >
      <SituateButton
        size="small"
        :disabled="!change || shortcuts.state.saving"
        @click="save"
        >{{ t("shortcuts.save") }}</SituateButton
      >
    </SituateDialogActions>
  </SituateDialog>
  <ErrorDialog
    :open="!!saveError"
    :message="localizeError(saveError)"
    @dismiss="dismissError"
  />
</template>

<style scoped>
.shortcut-search {
  position: relative;
}
.shortcut-search > svg {
  position: absolute;
  inset-inline-start: 12px;
  inset-block-start: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  color: var(--situate-muted);
  pointer-events: none;
}
.shortcut-search :deep(input) {
  padding-block: var(--situate-space-2);
  padding-inline-start: 38px;
  background: var(--situate-paper);
  font-size: var(--situate-text-small);
}
.shortcut-group {
  margin-top: var(--situate-space-6);
}
.shortcut-group ul {
  list-style: none;
  margin: var(--situate-space-1-5) 0 0;
  padding: 0;
}
.shortcut-group li + li {
  border-top: 1px solid var(--situate-line);
}
.shortcut-row {
  width: 100%;
  min-height: var(--situate-target-min);
  background: transparent;
  border: 0;
  border-radius: var(--situate-radius-control);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--situate-space-1-5) var(--situate-space-4);
  padding: var(--situate-space-2);
  text-align: start;
  font: inherit;
  font-size: var(--situate-text-small);
  color: var(--situate-ink);
}
@media (hover: hover) {
  .shortcut-row:hover {
    background: var(--situate-paper);
  }
}
.shortcut-name {
  flex: 1 1 auto;
  font-weight: 600;
}
.shortcut-name small {
  display: block;
  font-weight: 400;
}
.shortcut-binding {
  display: flex;
  gap: var(--situate-space-1);
  flex-wrap: wrap;
  align-items: center;
  margin-inline-start: auto;
}
.shortcut-binding small {
  margin-inline-end: var(--situate-space-2);
}
.shortcut-name small,
.shortcut-binding small {
  color: var(--situate-muted);
}
.shortcut-binding kbd {
  display: inline-grid;
  min-inline-size: 24px;
  min-block-size: 24px;
  place-items: center;
  padding: 1px 5px;
  border: 1px solid var(--situate-line);
  border-radius: 5px;
  background: var(--situate-paper);
  font: inherit;
}
label {
  display: block;
  margin-bottom: var(--situate-space-2);
}
.shortcut-draft-actions {
  display: flex;
  gap: var(--situate-space-1);
  flex-wrap: wrap;
  margin: var(--situate-space-1-5) 0 var(--situate-space-3);
}
.shortcut-draft-actions button {
  text-decoration: underline;
  text-underline-offset: 4px;
}
</style>
