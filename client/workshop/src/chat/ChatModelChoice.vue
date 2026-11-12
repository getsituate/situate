<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import {
  choiceGuard,
  catalog,
  currentWorkspace,
  resolvedModelId,
  eligibleModels,
  modelAction,
  modelLocked,
  saveModel,
  selectedModelName,
  type AiState,
} from "../ai/model";
import { SituateIcon, SituateButton, SituateDialog, SituateInput } from "../ui";
import { providerName } from "../ai/content";
import { modelChoiceCopy as copy, compactControlCopy } from "./content";
import { useAiState } from "../ai/use-ai-state";
import ChatDropdown from "./ChatDropdown.vue";
import ModelIssuePopup from "./ModelIssuePopup.vue";
import { modelChoiceBusy, modelIssue, type ModelRecovery } from "./model-issue";
import {
  selectedThinking,
  thinkingCapability,
  type ThinkingChoices,
  thinkingKey,
  workspaceThinking,
  resolveThinking,
  type ThinkingSelection,
} from "./thinking";
const props = withDefaults(
  defineProps<{
    state: AiState;
    thinking: ThinkingChoices;
    active?: boolean;
    locale?: "en" | "de";
  }>(),
  { active: true, locale: "en" },
);
const emit = defineEmits<{
  "update:state": [state: AiState];
  thinking: [level: ThinkingSelection];
  "focus-draft": [];
}>();
const { state, update } = useAiState(props, emit);
const id = useId();
const root = ref<HTMLElement>();
const trigger = ref<InstanceType<typeof SituateButton>>();
const modal = ref<InstanceType<typeof SituateDialog>>();
const manual = ref<InstanceType<typeof SituateInput>>();
const modelDropdown = ref<InstanceType<typeof ChatDropdown>>();
const thinkingDropdown = ref<InstanceType<typeof ChatDropdown>>();
const labels = computed(() => compactControlCopy[props.locale]);
const current = computed(() => currentWorkspace(state.value));
const name = computed(() => selectedModelName(state.value));
const guard = computed(() => choiceGuard(state.value));
const busy = computed(() => modelChoiceBusy(state.value));
const issue = computed(() => modelIssue(state.value));
const defaultConnection = computed(() =>
  current.value.defaultConnection === undefined
    ? current.value.connection
    : current.value.defaultConnection,
);
const defaultConnectionName = computed(
  () =>
    defaultConnection.value?.label ||
    (defaultConnection.value
      ? providerName(defaultConnection.value.provider)
      : copy.noAccess),
);
const defaultId = computed(() =>
  current.value.defaultModel === "recommended"
    ? eligibleModels(state.value)[0]?.id
    : current.value.defaultModel,
);
const defaultName = computed(() => {
  if (
    current.value.defaultModel === "recommended" &&
    (defaultConnection.value?.id ?? defaultConnection.value?.provider) !==
      (current.value.connection?.id ?? current.value.connection?.provider)
  )
    return copy.recommended;
  return (
    catalog.find(
      (model) =>
        model.provider === defaultConnection.value?.provider &&
        model.id === defaultId.value,
    )?.name ??
    defaultId.value ??
    copy.unavailable
  );
});
const modelSource = computed(() =>
  current.value.model.selected
    ? labels.value.explicit
    : labels.value.workspaceDefault,
);
const choiceName = computed(() => {
  const phase = current.value.model.phase;
  if (phase === "loading") return copy.loading;
  if (phase === "saving") return copy.saving;
  if (phase === "reconciling") return copy.checking;
  return resolvedModelId(state.value) ? name.value : copy.unavailable;
});
const connectionLabel = computed(() => {
  const connection = current.value.connection;
  return connection
    ? [
        ...new Set(
          [connection.label, providerName(connection.provider)].filter(Boolean),
        ),
      ].join(" · ")
    : copy.noAccess;
});
const selectionDetail = computed(() =>
  current.value.connection
    ? `${connectionLabel.value} · ${resolvedModelId(state.value) ? name.value : copy.unavailable}`
    : copy.noAccess,
);
const models = computed(() => [
  {
    id: "",
    label: labels.value.workspaceDefault,
    source: "↳",
    detail: defaultConnection.value
      ? `${current.value.defaultModel === "recommended" ? `${labels.value.recommended} · ` : ""}${defaultConnectionName.value} · ${defaultName.value}`
      : copy.noAccess,
  },
  ...eligibleModels(state.value).map((model) => ({
    id: model.id,
    label: model.name,
  })),
]);
const forcePicker = ref(false);
const pickerVisible = computed(
  () => current.value.showModelPicker || forcePicker.value,
);
const thinkingValue = computed(
  () => props.thinking[state.value.workspace][thinkingKey(state.value)] ?? "",
);
const thinkingSource = computed(() =>
  !thinkingValue.value
    ? labels.value.workspaceDefault
    : thinkingValue.value === "recommended"
      ? labels.value.recommended
      : labels.value.explicit,
);
const thinkingText = computed(() =>
  thinking.value ? labels.value[thinking.value] : "",
);
const modelDetail = computed(
  () =>
    `${modelSource.value} · ${selectionDetail.value}. ${labels.value.scope}`,
);
const thinkingDetail = computed(
  () =>
    `${thinkingSource.value} · ${thinkingText.value}. ${labels.value.scope}`,
);
const levels = computed(() => {
  const capability = thinkingCapability(state.value);
  if (!capability || capability.levels.length < 2) return [];
  const preference = workspaceThinking(state.value);
  return [
    {
      id: "",
      label: labels.value.workspaceDefault,
      source: "↳",
      detail: `${preference === "recommended" ? `${labels.value.recommended} · ` : ""}${labels.value[resolveThinking(capability, preference)]}`,
    },
    {
      id: "recommended",
      label: labels.value.recommended,
      source: "☆",
      detail: labels.value[capability.default],
    },
    ...capability.levels.map((level) => ({
      id: level,
      label: labels.value[level],
    })),
  ];
});
const thinking = computed(() => selectedThinking(state.value, props.thinking));
function pickerClosed(open: boolean) {
  if (!open && forcePicker.value) {
    forcePicker.value = false;
    void nextTick(() => emit("focus-draft"));
  }
}
let observer: ResizeObserver | undefined;
function openManual() {
  if (modelLocked(state.value)) return;
  update((next) => {
    next.dialog = "model";
    next.manualId = resolvedModelId(next) || "";
    next.manualError = "";
  });
}
function closeManual() {
  update((next) => {
    next.dialog = null;
  });
  if (forcePicker.value) pickerClosed(false);
  else
    void nextTick(() => trigger.value?.element?.focus({ preventScroll: true }));
}
function select(id: string) {
  update((next) => saveModel(next, id || null));
  void nextTick(() => emit("focus-draft"));
}
function selectThinking(level: string) {
  if (guard.value || !levels.value.some((item) => item.id === level)) return;
  emit("thinking", (level || null) as ThinkingSelection);
  void nextTick(() => emit("focus-draft"));
}
function submitManual() {
  if (!state.value.manualId.trim()) {
    update((next) => {
      next.manualError = "Enter a model ID.";
    });
    manual.value?.element?.focus();
  } else select(state.value.manualId);
}
function beforeIssue() {
  modelDropdown.value?.close();
  thinkingDropdown.value?.close();
  if (state.value.dialog === "model") {
    modal.value?.element?.close();
    update((next) => {
      next.dialog = null;
    });
  }
}
function recover(action: ModelRecovery) {
  if (action === "choose") {
    forcePicker.value = true;
    void nextTick(() =>
      current.value.model.manual ? openManual() : modelDropdown.value?.open(),
    );
    return;
  }
  update((next) => modelAction(next, action));
  void nextTick(() => emit("focus-draft"));
}
function trap(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeManual();
    return;
  }
  if (event.key !== "Tab") return;
  const nodes = [
    ...modal.value!.element!.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input",
    ),
  ];
  const first = nodes[0],
    last = nodes.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
