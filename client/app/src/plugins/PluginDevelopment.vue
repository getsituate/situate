<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
  watch,
} from "vue";
import { t } from "@situate/localization";
import { SituateIconButton } from "@situate/ui";
import type { ToolActivity } from "../components/chat/transcript";
import type { PresentationValue } from "../layout/navigation";
import ChatActions from "../components/chat/ChatActions.vue";
import { vChatCornerClearance } from "../components/chat/corner-clearance";
import DevelopmentHelpDialog from "./DevelopmentHelpDialog.vue";
import AssignmentChanges from "./AssignmentChanges.vue";
import {
  restoreChangesNavigation,
  type AssignmentChangesState,
  type ChangesNavigation,
} from "./assignment-changes";
import {
  recordedAssignmentChanges,
  loadRecordedChange,
  observedAssignmentHistories,
  loadObservedHistory,
  type ObservedAssignmentChanges,
  type RecordedChange,
} from "./assignment-history";
const props = withDefaults(
  defineProps<{
    title: string;
    scope: string;
    conversation?: string;
    activity?: readonly ToolActivity[];
    presentation?: PresentationValue;
    failed?: boolean;
    canSwitch?: boolean;
    modeUnavailable?: string;
  }>(),
  { activity: () => [] },
);
const emit = defineEmits<{
  covered: [value: boolean];
  presentation: [value: PresentationValue];
  changeMode: [];
}>();
const saved: Record<string, PresentationValue> =
  props.presentation &&
  typeof props.presentation === "object" &&
  !Array.isArray(props.presentation)
    ? (props.presentation as Record<string, PresentationValue>)
    : {};
const id = useId();
const root = ref<HTMLElement>();
const actions = ref<InstanceType<typeof ChatActions>>();
const changesView = ref<InstanceType<typeof AssignmentChanges>>();
const changesOpen = ref(saved.open === true);
const expanded = ref(saved.expanded === true);
const panel = ref<"chat" | "changes">(
  saved.panel === "changes" ? "changes" : "chat",
);
const navigation = ref(restoreChangesNavigation(saved.navigation));
const narrow = ref(false);
const helpOpen = ref(false);
const helpStyle = ref<Record<string, string>>({});
const visible = computed(() =>
  narrow.value ? panel.value === "changes" : changesOpen.value,
);
const recorded = computed(() => recordedAssignmentChanges(props.activity));
const histories = computed(() => observedAssignmentHistories(props.activity));
const observations = shallowRef(new Map<string, ObservedAssignmentChanges>());
const historyLoading = new Set<string>();
const known = computed(() => [
  ...recorded.value,
  ...[...observations.value.values()].flatMap((value) => value.changes),
]);
const cache = shallowRef(new Map<string, RecordedChange>());
const loading = new Set<string>();
let alive = true;
let generation = 0;
const state = computed<AssignmentChangesState>(() => ({
  status:
    known.value.length > 4096 ||
    [...observations.value.values()].some(
      (value) => value.status === "unavailable",
    )
      ? "unavailable"
      : [...observations.value.values()].some(
            (value) => value.status === "error",
          )
        ? "error"
        : histories.value.some((history) => !observations.value.has(history.id))
          ? "loading"
          : "ready",
  changes: known.value.map((change) => cache.value.get(change.id) ?? change),
}));
function publish() {
  emit("presentation", {
    open: changesOpen.value,
    expanded: expanded.value,
    panel: panel.value,
    navigation: {
      ...navigation.value,
      revealed: { ...navigation.value.revealed },
    },
  });
}
function setPanel(value: "chat" | "changes") {
  if (panel.value !== value) {
    panel.value = value;
    publish();
  }
}
function navigate(value: ChangesNavigation) {
  navigation.value = value;
  publish();
}
async function loadObservations(force = false) {
  const current = generation;
  for (const history of histories.value) {
    if (
      !alive ||
      current !== generation ||
      !changesOpen.value ||
      known.value.length > 4096
    )
      return;
    if (
      historyLoading.has(history.id) ||
      (!force && observations.value.has(history.id))
    )
      continue;
    historyLoading.add(history.id);
    try {
      const loaded = await loadObservedHistory(props.scope, history);
      if (!alive || current !== generation) return;
      const next = new Map(observations.value);
      next.set(history.id, loaded);
      observations.value = next;
    } finally {
      if (current === generation) historyLoading.delete(history.id);
    }
  }
}
function retry() {
  void loadObservations(true);
  void loadSelected(true);
}
async function loadSelected(force = false) {
  const selected = navigation.value.selected;
  const change = known.value.find((change) => change.id === selected);
  if (
    !change ||
    (change.before?.status !== "loading" &&
      change.after?.status !== "loading" &&
      !force) ||
    (!force && cache.value.has(selected)) ||
    loading.has(selected)
  )
    return;
  const current = generation;
  loading.add(selected);
  try {
    const loaded = await loadRecordedChange(props.scope, change);
    if (!alive || current !== generation) return;
    const next = new Map(cache.value);
    next.set(selected, loaded);
    while (next.size > 8) {
      const key = [...next.keys()].find(
        (key) => key !== navigation.value.selected,
      );
      if (key) next.delete(key);
      else break;
    }
    cache.value = next;
  } finally {
    if (current === generation) loading.delete(selected);
  }
}
watch(
  [known, () => navigation.value.selected, changesOpen],
  () => {
    if (changesOpen.value) void loadSelected();
  },
  { immediate: true },
);
watch(
  [histories, changesOpen],
  () => {
    if (changesOpen.value) void loadObservations();
  },
  { immediate: true },
);
watch(
  () => props.scope,
  () => {
    generation++;
    cache.value = new Map();
    observations.value = new Map();
    historyLoading.clear();
    loading.clear();
  },
);
watch(
  () =>
    helpOpen.value ||
    (narrow.value && visible.value) ||
    (changesOpen.value && expanded.value),
  (value) => emit("covered", value),
  { immediate: true },
);
let observer: ResizeObserver | undefined;
function placeHelp() {
  const box = root.value?.getBoundingClientRect();
  if (!box || !root.value?.offsetWidth) return;
  const scale = box.width / root.value.offsetWidth;
  helpStyle.value = {
    transform: "translate(-50%, -50%)",
    left: `${(box.left + box.width / 2) / scale}px`,
    top: `${(box.top + box.height / 2) / scale}px`,
    width: `${Math.min(520, box.width / scale - 32)}px`,
    maxHeight: `${Math.max(0, box.height / scale - 32)}px`,
  };
}
function openHelp(event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus();
  placeHelp();
  helpOpen.value = true;
}
function helpKeyboard(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const targets = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button, [tabindex="0"]',
    ),
  ];
  const first = targets[0],
    last = targets.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
