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
import { SituateButton, SituateIconButton, SituateDialog } from "../ui";
import NavigationComposer from "./NavigationComposer.vue";
import ChatPaneHeader from "../components/ChatPaneHeader.vue";
import NavigationDashboard from "./NavigationDashboard.vue";
import NavigationGreeting from "./NavigationGreeting.vue";
import {
  addChat,
  closeTab,
  selectTab,
  toggleTask,
  updateDraft,
  type NavigationState,
  type ViewId,
} from "./model";
import { useNavigationState } from "./use-navigation-state";
const props = withDefaults(
  defineProps<{
    state: NavigationState;
    navigationId?: string;
    navigationOpen?: boolean;
    showNavigation?: boolean;
  }>(),
  { navigationOpen: false, showNavigation: true },
);
const emit = defineEmits<{
  "update:state": [state: NavigationState];
  openNavigation: [event: MouseEvent];
}>();
const { state, update } = useNavigationState(
  () => props.state,
  (value) => emit("update:state", value),
);
const id = useId();
const root = ref<HTMLElement>();
const dialog = ref<InstanceType<typeof SituateDialog>>();
const keep = ref<InstanceType<typeof SituateButton>>();
const single = ref(true);
let observer: ResizeObserver | undefined;
let closeInvoker: HTMLElement | null = null;
const view = computed(() =>
  state.value.tabs.find((tab) => tab.kind === "view"),
);
const chats = computed(() =>
  state.value.tabs.filter((tab) => tab.kind === "chat"),
);
const tabs = computed(() => (single.value ? state.value.tabs : chats.value));
const selected = computed(() =>
  single.value ? state.value.activeTab : state.value.activeChat,
);
const pending = computed(() =>
  state.value.tabs.find((tab) => tab.id === state.value.pendingClose),
);
function visible(tabId: string) {
  return single.value
    ? state.value.activeTab === tabId
    : view.value?.id === tabId || state.value.activeChat === tabId;
}
function reveal() {
  const tab = root.value?.querySelector<HTMLElement>(
    `[role="tab"][aria-selected="true"]`,
  );
  const strip = tab?.closest(".tab-strip");
  if (!tab || !strip) return;
  const target = tab.getBoundingClientRect();
  const area = strip.getBoundingClientRect();
  if (target.left < area.left + 6)
    strip.scrollLeft -= area.left + 6 - target.left;
  else if (target.right > area.right - 6)
    strip.scrollLeft += target.right - area.right + 6;
}
async function focusCurrent() {
  await nextTick();
  reveal();
  const target = root.value?.querySelector<HTMLElement>(
    single.value || chats.value.length > 1
      ? '[role="tab"][aria-selected="true"]'
      : ".workarea:not([hidden]) .pane-title",
  );
  (
    target ?? root.value?.querySelector<HTMLElement>(".empty-tabs button")
  )?.focus({ preventScroll: true });
}
function choose(tabId: string, focus = false) {
  if (state.value.activeTab !== tabId) update(selectTab(state.value, tabId));
  void nextTick(reveal);
  if (focus) void focusCurrent();
}
function create() {
  update(addChat(state.value));
  void focusCurrent();
}
function requestClose(tabId: string, event?: Event) {
  if (state.value.pendingClose) return;
  closeInvoker =
    event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  update(closeTab(state.value, tabId));
  if (!state.value.pendingClose) void focusCurrent();
}
function dismiss(discard: boolean) {
  const key = state.value.pendingClose;
  if (!key) return;
  update(
    discard
      ? closeTab(state.value, key, true)
      : { ...state.value, pendingClose: null },
  );
  if (discard) void focusCurrent();
  else
    void nextTick(() => {
      if (closeInvoker?.isConnected && closeInvoker.getClientRects().length)
        closeInvoker.focus({ preventScroll: true });
      else void focusCurrent();
    });
}
function dialogKeyboard(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const first = keep.value?.element;
  const last =
    dialog.value?.element?.querySelector<HTMLButtonElement>(".discard-tab");
  if (!first || !last) return;
  // Platform Tab navigation may skip buttons; cycle both dialog controls explicitly.
  event.preventDefault();
  (document.activeElement === first ? last : first).focus();
}
function keyboard(event: KeyboardEvent, tabId: string) {
  if (event.key === "Delete") {
    event.preventDefault();
    if (!event.repeat) requestClose(tabId, event);
    return;
  }
  const index = tabs.value.findIndex((tab) => tab.id === tabId);
  const count = tabs.value.length;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? count - 1
        : event.key === "ArrowRight"
          ? (index + 1) % count
          : event.key === "ArrowLeft"
            ? (index + count - 1) % count
            : -1;
  if (next < 0) return;
  event.preventDefault();
  choose(tabs.value[next]!.id, true);
}
watch(
  () => state.value.pendingClose,
  async (value) => {
    await nextTick();
    if (value && !dialog.value?.element?.open) {
      dialog.value?.element?.showModal();
      keep.value?.element?.focus();
    } else if (!value && dialog.value?.element?.open)
      dialog.value?.element.close();
  },
  { immediate: true },
);
onMounted(() => {
  function resize() {
    if (!root.value) return;
    const next = root.value.clientWidth < 840 || root.value.clientHeight < 480;
    if (single.value === next) return;
    const focused =
      document.activeElement instanceof HTMLElement &&
      root.value.contains(document.activeElement)
        ? document.activeElement
        : null;
    const wasTabControl = !!focused?.closest(".pane-switcher");
    single.value = next;
    void nextTick(() => {
      reveal();
      if (!focused || state.value.pendingClose) return;
      if (wasTabControl || !focused.isConnected || focused.closest("[hidden]"))
        void focusCurrent();
    });
  }
  if (window.ResizeObserver) {
    observer = new ResizeObserver(resize);
    observer.observe(root.value!);
  }
  resize();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  if (dialog.value?.element?.open) dialog.value?.element.close();
});
defineExpose({ focusTitle: focusCurrent });
</script>