function position() {
  const dialog = modal.value?.element;
  const area = root.value?.closest(".chat-screen")?.getBoundingClientRect();
  const anchor = trigger.value?.element?.getBoundingClientRect();
  if (!dialog?.open || !area || !anchor) return;
  dialog.style.transform = "none";
  dialog.style.maxHeight = `${Math.max(0, area.height - 24)}px`;
  dialog.style.width = `${Math.min(280, area.width - 24)}px`;
  dialog.style.left = `${Math.max(area.left + 12, Math.min(area.right - dialog.offsetWidth - 12, anchor.right - dialog.offsetWidth))}px`;
  dialog.style.top = `${Math.max(area.top + 12, Math.min(area.bottom - dialog.offsetHeight - 12, anchor.top - dialog.offsetHeight - 4))}px`;
}
function syncDialog() {
  if (
    props.active &&
    state.value.dialog === "model" &&
    current.value.model.manual
  ) {
    if (!modal.value?.element?.open) modal.value?.element?.showModal();
    position();
    manual.value?.element?.focus();
  } else modal.value?.element?.close();
}
watch(() => state.value.dialog, syncDialog, { flush: "post" });
watch(
  () => props.active,
  (active) => {
    syncDialog();
    if (!active) {
      modelDropdown.value?.close();
      thinkingDropdown.value?.close();
    }
  },
);
watch(
  () => modelLocked(state.value),
  (locked) => {
    if (locked && state.value.dialog === "model") {
      update((next) => {
        next.dialog = null;
      });
      void nextTick(() => emit("focus-draft"));
    }
  },
);
watch(
  () => state.value.manualError,
  () => nextTick(position),
);
onMounted(() => {
  syncDialog();
  observer = new ResizeObserver(position);
  const area = root.value?.closest(".chat-screen");
  if (area) observer.observe(area);
  if (modal.value?.element) observer.observe(modal.value?.element);
  window.addEventListener("resize", position);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", position);
  modal.value?.element?.close();
});
</script>