async function showChanges() {
  changesOpen.value = true;
  panel.value = "changes";
  publish();
  await nextTick();
  changesView.value?.focusTitle();
}
async function closeChanges() {
  changesOpen.value = false;
  panel.value = "chat";
  publish();
  await nextTick();
  actions.value?.focus();
}
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(([entry]) => {
      narrow.value = entry.contentRect.width <= 840;
      if (helpOpen.value) placeHelp();
    });
    observer.observe(root.value!);
  }
});
onBeforeUnmount(() => {
  alive = false;
  generation++;
  observer?.disconnect();
});
defineExpose({ focusTitle: () => actions.value?.focus() });
</script>
<template>
  <div
    ref="root"
    class="plugin-development"
    :class="{ failed }"
    :aria-label="title"
  >
    <div
      v-chat-corner-clearance="true"
      class="development-layout"
      :data-changes-only="
        !failed && visible && (narrow || expanded) ? '' : undefined
      "
      :class="{
        'changes-open': changesOpen,
        'changes-expanded': changesOpen && expanded && !narrow,
        'show-changes': panel === 'changes',
      }"
    >
      <div class="chat-corners">
        <div class="chat-corner-start">
          <slot name="navigation" />
          <span class="development-mode-label" role="status">{{
            t("pluginDevelopment.context")
          }}</span>
          <SituateIconButton
            class="development-help-trigger"
            icon="info"
            :label="t('pluginDevelopment.help')"
            aria-haspopup="dialog"
            :aria-expanded="helpOpen"
            :aria-controls="helpOpen ? `${id}-help` : undefined"
            @click="openHelp"
          />
        </div>
        <ChatActions
          v-if="!failed"
          ref="actions"
          development
          :can-switch="!!canSwitch"
          :mode-unavailable="modeUnavailable"
          :changes-visible="visible"
          @change-mode="emit('changeMode')"
          @toggle-changes="visible ? closeChanges() : showChanges()"
        />
      </div>
      <section
        class="plugin-conversation"
        :aria-label="t('pluginDevelopment.chat')"
        @focusin="setPanel('chat')"
      >
        <slot
          :covered="
            helpOpen || (narrow && visible) || (changesOpen && expanded)
          "
        />
      </section>
      <aside
        :id="`${id}-changes`"
        class="development-changes"
        :aria-label="t('assignmentChanges.title')"
        @focusin="setPanel('changes')"
        @keydown.esc.stop.prevent="closeChanges"
      >
        <AssignmentChanges
          ref="changesView"
          :state="state"
          :navigation="navigation"
          :expanded="expanded"
          :allow-expand="!narrow"
          @navigate="navigate"
          @retry="retry"
          @expand="
            expanded = $event;
            publish();
          "
        />
      </aside>
    </div>
    <DevelopmentHelpDialog
      v-if="helpOpen"
      :id="`${id}-help`"
      class="development-help"
      :style="helpStyle"
      :title="t('pluginDevelopment.help')"
      focus-close
      @close="helpOpen = false"
      @keydown="helpKeyboard"
    >
      <div
        class="development-help-body"
        tabindex="0"
        role="region"
        :aria-label="t('pluginDevelopment.help')"
      >
        <p>{{ t("pluginDevelopment.helpIntro") }}</p>
        <p>{{ t("pluginDevelopment.helpLeaving") }}</p>
        <h3>{{ t("pluginDevelopment.helpDraft") }}</h3>
        <p>{{ t("pluginDevelopment.helpScope") }}</p>
        <p>{{ t("pluginDevelopment.helpSafety") }}</p>
      </div>
    </DevelopmentHelpDialog>
  </div>
