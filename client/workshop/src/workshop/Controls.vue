<script setup lang="ts">
defineOptions({ name: "WorkshopControls" });
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import SetupConversationControls from "../onboarding/SetupConversationControls.vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  SituateButton,
  SituateInput,
  SituateSelect,
  SituateTextarea,
  SituateCheckbox,
} from "../ui";
import CallbackControls from "../auth-callback/CallbackControls.vue";
import RecoveryControls from "../error-recovery/RecoveryControls.vue";
import ComponentLibraryControls from "../component-library/ComponentLibraryControls.vue";
import {
  createSimulation,
  isScenario,
  reduceSimulation,
  type Command,
  type Content,
  type Outcome,
} from "./simulation";
import {
  connect,
  previewUrl,
  type Transport,
  type Viewport,
} from "./transport";
import { screenControls } from "./screen-controls";
import { scenarioBrowser } from "./content";
import ChatControls from "../chat/ChatControls.vue";
import { startWorkClock } from "../chat/work-clock";
import DictationControls from "../dictation/DictationControls.vue";
import QueueControls from "../chat-queue/QueueControls.vue";
import ScenarioBrowser from "./ScenarioBrowser.vue";
import TabsControls from "../tabs/TabsControls.vue";
import EditorControls from "../editor/EditorControls.vue";
import DocumentsControls from "../documents/DocumentsControls.vue";
import AiControls from "../ai/AiControls.vue";
import OnboardingControls from "../onboarding/OnboardingControls.vue";
import FinaleControls from "../workspaces/setup-journey/finale/FinaleControls.vue";
import FirstEntryControls from "../workspaces/FirstEntryControls.vue";
import OnboardingImportControls from "../onboarding/OnboardingImportControls.vue";
import PluginsControls from "../plugins/PluginsControls.vue";
import SettingsControls from "../settings/SettingsControls.vue";
import UpdateControls from "../updates/UpdateControls.vue";
import NavigationControls from "../navigation/NavigationControls.vue";
import EnvironmentControls from "./platform/EnvironmentControls.vue";
import { createPlatformState, profiles } from "./platform/model";

