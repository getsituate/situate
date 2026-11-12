<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  SituateIcon,
  SituateIconButton,
  SituateButton,
  SituateDialog,
  SituateInput,
} from "../ui";
import SituateSelect from "../ui/SituateSelect.vue";
import MaximizedPaneHeader from "./MaximizedPaneHeader.vue";
import copy from "../localization/en.tabs.json";
import SplitLayout from "./SplitLayout.vue";
import PaneTile from "./PaneTile.vue";
import PaneHistory from "./PaneHistory.vue";
import PanePager from "./PanePager.vue";
import TabActions from "./TabActions.vue";
import {
  activeTab,
  currentView,
  paneTitle as titleForPane,
  hasActivity as tabHasActivity,
  dimensions,
  leaves,
  tabName,
  viewIcons,
  type Edge,
  type Pane,
  type TabsAction,
  type TabsState,
} from "./model";
const props = defineProps<{
  state: TabsState;
  initialMove?: boolean;
  mobile: boolean;
  workspaceName: string;
  navigationId: string;
  navigationOpen: boolean;
  showNavigation: boolean;
}>();
const emit = defineEmits<{
  action: [action: TabsAction];
  openNavigation: [event: MouseEvent];
  initialMoveOpened: [];
}>();
const tab = computed(() => activeTab(props.state));
const paneTitle = (pane: Pane) => titleForPane(pane, props.state);
const root = ref<HTMLElement>();
const tablist = ref<HTMLElement>();
const tabNavigation = ref<HTMLElement>();
const overflowing = ref(false);
const dialog = ref<InstanceType<typeof SituateDialog>>();
const width = ref(1200);
const narrow = computed(() => props.mobile || width.value < 660);
const multipleTabs = computed(() => props.state.tabs.length > 1);
const paneIds = computed(() => (tab.value ? leaves(tab.value.layout) : []));
const pagerPanes = computed(() => {
  const current = tab.value;
  return current
    ? paneIds.value.map((id) => ({
        id,
        title: paneTitle(current.panes[id]!),
      }))
    : [];
});
const focusPane = computed(
  () =>
    tab.value?.panes[
      narrow.value ? tab.value.active : tab.value.maximized || tab.value.active
    ],
);
const lonePane = computed(() => paneIds.value.length === 1);
const single = computed(
  () => lonePane.value || narrow.value || !!tab.value?.maximized,
);
const treeSize = computed(() =>
  tab.value && !single.value
    ? dimensions(tab.value.layout)
    : { width: 0, height: 0 },
);
const dragging = ref<string | null>(null);
const mode = ref<"tab" | "pane" | "move" | "all">("tab");
const selectedPane = ref("");
const selectedTab = ref("");
const renameOrigin = ref<"surface" | "all">("surface");
const overviewFocus = ref("");
const editedTab = computed(() =>
  props.state.tabs.find((item) => item.id === selectedTab.value),
);
const tabCount = computed(() =>
  props.state.tabs.length === 1
    ? copy.oneTab
    : copy.tabCount.replace("{count}", String(props.state.tabs.length)),
);
const name = ref("");
const target = ref("");
const edge = ref<Edge>("right");
const title = computed(() =>
  mode.value === "tab"
    ? copy.rename
    : mode.value === "pane"
      ? copy.paneOptions
      : mode.value === "move"
        ? copy.movePane
        : copy.allTabs,
);
let observer: ResizeObserver | undefined;
let returnFocus: HTMLElement | null = null;
let tabsObserver: ResizeObserver | undefined;
let tabsFrame = 0;
let widthFrame = 0;
function measureTabs() {
  overflowing.value =
    !!tablist.value &&
    !!tabNavigation.value &&
    (tablist.value.scrollWidth > tabNavigation.value.clientWidth + 1 ||
      [...tablist.value.querySelectorAll<HTMLElement>("button > span")].some(
        (label) => label.scrollWidth > label.clientWidth + 1,
      ));
}
function revealActiveTab() {
  tablist.value
    ?.querySelector<HTMLElement>('[aria-selected="true"]')
    ?.closest(".topic-tab")
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    cancelAnimationFrame(widthFrame);
    widthFrame = requestAnimationFrame(() => {
      width.value = entry.contentRect.width;
    });
  });
  if (root.value) {
    width.value = root.value.clientWidth;
    observer.observe(root.value);
  }
  tabsObserver = new ResizeObserver(() => {
    cancelAnimationFrame(tabsFrame);
    tabsFrame = requestAnimationFrame(() => {
      measureTabs();
      revealActiveTab();
    });
  });
  if (tabNavigation.value) tabsObserver.observe(tabNavigation.value);
  document.fonts.addEventListener("loadingdone", measureTabs);
  measureTabs();
  if (props.initialMove)
    void nextTick(() => {
      const trigger = root.value?.querySelector<HTMLElement>(
        narrow.value ? ".mobile-pane-options" : ".pane-title",
      );
      if (trigger) {
        open("move", trigger);
        emit("initialMoveOpened");
      }
    });
});
onBeforeUnmount(() => {
  observer?.disconnect();
  tabsObserver?.disconnect();
  cancelAnimationFrame(tabsFrame);
  cancelAnimationFrame(widthFrame);
  document.fonts.removeEventListener("loadingdone", measureTabs);
  dialog.value?.element?.close();
});
watch(overflowing, (visible) => {
  if (
    !visible &&
    document.activeElement === root.value?.querySelector(".all-tabs")
  )
    void nextTick(focusActiveTab);
});
watch(
  tabNavigation,
  (element, previous) => {
    if (previous) tabsObserver?.unobserve(previous);
    if (element) tabsObserver?.observe(element);
  },
  { flush: "post" },
);
watch(
  [
    () => props.state.active,
    narrow,
    () =>
      props.state.tabs
        .map((item) => `${item.id}:${tabName(item)}:${hasActivity(item.id)}`)
        .join("|"),
  ],
  async () => {
    dragging.value = null;
    await nextTick();
    measureTabs();
    revealActiveTab();
  },
);
watch([single, narrow, lonePane], async () => {
  dragging.value = null;
  const focused = document.activeElement as HTMLElement | null;
  if (!focused || !root.value?.contains(focused)) return;
  const pane = focused.closest<HTMLElement>("[data-pane]");
  const maximizedHeader = focused.closest(".maximized-pane-header");
  const body = focused.closest(".pane-body");
  const selector = "button, input, textarea, select, [tabindex]";
  const index = body
    ? [...body.querySelectorAll(selector)].indexOf(focused)
    : -1;
  const selection =
    focused instanceof HTMLTextAreaElement
      ? ([focused.selectionStart, focused.selectionEnd] as const)
      : null;
  await nextTick();
  if (focused.isConnected) return;
  const replacement =
    body && pane
      ? root.value
          ?.querySelector(`[data-pane="${pane.dataset.pane}"] .pane-body`)
          ?.querySelectorAll<HTMLElement>(selector)[index]
      : null;
  if (replacement) {
    replacement.focus({ preventScroll: true });
    if (selection && replacement instanceof HTMLTextAreaElement)
      replacement.setSelectionRange(...selection);
  } else if (pane || maximizedHeader) focusPaneHeader();
  else focusActiveTab();
});
watch(mode, () => {
  if (dialog.value?.element?.open) void nextTick(focusDialog);
});
function focusDialog() {
  if (mode.value === "all" && overviewFocus.value) {
    const trigger = dialog.value?.element?.querySelector<HTMLElement>(
      `[data-tab-actions="${overviewFocus.value}"] > button`,
    );
    if (trigger) {
      trigger.focus();
      return;
    }
  }
  const allTarget =
    props.state.tabs.length === 1 &&
    focusPane.value &&
    currentView(focusPane.value) === "empty"
      ? ".sheet-new-tab"
      : '.tab-sheet-select[aria-current="true"]';
  dialog.value?.element
    ?.querySelector<HTMLElement>(
      mode.value === "all"
        ? allTarget
        : "input, .situate-select-trigger, .pane-actions button",
    )
    ?.focus();
}
function open(
  which: typeof mode.value,
  event: MouseEvent | HTMLElement,
  pane = "",
) {
  returnFocus =
    event instanceof HTMLElement ? event : (event.currentTarget as HTMLElement);
  returnFocus.focus();
  mode.value = which;
  renameOrigin.value = "surface";
  overviewFocus.value = "";
  selectedPane.value = pane || tab.value?.active || "";
  selectedTab.value = tab.value?.id ?? "";
  name.value = tab.value ? tabName(tab.value) : "";
  target.value = paneIds.value.find((id) => id !== selectedPane.value) ?? "";
  edge.value = "right";
  dialog.value?.element?.showModal();
  void nextTick(() => {
    const field =
      dialog.value?.element?.querySelector<HTMLInputElement>("input");
    if (field) {
      field.focus();
      field.select();
    } else
      dialog.value?.element
        ?.querySelector<HTMLElement>(
          '.pane-actions button, .tab-sheet-select[aria-current="true"], .situate-select-trigger',
        )
        ?.focus();
  });
}
function renameTab(
  id: string,
  origin: "surface" | "all",
  trigger: HTMLElement,
) {
  const item = props.state.tabs.find((item) => item.id === id);
  if (!item) return;
  if (origin === "surface") returnFocus = trigger;
  renameOrigin.value = origin;
  selectedTab.value = id;
  name.value = tabName(item);
  mode.value = "tab";
  dialog.value?.element?.showModal();
  void nextTick(() => {
    const field =
      dialog.value?.element?.querySelector<HTMLInputElement>("input");
    field?.focus();
    field?.select();
  });
}
function saveName() {
  if (!editedTab.value) return;
  emit("action", {
    type: "rename-tab",
    id: editedTab.value.id,
    name:
      name.value.trim() === tabName(editedTab.value)
        ? editedTab.value.name
        : name.value,
  });
  close();
}
function closeTab(id: string, origin: "surface" | "all") {
  const index = props.state.tabs.findIndex((item) => item.id === id);
  overviewFocus.value =
    props.state.tabs[index + 1]?.id ?? props.state.tabs[index - 1]?.id ?? "";
  emit("action", { type: "close-tab", id });
  void nextTick(origin === "all" ? focusDialog : focusActiveTab);
}
function close() {
  if (mode.value === "tab" && renameOrigin.value === "all") {
    overviewFocus.value = selectedTab.value;
    mode.value = "all";
  } else dismiss(true);
}
function dismiss(restoreFocus: boolean) {
  dialog.value?.element?.close();
  if (!restoreFocus) return;
  void nextTick(() => {
    if (returnFocus?.isConnected) returnFocus.focus();
    else focusActiveTab();
  });
}
function act(action: TabsAction) {
  emit("action", action);
  dismiss(false);
  void nextTick(() => {
    const paneAction = [
      "split",
      "move",
      "maximize",
      "close-pane",
      "open",
      "history",
    ].includes(action.type);
    if (paneAction && tab.value) focusPaneHeader();
    else focusActiveTab();
  });
}
function paneAction(action: TabsAction) {
  emit("action", action);
  if (
    action.type === "open" ||
    action.type === "move" ||
    action.type === "new-conversation" ||
    action.type === "history"
  )
    void nextTick(() => focusPaneHeader(action.id));
}
function focusPaneHeader(id = tab.value?.active) {
  if (lonePane.value) {
    focusActiveTab();
    return;
  }
  root.value
    ?.querySelector<HTMLElement>(
      tab.value?.maximized
        ? ".maximized-pane-title"
        : narrow.value
          ? '.pane-pager [aria-current="true"]'
          : `[data-pane="${id}"] .pane-title`,
    )
    ?.focus({ preventScroll: true });
}
function focusActiveTab() {
  (
    tablist.value?.querySelector<HTMLElement>('[aria-selected="true"]') ??
    root.value?.querySelector<HTMLElement>(".mobile-tab-trigger, .new-tab")
  )?.focus({ preventScroll: true });
}
function selectTab(id: string, focus = true) {
  emit("action", { type: "select-tab", id });
  if (focus) void nextTick(() => focusActiveTab());
}
function tabKey(event: KeyboardEvent, index: number) {
  const count = props.state.tabs.length;
  let next: number;
  if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  else if (event.key === "ArrowRight") next = (index + 1) % count;
  else if (event.key === "ArrowLeft") next = (index + count - 1) % count;
  else return;
  event.preventDefault();
  selectTab(props.state.tabs[next]!.id, true);
}
function createTab() {
  emit("action", { type: "new-tab" });
  void nextTick(focusActiveTab);
}
function hasActivity(id: string) {
  return tabHasActivity(props.state, id);
}
defineExpose({ focusPaneHeader });
</script>