<template>
  <div ref="root" class="chat-model-choice">
    <div
      v-if="pickerVisible || issue || $slots.default"
      class="composer-meta"
      :class="{ 'picker-hidden': !pickerVisible && !issue }"
    >
      <slot />
      <div class="chat-choices" :aria-busy="busy">
        <SituateButton
          variant="plain"
          v-if="pickerVisible && current.model.manual"
          ref="trigger"
          type="button"
          class="manual-trigger"
          :aria-label="`${labels.model}: ${choiceName}. ${modelDetail}`"
          aria-haspopup="dialog"
          :aria-expanded="state.dialog === 'model'"
          :aria-controls="`${id}-manual-dialog`"
          :aria-describedby="`${id}-status`"
          :disabled="modelLocked(state)"
          :title="modelDetail"
          @click="openManual"
        >
          <small v-if="!current.model.selected" aria-hidden="true">↳</small>
          <span>{{ choiceName }}</span
          ><SituateIcon name="chevron" />
        </SituateButton>
        <ChatDropdown
          v-else-if="pickerVisible"
          ref="modelDropdown"
          class="model-trigger"
          :label="labels.model"
          :value="current.model.selected ?? ''"
          :text="choiceName"
          :title="modelDetail"
          :source="current.model.selected ? undefined : '↳'"
          :accessible-text="`${choiceName}. ${modelSource}`"
          :options="models"
          :disabled="modelLocked(state)"
          :describedby="`${id}-status`"
          @select="select"
          @update:open="pickerClosed"
        />
        <ChatDropdown
          v-if="pickerVisible && levels.length && thinking"
          ref="thinkingDropdown"
          class="thinking-trigger"
          :label="labels.thinking"
          :value="thinkingValue"
          :text="thinkingText"
          :title="thinkingDetail"
          :source="
            !thinkingValue
              ? '↳'
              : thinkingValue === 'recommended'
                ? '☆'
                : undefined
          "
          :accessible-text="`${thinkingText}. ${thinkingSource}`"
          :options="levels"
          :disabled="!!guard"
          :describedby="guard ? `${id}-status` : undefined"
          @select="selectThinking"
        />
        <ModelIssuePopup
          :issue="active ? issue : null"
          :workspace="state.workspace"
          @before-open="beforeIssue"
          @recover="recover"
          @focus-draft="active && emit('focus-draft')"
        />
      </div>
    </div>
    <span :id="`${id}-status`" class="sr-only" role="status">{{ guard }}</span>
    <SituateDialog
      appearance="plain"
      :id="`${id}-manual-dialog`"
      ref="modal"
      aria-label="Model ID"
      @cancel.prevent.stop="closeManual"
      @keydown="trap"
    >
      <form class="manual-model" novalidate @submit.prevent="submitManual">
        <div class="manual-fields">
          <SituateButton
            variant="secondary"
            size="small"
            type="button"
            @click="select('')"
          >
            {{ copy.manualDefault }}
          </SituateButton>
          <label :for="`${id}-manual`">Model ID</label
          ><SituateInput
            :id="`${id}-manual`"
            ref="manual"
            required
            autocomplete="off"
            spellcheck="false"
            :value="state.manualId"
            :aria-invalid="!!state.manualError || undefined"
            :aria-describedby="
              state.manualError ? `${id}-manual-error` : undefined
            "
            @input="
              update((next) => {
                next.manualId = ($event.target as HTMLInputElement).value;
                next.manualError = '';
              })
            "
          />
          <p v-if="state.manualError" :id="`${id}-manual-error`" role="alert">
            {{ state.manualError }}
          </p>
        </div>
        <div class="manual-actions">
          <SituateButton
            variant="secondary"
            size="small"
            type="button"
            @click="closeManual"
            >Cancel</SituateButton
          ><SituateButton variant="primary" size="small" type="submit"
            >Use model ID</SituateButton
          >
        </div>
      </form>
    </SituateDialog>
  </div>
</template>

<style scoped src="./model-choice.css"></style>