const query = new URLSearchParams(location.search);
const selected = query.get("scenario");
const state = shallowRef(
  createSimulation(
    isScenario(selected) ? selected : "workspaces",
    query.get("platform") === "mobile",
  ),
);
state.value.chat = startWorkClock(state.value.chat);
const requestedProfile = profiles.find(
  (profile) => profile.id === query.get("profile"),
);
if (requestedProfile) {
  state.value.environment = createPlatformState(requestedProfile.id);
  state.value.environment.keyboardOpen =
    requestedProfile.mobile && query.get("keyboard") === "open";
  if (!query.has("platform"))
    state.value = reduceSimulation(state.value, {
      type: "platform",
      mobile: requestedProfile.mobile,
    });
}
const native = isTauri();
const host = crypto.randomUUID();
let revision = 0;
let acknowledged = 0;
let transport: Transport | undefined;
let alive = true;
let timer: ReturnType<typeof setInterval> | undefined;
let popup: Window | null = null;
let initializedSize = false;
const connectionError = ref("");
const windowError = ref("");
const lastSeen = ref(0);
const now = ref(Date.now());
const actual = shallowRef<Viewport | null>(null);
const connected = computed(
  () => lastSeen.value > 0 && now.value - lastSeen.value < 3500,
);
const width = ref(requestedProfile?.width ?? 1280);
const height = ref(requestedProfile?.height ?? 800);
const presets = [
  { name: "Desktop", width: 1280, height: 800 },
  { name: "Tablet", width: 768, height: 1024 },
  { name: "Mobile", width: 390, height: 844 },
  { name: "Small mobile", width: 320, height: 568 },
];
const currentPreset = computed(
  () =>
    presets.find(
      (preset) =>
        preset.width === actual.value?.width &&
        preset.height === actual.value?.height,
    )?.name ?? "Custom",
);
const context = computed(() => screenControls(state.value));
const documentCollectionVisible = computed(() => {
  const viewportWidth = actual.value?.width ?? width.value;
  const contentWidth =
    viewportWidth -
    (viewportWidth >= 1184 && !state.value.sidebarCollapsed ? 272 : 0);
  return (
    !state.value.documents.selected ||
    (!state.value.snapshot.mobile && contentWidth > 760)
  );
});
let locationTimer: ReturnType<typeof setTimeout> | undefined;
let pendingLocation = "";
function shareLocation(): void {
  const url = new URL(location.href);
  url.searchParams.set("scenario", state.value.scenario);
  url.searchParams.delete("questionView");
  url.searchParams.set(
    "platform",
    state.value.snapshot.mobile ? "mobile" : "desktop",
  );
  url.searchParams.set("profile", state.value.environment.profile);
  url.searchParams.set(
    "keyboard",
    state.value.environment.keyboardOpen ? "open" : "closed",
  );
  if (url.href === pendingLocation) return;
  pendingLocation = url.href;
  if (locationTimer) clearTimeout(locationTimer);
  // WebKit rate-limits History API writes; preview updates must stay immediate.
  locationTimer = setTimeout(() => {
    if (pendingLocation !== location.href)
      history.replaceState(null, "", pendingLocation);
    locationTimer = undefined;
  }, 200);
}
async function publish(): Promise<void> {
  try {
    await transport?.send({
      type: "state",
      state: state.value,
      revision,
      host,
      acknowledged,
    });
    connectionError.value = "";
  } catch {
    connectionError.value =
      "The preview could not be reached. Open it again to reconnect.";
  }
}
function dispatch(command: Command): void {
  if (command.type === "onboarding" && command.workspaceId === undefined)
    command = {
      ...command,
      workspaceId: state.value.snapshot.current?.id ?? "",
    };
  const next = reduceSimulation(state.value, command);
  next.chat = startWorkClock(next.chat);
  state.value = next;
  revision++;
  shareLocation();
  void publish();
}
watch(
  [
    () => state.value.setupConversation.pending?.run,
    () => state.value.setupConversation.manual,
    () => state.value.epoch,
  ],
  (_current, _previous, cleanup) => {
    const pending = state.value.setupConversation.pending;
    if (
      !pending ||
      state.value.setupConversation.manual ||
      (state.value.feature !== "setup-conversation" &&
        !state.value.setupConversation.entered)
    )
      return;
    const epoch = state.value.epoch;
    const timer = setTimeout(
      () => {
        if (state.value.epoch === epoch)
          dispatch({
            type: "setup-conversation",
            action: { type: "complete", run: pending.run },
          });
      },
      pending.kind === "import" ? 12000 : 800,
    );
    cleanup(() => clearTimeout(timer));
  },
  { immediate: true },
);
function value(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}
async function resize(): Promise<void> {
  windowError.value = "";
  if (
    !Number.isInteger(width.value) ||
    !Number.isInteger(height.value) ||
    width.value < 320 ||
    width.value > 2560 ||
    height.value < 320 ||
    height.value > 2000
  ) {
    windowError.value =
      "Enter a width from 320 to 2560 and a height from 320 to 2000.";
    return;
  }
  try {
    if (native)
      await invoke("workshop_resize_preview", {
        width: width.value,
        height: height.value,
        insetWidth: actual.value?.insetWidth ?? 0,
        insetHeight: actual.value?.insetHeight ?? 0,
      });
    else if (connected.value)
      await transport?.send({
        type: "resize",
        width: width.value,
        height: height.value,
      });
    else windowError.value = "Open the preview before applying a size.";
  } catch {
    windowError.value =
      "The preview could not be resized. Open it again and retry.";
  }
}
function applyPreset(preset: { width: number; height: number }): void {
  width.value = preset.width;
  height.value = preset.height;
  void resize();
}
function rotate(): void {
  [width.value, height.value] = [height.value, width.value];
  void resize();
}
async function openPreview(): Promise<void> {
  windowError.value = "";
  if (native) {
    try {
      await invoke("workshop_open_preview");
      await resize();
    } catch {
      windowError.value = "The preview window could not be opened.";
    }
  } else {
    if (popup && !popup.closed) {
      popup.focus();
      return;
    }
    popup = window.open(
      previewUrl(),
      `design-preview-${new URL(previewUrl()).searchParams.get("session")}`,
      `popup,width=${width.value},height=${height.value}`,
    );
    if (!popup)
      windowError.value =
        "Allow pop-up windows for this site, then open the preview again.";
  }
}

