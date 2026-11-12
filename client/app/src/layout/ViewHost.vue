<script setup lang="ts">
import {
  computed,
  nextTick,
  onErrorCaptured,
  ref,
  shallowRef,
  watch,
} from "vue";
import { t } from "@situate/localization";
import { SituateButton, SituateIcon, SituateIconButton } from "@situate/ui";
import {
  currentEntry,
  type PresentationValue,
  type ViewTarget,
} from "./navigation";
import type { Pane, TopicTab } from "./model";
import type { WorkspaceUi } from "./runtime";
import { viewType } from "./registry";
import { reportFailure } from "../diagnostics/failures";
import { recoveryMode, pluginMayExecute } from "../recovery";

const props = defineProps<{
  ui: WorkspaceUi;
  pane: Pane;
  tab: TopicTab;
  workspaceName: string;
}>();
const emit = defineEmits<{
  newConversation: [];
  reference: [value: unknown];
  identity: [value: unknown];
  error: [value: unknown];
  plugins: [id?: string];
}>();
const ticket = props.ui.session.capture({
  tabId: props.tab.id,
  paneId: props.pane.id,
});
const entry = computed(() => currentEntry(props.pane.navigation));
const definition = computed(() =>
  props.ui.registry.definitions.get(viewType(entry.value.target)),
);
const plugins = shallowRef<Awaited<WorkspaceUi["plugins"]>>();
void props.ui.plugins
  ?.then((runtime) => {
    plugins.value = runtime;
  })
  .catch(() => undefined);
const suspendedPlugin = computed(() => {
  const target = entry.value.target;
  if (definition.value || target.kind !== "view" || recoveryMode() !== true)
    return;
  const id = target.viewId.split(":")[0]!;
  return target.viewId.includes(":") &&
    plugins.value?.state.plugins.some(
      (plugin) => plugin.id === id && plugin.enabled,
    ) &&
    !pluginMayExecute(props.ui.session.workspaceId, id)
    ? id
    : undefined;
});
const resuming = ref(false);
async function resume() {
  if (!suspendedPlugin.value || resuming.value) return;
  resuming.value = true;
  try {
    await (await props.ui.plugins)?.resume(suspendedPlugin.value);
  } catch (error) {
    emit("error", error);
  } finally {
    resuming.value = false;
  }
}
const failed = ref(false);
const retry = ref(0);
const showAll = ref(false);
const chooser = ref<HTMLElement>();
async function browseAll(all: boolean) {
  showAll.value = all;
  await nextTick();
  chooser.value
    ?.querySelector<HTMLElement>(all ? ".chooser-back" : ".all-views")
    ?.focus({ preventScroll: true });
}
const available = computed(() =>
  [...props.ui.registry.definitions.values()].filter(
    (view) => !["conversation", "empty"].includes(view.id),
  ),
);
const pins = computed(() => props.ui.session.state.document?.pinnedViews ?? []);
const choices = computed(() =>
  showAll.value
    ? available.value
    : pins.value.flatMap((id) =>
        available.value.filter((view) => view.id === id),
      ),
);
watch(
  () => entry.value.id,
  () => {
    failed.value = false;
    showAll.value = false;
  },
);
onErrorCaptured((error) => {
  reportFailure("view", error, props.ui.session.workspaceId);
  failed.value = true;
  return false;
});
function retain(value: PresentationValue) {
  if (!props.ui.session.current(ticket)) return;
  props.ui.session.dispatch({
    type: "retain-presentation",
    tabId: props.tab.id,
    paneId: props.pane.id,
    entryId: entry.value.id,
    presentation: value,
  });
}
function open(target: ViewTarget, presentation?: PresentationValue) {
  void props.ui.coordinator
    .open(target, ticket, undefined, presentation)
    .catch((error: unknown) => emit("error", error));
}
const viewProps = computed(() => {
  const target = entry.value.target;
  const common = {
    workspaceId: props.ui.session.workspaceId,
    workspaceName: props.workspaceName,
    embedded: true,
    presentation: entry.value.presentation,
  };
  if (target.kind === "conversation" || target.kind === "new-conversation")
    return {
      ...common,
      workspaceScope: props.ui.session.workspaceId,
      conversationId: target.conversationId,
      navigationId: "",
      navigationOpen: false,
    };
  if (target.kind === "view")
    return {
      ...common,
      target: { contentId: target.contentId, revision: target.revision },
    };
  return common;
});
</script>

