<script setup lang="ts">
import {
  useTemplateRef,
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  useId,
} from "vue";
import {
  SituateDialog,
  SituateButton,
  SituateDialogActions,
  SituateInput,
  SituateIcon,
  SituateIconButton,
  SituateSelect,
} from "@situate/ui";
import { diagnosticsFor, type Context } from "../../diagnostics";
import { layoutAction } from "../../diagnostics/actions";
import WorkingIndicator from "../../components/WorkingIndicator.vue";
import MaximizedPaneHeader from "./MaximizedPaneHeader.vue";
import { t } from "@situate/localization";
import SplitLayout from "./SplitLayout.vue";
import PaneTile from "./PaneTile.vue";
import PaneHistory from "./PaneHistory.vue";
import PanePager from "./PanePager.vue";
import TabActions from "./TabActions.vue";
import {
  selectedTab as activeTab,
  tabTitle,
  type LayoutState,
  type LayoutIntent,
  type Pane,
} from "../model";
import { currentEntry, type ViewTarget } from "../navigation";
import { paneOrder, type PaneEdge } from "../tree";
import { dimensions } from "./geometry";
import { edges, edgeTitle } from "./edges";
const props = defineProps<{
  state: LayoutState;
  workspaceId?: string;
  mobile?: boolean;
  titleFor: (target: ViewTarget) => string;
  hasActivity?: (tabId: string) => boolean;
  showNavigation?: boolean;
  navigationId?: string;
  navigationOpen?: boolean;
}>();
defineSlots<{
  pane(props: {
    pane: Pane;
    tab: LayoutState["tabs"][number];
    active: boolean;
  }): unknown;
}>();
const paneTitle = (pane: Pane) =>
  props.titleFor(currentEntry(pane.navigation).target);
const tabName = (tab: LayoutState["tabs"][number]) =>
  tabTitle(tab, props.titleFor);
const paneById = (id: string) =>
  tab.value!.panes.find((pane) => pane.id === id)!;
const emit = defineEmits<{
  intent: [intent: LayoutIntent, diagnostic?: Context];
  navigation: [event: MouseEvent];
}>();
const tab = computed(() => activeTab(props.state));
const surfaceMenu = ref<InstanceType<typeof TabActions>>();
const maximizedHeader = ref<InstanceType<typeof MaximizedPaneHeader>>();
const overviewMenus = ref<InstanceType<typeof TabActions>[]>([]);
const instanceId = useId();
const root = ref<HTMLElement>();
const tablist = ref<HTMLElement>();
const tabNavigation = ref<HTMLElement>();
const overflowing = ref(false);
const dialogControl =
  useTemplateRef<InstanceType<typeof SituateDialog>>("dialogControl");
