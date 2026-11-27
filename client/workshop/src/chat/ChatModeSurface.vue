<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  ref,
  shallowRef,
  watchPostEffect,
} from "vue";
import ChatCornerActions from "../plugins/ChatCornerActions.vue";
import PluginDevelopment from "../plugins/PluginDevelopment.vue";
import {
  clonePluginState,
  createPluginState,
  currentDevelopment,
  startPluginDevelopment,
  switchChatMode,
  type PluginState,
} from "../plugins/model";
import { developmentTranscript } from "../plugins/development-transcript";
import type { Event } from "./model";
import { chatModeSessions } from "./mode-sessions";

const props = defineProps<{
  title: string;
  sessionKey?: string;
  startsInDevelopment?: boolean;
  draft?: string;
  working?: boolean;
  empty?: boolean;
  fixedMode?: boolean;
  closeLabel?: string;
  navigationOpen?: boolean;
  events?: Event[];
  contentSelector: string;
}>();
defineSlots<{
  default(props: { developmentEvents: Event[] }): unknown;
  navigation?(): unknown;
  actions?(): unknown;
}>();
const emit = defineEmits<{ draft: [draft: string]; close: [] }>();
const sessions = inject(chatModeSessions);
const local = shallowRef<PluginState>();
const state = computed({
  get: () =>
    sessions && props.sessionKey ? sessions.get(props.sessionKey) : local.value,
  set: (next: PluginState | undefined) => {
    if (sessions && props.sessionKey && next)
      sessions.set(props.sessionKey, next);
    else local.value = next;
  },
});
function createDevelopment() {
  const next = createPluginState("plugins-empty");
  startPluginDevelopment(next, "");
  const current = currentDevelopment(next)!;
  current.title = props.title;
  current.draft = props.draft ?? "";
  current.filesOpen = false;
  switchChatMode(next, "development");
  return next;
}
if (props.startsInDevelopment && !state.value)
  state.value = createDevelopment();
const development = computed(
  () => state.value && currentDevelopment(state.value),
);
const developing = computed(
  () => development.value?.modeSwitch?.active === "development",
);
const developmentEvents = computed(() =>
  development.value ? developmentTranscript(development.value) : [],
);
const root = ref<HTMLElement>();
const body = ref<HTMLElement>();
const navigation = ref<HTMLElement>();
const actions = ref<InstanceType<typeof ChatCornerActions>>();
const developmentView = ref<InstanceType<typeof PluginDevelopment>>();
const clearance = ref(0);
function focus() {
  if (developing.value) developmentView.value?.focusTitle();
  else if (actions.value?.focus()) return;
  else body.value?.focus({ preventScroll: true });
}
defineExpose({ focus });
async function enterDevelopment() {
  if (props.fixedMode || props.working) return;
  const next = state.value
    ? clonePluginState(state.value)
    : createDevelopment();
  const current = currentDevelopment(next)!;
  current.title = props.title;
  current.draft = props.draft ?? "";
  switchChatMode(next, "development");
  state.value = next;
  await nextTick();
  focus();
}
function updateDevelopment(next: PluginState) {
  const wasDeveloping = developing.value;
  const before = development.value?.draft;
  state.value = next;
  const draft = currentDevelopment(next)!.draft;
  if (draft !== before && draft !== props.draft) emit("draft", draft);
  if (wasDeveloping && !developing.value) void nextTick(focus);
}
watchPostEffect((cleanup) => {
  const frame = root.value;
  const panel = body.value;
  const bars = [actions.value?.element, navigation.value].filter(
    (node): node is HTMLElement => !!node,
  );
  const empty = props.empty && !developmentEvents.value.length;
  const selector = props.contentSelector;
  if (developing.value || !frame || !panel || !bars.length) return;
  const measure = () => {
    const target = panel.querySelector<HTMLElement>(selector);
    if (!target || !frame.offsetWidth) {
      clearance.value = 0;
      return;
    }
    const view = frame.getBoundingClientRect();
    const scale = view.width / frame.offsetWidth;
    const text = target.getBoundingClientRect();
    const padding = getComputedStyle(target);
    const left = text.left + parseFloat(padding.paddingLeft) * scale;
    const right = text.right - parseFloat(padding.paddingRight) * scale;
    let next = 0;
    for (const bar of bars) {
      if (!bar.offsetHeight) continue;
      const tools = bar.getBoundingClientRect();
      if (
        tools.left < right + 8 * scale &&
        tools.right > left - 8 * scale &&
        (!empty ||
          text.top - clearance.value * scale < tools.bottom + 8 * scale)
      )
        next = Math.max(next, bar.offsetTop + bar.offsetHeight + 8);
    }
    clearance.value = next;
  };
  const resize = new ResizeObserver(measure);
  for (const element of [frame, panel, ...bars]) resize.observe(element);
  const content = new MutationObserver(measure);
  content.observe(panel, { childList: true, subtree: true });
  measure();
  cleanup(() => {
    resize.disconnect();
    content.disconnect();
  });
});
</script>

<template>
  <div ref="root" class="chat-mode-surface">
    <div
      v-if="$slots.navigation && !developing"
      ref="navigation"
      class="corner-navigation"
    >
      <slot name="navigation" />
    </div>
    <ChatCornerActions
      v-if="!developing"
      ref="actions"
      mode="chat"
      :working="working"
      :fixed-mode="fixedMode"
      :close-label="closeLabel"
      @change-mode="enterDevelopment"
      @close="emit('close')"
      ><slot name="actions"
    /></ChatCornerActions>
    <div
      v-show="!developing"
      ref="body"
      class="chat-mode-body"
      tabindex="-1"
      :style="{ '--corner-clearance': `${clearance}px` }"
    >
      <slot :development-events="developmentEvents" />
    </div>
    <PluginDevelopment
      v-if="developing && state"
      ref="developmentView"
      :state="state"
      :title="title"
      :context-events="events"
      :close-label="closeLabel"
      :navigation-open="navigationOpen"
      embedded
      @update:state="updateDevelopment"
      @close="emit('close')"
    >
      <template v-if="$slots.navigation" #corner-navigation
        ><slot name="navigation"
      /></template>
      <template v-if="$slots.actions" #corner-actions
        ><slot name="actions"
      /></template>
    </PluginDevelopment>
  </div>
</template>

<style scoped>
.chat-mode-surface {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.chat-mode-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  padding-block-start: var(--corner-clearance);
}
.chat-mode-surface > .chat-corner-actions,
.corner-navigation {
  position: absolute;
  z-index: 2;
  inset-block-start: 8px;
}
.chat-mode-surface > .chat-corner-actions {
  inset-inline-end: 8px;
}
.corner-navigation {
  inset-inline-start: 8px;
}
</style>