</template>
<style scoped>
.plugin-development {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  container: development / inline-size;
  background: color-mix(
    in srgb,
    var(--situate-accent-soft, var(--situate-lilac)) 45%,
    var(--situate-surface)
  );
}
.development-layout {
  --changes-width: clamp(320px, 34%, 440px);
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.development-layout.changes-open {
  grid-template-columns: minmax(0, 1fr) var(--changes-width);
}
.chat-corners {
  position: absolute;
  z-index: 2;
  inset-block-start: 8px;
  inset-inline: 8px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 4px;
  pointer-events: none;
}
.chat-corners > * {
  pointer-events: auto;
}
.chat-corners > .chat-corner-actions {
  flex-shrink: 0;
}
.changes-open:not(.changes-expanded) .chat-corners {
  inset-inline-end: calc(var(--changes-width) + 8px);
}
.chat-corner-start {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.development-mode-label {
  padding-inline-start: 8px;
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
  font-weight: 400;
  overflow-wrap: anywhere;
}
.development-layout.changes-expanded {
  grid-template-columns: minmax(0, 1fr);
}
.plugin-conversation {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.development-changes {
  display: none;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-inline-start: 1px solid var(--situate-line);
  background: var(--situate-surface);
}
.changes-open .development-changes {
  display: flex;
}
[data-changes-only] > .development-changes {
  padding-block-start: var(--chat-corner-clearance, 0px);
}
.changes-expanded .plugin-conversation {
  display: none;
}
.development-help {
  position: fixed;
  inset: auto;
  margin: 0;
}
.development-help-trigger :deep(svg) {
  width: 18px;
  height: 18px;
}
.development-help :deep(header) {
  position: sticky;
  top: -24px;
  background: var(--situate-surface);
  padding-block: 8px;
}
:is(button, [tabindex]):focus:where(
    html:not([data-input-modality="pointer"]) *
  ) {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@container development (max-width:840px) {
  .development-layout.changes-open {
    grid-template-columns: minmax(0, 1fr);
  }
  .changes-open:not(.changes-expanded) .chat-corners {
    inset-inline-end: 8px;
  }
  .development-changes,
  .changes-open .development-changes {
    display: none;
    border: 0;
  }
  .show-changes .development-changes {
    display: flex;
  }
  .show-changes .plugin-conversation {
    display: none;
  }
}
.failed .development-layout {
  grid-template-columns: minmax(0, 1fr);
}
.failed .chat-corners {
  inset-inline-end: 8px;
}
.failed .development-changes {
  display: none;
}
.failed .plugin-conversation {
  display: flex;
}
</style>
