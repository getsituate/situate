<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import ConversationRow from "./ConversationRow.vue";
import { computed, nextTick, ref, useId, watch } from "vue";
import {
  activeTab,
  currentTarget,
  type TabsState,
  type TabsAction,
  type PinnedView,
} from "../tabs/model";
import { catalogView, viewCatalog } from "../tabs/catalog";
import copy from "../localization/en.tabs.json";
import { SituateIconButton, SituateButton, SituateIcon as UiIcon } from "../ui";
import SituateIcon from "./NavigationIcon.vue";
import { views } from "./fixtures";
import {
  archiveConversation,
  conversationStatus,
  openChat,
  openView,
  type NavigationState,
  type ViewId,
} from "./model";
import { useNavigationState } from "./use-navigation-state";
const props = defineProps<{
  state: NavigationState;
  topics?: TabsState;
  hiddenViews?: string[];
}>();
const root = ref<HTMLElement>();
const moreOpen = ref(false);
const moreId = useId();
const emit = defineEmits<{
  "update:state": [state: NavigationState];
  navigate: [];
  topicAction: [action: TabsAction];
}>();
const { state, update } = useNavigationState(
  () => props.state,
  (value) => emit("update:state", value),
);
const pinned = computed(() =>
  props.topics
    ? props.topics.pinnedViews.map(catalogView)
    : views.slice(state.value.scene === "dashboard" ? 0 : 1, 4),
);
const more = computed(() =>
  props.topics
    ? viewCatalog.filter((view) => !props.topics!.pinnedViews.includes(view.id))
    : views.slice(4).filter((view) => !props.hiddenViews?.includes(view.id)),
);
const directViews = computed(() =>
  pinned.value.length ? pinned.value : more.value,
);
const hasMore = computed(
  () => pinned.value.length > 0 && more.value.length > 0,
);
watch(hasMore, (value) => {
  if (!value) moreOpen.value = false;
});
const selected = computed(() => {
  const tab = props.topics && activeTab(props.topics);
  return tab
    ? currentTarget(tab.panes[tab.active]!)
    : props.topics
      ? null
      : state.value.activeTab;
});
const conversations = computed(() =>
  props.topics
    ? Object.values(props.topics.conversations).map((item) => ({
        ...item,
        status: item.activity,
      }))
    : state.value.conversations,
);
const archive = computed(() =>
  conversations.value.filter((item) => item.archived),
);
function navigateView(id: PinnedView) {
  if (props.topics) emit("topicAction", { type: "navigate", view: id });
  else update(openView(state.value, id as ViewId));
  emit("navigate");
}
function newConversation() {
  if (props.topics) emit("topicAction", { type: "new-conversation" });
  else update(openChat(state.value));
  emit("navigate");
}
function openConversation(id: string) {
  if (!props.topics) return;
  emit("topicAction", {
    type: "navigate",
    view: id === "garden" ? "chat" : `conversation:${id}`,
  });
  emit("navigate");
}
function renameItem(id: string, title: string) {
  if (props.topics)
    emit("topicAction", { type: "rename-conversation", id, title });
  else
    update({
      ...state.value,
      conversations: state.value.conversations.map((item) =>
        item.id === id ? { ...item, title } : item,
      ),
    });
}
function archiveItem(id: string) {
  if (props.topics) emit("topicAction", { type: "archive-conversation", id });
  else update(archiveConversation(state.value, id));
}
async function pin(id: PinnedView) {
  if (!props.topics) return;
  if (!props.topics.pinnedViews.length || props.topics.pinnedViews.includes(id))
    moreOpen.value = true;
  emit("topicAction", { type: "pin-view", view: id });
  await nextTick();
  root.value?.querySelector<HTMLElement>(`[data-view-pin="${id}"]`)?.focus();
}
function status(value: string) {
  return props.topics
    ? value === "working"
      ? copy.working
      : copy.ready
    : conversationStatus(value);
}
</script>