<template>
  <section
    v-if="entry.target.kind === 'empty'"
    ref="chooser"
    class="view-chooser"
    :aria-label="t('layoutHost.chooseView')"
  >
    <div class="chooser-content">
      <SituateButton
        variant="plain"
        v-if="showAll"
        type="button"
        class="chooser-back"
        @click="browseAll(false)"
      >
        <SituateIcon name="back" />{{ t("layoutHost.back") }}
      </SituateButton>
      <h2>
        {{ showAll ? t("layoutHost.allViews") : t("layoutHost.chooserTitle") }}
      </h2>
      <SituateButton
        variant="plain"
        v-if="!showAll"
        class="new-conversation"
        type="button"
        @click="emit('newConversation')"
      >
        <SituateIcon name="chat" /><span>{{ t("navigation.newChat") }}</span
        ><SituateIcon name="plus" />
      </SituateButton>
      <section
        :aria-label="
          showAll ? t('layoutHost.allViews') : t('layoutHost.pinnedViews')
        "
      >
        <h3 v-if="!showAll">{{ t("layoutHost.pinnedViews") }}</h3>
        <div class="view-choices">
          <div v-for="view in choices" :key="view.id" class="view-choice">
            <SituateButton
              variant="plain"
              class="choose-view"
              type="button"
              @click="open({ kind: 'view', viewId: view.id })"
            >
              <SituateIcon :name="view.icon" /><span
                data-localization-content="user"
                >{{ view.title() }}</span
              ><SituateIcon name="forward" />
            </SituateButton>
            <SituateIconButton
              v-if="showAll"
              icon="pin"
              :label="
                pins.includes(view.id)
                  ? t('layoutHost.unpin', { title: view.title() })
                  : t('layoutHost.pin', { title: view.title() })
              "
              :aria-pressed="pins.includes(view.id)"
              @click="ui.session.pin(view.id)"
            />
          </div>
        </div>
        <template v-if="!showAll && !choices.length">
          <p>{{ t("layoutHost.noPinnedViews") }}</p>
          <p class="chooser-help">{{ t("layoutHost.noPinnedHelp") }}</p>
        </template>
      </section>
      <SituateButton
        variant="plain"
        v-if="!showAll"
        type="button"
        class="all-views"
        @click="browseAll(true)"
      >
        {{ t("layoutHost.allViews") }}<SituateIcon name="forward" />
      </SituateButton>
    </div>
  </section>
  <section v-else-if="suspendedPlugin" class="view-message" role="status">
    <h2>{{ t("recovery.pausedView") }}</h2>
    <p>{{ t("recovery.risk") }}</p>
    <SituateButton :disabled="resuming" @click="resume">{{
      t("recovery.resume")
    }}</SituateButton>
    <SituateButton variant="secondary" @click="emit('plugins')">{{
      t("recovery.manage")
    }}</SituateButton>
    <SituateButton variant="ghost" @click="emit('plugins', suspendedPlugin)">{{
      t("pluginManagement.inspect")
    }}</SituateButton>
  </section>
  <section v-else-if="!definition || failed" class="view-message" role="status">
    <h2>
      {{
        failed ? t("layoutHost.viewFailed") : t("layoutHost.viewUnavailable")
      }}
    </h2>
    <p>{{ t("layoutHost.viewUnavailableHelp") }}</p>
    <SituateButton
      variant="plain"
      v-if="definition"
      type="button"
      @click="
        failed = false;
        retry++;
      "
    >
      {{ t("layoutHost.retry") }}
    </SituateButton>
    <SituateButton
      variant="secondary"
      type="button"
      @click="open({ kind: 'empty' })"
    >
      {{ t("layoutHost.chooseView") }}
    </SituateButton>
  </section>
  <Suspense v-else :key="`${entry.id}:${retry}`">
    <component
      :is="definition.component"
      v-bind="viewProps"
      @presentation="retain"
      @navigate="open"
      @leave="open({ kind: 'empty' })"
      @reference="emit('reference', $event)"
      @identity="emit('identity', $event)"
    />
    <template #fallback
      ><p class="view-message" role="status">
        {{ t("layoutHost.loading") }}
      </p></template
    >
  </Suspense>
</template>

<style scoped>
.view-chooser {
  height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  display: flex;
  padding: 32px 24px;
}
.chooser-content {
  width: min(440px, 100%);
  margin: auto;
}
.chooser-content h2 {
  margin: 0 0 24px;
  font-size: 24px;
  line-height: 1.25;
  letter-spacing: var(--situate-tracking-heading);
}
.chooser-content h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--situate-muted);
}
.new-conversation {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 56px;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 32px;
  border: 1px solid var(--situate-control-line);
  border-radius: 12px;
  background: var(--situate-surface);
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  text-align: start;
  font-weight: 600;
}
.new-conversation span {
  flex: 1;
}
.view-choice {
  display: flex;
  align-items: center;
  gap: 4px;
}
.choose-view {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
  min-height: 52px;
  padding: 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  text-align: start;
}
.choose-view span {
  flex: 1;
}
.choose-view svg {
  flex-shrink: 0;
  color: var(--situate-muted);
}
.chooser-content button {
  font-size: 14px;
}
.chooser-content button:hover {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
.all-views,
.chooser-back {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  border: 0;
  padding: 8px 12px;
  border-radius: 10px;
  background: transparent;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.all-views {
  margin-top: 16px;
}
.chooser-back {
  margin-bottom: 16px;
}
.chooser-content p {
  font-size: 14px;
  margin: 8px 0;
}
.chooser-help {
  color: var(--situate-muted);
}
@container pane (max-width: 360px) {
  .view-chooser {
    padding: 24px 20px;
  }
  .chooser-content h2 {
    font-size: 21px;
  }
}

.view-message {
  margin: auto;
  padding: 24px;
  max-width: 480px;
}
.view-message button {
  margin: 8px;
  min-height: 44px;
}
</style>