<template>
  <div
    ref="root"
    class="navigation-view"
    :class="{
      'has-view': !!view,
      'has-chats': !!chats.length,
      'has-chat-tabs': chats.length > 1,
    }"
    :data-layout="single ? 'single' : 'tiled'"
  >
    <div v-if="showNavigation && !state.tabs.length" class="navigation-access">
      <SituateIconButton
        icon="menu"
        label="Open navigation"
        aria-haspopup="dialog"
        :aria-controls="navigationId"
        :aria-expanded="navigationOpen"
        @click="emit('openNavigation', $event)"
      />
    </div>
    <div class="split" :class="{ 'one-pane': !view || !chats.length }">
      <section
        v-for="tab in state.tabs"
        :id="`${id}-pane-${tab.id}`"
        :key="tab.id"
        :hidden="!visible(tab.id)"
        class="workarea"
        :class="{
          'view-pane': tab.kind === 'view',
          'chat-pane': tab.kind === 'chat',
        }"
        :role="
          single || (tab.kind === 'chat' && chats.length > 1)
            ? 'tabpanel'
            : 'region'
        "
        :aria-labelledby="
          single || (tab.kind === 'chat' && chats.length > 1)
            ? `${id}-tab-${tab.id}`
            : `${id}-title-${tab.id}`
        "
        @focusin="choose(tab.id)"
      >
        <ChatPaneHeader
          :title="tab.title"
          :show-chat-icon="tab.kind === 'chat'"
          :title-id="`${id}-title-${tab.id}`"
        >
          <template #navigation>
            <SituateIconButton
              v-if="
                showNavigation &&
                (single || tab.id === (view?.id ?? state.activeChat))
              "
              icon="menu"
              label="Open navigation"
              aria-haspopup="dialog"
              :aria-controls="navigationId"
              :aria-expanded="navigationOpen"
              @click="emit('openNavigation', $event)"
            />
          </template>
          <SituateIconButton
            icon="split"
            :label="`Split pane — ${tab.title}`"
            disabled
            unavailable-reason="Additional split panes are unavailable."
          /><SituateIconButton
            icon="close"
            :label="`Close pane — ${tab.title}`"
            @click="requestClose(tab.id, $event)"
          />
        </ChatPaneHeader>
        <NavigationDashboard
          v-if="tab.kind === 'view'"
          :view="tab.id as ViewId"
          :completed-tasks="state.completedTasks"
          @toggle-task="update(toggleTask(state, $event))"
        />
        <div v-else class="empty-chat">
          <div class="welcome">
            <NavigationGreeting
              :text="tab.greeting"
              :active="visible(tab.id)"
              :covered="navigationOpen || !!state.pendingClose"
            /><NavigationComposer
              :model-value="tab.draft"
              @update:model-value="update(updateDraft(state, tab.id, $event))"
              ><template #options
                ><slot
                  name="chat-options"
                  :conversation-id="tab.id" /></template
            ></NavigationComposer>
          </div>
        </div>
      </section>
      <div v-if="!state.tabs.length" class="empty-tabs">
        <h2>No open tabs</h2>
        <p>Open a view from navigation, or start a new chat.</p>
        <SituateButton @click="create">New chat</SituateButton>
      </div>
    </div>
    <div v-if="single || chats.length > 1" class="pane-switcher">
      <div
        v-if="tabs.length"
        class="tab-strip"
        role="tablist"
        :aria-label="single ? 'Open tabs' : 'Open chats'"
      >
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="tab-item"
          role="presentation"
        >
          <SituateButton
            variant="plain"
            :id="`${id}-tab-${tab.id}`"
            type="button"
            role="tab"
            :aria-controls="`${id}-pane-${tab.id}`"
            :aria-selected="selected === tab.id"
            :tabindex="selected === tab.id ? 0 : -1"
            @click="choose(tab.id)"
            @keydown="keyboard($event, tab.id)"
          >
            {{ tab.title }}</SituateButton
          ><SituateIconButton
            v-if="selected === tab.id"
            icon="close"
            class="tab-close"
            :label="`Close tab — ${tab.title}`"
            @click="requestClose(tab.id, $event)"
          />
        </div>
      </div>
      <SituateIconButton
        icon="plus"
        class="new-tab-button"
        label="New tab"
        @click="create"
      />
    </div>
    <p class="sr-only" role="status">{{ state.feedback }}</p>
    <SituateDialog
      ref="dialog"
      class="close-tab-dialog"
      :aria-labelledby="`${id}-close-title`"
      :aria-describedby="`${id}-close-description`"
      @cancel.prevent="dismiss(false)"
      @keydown="dialogKeyboard"
    >
      <h2 :id="`${id}-close-title`">Discard this draft?</h2>
      <p :id="`${id}-close-description`">
        Closing “{{ pending?.title }}” will discard its unsent message.
      </p>
      <div class="dialog-actions">
        <SituateButton
          variant="secondary"
          size="small"
          ref="keep"
          type="button"
          class="keep-tab"
          @click="dismiss(false)"
        >
          Keep tab</SituateButton
        ><SituateButton
          variant="danger"
          class="discard-tab"
          @click="dismiss(true)"
          >Discard draft</SituateButton
        >
      </div>
    </SituateDialog>
  </div>