<template>
  <div ref="root" class="navigation-sidebar">
    <section :aria-label="copy.viewsHeading">
      <div class="section-heading views-heading">
        <h2>{{ copy.viewsHeading }}</h2>
        <SituateButton
          v-if="hasMore"
          variant="ghost"
          size="small"
          type="button"
          class="more-views"
          :aria-label="copy.moreViewsLabel"
          :aria-expanded="moreOpen"
          :aria-controls="moreId"
          @click="moreOpen = !moreOpen"
        >
          <span class="more-views-content" aria-hidden="true">
            <span>{{ copy.moreViewsLabel }}</span>
            <UiIcon name="chevron" />
          </span>
        </SituateButton>
      </div>
      <div
        v-for="view in directViews"
        :key="view.id"
        class="nav-row"
        :class="{ selected: selected === view.id }"
      >
        <SituateButton
          variant="plain"
          type="button"
          class="destination"
          :aria-current="selected === view.id ? 'page' : undefined"
          @click="navigateView(view.id)"
        >
          <SituateIcon :name="view.icon" />{{ view.label }}
        </SituateButton>
        <SituateIconButton
          :label="
            (pinned.length ? copy.unpinView : copy.pinView).replace(
              '{view}',
              view.label,
            )
          "
          :data-view-pin="view.id"
          :disabled="!topics"
          :aria-pressed="pinned.length > 0"
          :unavailable-reason="
            topics ? undefined : 'Pinned views cannot be changed.'
          "
          @click="pin(view.id)"
          ><SituateIcon name="pin" :filled="pinned.length > 0"
        /></SituateIconButton>
      </div>
      <div
        :id="moreId"
        v-show="hasMore && moreOpen"
        class="additional-views"
        role="group"
        :aria-label="copy.moreViews"
      >
        <p class="additional-views-label">{{ copy.moreViews }}</p>
        <div
          v-for="view in hasMore ? more : []"
          :key="view.id"
          class="nav-row"
          :class="{ selected: selected === view.id }"
        >
          <SituateButton
            variant="plain"
            type="button"
            class="destination"
            :aria-current="selected === view.id ? 'page' : undefined"
            @click="navigateView(view.id)"
          >
            <SituateIcon :name="view.icon" />{{ view.label }}
          </SituateButton>
          <SituateIconButton
            :label="copy.pinView.replace('{view}', view.label)"
            :data-view-pin="view.id"
            :disabled="!topics"
            :aria-pressed="false"
            :unavailable-reason="
              topics ? undefined : 'Pinned views cannot be changed.'
            "
            @click="pin(view.id)"
            ><SituateIcon name="pin"
          /></SituateIconButton>
        </div>
      </div>
    </section>
    <section :aria-label="copy.conversationHeading" class="conversations">
      <div class="section-heading">
        <h2>{{ copy.conversationHeading }}</h2>
        <SituateIconButton
          icon="plus"
          :label="topics ? copy.newConversation : 'Open chat'"
          @click="newConversation"
        />
      </div>
      <slot name="conversation-items" />
      <ConversationRow
        v-for="item in conversations.filter((item) => !item.archived)"
        :key="item.id"
        :title="item.title"
        :navigable="!!topics"
        :status="status(item.status)"
        :working="item.status === 'working'"
        :needs-approval="item.status === 'approval'"
        :selected="
          selected ===
          (item.id === 'garden' ? 'chat' : `conversation:${item.id}`)
        "
        archivable
        @open="openConversation(item.id)"
        @rename="renameItem(item.id, $event)"
        @archive="archiveItem(item.id)"
      />
      <SituateDisclosure>
        <template #label>
          {{ copy.archive }} <span>{{ archive.length }}</span>
        </template>
        <div
          v-for="item in archive"
          :key="item.id"
          class="nav-row conversation"
        >
          <div>
            {{ item.title }}<small>{{ status(item.status) }}</small>
          </div>
          <SituateIconButton
            :label="copy.restoreConversation.replace('{title}', item.title)"
            @click="archiveItem(item.id)"
            ><SituateIcon name="restore"
          /></SituateIconButton>
        </div>
      </SituateDisclosure>
    </section>
  </div>
</template>

<style scoped>
.navigation-sidebar {
  min-width: 0;
}
h2 {
  margin: 0 12px 8px;
  color: var(--situate-muted);
  font-size: 12px;
  font-weight: 600;
}
.nav-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 48px;
  padding: 2px 4px 2px 12px;
  border-radius: var(--situate-radius-control);
  font-size: var(--situate-text-small);
}
.destination {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  min-height: 44px;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  overflow-wrap: anywhere;
}
.selected {
  background: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.selected .destination {
  text-decoration: underline;
  text-underline-offset: 4px;
}
:deep(summary) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  color: var(--situate-muted);
  font-size: 13px;
  cursor: pointer;
}
:deep(summary)::before {
  content: "›";
}
details[open] > :deep(summary)::before {
  content: "⌄";
}
:deep(summary) span {
  margin-left: auto;
}
.views-heading {
  min-height: 44px;
  gap: 4px;
}
.more-views.situate-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  min-height: var(--situate-target-min);
  padding: 0;
  border: 0;
  border-radius: var(--situate-radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--situate-muted);
  font-family: var(--situate-font-body);
  font-size: var(--situate-text-caption);
  font-weight: var(--situate-weight-emphasis);
  line-height: var(--situate-leading-body);
  -webkit-tap-highlight-color: transparent;
}
.more-views-content {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 10px 4px 12px;
  border-radius: inherit;
}
.more-views :deep(svg) {
  width: 14px;
  height: 14px;
  transform: rotate(-90deg);
}
.more-views[aria-expanded="true"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.more-views[aria-expanded="true"] .more-views-content,
.more-views:active .more-views-content {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.more-views[aria-expanded="true"] :deep(svg) {
  transform: rotate(0deg);
}
@media (hover: hover) {
  .more-views:not([aria-expanded="true"]):hover {
    color: var(--situate-ink);
  }
  .more-views:hover .more-views-content {
    background: var(--situate-accent-soft, var(--situate-lilac));
  }
}
.additional-views {
  margin-top: var(--situate-space-3);
  padding-top: var(--situate-space-3);
  border-top: var(--situate-stroke-divider) solid var(--situate-line);
}
.additional-views-label {
  margin: 0 var(--situate-space-3) var(--situate-space-1);
  color: var(--situate-muted);
  font-size: var(--situate-text-caption);
  font-weight: var(--situate-weight-emphasis);
}
.conversations {
  margin-top: 32px;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-heading h2 {
  margin-bottom: 0;
}
.conversation {
  min-height: 68px;
}
.conversation > div,
.conversation-destination {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
small {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  color: var(--situate-muted);
  font-size: 12px;
  font-weight: 400;
}
small :deep(svg) {
  width: 14px;
  height: 14px;
}
.conversation-destination {
  border: 0;
  background: transparent;
  color: inherit;
  text-align: start;
  padding: 8px 0;
  font: inherit;
}
.conversation-destination[aria-current="page"] {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  font-weight: 600;
}
.working {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
button:focus-visible,
:deep(summary):focus-visible {
  outline: var(--situate-stroke-focus) solid var(--situate-cobalt);
  outline-offset: var(--situate-focus-offset);
}
@media (hover: hover) {
  .nav-row:hover {
    background: var(--situate-accent-soft, var(--situate-lilac));
  }
}
.situate-icon-button[aria-pressed="true"]:not(:disabled) {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
</style>
