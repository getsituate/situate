<script setup lang="ts">
import DictationSettings from "../dictation/DictationSettings.vue";
import { copy as dictationCopy } from "../dictation/content";
import type { DictationState, DictationAction } from "../dictation/model";
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import SituateSwitch from "../ui/SituateSwitch.vue";
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from "vue";
import { workshopNavigation } from "../workshop/content";
import SituateSelect from "../ui/SituateSelect.vue";
import {
  SituateIcon,
  SituateIconButton,
  SituateButton,
  SituateInput,
} from "../ui";
import EditorDialog from "../editor/EditorDialog.vue";
import AiView from "../ai/AiView.vue";
import ProviderIcon from "../ai/ProviderIcon.vue";
import { accessLabel } from "../ai/content";
import type { AiState } from "../ai/model";
import {
  settingsThinking,
  settingsThinkingUnavailable,
  setSettingsThinking,
} from "./thinking";
import { thinkingLabels, type ThinkingPreference } from "../chat/thinking";
import { modelChoiceCopy } from "../chat/content";
import { connectionCopy, deviceAiCopy, catalogCopy } from "./content";
import {
  connectionCatalog,
  catalogMessage,
  refreshModels,
  savedModelUnavailable,
} from "./catalog";
import {
  openConnection,
  connectionIssue,
  providerAttention,
  recoverProvider,
  updateConnection,
  categories,
  cloneSettings,
  dateFormats,
  disconnect,
  numberFormats,
  providerName,
  connectionName,
  renameConnection,
  saveShortcut,
  selectProvider,
  type SettingsPage,
  type SettingsState,
} from "./model";
import AppearanceSettings from "./AppearanceSettings.vue";
import UpdateSettings from "../updates/UpdateSettings.vue";
import AboutSituate from "../updates/AboutSituate.vue";
import type { UpdateState, UpdateAction } from "../updates/model";
import "./settings.css";
const props = defineProps<{
  state: SettingsState;
  dictation?: DictationState;
  updates?: UpdateState;
  workspaceName: string;
  showNavigation: boolean;
  navigationId: string;
  navigationOpen: boolean;
  mac: boolean;
  mobile: boolean;
}>();
const emit = defineEmits<{
  "update:state": [state: SettingsState];
  openNavigation: [event: MouseEvent];
  plugins: [];
  dictationAction: [action: DictationAction];
  updateAction: [action: UpdateAction];
}>();
const state = shallowRef(props.state);
watch(
  () => props.state,
  (value) => {
    state.value = value;
  },
  { flush: "sync" },
);
function update(change: (state: SettingsState) => void) {
  const next = cloneSettings(state.value);
  change(next);
  if (JSON.stringify(next) === JSON.stringify(state.value)) return;
  state.value = next;
  emit("update:state", next);
}
function set<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
  update((s) => {
    s[key] = value;
  });
}
function value(event: Event) {
  return (event.target as HTMLInputElement).value;
}
const scrollArea = ref<HTMLElement>();
let resizeObserver: ResizeObserver | undefined;
function revealFocusedField() {
  const area = scrollArea.value;
  const focused = document.activeElement;
  if (
    !area ||
    !(focused instanceof HTMLElement) ||
    !area.contains(focused) ||
    focused.closest("dialog")
  )
    return;
  const field = focused.getBoundingClientRect(),
    bounds = area.getBoundingClientRect();
  if (field.bottom > bounds.bottom - 8)
    area.scrollTop += field.bottom - bounds.bottom + 8;
  else if (field.top < bounds.top + 8)
    area.scrollTop -= bounds.top + 8 - field.top;
}
onMounted(() => {
  if (typeof ResizeObserver !== "undefined" && scrollArea.value) {
    resizeObserver = new ResizeObserver(revealFocusedField);
    resizeObserver.observe(scrollArea.value);
  }
});
onBeforeUnmount(() => resizeObserver?.disconnect());
const title = ref<HTMLElement>();
const categoryNav = ref<HTMLElement>();
async function navigate(page: SettingsPage) {
  update((s) => {
    s.page = page;
    s.detail = true;
    s.notice = "";
  });
  await nextTick();
  title.value?.focus();
}
async function back() {
  set("detail", false);
  await nextTick();
  categoryNav.value
    ?.querySelector<HTMLButtonElement>('[aria-current="page"]')
    ?.focus();
}
const category = computed(() =>
  categories.find((c) => c.id === state.value.page)!,
);
const models = computed(() => connectionCatalog(state.value));
const availableModels = computed(() => models.value.models);
const manualModels = computed(() =>
  ["compatible", "llama.cpp"].includes(
    state.value.connections[state.value.provider]?.provider ?? "",
  ),
);
const activeConnection = computed(() =>
  state.value.useManaged
    ? state.value.managedAvailable
    : !!state.value.provider &&
      !connectionIssue(state.value, state.value.provider),
);
const thinkingModel = computed(() => settingsThinking(state.value));
const thinkingUnavailable = computed(() =>
  settingsThinkingUnavailable(state.value),
);
const custom = computed(
  () =>
    state.value.chatModel !== "recommended" ||
    (thinkingModel.value && thinkingModel.value.preference !== "recommended") ||
    state.value.showModelPicker ||
    state.value.activityModel !== "recommended",
);
const shortcuts = computed(() =>
  state.value.shortcuts.filter((s) =>
    `${s.name} ${s.group}`
      .toLowerCase()
      .includes(state.value.search.toLowerCase()),
  ),
);
const shortcut = computed(() =>
  state.value.shortcuts.find((s) => s.id === state.value.target),
);
function keyLabel(keys: string) {
  return keys
    ? keys.replace("Mod", props.mac ? "⌘" : "Ctrl").replaceAll("+", " + ")
    : "Not assigned";
}
function openDialog(
  kind: SettingsState["dialog"],
  target: string,
  event: MouseEvent,
) {
  (event.currentTarget as HTMLElement).focus();
  update((s) => {
    s.dialog = kind;
    s.target = target;
    s.shortcutError = "";
    s.nameError = "";
    s.nameDraft = connectionName(s, target);
    s.shortcutDraft = s.shortcuts.find((row) => row.id === target)?.keys ?? "";
  });
}
async function confirmDisconnect() {
  update(disconnect);
  await nextTick();
  document
    .querySelector<HTMLElement>(
      "#chat-provider:not(:disabled), .settings-section-title button",
    )
    ?.focus();
}
function closeDialog() {
  set("dialog", null);
}
async function useManaged() {
  update((s) => selectProvider(s, "situate"));
  await nextTick();
  document.querySelector<HTMLElement>("#chat-provider")?.focus();
}
function recover(provider: string) {
  update((s) => {
    recoverProvider(s, provider);
    if (s.setup) s.setup.mobile = props.mobile;
  });
}
async function connectionChanged(setup: AiState) {
  const reviewClosed =
    state.value.setup?.screen === "restriction" &&
    state.value.setup.warningIntent === "use" &&
    setup.screen === "settings";
  update((s) => {
    updateConnection(s, setup);
    if (reviewClosed) s.setup = null;
  });
  if (reviewClosed) {
    await nextTick();
    document
      .querySelector<HTMLElement>(
        `[data-provider-recovery="${setup.provider}"], [data-provider-manage="${setup.provider}"]`,
      )
      ?.focus();
  }
}
function connect(provider?: string, manage = false) {
  update((s) => {
    openConnection(s, provider, manage);
    s.setup!.mobile = props.mobile;
  });
}
async function returnToSettings() {
  update((s) => {
    s.setup = null;
    s.detail = true;
  });
  await nextTick();
  title.value?.focus();
}
function record(event: KeyboardEvent) {
  if (event.key === "Tab" || event.key === "Escape") return;
  event.preventDefault();
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    set(
      "shortcutError",
      "Hold Command, Control or Alt, then press another key.",
    );
    return;
  }
  update((s) => {
    s.shortcutDraft = [
      event.ctrlKey || event.metaKey ? "Mod" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      event.key.length === 1 ? event.key.toUpperCase() : event.key,
    ]
      .filter(Boolean)
      .join("+");
    s.shortcutError = "";
  });
}
</script>