</template>

<style scoped>
.navigation-view {
  position: relative;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--situate-surface);
}
.navigation-access {
  flex-shrink: 0;
  border-bottom: 1px solid var(--situate-line);
  padding: 4px 12px;
}
.split {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}
.split.one-pane {
  grid-template-columns: minmax(0, 1fr);
}
.workarea {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.workarea[hidden] {
  display: none;
}
.view-pane {
  grid-column: 1;
  grid-row: 1;
}
.chat-pane {
  grid-column: 2;
  grid-row: 1;
}
.one-pane .workarea {
  grid-column: 1;
}
.split:not(.one-pane) .chat-pane {
  border-left: 9px solid var(--situate-paper);
}
.empty-chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 38px;
}
.welcome {
  width: 100%;
  max-width: 640px;
  flex: 0 0 auto;
  margin: auto;
  padding-bottom: 56px;
}
.empty-tabs {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  gap: 16px;
  padding: 24px;
  overflow: auto;
  text-align: center;
}
.empty-tabs h2,
.empty-tabs p {
  margin: 0;
}
.empty-tabs p {
  color: var(--situate-muted);
}
.pane-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-shrink: 0;
  padding: 8px 16px;
  border-top: 1px solid var(--situate-line);
  background: var(--situate-paper);
}
.tab-strip {
  display: flex;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  padding: 6px;
  margin: -6px;
}
.tab-item {
  display: flex;
  align-items: center;
  flex: 1 0 auto;
  border-radius: var(--situate-radius-control);
}
.tab-item:has([aria-selected="true"]) {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
[role="tab"] {
  flex: 1 0 auto;
  min-height: 48px;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--situate-radius-control);
  background: transparent;
  color: var(--situate-muted);
  font: inherit;
  font-size: 14px;
  white-space: nowrap;
}
[aria-selected="true"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 5px;
}
.new-tab-button {
  flex: 0 0 48px;
  margin-left: auto;
}
.close-tab-dialog {
  width: min(520px, calc(100vw - 36px));
  max-height: 85dvh;
  padding: 24px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-card);
  background: var(--situate-surface);
  color: var(--situate-ink);
  overflow-y: auto;
}
.close-tab-dialog::backdrop {
  background: color-mix(in srgb, var(--situate-ink) 32%, transparent);
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}
.keep-tab {
  min-height: 50px;
  padding: 12px 24px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-pill);
  background: var(--situate-surface);
  color: inherit;
  font: inherit;
}
button:focus-visible,
.pane-title:focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
[data-layout="single"] .split {
  display: flex;
}
[data-layout="single"] .workarea {
  flex: 1;
  border-left: 0;
}
[data-layout="single"] .empty-chat {
  padding: 24px;
}
[data-layout="single"] .welcome {
  padding-bottom: 0;
}
[data-layout="tiled"] {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
}
[data-layout="tiled"]:not(.has-view),
[data-layout="tiled"]:not(.has-chats) {
  grid-template-columns: minmax(0, 1fr);
}
[data-layout="tiled"] .navigation-access {
  grid-column: 1 / -1;
  grid-row: 1;
}
[data-layout="tiled"] .split {
  display: contents;
}
[data-layout="tiled"] .view-pane {
  grid-row: 2 / 4;
}
[data-layout="tiled"] .chat-pane {
  grid-row: 2 / 4;
}
[data-layout="tiled"].has-chat-tabs .chat-pane {
  grid-row: 3;
}
[data-layout="tiled"] .pane-switcher {
  grid-column: 2;
  grid-row: 2;
  border-top: 0;
  border-bottom: 1px solid var(--situate-line);
}
[data-layout="tiled"]:not(.has-view) .pane-switcher {
  grid-column: 1;
}
[data-layout="tiled"] .empty-tabs {
  grid-row: 2 / 4;
}
@media (max-height: 480px) {
  .empty-chat {
    padding-block: 12px;
  }
  .welcome {
    padding-bottom: 0;
  }
}
</style>