<template>
  <main
    ref="root"
    class="topic-window"
    :class="{ 'narrow-tabs': narrow, 'lone-pane': lonePane }"
    @keydown.esc="dragging = null"
  >
    <header class="tab-header" :class="{ 'mobile-topbar': narrow }">
      <SituateIconButton
        v-if="showNavigation || narrow"
        icon="menu"
        :label="`${copy.navigation}: ${workspaceName}`"
        :aria-controls="navigationId"
        :aria-expanded="navigationOpen"
        @click="emit('openNavigation', $event)"
      />
      <div v-if="!narrow" ref="tabNavigation" class="tab-navigation">
        <div
          v-if="tab"
          ref="tablist"
          class="topic-tabs"
          role="tablist"
          :aria-label="copy.tabs"
          aria-orientation="horizontal"
        >
          <div
            v-for="(item, index) in state.tabs"
            :key="item.id"
            role="presentation"
            class="topic-tab"
            :class="{ selected: state.active === item.id }"
          >
            <SituateButton
              variant="plain"
              class="topic-tab-select"
              :id="`topic-${item.id}`"
              role="tab"
              :aria-selected="state.active === item.id"
              :aria-controls="`panel-${item.id}`"
              :tabindex="state.active === item.id ? 0 : -1"
              :title="tabName(item)"
              @click="selectTab(item.id)"
              @dblclick="
                renameTab(
                  item.id,
                  'surface',
                  $event.currentTarget as HTMLElement,
                )
              "
              @keydown="tabKey($event, index)"
            >
              <SituateIcon
                :name="
                  viewIcons[currentView(item.panes[leaves(item.layout)[0]!]!)]
                "
              />
              <span>{{ tabName(item) }}</span>
              <small v-if="hasActivity(item.id)" class="tab-activity">{{
                copy.working
              }}</small>
            </SituateButton>
            <SituateButton
              variant="plain"
              type="button"
              class="tab-close"
              :tabindex="state.active === item.id ? 0 : -1"
              :aria-label="copy.namedCloseTab.replace('{title}', tabName(item))"
              :title="copy.closeTab"
              @click="closeTab(item.id, 'surface')"
            >
              <SituateIcon name="close" />
            </SituateButton>
          </div>
        </div>
        <SituateIconButton
          v-if="overflowing"
          class="all-tabs"
          icon="chevron"
          :label="copy.allTabs"
          @click="open('all', $event)"
        />
      </div>
      <div
        v-else-if="tab"
        class="mobile-tabs"
        :role="multipleTabs ? undefined : 'tablist'"
        :aria-label="copy.tabs"
      >
        <SituateButton
          variant="plain"
          :id="multipleTabs ? undefined : `topic-${tab.id}`"
          class="mobile-tab-trigger"
          :role="multipleTabs ? undefined : 'tab'"
          :aria-selected="multipleTabs ? undefined : true"
          :aria-controls="multipleTabs ? undefined : `panel-${tab.id}`"
          :aria-haspopup="multipleTabs ? 'dialog' : undefined"
          :title="tabName(tab)"
          @click="multipleTabs ? open('all', $event) : selectTab(tab.id)"
        >
          <span id="mobile-active-tab">{{ tabName(tab) }}</span>
          <template v-if="multipleTabs"
            ><small>{{ tabCount }}</small
            ><SituateIcon name="chevron"
          /></template>
          <span
            v-if="hasActivity(tab.id)"
            class="mobile-activity"
            role="status"
            >{{ copy.working }}</span
          >
        </SituateButton>
      </div>
      <SituateIconButton
        v-if="!narrow || !tab"
        icon="plus"
        :label="copy.newTab"
        class="new-tab"
        @click="createTab"
      />
      <TabActions
        v-if="tab && !narrow"
        :key="tab.id"
        :label="copy.tabOptions"
        bulk
        :can-close-others="multipleTabs"
        @close-others="act({ type: 'close-other-tabs', id: tab.id })"
        @close-all="act({ type: 'close-all-tabs' })"
        @rename="renameTab(tab.id, 'surface', $event)"
        @close="closeTab(tab.id, 'surface')"
      />
      <div v-if="focusPane && lonePane" class="surface-pane-actions">
        <PaneHistory
          :pane="focusPane"
          @navigate="
            paneAction({ type: 'history', id: focusPane.id, delta: $event })
          "
        />
        <SituateIconButton
          v-if="!narrow"
          class="surface-pane-options"
          icon="split"
          :label="`${copy.paneOptions}: ${paneTitle(focusPane)}`"
          @click="open('pane', $event, focusPane.id)"
        />
      </div>
      <TabActions
        v-if="tab && narrow"
        :key="tab.id"
        surface
        :include-layout="lonePane"
        bulk
        :can-close-others="multipleTabs"
        @close-others="act({ type: 'close-other-tabs', id: tab.id })"
        @close-all="act({ type: 'close-all-tabs' })"
        :label="lonePane ? copy.surfaceActions : copy.tabOptions"
        @create="createTab"
        @layout="open('pane', $event, focusPane?.id)"
        @rename="renameTab(tab.id, 'surface', $event)"
        @close="closeTab(tab.id, 'surface')"
      />
    </header>
    <div class="topic-workarea">
      <section
        v-for="item in state.tabs.filter(
          (item) => !narrow && item.id !== state.active,
        )"
        :id="`panel-${item.id}`"
        :key="item.id"
        role="tabpanel"
        :aria-labelledby="`topic-${item.id}`"
        hidden
      />
      <section
        v-if="tab"
        :id="`panel-${tab.id}`"
        :role="narrow && multipleTabs ? 'region' : 'tabpanel'"
        :aria-labelledby="
          narrow && multipleTabs ? 'mobile-active-tab' : `topic-${tab.id}`
        "
        class="topic-panel"
      >
        <MaximizedPaneHeader
          v-if="tab.maximized && focusPane && !lonePane"
          :pane="focusPane"
          :panes="pagerPanes"
          @select="emit('action', { type: 'select-pane', id: $event })"
          @restore="act({ type: 'maximize', id: focusPane.id })"
          @history="
            paneAction({ type: 'history', id: focusPane.id, delta: $event })
          "
          @options="open('pane', $event, focusPane.id)"
        />
        <div
          v-else-if="narrow && !lonePane && focusPane"
          class="mobile-pane-header"
        >
          <PaneHistory
            :pane="focusPane"
            @navigate="
              paneAction({ type: 'history', id: focusPane.id, delta: $event })
            "
          />
          <PanePager
            :key="tab.id"
            :panes="pagerPanes"
            :active="tab.active"
            @select="emit('action', { type: 'select-pane', id: $event })"
          />
          <SituateIconButton
            class="mobile-pane-options"
            icon="more"
            :label="`${copy.paneOptions}: ${paneTitle(focusPane)}`"
            @click="open('pane', $event, focusPane.id)"
          />
        </div>
        <div class="layout-scroll">
          <div
            class="layout-canvas"
            :style="{
              minWidth: `${treeSize.width}px`,
              minHeight: `${treeSize.height}px`,
            }"
          >
            <PaneTile
              v-if="single && focusPane"
              :key="focusPane.id"
              :pane="focusPane"
              :state="state"
              active
              :dragging="null"
              :maximized="true"
              :compact="narrow || lonePane || !!tab.maximized"
              @action="paneAction"
              @options="(id, event) => open('pane', event, id)"
            />
            <SplitLayout
              v-else
              :node="tab.layout"
              :tab="tab"
              :state="state"
              :dragging="dragging"
              @action="paneAction"
              @options="(id, event) => open('pane', event, id)"
              @drag="dragging = $event"
            />
          </div>
        </div>
      </section>
    </div>
    <SituateDialog
      ref="dialog"
      id="topic-layout-dialog"
      class="topic-dialog"
      :class="{ 'mobile-sheet': narrow }"
      aria-labelledby="topic-dialog-title"
      @cancel.prevent="close"
      @click="$event.target === dialog?.element && close()"
    >
      <template #header>
        <h2 id="topic-dialog-title">{{ title }}</h2>
        <SituateIconButton icon="close" :label="copy.close" @click="close" />
      </template>
      <form
        v-if="mode === 'tab' && editedTab"
        class="rename-form"
        @submit.prevent="saveName"
      >
        <label for="tab-name" class="sr-only">{{ copy.nameLabel }}</label>
        <SituateInput
          id="tab-name"
          v-model="name"
          :placeholder="tabName({ ...editedTab, name: '' })"
        />
        <div class="dialog-actions">
          <SituateButton
            variant="secondary"
            size="small"
            type="button"
            @click="close"
          >
            {{ copy.cancel }}</SituateButton
          ><SituateButton variant="primary" size="small" type="submit">
            {{ copy.save }}
          </SituateButton>
        </div>
      </form>
      <div v-else-if="mode === 'pane' && tab" class="pane-actions">
        <SituateButton
          variant="plain"
          @click="act({ type: 'split', id: selectedPane, edge: 'right' })"
        >
          <SituateIcon name="split" />{{ copy.splitRight }}
        </SituateButton>
        <SituateButton
          variant="plain"
          @click="act({ type: 'split', id: selectedPane, edge: 'bottom' })"
        >
          <SituateIcon name="split" class="rotate-icon" />{{ copy.splitBelow }}
        </SituateButton>
        <SituateButton
          variant="plain"
          v-if="paneIds.length > 1"
          @click="mode = 'move'"
        >
          <SituateIcon name="grip" />{{ copy.movePane }}
        </SituateButton>
        <SituateButton
          variant="plain"
          v-if="!narrow && paneIds.length > 1"
          @click="act({ type: 'maximize', id: selectedPane })"
        >
          <SituateIcon :name="tab.maximized ? 'restore' : 'expand'" />{{
            tab.maximized ? copy.restore : copy.maximize
          }}
        </SituateButton>
        <SituateButton
          variant="plain"
          @click="act({ type: 'close-pane', id: selectedPane })"
        >
          <SituateIcon name="close" />{{ copy.closePane }}
        </SituateButton>
      </div>
      <form
        v-else-if="mode === 'move' && tab"
        class="move-pane-form"
        @submit.prevent="act({ type: 'move', id: selectedPane, target, edge })"
      >
        <p class="move-pane-source">
          {{
            copy.movingPane.replace(
              "{title}",
              paneTitle(tab.panes[selectedPane]!),
            )
          }}
        </p>
        <label for="move-target">{{ copy.target }}</label>
        <SituateSelect
          id="move-target"
          :value="target"
          @change="target = ($event.target as HTMLSelectElement).value"
        >
          <option
            v-for="id in paneIds.filter((id) => id !== selectedPane)"
            :key="id"
            :value="id"
          >
            {{ paneIds.indexOf(id) + 1 }} ·
            {{ paneTitle(tab.panes[id]!) }}
          </option>
        </SituateSelect>
        <label for="move-position">{{ copy.position }}</label>
        <SituateSelect
          id="move-position"
          :value="edge"
          @change="edge = ($event.target as HTMLSelectElement).value as Edge"
        >
          <option
            v-for="(label, value) in copy.edges"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </SituateSelect>
        <div class="dialog-actions">
          <SituateButton variant="secondary" type="button" @click="close">
            {{ copy.cancel }}</SituateButton
          ><SituateButton variant="primary" type="submit">
            {{ copy.move }}
          </SituateButton>
        </div>
      </form>
      <div v-else-if="mode === 'all'" class="all-tab-list">
        <div
          v-for="item in state.tabs"
          :key="item.id"
          class="tab-sheet-row"
          :class="{ 'tab-sheet-row--current': item.id === state.active }"
        >
          <SituateButton
            variant="plain"
            class="tab-sheet-select"
            :aria-current="item.id === state.active ? 'true' : undefined"
            @click="act({ type: 'select-tab', id: item.id })"
          >
            <span class="tab-sheet-copy">
              <span class="tab-sheet-title">{{ tabName(item) }}</span>
              <span class="tab-sheet-meta">
                {{ leaves(item.layout).length }}
                {{
                  leaves(item.layout).length === 1
                    ? copy.paneSingular
                    : copy.paneCount
                }}<template v-if="hasActivity(item.id)">
                  · {{ copy.working }}</template
                >
              </span>
            </span>
            <SituateIcon
              v-if="item.id === state.active"
              name="check"
              class="tab-sheet-current"
            />
          </SituateButton>
          <TabActions
            class="tab-sheet-options"
            :data-tab-actions="item.id"
            :label="`${copy.tabOptions}: ${tabName(item)}`"
            @rename="renameTab(item.id, 'all', $event)"
            @close="closeTab(item.id, 'all')"
          />
        </div>
        <footer class="tab-overview-actions">
          <SituateButton
            v-if="state.closedTabs.length"
            variant="plain"
            class="sheet-reopen-tab"
            @click="act({ type: 'reopen-tab' })"
          >
            <SituateIcon name="history" />{{ copy.reopenTab }}
          </SituateButton>
          <SituateButton
            variant="secondary"
            size="small"
            class="sheet-new-tab"
            @click="act({ type: 'new-tab' })"
          >
            <SituateIcon name="plus" />{{ copy.newTab }}
          </SituateButton>
        </footer>
      </div>
    </SituateDialog>
  </main>