<template>
  <section
    class="settings-view"
    :class="{ 'settings-detail-open': state.detail }"
    aria-label="Settings"
  >
    <div class="settings-layout">
      <nav
        ref="categoryNav"
        class="settings-categories"
        aria-label="Settings categories"
      >
        <header class="settings-category-heading">
          <SituateIconButton
            v-if="showNavigation"
            icon="menu"
            :label="workshopNavigation.openNavigation"
            :aria-controls="navigationId"
            :aria-expanded="navigationOpen"
            @click="emit('openNavigation', $event)"
          />
          <div>
            <h1>Settings</h1>
            <span v-if="showNavigation" class="settings-workspace">{{
              workspaceName
            }}</span>
          </div>
        </header>
        <SituateButton
          variant="plain"
          v-for="item in categories.filter(
            (item) =>
              (item.id !== 'dictation' || dictation) &&
              (item.id !== 'updates' ||
                (updates?.enabled && updates.channel === 'direct')),
          )"
          :key="item.id"
          type="button"
          :aria-current="state.page === item.id ? 'page' : undefined"
          @click="navigate(item.id)"
        >
          <SituateIcon
            v-if="item.id === 'dictation'"
            name="mic"
            class="category-symbol"
          />
          <SituateIcon
            v-else-if="item.id === 'updates' || item.id === 'about'"
            :name="item.id === 'about' ? 'info' : 'update'"
            class="category-symbol"
          />
          <span v-else class="category-symbol" aria-hidden="true">{{
            item.id === "formats"
              ? "Aa"
              : item.id === "ai"
                ? "✦"
                : item.id === "appearance"
                  ? "◐"
                  : "⌘"
          }}</span>
          <span>{{
            item.id === "dictation" && dictation
              ? dictationCopy(dictation.language).title
              : item.label
          }}</span
          ><span class="category-arrow" aria-hidden="true">›</span>
        </SituateButton>
        <SituateButton variant="plain" type="button" @click="emit('plugins')">
          <span class="category-symbol" aria-hidden="true">◇</span>
          <span>{{ workshopNavigation.plugins }}</span>
          <span class="category-arrow" aria-hidden="true">›</span>
        </SituateButton>
      </nav>
      <main
        ref="scrollArea"
        class="settings-content"
        @focusin="revealFocusedField"
      >
        <div class="settings-content-inner">
          <SituateButton
            variant="plain"
            class="settings-back"
            type="button"
            @click="back"
          >
            ‹ All settings
          </SituateButton>
          <header class="settings-page-heading">
            <SituateIconButton
              v-if="showNavigation"
              class="settings-detail-navigation"
              icon="menu"
              :label="workshopNavigation.openNavigation"
              :aria-controls="navigationId"
              :aria-expanded="navigationOpen"
              @click="emit('openNavigation', $event)"
            />
            <div>
              <h2 ref="title" tabindex="-1">
                {{
                  state.page === "dictation" && dictation
                    ? dictationCopy(dictation.language).title
                    : category.label
                }}
              </h2>
              <span
                v-if="showNavigation"
                class="settings-workspace settings-detail-navigation"
                >{{ workspaceName }}</span
              >
            </div>
          </header>
          <p
            v-if="state.page === 'ai'"
            class="settings-section-help"
            data-ai-scope
          >
            <strong>{{ deviceAiCopy.scope }}</strong
            ><br />
            {{ deviceAiCopy.scopeDetail }}
          </p>
          <p v-if="state.notice" class="settings-notice" role="status">
            {{ state.notice }}
          </p>

          <UpdateSettings
            v-if="state.page === 'updates' && updates"
            :state="updates"
            @action="emit('updateAction', $event)"
          />
          <AboutSituate
            v-else-if="state.page === 'about' && updates"
            :state="updates"
            @action="emit('updateAction', $event)"
          />
          <DictationSettings
            v-else-if="state.page === 'dictation' && dictation"
            :state="dictation"
            @action="emit('dictationAction', $event)"
          />
          <AppearanceSettings
            v-else-if="state.page === 'appearance'"
            :accent="state.accent"
            :workspace-name="workspaceName"
            @select="set('accent', $event)"
          />
          <div
            v-else-if="state.page === 'ai' && state.setup"
            class="settings-connection"
          >
            <SituateButton
              variant="ghost"
              size="small"
              type="button"
              class="settings-text-button settings-connection-back"
              @click="returnToSettings"
            >
              {{ connectionCopy.back }}
            </SituateButton>
            <AiView
              :state="{ ...state.setup, mobile }"
              :connection-context="{
                workspace: workspaceName,
                connected: state.connected.map(
                  (id) => state.connections[id]!.provider,
                ),
              }"
              @update:state="connectionChanged"
              @return-to-settings="returnToSettings"
            />
          </div>
          <template v-else-if="state.page === 'formats'">
            <section class="settings-group" aria-labelledby="language-heading">
              <h3 id="language-heading">Language</h3>
              <div class="setting-row">
                <div>
                  <label for="settings-language">Interface language</label>
                  <p id="language-help">
                    Your content and existing plugins keep their language.
                  </p>
                </div>
                <SituateSelect
                  id="settings-language"
                  :value="state.language"
                  aria-describedby="language-help"
                  @change="set('language', value($event) as 'en' | 'de')"
                  ><option value="en">English</option>
                  <option value="de">German</option></SituateSelect
                >
              </div>
              <p class="settings-footnote">
                Chat follows the language of your messages unless you ask for
                another.
              </p>
            </section>
            <section class="settings-group" aria-labelledby="formats-heading">
              <h3 id="formats-heading">Dates, time & numbers</h3>
              <div class="setting-row">
                <label for="settings-time">Time format</label
                ><SituateSelect
                  id="settings-time"
                  :value="state.formats.time"
                  @change="
                    update((s) => {
                      s.formats.time = value($event) as '12' | '24';
                    })
                  "
                  ><option value="24">24-hour · 14:30</option>
                  <option value="12">12-hour · 2:30 PM</option></SituateSelect
                >
              </div>
              <div class="setting-row">
                <label for="settings-date">Date format</label
                ><SituateSelect
                  id="settings-date"
                  :value="state.formats.date"
                  @change="
                    update((s) => {
                      s.formats.date = value(
                        $event,
                      ) as SettingsState['formats']['date'];
                    })
                  "
                  ><option
                    v-for="format in dateFormats"
                    :key="format.id"
                    :value="format.id"
                  >
                    {{ format.label }}
                  </option></SituateSelect
                >
              </div>
              <div class="setting-row">
                <label for="settings-number">Number format</label
                ><SituateSelect
                  id="settings-number"
                  :value="state.formats.number"
                  @change="
                    update((s) => {
                      s.formats.number = value(
                        $event,
                      ) as SettingsState['formats']['number'];
                    })
                  "
                  ><option
                    v-for="format in numberFormats"
                    :key="format.id"
                    :value="format.id"
                  >
                    {{ format.label }}
                  </option></SituateSelect
                >
              </div>
            </section>
          </template>

          <template v-else-if="state.page === 'ai'">
            <section class="settings-group" aria-labelledby="providers-heading">
              <div class="settings-section-title">
                <h3 id="providers-heading">{{ connectionCopy.heading }}</h3>
                <SituateButton
                  variant="ghost"
                  size="small"
                  class="settings-text-button"
                  type="button"
                  @click="connect()"
                >
                  {{ connectionCopy.add }}
                </SituateButton>
              </div>
              <div v-if="!state.connected.length" class="settings-empty">
                <h4>{{ deviceAiCopy.emptyTitle }}</h4>
                <p>{{ deviceAiCopy.emptyDetail }}</p>
              </div>
              <div
                v-for="id in state.connected"
                :key="id"
                class="provider-row"
                :data-connection="id"
              >
                <ProviderIcon :provider="state.connections[id]!.provider" />
                <div class="provider-description">
                  <strong>{{ connectionName(state, id) }}</strong>
                  <small
                    v-if="
                      connectionName(state, id) !==
                      providerName(state.connections[id]!.provider)
                    "
                    >{{ providerName(state.connections[id]!.provider) }}</small
                  >
                  <small v-if="!state.useManaged && state.provider === id">{{
                    connectionCopy.selected
                  }}</small
                  ><small>{{
                    providerAttention(state, id)
                      ? providerAttention(state, id)!.status
                      : state.connections[id]
                        ? `Connected · ${accessLabel(state.connections[id]!.method)}`
                        : "Connected"
                  }}</small>
                  <small v-if="state.connections[id]?.endpoint">{{
                    state.connections[id]!.endpoint
                  }}</small>
                </div>
                <div class="provider-actions">
                  <SituateButton
                    variant="secondary"
                    size="small"
                    v-if="providerAttention(state, id)?.action"
                    type="button"
                    :disabled="state.connectionStates[id]?.storeRetry"
                    :data-provider-recovery="id"
                    @click="recover(id)"
                  >
                    {{
                      state.connectionStates[id]?.storeRetry
                        ? connectionCopy.retrying
                        : providerAttention(state, id)!.action
                    }}
                  </SituateButton>
                  <SituateButton
                    variant="ghost"
                    size="small"
                    class="settings-text-button"
                    type="button"
                    :aria-label="
                      connectionCopy.manageProvider(connectionName(state, id))
                    "
                    :data-provider-manage="id"
                    @click="connect(id, true)"
                  >
                    {{ connectionCopy.manage }}
                  </SituateButton>
                  <SituateButton
                    variant="ghost"
                    size="small"
                    class="settings-text-button"
                    type="button"
                    :aria-label="`${connectionCopy.rename} ${connectionName(state, id)}`"
                    @click="openDialog('rename', id, $event)"
                  >
                    {{ connectionCopy.rename }}
                  </SituateButton>
                  <SituateButton
                    variant="ghost"
                    size="small"
                    class="settings-text-button"
                    type="button"
                    :aria-label="`Disconnect ${connectionName(state, id)}`"
                    @click="openDialog('disconnect', id, $event)"
                  >
                    Disconnect
                  </SituateButton>
                </div>
              </div>
            </section>
            <section
              v-if="state.managedAvailable || state.useManaged"
              class="settings-group"
              aria-labelledby="managed-heading"
            >
              <h3 id="managed-heading">{{ deviceAiCopy.managedTitle }}</h3>
              <p
                v-if="!state.managedAvailable"
                class="settings-attention"
                role="status"
              >
                {{ deviceAiCopy.managedUnavailable }}
              </p>
              <template v-else>
                <strong>{{ deviceAiCopy.managedAvailable }}</strong>
                <p>{{ deviceAiCopy.managedDetail }}</p>
                <p v-if="state.useManaged" role="status">
                  {{ deviceAiCopy.managedSelected }}
                </p>
                <SituateButton
                  variant="ghost"
                  size="small"
                  v-else
                  class="settings-text-button"
                  type="button"
                  @click="useManaged"
                >
                  {{ deviceAiCopy.managedUse }}
                </SituateButton>
              </template>
            </section>
            <section class="settings-group" aria-labelledby="chat-heading">
              <h3 id="chat-heading">Chat</h3>
              <div class="setting-row">
                <div>
                  <label for="chat-provider">{{
                    connectionCopy.selection
                  }}</label>
                  <p>{{ deviceAiCopy.providerHelp }}</p>
                </div>
                <SituateSelect
                  id="chat-provider"
                  :value="state.useManaged ? 'situate' : state.provider"
                  :disabled="!state.connected.length && !state.managedAvailable"
                  @change="update((s) => selectProvider(s, value($event)))"
                  ><option value="" disabled>
                    {{ connectionCopy.choose }}
                  </option>
                  <option
                    v-if="state.managedAvailable || state.useManaged"
                    value="situate"
                    :disabled="!state.managedAvailable"
                  >
                    {{ deviceAiCopy.managedTitle }}
                  </option>
                  <option v-for="id in state.connected" :key="id" :value="id">
                    {{ connectionName(state, id) }}
                  </option></SituateSelect
                >
              </div>
              <p
                v-if="
                  !state.useManaged && !state.provider && state.connected.length
                "
                class="settings-attention"
              >
                {{
                  state.connected.length
                    ? connectionCopy.selectBeforeChat
                    : "Connect a provider before sending a message."
                }}
              </p>
              <p
                v-else-if="
                  !state.useManaged && state.provider && !activeConnection
                "
                class="settings-attention"
                role="status"
              >
                {{
                  state.connectionStates[state.provider]?.storeRetry
                    ? connectionCopy.retryPending
                    : connectionIssue(state, state.provider) === "reconnect"
                      ? connectionCopy.reconnectProvider(
                          connectionName(state, state.provider),
                        )
                      : providerAttention(state, state.provider)?.detail
                }}
              </p>
              <div class="setting-row">
                <div>
                  <label for="activity-messages"
                    >AI-written progress updates</label
                  >
                  <p id="activity-help">
                    These updates use extra AI requests and may cost more. When
                    off, you’ll still see when Situate is working.
                  </p>
                </div>
                <SituateSwitch
                  id="activity-messages"
                  :checked="state.activity"
                  aria-describedby="activity-help"
                  @change="
                    set('activity', ($event.target as HTMLInputElement).checked)
                  "
                />
              </div>
            </section>
            <p v-if="state.useManaged" class="settings-footnote">
              {{ deviceAiCopy.managedModel }}
            </p>
            <SituateDisclosure
              v-else
              class="settings-advanced"
              :open="state.advanced"
              @toggle="
                set('advanced', ($event.target as HTMLDetailsElement).open)
              "
            >
              <template #label>
                Advanced settings<span v-if="custom">Customized</span>
              </template>
              <div class="advanced-body">
                <div class="setting-row">
                  <label for="chat-model">Chat model</label
                  ><SituateSelect
                    id="chat-model"
                    :disabled="!activeConnection || models.status === 'loading'"
                    :value="state.chatModel"
                    @change="set('chatModel', value($event))"
                    ><option value="recommended">Use recommended model</option>
                    <option
                      v-if="
                        state.chatModel !== 'recommended' &&
                        !availableModels.includes(state.chatModel)
                      "
                      :value="state.chatModel"
                      disabled
                    >
                      {{
                        savedModelUnavailable(state)
                          ? catalogCopy.unavailable(state.chatModel)
                          : state.chatModel
                      }}
                    </option>
                    <option
                      v-for="model in availableModels"
                      :key="model"
                      :value="model"
                    >
                      {{ model }}
                    </option></SituateSelect
                  >
                </div>

                <div class="setting-row">
                  <div>
                    <label for="chat-thinking">{{
                      modelChoiceCopy.thinking
                    }}</label>
                    <p v-if="!thinkingModel" id="chat-thinking-help">
                      {{ thinkingUnavailable.detail }}
                    </p>
                  </div>
                  <SituateSelect
                    id="chat-thinking"
                    :value="thinkingModel?.preference ?? ''"
                    :disabled="!activeConnection || !thinkingModel"
                    :aria-describedby="
                      !thinkingModel ? 'chat-thinking-help' : undefined
                    "
                    @change="
                      update((s) =>
                        setSettingsThinking(
                          s,
                          value($event) as ThinkingPreference,
                        ),
                      )
                    "
                  >
                    <option v-if="!thinkingModel" value="">
                      {{ thinkingUnavailable.label }}
                    </option>
                    <option v-if="thinkingModel" value="recommended">
                      {{
                        modelChoiceCopy.recommendedLevel(
                          thinkingLabels[thinkingModel.capability.default],
                        )
                      }}
                    </option>
                    <option
                      v-for="level in thinkingModel?.capability.levels ?? []"
                      :key="level"
                      :value="level"
                    >
                      {{ thinkingLabels[level] }}
                    </option>
                  </SituateSelect>
                </div>
                <section
                  v-if="state.provider"
                  class="connection-catalog"
                  :aria-label="catalogCopy.heading"
                >
                  <div class="settings-section-title">
                    <p role="status">
                      {{ catalogMessage(state) }}
                    </p>
                    <SituateButton
                      variant="ghost"
                      size="small"
                      class="settings-text-button"
                      type="button"
                      :disabled="
                        !activeConnection || models.status === 'loading'
                      "
                      @click="update((s) => refreshModels(s))"
                    >
                      {{ catalogCopy.refresh }}
                    </SituateButton>
                  </div>
                  <p>{{ catalogCopy.source[models.source] }}</p>
                  <p>{{ catalogCopy.listingDetail }}</p>
                  <p
                    v-if="savedModelUnavailable(state)"
                    class="settings-attention"
                    role="status"
                  >
                    {{ catalogCopy.unavailableDetail }}
                  </p>
                  <form
                    v-if="manualModels"
                    class="manual-model-form"
                    @submit.prevent="
                      update((s) => {
                        if (s.modelIdDraft.trim())
                          s.chatModel = s.modelIdDraft.trim();
                      })
                    "
                  >
                    <label for="settings-model-id">{{
                      catalogCopy.manual
                    }}</label>
                    <SituateInput
                      id="settings-model-id"
                      :value="state.modelIdDraft"
                      aria-describedby="settings-model-id-help"
                      autocomplete="off"
                      @input="set('modelIdDraft', value($event))"
                    />
                    <p id="settings-model-id-help">
                      {{ catalogCopy.manualHelp }}
                    </p>
                    <SituateButton
                      variant="ghost"
                      size="small"
                      type="submit"
                      class="settings-text-button"
                      :disabled="
                        !activeConnection ||
                        !state.modelIdDraft.trim() ||
                        models.status === 'loading'
                      "
                    >
                      {{ catalogCopy.manualSave }}
                    </SituateButton>
                  </form>
                </section>
                <div class="setting-row">
                  <div>
                    <label for="chat-picker">Show model picker in chat</label>
                    <p id="picker-help">
                      {{ deviceAiCopy.modelHelp }}
                    </p>
                  </div>
                  <SituateSwitch
                    id="chat-picker"
                    :checked="state.showModelPicker"
                    aria-describedby="picker-help"
                    @change="
                      set(
                        'showModelPicker',
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                </div>
                <div v-if="state.activity" class="setting-row">
                  <label for="activity-model">Model for progress updates</label
                  ><SituateSelect
                    id="activity-model"
                    :disabled="!activeConnection"
                    :value="state.activityModel"
                    @change="set('activityModel', value($event))"
                    ><option value="recommended">Use recommended model</option>
                    <option
                      v-for="model in availableModels"
                      :key="model"
                      :value="model"
                    >
                      {{ model }}
                    </option></SituateSelect
                  >
                </div>
                <p v-else class="settings-footnote">
                  Progress updates are off. Your model choice is kept.
                </p>
                <p v-if="!activeConnection" class="settings-footnote">
                  Choose a connected provider above to select models.
                </p>
              </div>
            </SituateDisclosure>
          </template>

          <template v-else>
            <label class="shortcut-search"
              ><span>Find an action</span
              ><SituateInput
                type="search"
                :value="state.search"
                placeholder="Search actions…"
                @input="set('search', value($event))"
            /></label>
            <p class="settings-section-help">
              These shortcuts work in Situate, not in other apps.
            </p>
            <div v-for="row in shortcuts" :key="row.id" class="setting-row">
              <div>
                <strong>{{ row.name }}</strong>
                <p>{{ row.group }}</p>
              </div>
              <SituateButton
                variant="plain"
                class="shortcut-key"
                type="button"
                :aria-label="`Change shortcut for ${row.name}`"
                @click="openDialog('shortcut', row.id, $event)"
              >
                {{ keyLabel(row.keys)
                }}<span v-if="row.keys !== row.original" class="shortcut-custom"
                  >Modified</span
                >
              </SituateButton>
            </div>
            <div v-if="!shortcuts.length" class="settings-empty">
              <h3>No matching actions</h3>
              <p>Try a different name or clear the search.</p>
              <SituateButton
                variant="secondary"
                size="small"
                type="button"
                @click="set('search', '')"
              >
                Clear search
              </SituateButton>
            </div>
          </template>
        </div>
      </main>
    </div>

    <EditorDialog
      v-if="state.dialog"
      :title="
        state.dialog === 'disconnect'
          ? `Disconnect ${connectionName(state, state.target)}?`
          : state.dialog === 'rename'
            ? connectionCopy.renameTitle
            : `Shortcut: ${shortcut?.name}`
      "
      @close="closeDialog"
    >
      <div class="settings-dialog-body">
        <template v-if="state.dialog === 'disconnect'">
          <p>
            {{
              deviceAiCopy.disconnect(
                connectionName(state, state.target),
                workspaceName,
              )
            }}
          </p>
          <p
            v-if="!state.useManaged && state.target === state.provider"
            class="settings-attention"
          >
            To keep using chat and progress updates, choose another provider or
            reconnect. Situate won’t switch providers for you.
          </p>
          <p>Your conversations and drafts are kept.</p>
          <div class="settings-dialog-actions">
            <SituateButton
              variant="secondary"
              size="small"
              type="button"
              autofocus
              @click="closeDialog"
            >
              Keep connection</SituateButton
            ><SituateButton
              variant="danger"
              size="small"
              type="button"
              @click="confirmDisconnect"
            >
              {{ connectionCopy.disconnect }}
            </SituateButton>
          </div>
        </template>
        <form
          v-else-if="state.dialog === 'rename'"
          @submit.prevent="update(renameConnection)"
        >
          <label for="connection-name">{{ connectionCopy.name }}</label>
          <SituateInput
            id="connection-name"
            autofocus
            maxlength="80"
            :value="state.nameDraft"
            :aria-invalid="!!state.nameError"
            :aria-describedby="
              state.nameError
                ? 'connection-name-help connection-name-error'
                : 'connection-name-help'
            "
            @input="set('nameDraft', value($event))"
          />
          <p id="connection-name-help">{{ connectionCopy.nameHelp }}</p>
          <p v-if="state.nameError" id="connection-name-error" role="alert">
            {{ state.nameError }}
          </p>
          <div class="settings-dialog-actions">
            <SituateButton
              variant="secondary"
              size="small"
              type="button"
              @click="closeDialog"
              >Cancel</SituateButton
            ><SituateButton variant="primary" size="small" type="submit">
              {{ connectionCopy.saveName }}
            </SituateButton>
          </div>
        </form>
        <template v-else>
          <label for="shortcut-record">Press a key combination</label
          ><SituateInput
            id="shortcut-record"
            readonly
            :value="keyLabel(state.shortcutDraft)"
            :aria-invalid="!!state.shortcutError"
            :aria-describedby="
              state.shortcutError
                ? 'shortcut-help shortcut-error'
                : 'shortcut-help'
            "
            @keydown="record"
          />
          <p id="shortcut-help">
            Hold {{ mac ? "Command" : "Control" }} or Alt, then press another
            key. Press Escape to cancel.
          </p>
          <p v-if="state.shortcutError" id="shortcut-error" role="alert">
            {{ state.shortcutError }}
          </p>
          <div class="settings-dialog-actions">
            <SituateButton
              variant="secondary"
              size="small"
              type="button"
              @click="
                update((s) => {
                  s.shortcutDraft = shortcut?.original ?? '';
                  s.shortcutError = '';
                })
              "
            >
              Use default</SituateButton
            ><SituateButton
              variant="secondary"
              size="small"
              type="button"
              @click="
                update((s) => {
                  s.shortcutDraft = '';
                  s.shortcutError = '';
                })
              "
            >
              Clear</SituateButton
            ><SituateButton
              variant="primary"
              size="small"
              type="button"
              @click="update(saveShortcut)"
            >
              Save shortcut
            </SituateButton>
          </div>
        </template>
      </div>
    </EditorDialog>
  </section>
</template>