const dialog = computed(() => dialogControl.value?.element);
const width = ref(1200);
const narrow = computed(() => props.mobile || width.value < 660);
const multipleTabs = computed(() => props.state.tabs.length > 1);
const paneIds = computed(() => (tab.value ? paneOrder(tab.value.layout) : []));
const pagerPanes = computed(() => {
  const current = tab.value;
  return current
    ? paneIds.value.map((id) => ({
        id,
        title: paneTitle(current.panes.find((pane) => pane.id === id)!),
      }))
    : [];
});
const focusPane = computed(() => {
  const current = tab.value;
  if (!current) return undefined;
  const id = narrow.value
    ? current.activePaneId
    : current.maximizedPaneId || current.activePaneId;
  return current.panes.find((pane) => pane.id === id);
});
const lonePane = computed(() => paneIds.value.length === 1);
const single = computed(
  () => lonePane.value || narrow.value || !!tab.value?.maximizedPaneId,
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
    ? t("layoutUi.oneTab")
    : t("layoutUi.tabCount", { count: props.state.tabs.length }),
);
const name = ref("");
const target = ref("");
const edge = ref<PaneEdge>("right");
const title = computed(() =>
  mode.value === "tab"
    ? t("layoutUi.rename")
    : mode.value === "pane"
      ? t("layoutUi.paneOptions")
      : mode.value === "move"
        ? t("layoutUi.movePane")
        : t("layoutUi.allTabs"),
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
    tablist.value.scrollWidth > tabNavigation.value.clientWidth + 1;
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
  if (root.value) observer.observe(root.value);
  tabsObserver = new ResizeObserver(() => {
    cancelAnimationFrame(tabsFrame);
    tabsFrame = requestAnimationFrame(() => {
      measureTabs();
      revealActiveTab();
    });
  });
  if (tabNavigation.value) tabsObserver.observe(tabNavigation.value);
  document.fonts?.addEventListener("loadingdone", measureTabs);
  measureTabs();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  tabsObserver?.disconnect();
  cancelAnimationFrame(tabsFrame);
  cancelAnimationFrame(widthFrame);
  document.fonts?.removeEventListener("loadingdone", measureTabs);
  dialog.value?.close();
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
    () => props.state.activeTabId,
    narrow,
    () =>
      props.state.tabs
        .map((item) => `${item.id}:${tabName(item)}:${tabHasActivity(item.id)}`)
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
  const header = focused.closest(".maximized-pane-header");
  const body = focused.closest(".pane-body");
  const selector = "button, input, textarea, select, [tabindex]";
  const index = body
    ? [...body.querySelectorAll(selector)].indexOf(focused)
    : -1;
  await nextTick();
  if (focused.isConnected) return;
  const replacement =
    body && pane
      ? root.value
          ?.querySelector(
            `[data-pane="${CSS.escape(pane.dataset.pane!)}"] .pane-body`,
          )
          ?.querySelectorAll<HTMLElement>(selector)[index]
      : null;
  if (replacement) {
    replacement.focus({ preventScroll: true });
  } else if (pane || header) focusPaneHeader();
  else focusActiveTab();
});
watch(mode, () => {
  if (dialog.value?.open) void nextTick(focusDialog);
});
function focusDialog() {
  if (mode.value === "all" && overviewFocus.value) {
    const trigger = dialog.value?.querySelector<HTMLElement>(
      `[data-tab-actions="${CSS.escape(overviewFocus.value)}"] > button`,
    );
    if (trigger) {
      trigger.focus();
      return;
    }
  }
  const allTarget =
    props.state.tabs.length === 1 &&
    focusPane.value &&
    currentEntry(focusPane.value.navigation).target.kind === "empty"
      ? ".sheet-new-tab"
      : '.tab-sheet-select[aria-current="true"]';
  dialog.value
    ?.querySelector<HTMLElement>(
      mode.value === "all"
        ? allTarget
        : "input, [role=combobox], .pane-actions button",
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
  selectedPane.value = pane || tab.value?.activePaneId || "";
  selectedTab.value = tab.value?.id ?? "";
  name.value = tab.value ? tabName(tab.value) : "";
  target.value = paneIds.value.find((id) => id !== selectedPane.value) ?? "";
  edge.value = "right";
  dialog.value?.showModal();
  void nextTick(() => {
    const field = dialog.value?.querySelector<HTMLInputElement>("input");
    if (field) {
      field.focus();
      field.select();
    } else
      dialog.value
        ?.querySelector<HTMLElement>(
          '.pane-actions button, .tab-sheet-select[aria-current="true"], [role=combobox]',
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
  dialog.value?.showModal();
  void nextTick(() => {
    const field = dialog.value?.querySelector<HTMLInputElement>("input");
    field?.focus();
    field?.select();
  });
}
function recordIntent(intent: LayoutIntent, control = "button") {
  const context = diagnosticsFor(props.workspaceId).action(
    layoutAction(intent),
    control,
    "layout",
  );
  if (context) emit("intent", intent, context);
  else emit("intent", intent);
}
function saveName() {
  if (!editedTab.value) return;
  recordIntent({
    type: "rename-tab",
    tabId: editedTab.value.id,
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
  recordIntent({ type: "close-tab", tabId: id });
  void nextTick(origin === "all" ? focusDialog : focusActiveTab);
}
function close() {
  if (mode.value === "tab" && renameOrigin.value === "all") {
    overviewFocus.value = selectedTab.value;
    mode.value = "all";
  } else dismiss(true);
}
function dismiss(restoreFocus: boolean) {
  dialog.value?.close();
  if (!restoreFocus) return;
  void nextTick(() => {
    if (returnFocus?.isConnected) returnFocus.focus();
    else focusActiveTab();
  });
}
function act(action: LayoutIntent) {
  recordIntent(action, "menu");
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
function paneAction(action: LayoutIntent) {
  recordIntent(action, "pane");
  if (
    action.type === "open" ||
    action.type === "move" ||
    action.type === "history"
  )
    void nextTick(() =>
      focusPaneHeader("paneId" in action ? action.paneId : undefined),
    );
}
function focusPaneHeader(id = tab.value?.activePaneId) {
  if (lonePane.value) {
    focusActiveTab();
    return;
  }
  root.value
    ?.querySelector<HTMLElement>(
      tab.value?.maximizedPaneId
        ? ".maximized-pane-title"
        : narrow.value
          ? '.pane-pager [aria-current="true"]'
          : `[data-pane="${CSS.escape(id ?? "")}"] .pane-title`,
    )
    ?.focus({ preventScroll: true });
}
function focusActiveTab() {
  (
    tablist.value?.querySelector<HTMLElement>('[aria-selected="true"]') ??
    root.value?.querySelector<HTMLElement>(".mobile-tab-trigger, .new-tab")
  )?.focus({ preventScroll: true });
}
function selectTab(id: string, focus = true, control = "tab") {
  recordIntent({ type: "select-tab", tabId: id }, control);
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
  selectTab(props.state.tabs[next]!.id, true, "keyboard");
}
function createTab() {
  recordIntent({ type: "new-tab" });
  void nextTick(focusActiveTab);
}
function tabHasActivity(id: string) {
  return props.hasActivity?.(id) ?? false;
}
function back(): boolean {
  if (maximizedHeader.value?.back()) return true;
  for (const menu of [...overviewMenus.value, surfaceMenu.value]) {
    if (menu?.back()) return true;
  }
  if (dialog.value?.open) {
    close();
    return true;
  }
  if (dragging.value) {
    dragging.value = null;
    return true;
  }
  return false;
}
watch(
  [
    () => props.state.activeTabId,
    () => paneIds.value.includes(selectedPane.value),
  ],
  ([activeId, hasSource], [previousId]) => {
    if (
      dialog.value?.open &&
      (mode.value === "pane" || mode.value === "move") &&
      (activeId !== previousId || !hasSource)
    )
      dismiss(false);
  },
);
defineExpose({ back, focusPaneHeader });
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
        v-if="showNavigation"
        class="open-navigation"
        :aria-controls="navigationId"
        :aria-expanded="navigationOpen"
        icon="menu"
        :label="t('navigation.openNavigation')"
        @click="emit('navigation', $event)"
      />
      <div v-if="!narrow" ref="tabNavigation" class="tab-navigation">
        <div
          v-if="tab"
          ref="tablist"
          class="topic-tabs"
          role="tablist"
          :aria-label="t('layoutUi.tabs')"
          aria-orientation="horizontal"
        >
          <div
            v-for="(item, index) in state.tabs"
            :key="item.id"
            role="presentation"
            class="topic-tab"
            :class="{ selected: state.activeTabId === item.id }"
          >
            <SituateButton
              variant="plain"
              :id="`${instanceId}-topic-${item.id}`"
              class="topic-tab-select"
              role="tab"
              :aria-selected="state.activeTabId === item.id"
              :aria-controls="`${instanceId}-panel-${item.id}`"
              :tabindex="state.activeTabId === item.id ? 0 : -1"
              :title="t('layoutUi.title', { title: tabName(item) })"
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
              <span data-localization-content="user">{{ tabName(item) }}</span>
              <span class="tab-activity">
                <WorkingIndicator
                  v-if="tabHasActivity(item.id)"
                  :label="t('layoutUi.working')"
                />
              </span>
            </SituateButton>
            <SituateButton
              variant="plain"
              type="button"
              class="tab-close"
              :tabindex="state.activeTabId === item.id ? 0 : -1"
              :aria-label="
                t('layoutUi.namedCloseTab', { title: tabName(item) })
              "
              :title="t('layoutUi.closeTab')"
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
          :label="t('layoutUi.allTabs')"
          @click="open('all', $event)"
        />
      </div>
      <div
        v-else-if="tab"
        class="mobile-tabs"
        :role="multipleTabs ? undefined : 'tablist'"
        :aria-label="t('layoutUi.tabs')"
      >
        <SituateButton
          variant="plain"
          :id="multipleTabs ? undefined : `${instanceId}-topic-${tab.id}`"
          class="mobile-tab-trigger"
          :role="multipleTabs ? undefined : 'tab'"
          :aria-selected="multipleTabs ? undefined : true"
          :aria-controls="
            multipleTabs ? undefined : `${instanceId}-panel-${tab.id}`
          "
          :aria-haspopup="multipleTabs ? 'dialog' : undefined"
          :title="t('layoutUi.title', { title: tabName(tab) })"
          @click="multipleTabs ? open('all', $event) : selectTab(tab.id)"
        >
          <span
            :id="`${instanceId}-mobile-active-tab`"
            data-localization-content="user"
            >{{ tabName(tab) }}</span
          >
          <template v-if="multipleTabs"
            ><small>{{ tabCount }}</small
            ><SituateIcon name="chevron"
          /></template>
          <span class="tab-activity">
            <WorkingIndicator
              v-if="tabHasActivity(tab.id)"
              :label="t('layoutUi.working')"
            />
          </span>
        </SituateButton>
      </div>
      <div v-else class="empty-tab-space" />
      <SituateIconButton
        v-if="!narrow || !tab"
        icon="plus"
        :label="t('layoutUi.newTab')"
        class="new-tab"
        @click="createTab"
      />
      <TabActions
        v-if="tab && !narrow"
        ref="surfaceMenu"
        bulk
        :can-close-others="multipleTabs"
        @close-all="act({ type: 'close-all-tabs' })"
        @close-others="act({ type: 'close-other-tabs', tabId: tab.id })"
        :can-reopen="state.closedTabs.length > 0"
        @reopen="act({ type: 'reopen-tab' })"
        :key="tab.id"
        :label="t('layoutUi.tabOptions')"
        @rename="renameTab(tab.id, 'surface', $event)"
        @close="closeTab(tab.id, 'surface')"
      />
      <div v-if="tab && focusPane && lonePane" class="surface-pane-actions">
        <PaneHistory
          :pane="focusPane"
          @navigate="
            paneAction({
              type: 'history',
              tabId: tab.id,
              paneId: focusPane.id,
              delta: $event,
            })
          "
        />
        <SituateIconButton
          v-if="!narrow"
          class="surface-pane-options"
          icon="split"
          :label="
            t('layoutUi.namedPaneOptions', { title: paneTitle(focusPane) })
          "
          @click="open('pane', $event, focusPane.id)"
        />
      </div>
      <TabActions
        v-if="tab && narrow"
        ref="surfaceMenu"
        bulk
        :can-close-others="multipleTabs"
        @close-all="act({ type: 'close-all-tabs' })"
        @close-others="act({ type: 'close-other-tabs', tabId: tab.id })"
        :can-reopen="state.closedTabs.length > 0"
        @reopen="act({ type: 'reopen-tab' })"
        :key="tab.id"
        surface
        :include-layout="lonePane"
        :label="
          lonePane ? t('layoutUi.surfaceActions') : t('layoutUi.tabOptions')
        "
        @create="createTab"
        @layout="open('pane', $event, focusPane?.id)"
        @rename="renameTab(tab.id, 'surface', $event)"
        @close="closeTab(tab.id, 'surface')"
      />
    </header>
    <div class="topic-workarea">
      <section
        v-for="item in state.tabs.filter(
          (item) => !narrow && item.id !== state.activeTabId,
        )"
        :id="`${instanceId}-panel-${item.id}`"
        :key="item.id"
        role="tabpanel"
        :aria-labelledby="`${instanceId}-topic-${item.id}`"
        hidden
      />
      <section
        v-if="tab"
        :id="`${instanceId}-panel-${tab.id}`"
        :role="narrow && multipleTabs ? 'region' : 'tabpanel'"
        :aria-labelledby="
          narrow && multipleTabs
            ? `${instanceId}-mobile-active-tab`
            : `${instanceId}-topic-${tab.id}`
        "
        class="topic-panel"
      >
        <MaximizedPaneHeader
          v-if="tab.maximizedPaneId && focusPane && !lonePane"
          :key="tab.id"
          ref="maximizedHeader"
          :pane="focusPane"
          :panes="pagerPanes"
          @select="
            recordIntent({
              type: 'select-pane',
              tabId: tab.id,
              paneId: $event,
            })
          "
          @restore="
            act({ type: 'maximize', tabId: tab.id, paneId: focusPane.id })
          "
          @history="
            paneAction({
              type: 'history',
              tabId: tab.id,
              paneId: focusPane.id,
              delta: $event,
            })
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
              paneAction({
                type: 'history',
                tabId: tab.id,
                paneId: focusPane.id,
                delta: $event,
              })
            "
          />
          <PanePager
            :key="tab.id"
            :panes="pagerPanes"
            :active="tab.activePaneId"
            @select="
              recordIntent({
                type: 'select-pane',
                tabId: tab.id,
                paneId: $event,
              })
            "
          />
          <SituateIconButton
            icon="more"
            :label="
              t('layoutUi.namedPaneOptions', { title: paneTitle(focusPane) })
            "
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
              :tab="tab"
              :title-for="titleFor"
              active
              :dragging="null"
              :maximized="true"
              :compact="narrow || lonePane || !!tab.maximizedPaneId"
              @intent="paneAction"
              @options="(id, event) => open('pane', event, id)"
              ><template #pane="slotProps"
                ><slot name="pane" v-bind="slotProps" /></template
            ></PaneTile>
            <SplitLayout
              v-else
              :node="tab.layout"
              :tab="tab"
              :title-for="titleFor"
              :dragging="dragging"
              @intent="paneAction"
              @options="(id, event) => open('pane', event, id)"
              @drag="dragging = $event"
              ><template #pane="slotProps"
                ><slot name="pane" v-bind="slotProps" /></template
            ></SplitLayout>
          </div>
        </div>
      </section>
    </div>
    <SituateDialog
      ref="dialogControl"
      :id="`${instanceId}-topic-layout-dialog`"
      class="topic-dialog"
      :class="{ 'mobile-sheet': narrow }"
      :aria-labelledby="`${instanceId}-topic-dialog-title`"
      @cancel.prevent="close"
      @click="$event.target === dialog && close()"
    >
      <template #header>
        <h2 :id="`${instanceId}-topic-dialog-title`">{{ title }}</h2>
        <SituateIconButton
          icon="close"
          :label="t('layoutUi.close')"
          @click="close"
        />
      </template>
      <form
        v-if="mode === 'tab' && editedTab"
        class="rename-form"
        @submit.prevent="saveName"
      >
        <label :for="`${instanceId}-tab-name`" class="sr-only">{{
          t("layoutUi.nameLabel")
        }}</label>
        <SituateInput
          :id="`${instanceId}-tab-name`"
          v-model="name"
          :placeholder="tabName({ ...editedTab, name: '' })"
        />
        <SituateDialogActions
          ><SituateButton variant="secondary" type="button" @click="close">
            {{ t("layoutUi.cancel") }}</SituateButton
          ><SituateButton variant="primary" type="submit">
            {{ t("layoutUi.save") }}
          </SituateButton>
        </SituateDialogActions>
      </form>
      <div v-else-if="mode === 'pane' && tab" class="pane-actions">
        <SituateButton
          variant="ghost"
          @click="
            act({
              type: 'split',
              tabId: tab.id,
              paneId: selectedPane,
              edge: 'right',
            })
          "
        >
          <SituateIcon name="split" />{{ t("layoutUi.splitRight") }}
        </SituateButton>
        <SituateButton
          variant="ghost"
          @click="
            act({
              type: 'split',
              tabId: tab.id,
              paneId: selectedPane,
              edge: 'bottom',
            })
          "
        >
          <SituateIcon name="split" class="rotate-icon" />{{
            t("layoutUi.splitBelow")
          }}
        </SituateButton>
        <SituateButton
          variant="ghost"
          v-if="paneIds.length > 1"
          @click="mode = 'move'"
        >
          <SituateIcon name="grip" />{{ t("layoutUi.movePane") }}
        </SituateButton>
        <SituateButton
          variant="ghost"
          v-if="!narrow && paneIds.length > 1"
          @click="
            act({ type: 'maximize', tabId: tab.id, paneId: selectedPane })
          "
        >
          <SituateIcon :name="tab.maximizedPaneId ? 'restore' : 'expand'" />{{
            tab.maximizedPaneId ? t("layoutUi.restore") : t("layoutUi.maximize")
          }}
        </SituateButton>
        <SituateButton
          variant="ghost"
          @click="
            act({ type: 'close-pane', tabId: tab.id, paneId: selectedPane })
          "
        >
          <SituateIcon name="close" />{{ t("layoutUi.closePane") }}
        </SituateButton>
      </div>
      <form
        v-else-if="mode === 'move' && tab && paneIds.includes(selectedPane)"
        class="move-pane-form"
        @submit.prevent="
          act({
            type: 'move',
            tabId: tab.id,
            paneId: selectedPane,
            targetPaneId: target,
            edge,
          })
        "
      >
        <p class="move-pane-source">
          {{
            t("layoutUi.movingPane", {
              title: paneTitle(paneById(selectedPane)),
            })
          }}
        </p>
        <label :for="`${instanceId}-move-target`">{{
          t("layoutUi.target")
        }}</label
        ><SituateSelect
          :id="`${instanceId}-move-target`"
          :value="target"
          @change="target = ($event.target as HTMLSelectElement).value"
        >
          <option
            v-for="id in paneIds.filter((id) => id !== selectedPane)"
            :key="id"
            :value="id"
          >
            {{
              t("layoutUi.numberedPane", {
                index: paneIds.indexOf(id) + 1,
                title: paneTitle(paneById(id)),
              })
            }}
          </option>
        </SituateSelect>
        <label :for="`${instanceId}-move-position`">{{
          t("layoutUi.position")
        }}</label
        ><SituateSelect
          :id="`${instanceId}-move-position`"
          :value="edge"
          @change="
            edge = ($event.target as HTMLSelectElement).value as PaneEdge
          "
        >
          <option v-for="value in edges" :key="value" :value="value">
            {{ edgeTitle(value) }}
          </option>
        </SituateSelect>
        <SituateDialogActions
          ><SituateButton variant="secondary" type="button" @click="close">
            {{ t("layoutUi.cancel") }}</SituateButton
          ><SituateButton variant="primary" type="submit">
            {{ t("layoutUi.move") }}
          </SituateButton>
        </SituateDialogActions>
      </form>
      <div v-else-if="mode === 'all'" class="all-tab-list">
        <div
          v-for="item in state.tabs"
          :key="item.id"
          class="tab-sheet-row"
          :class="{ 'tab-sheet-row--current': item.id === state.activeTabId }"
        >
          <SituateButton
            variant="plain"
            class="tab-sheet-select"
            :aria-current="item.id === state.activeTabId ? 'true' : undefined"
            @click="act({ type: 'select-tab', tabId: item.id })"
          >
            <span class="tab-sheet-copy">
              <span class="tab-sheet-title" data-localization-content="user">{{
                tabName(item)
              }}</span>
              <span class="tab-sheet-meta">
                {{
                  paneOrder(item.layout).length === 1
                    ? t("layoutUi.onePane")
                    : t("layoutUi.paneTotal", {
                        count: paneOrder(item.layout).length,
                      })
                }}<template v-if="tabHasActivity(item.id)">
                  · {{ t("layoutUi.working") }}</template
                >
              </span>
            </span>
            <SituateIcon
              v-if="item.id === state.activeTabId"
              name="check"
              class="tab-sheet-current"
            />
          </SituateButton>
          <TabActions
            ref="overviewMenus"
            class="tab-sheet-options"
            :data-tab-actions="item.id"
            :label="t('layoutUi.namedTabOptions', { title: tabName(item) })"
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
            <SituateIcon name="history" />{{ t("layoutUi.reopenTab") }}
          </SituateButton>
          <SituateButton
            variant="secondary"
            size="small"
            class="sheet-new-tab"
            @click="act({ type: 'new-tab' })"
          >
            <SituateIcon name="plus" />{{ t("layoutUi.newTab") }}
          </SituateButton>
        </footer>
      </div>
    </SituateDialog>
  </main>
</template>

<style scoped>
.topic-window {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding-top: var(--app-safe-area-top, env(safe-area-inset-top, 0px));
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
.mobile-tabs,
.empty-tab-space {
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
  flex: 1;
  gap: 4px;
  padding: 2px;
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
.tab-close {
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
.tab-close:hover {
  background: color-mix(in srgb, var(--situate-ink) 8%, transparent);
}
@media (hover: none), (pointer: coarse) {
  .tab-close {
    flex-basis: 44px;
    width: 44px;
    height: 44px;
  }
}
.tab-activity {
  display: inline-flex;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
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
.topic-dialog form > label:not(.sr-only) {
  display: block;
  margin: 16px 0 8px;
  font-size: 14px;
}
.topic-dialog input {
  display: block;
  width: 100%;
  min-height: 48px;
  padding: 8px 12px;
  border-radius: 10px;
}
.pane-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pane-actions button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 14px;
  min-height: 48px;
  padding: 10px;
  border: 0;
  border-radius: 10px;
  text-align: start;
  font-size: 14px;
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
.topic-dialog.mobile-sheet[open] {
  top: calc(var(--app-viewport-top, 0px) + var(--app-viewport-height, 100dvh));
  bottom: auto;
  transform: translateY(-100%);
  margin-block: 0;
  width: min(100%, 520px);
  max-width: 100%;
  max-height: max(0px, calc(var(--app-viewport-height, 100dvh) - 12px));
  padding: 24px;
  padding-bottom: max(
    24px,
    var(--app-safe-area-bottom, env(safe-area-inset-bottom, 0px))
  );
  border-radius: 24px 24px 0 0;
}
.pane-actions button:disabled {
  color: var(--situate-control-line);
}
</style>