</template>

<style>
.topic-window {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding-top: var(--app-safe-area-top, 0px);
  background: var(--situate-paper);
}
.tab-header {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 56px;
  padding: 0 12px;
  gap: 4px;
  border-bottom: 1px solid var(--situate-line);
  background: var(--situate-surface);
}
.tab-navigation,
.mobile-tabs {
  flex: 1;
  min-width: 0;
}
.tab-navigation {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mobile-tabs {
  display: flex;
}
.topic-workarea {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.topic-tabs {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  min-width: 0;
  scrollbar-width: none;
  flex: 1;
  gap: 4px;
  padding: 2px;
}
.topic-tabs::-webkit-scrollbar {
  display: none;
}
.surface-pane-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-inline-start: 8px;
  margin-inline-start: 8px;
  border-inline-start: 1px solid var(--situate-line);
}
.topic-tab {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 0;
  max-width: 260px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--situate-muted);
  font-size: 14px;
  position: relative;
}
.topic-tab-select {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 8px 12px 8px 16px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
}
.topic-tab.selected {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  background: var(--situate-accent-soft, var(--situate-lilac));
  font-weight: 600;
}
.topic-tab.selected::after {
  content: "";
  position: absolute;
  inset: auto 16px 0;
  height: 2px;
  background: var(--situate-accent-strong, var(--situate-violet-deep));
  pointer-events: none;
}
.topic-tab-select > span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.topic-tabs .tab-close {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  margin-inline-end: 4px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: inherit;
  background: transparent;
}
.topic-tabs .tab-close:hover {
  background: color-mix(in srgb, var(--situate-ink) 8%, transparent);
}
@media (hover: none), (pointer: coarse) {
  .topic-tabs .tab-close {
    flex-basis: 44px;
    width: 44px;
    height: 44px;
  }
}
.topic-tab-select > svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.tab-activity {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--situate-surface);
  border-radius: 8px;
}
.topic-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.layout-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 18px;
}
.layout-canvas {
  height: 100%;
}
.move-pane-form .situate-select {
  display: grid;
  width: 100%;
}
.move-pane-source {
  margin: 0 0 24px;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.move-pane-form .dialog-actions {
  gap: 12px;
}
.topic-dialog {
  max-height: min(85dvh, var(--app-content-height, 85dvh));
}
.topic-dialog form > label:not(.sr-only) {
  display: block;
  margin: 16px 0 8px;
  font-size: 14px;
}
.topic-dialog input {
  display: block;
  width: 100%;
}
.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}
.rename-form .dialog-actions {
  margin-top: 16px;
}
.pane-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pane-actions button {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 48px;
  padding: 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: start;
  font-size: 14px;
}
.pane-actions button:hover {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.pane-actions button svg {
  flex-shrink: 0;
  color: var(--situate-muted);
}
.pane-actions button svg:nth-child(2) {
  margin-inline-start: auto;
}
.rotate-icon {
  transform: rotate(90deg);
}
.all-tab-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tab-sheet-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-inline-end: 4px;
  border-radius: 10px;
}
.tab-sheet-row--current {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.tab-sheet-select {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  min-height: 64px;
  padding: 10px 12px;
  text-align: start;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--situate-ink);
}
.tab-sheet-select:hover {
  background: color-mix(in srgb, var(--situate-ink) 5%, transparent);
}
.tab-sheet-copy {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 2px;
  overflow-wrap: anywhere;
}
.tab-sheet-title {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: var(--situate-text-small);
  font-weight: 600;
  line-height: 1.5;
}
.tab-sheet-meta {
  color: var(--situate-muted);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.5;
}
.tab-sheet-current {
  flex: none;
  width: 18px;
  height: 18px;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.tab-overview-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--situate-line);
}
.tab-overview-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.sheet-reopen-tab {
  min-height: 44px;
  padding: 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--situate-muted);
  font-size: var(--situate-text-small);
  font-weight: 600;
  line-height: 1.55;
}
.sheet-reopen-tab:hover {
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-ink);
}
.sheet-new-tab {
  margin-inline-start: auto;
}
.tab-overview-actions svg {
  flex: none;
  width: 18px;
  height: 18px;
}
.mobile-topbar {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 48px;
  padding: 0 6px;
  gap: 4px;
  border-bottom: 1px solid var(--situate-line);
}
.mobile-tab-trigger {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  padding: 8px 4px;
  background: transparent;
  text-align: start;
  font-size: 14px;
  font-weight: 600;
}
.mobile-tab-trigger > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mobile-tab-trigger > small {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--situate-muted);
  font-weight: 400;
}
.mobile-tab-trigger > svg {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}
.mobile-activity {
  font-size: 11px;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.mobile-pane-header {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--situate-line);
  background: var(--situate-surface);
}
.mobile-pane-header .pane-pager {
  flex: 1;
}
.narrow-tabs .layout-scroll,
.lone-pane .layout-scroll {
  padding: 0;
}
.lone-pane {
  background: var(--situate-surface);
}
.mobile-topbar .surface-pane-actions {
  padding-inline-start: 4px;
  margin-inline-start: 0;
}
#topic-layout-dialog.mobile-sheet[open] {
  top: calc(var(--app-content-top, 0px) + var(--app-content-height, 100dvh));
  bottom: auto;
  transform: translateY(-100%);
  margin-block: 0;
  width: min(100%, 520px);
  max-width: 100%;
  max-height: max(0px, calc(var(--app-content-height, 100dvh) - 12px));
  padding: 24px;
  border-radius: 24px 24px 0 0;
}
.pane-actions button:disabled {
  color: var(--situate-control-line);
}
</style>