onMounted(async () => {
  try {
    const connection = await connect("controls", (message) => {
      if (message.type === "hello") {
        actual.value = message.viewport;
        lastSeen.value = Date.now();
        now.value = Date.now();
        if (native && !initializedSize) {
          initializedSize = true;
          void resize();
        }
        void publish();
      } else if (message.type === "command") {
        if (
          message.host === host &&
          message.epoch === state.value.epoch &&
          message.sequence > acknowledged
        ) {
          acknowledged = message.sequence;
          dispatch(message.command);
        } else void publish();
      }
    });
    if (!alive) {
      connection.close();
      return;
    }
    transport = connection;
    shareLocation();
    timer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  } catch {
    connectionError.value =
      "Window communication is unavailable. Restart the design workshop.";
  }
});
onBeforeUnmount(() => {
  alive = false;
  transport?.close();
  if (timer) clearInterval(timer);
  if (locationTimer) clearTimeout(locationTimer);
});
</script>

<template>
  <main class="workshop-controls">
    <header>
      <p class="eyebrow">Situate</p>
      <h1>Design workshop</h1>
      <p class="help">
        Explore the app with example data. No workspace files are read or
        changed.
      </p>
      <div class="connection">
        <span role="status">{{
          connected ? "Preview connected" : "Preview disconnected"
        }}</span
        ><SituateButton
          variant="secondary"
          size="small"
          type="button"
          @click="openPreview"
          >Open preview</SituateButton
        >
      </div>
      <p v-if="connectionError" role="alert">{{ connectionError }}</p>
    </header>

    <section aria-labelledby="scenario-heading">
      <h2 id="scenario-heading">{{ scenarioBrowser.scenario }}</h2>
      <ScenarioBrowser
        :selected="state.scenario"
        @select="dispatch({ type: 'scenario', scenario: $event })"
      />
      <p class="current-screen">
        Current screen: <strong>{{ context.label }}</strong>
      </p>
      <SituateButton
        variant="secondary"
        size="small"
        type="button"
        @click="dispatch({ type: 'reset' })"
      >
        Reset scenario
      </SituateButton>
      <p class="help">
        Reset clears in-progress interactions.<template v-if="!native">
          The URL opens this starting scenario and platform.</template
        >
      </p>
    </section>

    <section aria-labelledby="viewport-heading">
      <h2 id="viewport-heading">Preview window</h2>
      <p v-if="actual" class="dimensions">
        <output aria-label="Actual viewport"
          >{{ actual.width }} × {{ actual.height }}</output
        >
        CSS px · {{ currentPreset }}
      </p>
      <p v-else class="help">Open the preview to see its content size.</p>
      <div class="presets">
        <SituateButton
          variant="secondary"
          size="small"
          v-for="preset in presets"
          :key="preset.name"
          type="button"
          @click="applyPreset(preset)"
        >
          {{ preset.name }}
        </SituateButton>
      </div>
      <form @submit.prevent="resize">
        <div class="size-fields">
          <label
            >Width<SituateInput
              v-model.number="width"
              type="number"
              min="320"
              max="2560"
              step="1"
              required
          /></label>
          <label
            >Height<SituateInput
              v-model.number="height"
              type="number"
              min="320"
              max="2000"
              step="1"
              required
          /></label>
        </div>
        <div class="actions">
          <SituateButton variant="secondary" size="small" type="submit"
            >Apply size</SituateButton
          ><SituateButton
            variant="secondary"
            size="small"
            type="button"
            @click="rotate"
            >Rotate</SituateButton
          >
        </div>
      </form>
      <p v-if="windowError" role="alert">{{ windowError }}</p>
      <p v-if="!native" class="help">
        Browsers may restrict window resizing. Use the desktop workshop for
        native window control.
      </p>
      <p
        v-if="actual && (actual.width !== width || actual.height !== height)"
        class="help"
      >
        Requested: {{ width }} × {{ height }}. The actual content size is shown
        above; window and screen limits may apply.
      </p>
      <label for="platform">Platform</label>
      <SituateSelect
        id="platform"
        :value="state.snapshot.mobile ? 'mobile' : 'desktop'"
        @change="
          dispatch({ type: 'platform', mobile: value($event) === 'mobile' })
        "
      >
        <option value="desktop">Desktop</option>
        <option value="mobile">Mobile</option>
      </SituateSelect>
      <p class="help">
        Platform and window size are independent. Mobile changes app behavior,
        not the operating system or touch input.
      </p>
      <EnvironmentControls
        class="environment-section"
        :state="state.environment"
        :editing="context.editing"
        @update:state="dispatch({ type: 'environment', state: $event })"
        @resize="applyPreset"
        @platform="dispatch({ type: 'platform', mobile: $event })"
      />
    </section>

    <section v-if="context.controls.length" aria-labelledby="state-heading">
      <h2 id="state-heading">{{ context.label }}</h2>
      <RecoveryControls
        v-if="context.controls.includes('recovery')"
        :state="state.recovery"
        @action="dispatch({ type: 'recovery', action: $event })"
      />
      <CallbackControls
        v-if="context.controls.includes('auth-callback')"
        :state="state.callback"
        @action="dispatch({ type: 'auth-callback', action: $event })"
      />
      <ComponentLibraryControls
        v-if="context.controls.includes('components')"
        :state="state.components"
        @patch="dispatch({ type: 'components', patch: $event })"
      />
      <DocumentsControls
        v-if="
          context.controls.includes('documents') || context.sourceManagement
        "
        :state="state.documents"
        :collection-visible="documentCollectionVisible"
        :source-mode="context.sourceManagement"
        @update:state="
          dispatch({
            type: 'documents',
            state: $event,
            workspaceId: state.snapshot.current?.id ?? '',
          })
        "
      />
      <PluginsControls
        v-if="context.controls.includes('plugins')"
        :state="state.plugins"
        @action="
          dispatch({
            type: 'plugin-action',
            action: $event,
            workspaceId: state.snapshot.current?.id ?? '',
          })
        "
        @update:state="
          dispatch({
            type: 'plugins',
            state: $event,
            workspaceId: state.snapshot.current?.id ?? '',
          })
        "
      />
      <TabsControls
        v-if="context.controls.includes('tabs')"
        :model-choices="context.controls.includes('tab-model')"
        :state="state.tabs"
        @action="dispatch({ type: 'tabs', action: $event })"
      />
      <UpdateControls
        v-if="context.controls.includes('updates')"
        :state="state.updates"
        @action="dispatch({ type: 'updates', action: $event })"
      />
      <SettingsControls
        v-if="context.controls.includes('settings')"
        :state="state.settings"
        :workspace-name="state.snapshot.current?.name ?? 'Field notes'"
        @update:state="dispatch({ type: 'settings', state: $event })"
      />
      <QueueControls
        v-if="context.controls.includes('chat-queue')"
        :state="state.chatQueue"
        @action="dispatch({ type: 'chat-queue', action: $event })"
      />
      <DictationControls
        v-if="context.controls.includes('dictation')"
        :state="state.dictation"
        :file-error="state.editor.files.some((file) => file.saveError)"
        @file-error="dispatch({ type: 'dictation-file-error', value: $event })"
        :surface="
          state.dictationNavigation
            ? 'session'
            : state.feature === 'settings' &&
                state.settings.page === 'dictation'
              ? 'download'
              : context.dictationNotice
                ? 'notice'
                : state.feature === 'dictation'
                  ? 'chat'
                  : 'session'
        "
        :owner="`${state.snapshot.current?.id}/${state.dictation.selected[state.snapshot.current?.id ?? ''] ?? 'a'}`"
        @action="dispatch({ type: 'dictation', action: $event })"
        @quit="
          dispatch({
            type: 'action',
            operation: { action: 'quit', request: 'dictation-quit' },
          })
        "
      />
      <ChatControls
        v-if="context.controls.includes('chat')"
        :state="state.chat"
        @update:state="dispatch({ type: 'chat', state: $event })"
      />
      <OnboardingImportControls
        v-if="context.controls.includes('onboarding-import')"
        :state="state.onboarding"
        @action="dispatch({ type: 'onboarding', action: $event })"
      />
      <SetupConversationControls
        v-if="context.controls.includes('setup-conversation')"
        :state="state.setupConversation"
        @action="dispatch({ type: 'setup-conversation', action: $event })"
      />
      <FirstEntryControls
        v-if="context.controls.includes('first-entry')"
        :state="state.firstEntry"
        @action="dispatch({ type: 'first-entry', action: $event })"
      />
      <FinaleControls
        v-if="context.controls.includes('setup-finale')"
        :state="state.onboarding.finale"
        @action="dispatch({ type: 'onboarding', action: $event })"
      />
      <OnboardingControls
        v-if="context.controls.includes('onboarding')"
        :state="state.onboarding"
        @action="dispatch({ type: 'onboarding', action: $event })"
      />
      <AiControls
        v-if="context.controls.includes('ai')"
        :state="state.ai"
        :connection-workspace="
          state.firstEntry.created ? state.snapshot.current?.name : undefined
        "
        @update:state="dispatch({ type: 'ai', state: $event })"
      />
      <EditorControls
        v-if="context.controls.includes('editor')"
        :state="state.editor"
        @update:state="dispatch({ type: 'editor', state: $event })"
      />
      <NavigationControls
        v-if="context.controls.includes('navigation')"
        :state="state.navigation"
        @update:state="dispatch({ type: 'navigation', state: $event })"
      />
      <template v-if="context.controls.includes('content')">
        <label for="content">Workspace examples</label>
        <SituateSelect
          id="content"
          :value="state.content"
          @change="
            dispatch({ type: 'content', content: value($event) as Content })
          "
        >
          <option value="empty">None</option>
          <option value="few">A few</option>
          <option value="many">Many</option>
          <option value="long">Long names</option>
        </SituateSelect>
      </template>
      <template v-if="context.controls.includes('error')">
        <label for="error-message">Error message</label>
        <SituateTextarea
          id="error-message"
          rows="3"
          :value="state.error"
          @input="
            dispatch({
              type: 'error',
              error: ($event.target as HTMLTextAreaElement).value,
            })
          "
        />
      </template>
      <label v-if="context.controls.includes('folder')" class="check"
        ><SituateCheckbox
          :checked="state.folderExists"
          @change="
            dispatch({
              type: 'folder',
              exists: ($event.target as HTMLInputElement).checked,
            })
          "
        />
        New workspace folder already exists</label
      >
    </section>

    <section
      v-if="context.canSetOutcome || context.canComplete"
      aria-labelledby="action-heading"
    >
      <h2 id="action-heading">Actions</h2>
      <template v-if="context.canSetOutcome">
        <label for="outcome">Action result</label>
        <SituateSelect
          id="outcome"
          :value="state.nextOutcome"
          @change="
            dispatch({ type: 'outcome', outcome: value($event) as Outcome })
          "
        >
          <option value="success">Succeed</option>
          <option value="error">Fail</option>
          <option value="wait">Wait for manual completion</option>
        </SituateSelect>
        <p class="help">Applies to actions until changed.</p>
      </template>
      <p role="status">
        {{
          state.pending
            ? `Waiting: ${state.pending.action}`
            : state.lastAction
              ? `Last action: ${state.lastAction}`
              : "No action in progress."
        }}
      </p>
      <div v-if="context.canComplete" class="actions">
        <SituateButton @click="dispatch({ type: 'finish', ok: true })"
          >Complete</SituateButton
        >
        <SituateButton
          variant="secondary"
          size="small"
          type="button"
          @click="dispatch({ type: 'finish', ok: false })"
        >
          Fail action
        </SituateButton>
      </div>
    </section>
  </main>
</template>

<style scoped>
.workshop-controls {
  height: 100%;
  overflow: auto;
  padding: 24px;
  background: var(--situate-paper);
}
header,
section {
  max-width: 600px;
  margin: 0 auto;
}
header {
  padding-bottom: 24px;
}
section {
  padding: 24px 0;
  border-top: 1px solid var(--situate-line);
}
h1 {
  font-size: 28px;
  line-height: 1.2;
  margin: 0 0 12px;
}
h2 {
  font-size: 18px;
  margin: 0 0 16px;
}
p {
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.eyebrow {
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--situate-violet-deep);
}
.help {
  font-size: 13px;
  line-height: 1.5;
}
label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  margin: 16px 0 6px;
}
.connection,
.actions,
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.connection {
  justify-content: space-between;
  font-size: 13px;
}
.size-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.size-fields label {
  min-width: 0;
}
.actions {
  margin-top: 12px;
}
.check {
  display: flex;
  gap: 10px;
  align-items: center;
  font-weight: 400;
}
.check input {
  width: 20px;
  min-height: 20px;
  flex-shrink: 0;
}
.dimensions {
  font-variant-numeric: tabular-nums;
}
.environment-section {
  margin-top: 24px;
}
</style>
