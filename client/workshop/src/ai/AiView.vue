<script setup lang="ts">
import SituateDisclosure from "../ui/SituateDisclosure.vue";
import {
  SituateButton,
  SituateCheckbox,
  SituateInput,
  SituateTextarea,
  SituateDialog,
} from "../ui";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import wordmark from "../brand/assets/wordmark.svg";
import welcome from "../brand/bend/svg/wave-welcome.svg";
import pleased from "./assets/celebrate-pleased.svg";
import AiFields from "./AiFields.vue";
import SituateSelect from "../ui/SituateSelect.vue";
import ProviderIcon from "./ProviderIcon.vue";
import EditorDialog from "../editor/EditorDialog.vue";
import { useAiState } from "./use-ai-state";
import { authFields, validateAuth } from "./fields";
import {
  accessLabel,
  inventoryCopy,
  transportCopy,
  accessProblems,
  securityCopy,
  errors,
  footerActions,
  requiredSetupActions,
  heading,
  providerName,
} from "./content";
import {
  acknowledgeWarning,
  cancelWarning,
  gateAccess,
  needsReview,
  requiresSessionTakeover,
  visibleRestriction,
} from "./security";
import { availableProviders, availableMethods, methods } from "./providers";
import {
  acceptHttpConsent,
  cancelHttpConsent,
  setAuthValue,
} from "./transport";
import {
  aiConnected,
  aiSetup,
  authScreen,
  beginConnection,
  cancelConnection,
  chooseMethod,
  chooseProvider,
  currentWorkspace,
  initialModel,
  navigate,
  startConnection,
  switchWorkspace,
  type AiState,
  type WorkspaceName,
} from "./model";
const props = defineProps<{
  state: AiState;
  requiredSetup?: boolean;
  connectionContext?: { workspace: string; connected: string[] };
}>();
const emit = defineEmits<{
  "update:state": [state: AiState];
  returnToSettings: [];
}>();
const { state, update } = useAiState(props, emit);
const confirmation = computed(
  () =>
    !!props.connectionContext &&
    ["forget", "remove"].includes(state.value.screen),
);
const current = computed(() => currentWorkspace(state.value));
const policy = computed(() => visibleRestriction(state.value));
const problem = computed(() => accessProblems[current.value.unavailable || ""]);
const reviewRequired = computed(
  () =>
    !!current.value.connection &&
    needsReview(state.value, current.value.connection),
);
const setup = computed(() => !!props.connectionContext || aiSetup(state.value));
const workspaceLabel = computed(
  () => props.connectionContext?.workspace ?? state.value.workspace,
);
const warningProvider = computed(() =>
  state.value.warningIntent === "use"
    ? (current.value.connection?.provider ?? state.value.provider)
    : state.value.provider,
);
const warningMethod = computed(() =>
  state.value.warningIntent === "use"
    ? (current.value.connection?.method ?? state.value.method)
    : state.value.method,
);
const decision = computed(
  () =>
    [
      "http-warning",
      "restriction",
      "session-unavailable",
      "forget",
      "remove",
    ].includes(state.value.screen) ||
    state.value.screen.startsWith("store-save-"),
);
const title = computed(() =>
  state.value.screen === "restriction" && policy.value?.blocked
    ? [securityCopy.blockedTitle, ""]
    : props.connectionContext && isSettings.value
      ? [
          current.value.connection?.label || securityCopy.connectionTitle,
          current.value.connection?.label
            ? `${providerName(current.value.connection.provider)} · ${accessLabel(current.value.connection.method)}`
            : "",
        ]
      : heading(state.value, workspaceLabel.value),
);
const actions = computed(() =>
  confirmation.value
    ? []
    : (props.requiredSetup
        ? requiredSetupActions(state.value)
        : props.connectionContext && state.value.screen === "success"
          ? [{ label: "Back to settings", action: "settings", primary: true }]
          : footerActions(state.value).map((button) =>
              props.connectionContext &&
              ["local", "chat"].includes(button.action)
                ? { ...button, label: "Back to settings" }
                : button,
            )
      ).filter(
        (button) => button.action !== "acknowledge" || !policy.value?.blocked,
      ),
);
function alreadyConnected(id: string) {
  return (
    !!props.connectionContext?.connected.includes(id) &&
    current.value.connection?.provider !== id
  );
}
const fields = computed(() => authFields(state.value));
const plainFields = computed(() =>
  fields.value.filter((field) => !field.group),
);
const extraFields = computed(() => fields.value.filter((field) => field.group));
const authMethods = computed(() =>
  availableMethods(state.value.provider, state.value.explorationMode),
);
const matches = computed(() =>
  availableProviders(state.value.explorationMode).filter((provider) =>
    provider.name.toLowerCase().includes(state.value.search.toLowerCase()),
  ),
);
const retained = computed(
  () =>
    aiConnected(state.value) &&
    !(
      state.value.screen === "restriction" &&
      state.value.warningIntent === "use"
    ) &&
    [
      "providers",
      "http-warning",
      "restriction",
      "session-unavailable",
      "methods",
      "key",
      "browser",
      "copy-code",
      "device",
      "cloud",
      "endpoint",
      "advanced",
      "connecting",
      "denied",
      "expired",
      "offline",
      "save-error",
    ].includes(state.value.screen),
);
const isSettings = computed(
  () =>
    confirmation.value ||
    ["settings", "restored", "reconnect", "locked", "capability"].includes(
      state.value.screen,
    ),
);
const root = ref<HTMLElement>();
const navigationOverlay = ref(false);
const skip = ref<InstanceType<typeof SituateDialog>>();
let observer: ResizeObserver | undefined;
function focus(selector: string) {
  void nextTick(() =>
    root.value
      ?.querySelector<HTMLElement>(selector)
      ?.focus({ preventScroll: true }),
  );
}
function setField(id: string, value: string) {
  update((next) => {
    setAuthValue(next, id, value);
    if (next.invalidField === id) {
      next.invalidField = "";
      next.fieldError = "";
    }
  });
}
function validate() {
  let invalid = "";
  update((next) => {
    if (gateAccess(next, "connect")) return;
    if (validateAuth(next)) beginConnection(next);
    else invalid = next.invalidField;
  });
  if (invalid)
    void nextTick(() => {
      const input = root.value?.querySelector<HTMLElement>(`[id="${invalid}"]`);
      input?.closest("details")?.setAttribute("open", "");
      input?.focus();
    });
}
function action(action: string) {
  if (
    props.requiredSetup &&
    ["skip", "local", "chat", "settings"].includes(action)
  )
    return;
  if (
    props.connectionContext &&
    (["local", "chat"].includes(action) ||
      (action === "settings" &&
        !["forget", "remove"].includes(state.value.screen)) ||
      (action === "return" && state.value.origin === "settings"))
  ) {
    emit("returnToSettings");
    return;
  }
  if (action === "validate") return validate();
  update((next) => {
    if (action === "cancel-http") return cancelHttpConsent(next);
    if (action === "accept-http") {
      if (acceptHttpConsent(next)) beginConnection(next);
      return;
    }
    if (action === "cancel-warning") return cancelWarning(next);
    if (action === "review-warning") return void gateAccess(next, "use");
    if (action === "acknowledge") {
      if (acknowledgeWarning(next) && next.warningIntent === "connect")
        authScreen(next);
      return;
    }
    if (action === "retry-store") {
      next.storeRetry = true;
      next.announcement = securityCopy.storePending;
      return;
    }
    if (action === "confirm-forget") {
      currentWorkspace(next).unavailable = "missing";
      navigate(next, "settings");
      next.announcement = securityCopy.forgotten;
      return;
    }
    if (action === "skip") {
      next.dialog = "skip";
      return;
    }
    if (action === "cancel") return cancelConnection(next);
    if (action === "connect" || action === "own")
      return startConnection(next, action === "own" ? "offer" : "settings");
    if (action === "return") return navigate(next, next.origin);
    if (action === "retry")
      return next.screen === "save-error"
        ? beginConnection(next)
        : authScreen(next);
    if (action === "confirm-remove") {
      const current = currentWorkspace(next);
      current.connection = null;
      current.unavailable = null;
      current.model = initialModel();
      return navigate(next, "settings");
    }
    if (action === "managed") {
      next.handoff =
        "Managed AI handoff: continue with the existing managed-access flow for this workspace. No connection has been granted.";
      return;
    }
    if (action === "open-browser") {
      if (gateAccess(next, "connect")) return;
      if (requiresSessionTakeover(next)) return authScreen(next);
      next.browserOpened = true;
      next.announcement = "Waiting for provider approval.";
      return;
    }
    navigate(next, action);
  });
}
function closeDialog() {
  update((next) => {
    next.dialog = null;
  });
  focus('[data-action="skip"]');
}
function trap(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeDialog();
    return;
  }
  if (event.key !== "Tab") return;
  const nodes = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      "button:not(:disabled), input, select, textarea",
    ),
  ].filter((node) => node.getClientRects().length);
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
function positionDialog() {
  navigationOverlay.value = !!root.value
    ?.querySelector(".header-actions")
    ?.getClientRects().length;
}
function syncDialogs() {
  const kind = state.value.dialog;
  if (kind === "skip") {
    if (!skip.value?.element?.open) skip.value?.element?.showModal();
    focus("#dismiss-skip");
  } else skip.value?.element?.close();
}
watch(() => state.value.dialog, syncDialogs, { flush: "post" });
watch(
  [() => state.value.screen, () => state.value.workspace],
  (_next, previous) => {
    if (
      !confirmation.value &&
      !(props.connectionContext && ["forget", "remove"].includes(previous[0]))
    )
      focus(".heading [tabindex], #chat-title");
  },
);
watch([() => state.value.mobile, () => state.value.screen], () =>
  nextTick(positionDialog),
);
onMounted(() => {
  if (state.value.dialog) syncDialogs();
  else focus(".heading [tabindex], #chat-title");
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(positionDialog);
    if (root.value) observer.observe(root.value);
  }
  window.addEventListener("resize", positionDialog);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", positionDialog);
});
</script>
<template>
  <div
    ref="root"
    class="ai-view"
    :class="{
      'setup-window': setup && !connectionContext,
      'embedded-connection': !!connectionContext,
      'setup-welcome': state.screen === 'offer',
      'setup-complete': state.screen === 'success',
      'decision-screen': decision,
      'connection-settings': isSettings,
      mobile: state.mobile,
    }"
    :data-screen="state.screen"
  >
    <header
      v-if="setup && !connectionContext && !requiredSetup"
      class="setup-header"
    >
      <img :src="wordmark" alt="Situate" /><span
        >{{ workspaceLabel }} · AI setup</span
      >
    </header>
    <header v-else-if="!setup && !connectionContext" class="app-header">
      <div class="identity">
        <img class="wordmark" :src="wordmark" alt="Situate" /><label
          class="workspace"
          ><span>Open workspace</span
          ><SituateSelect
            id="workspace"
            aria-label="Active workspace"
            :value="state.workspace"
            @change="
              update((next) =>
                switchWorkspace(
                  next,
                  ($event.target as HTMLSelectElement).value as WorkspaceName,
                ),
              )
            "
          >
            <option>Personal</option>
            <option>Studio</option>
          </SituateSelect></label
        >
      </div>
      <div class="header-actions">
        <SituateButton
          variant="secondary"
          size="small"
          type="button"
          :aria-expanded="state.navigationOpen"
          aria-controls="workspace-nav"
          @click="
            update((next) => {
              next.navigationOpen = !next.navigationOpen;
            });
            focus(
              state.navigationOpen
                ? '.sidebar button'
                : '.header-actions button',
            );
          "
        >
          Menu
        </SituateButton>
      </div>
    </header>
    <div :class="setup || connectionContext ? 'setup-body' : 'shell'">
      <nav
        v-if="!setup && !connectionContext"
        id="workspace-nav"
        class="sidebar"
        :class="{ 'navigation-open': state.navigationOpen }"
        aria-label="Workspace navigation"
        @keydown.esc.stop="
          update((next) => {
            next.navigationOpen = false;
          });
          focus('.header-actions button');
        "
      >
        <SituateButton
          variant="plain"
          v-for="item in [
            { label: 'Notes', screen: 'local' },
            { label: 'Chat', screen: 'chat' },
            { label: 'Settings', screen: 'settings' },
          ]"
          :key="item.screen"
          type="button"
          :aria-current="state.screen === item.screen ? 'page' : undefined"
          :data-action="item.screen"
          @click="action(item.screen)"
        >
          {{ item.label }}
        </SituateButton>
        <div class="other">
          <strong>{{
            state.workspace === "Personal" ? "Studio" : "Personal"
          }}</strong>
          <p>
            Also open ·
            {{
              state.workspaces[
                state.workspace === "Personal" ? "Studio" : "Personal"
              ].connection
                ? "AI configured"
                : "AI not connected"
            }}
          </p>
        </div>
      </nav>
      <component
        :is="connectionContext ? 'div' : 'main'"
        class="pane"
        :inert="(state.navigationOpen && navigationOverlay) || undefined"
      >
        <div class="scroll">
          <div class="content">
            <ol
              v-if="setup && !connectionContext && !decision"
              class="setup-progress"
              aria-label="Setup progress"
            >
              <li class="done">
                <span aria-hidden="true">✓</span>Workspace ready
              </li>
              <li
                :class="state.screen === 'success' ? 'done' : 'active'"
                :aria-current="state.screen !== 'success' ? 'step' : undefined"
              >
                <span aria-hidden="true">{{
                  state.screen === "success" ? "✓" : "2"
                }}</span
                >AI access
              </li>
              <li
                :class="{ done: state.screen === 'success' }"
                :aria-current="state.screen === 'success' ? 'step' : undefined"
              >
                <span aria-hidden="true">{{
                  state.screen === "success" ? "✓" : "3"
                }}</span
                >Ready
              </li>
            </ol>
            <div
              v-if="state.screen !== 'chat'"
              :class="
                state.screen === 'offer'
                  ? 'welcome-scene'
                  : state.screen === 'success' && !connectionContext
                    ? 'success-scene'
                    : ''
              "
            >
              <img
                v-if="state.screen === 'success' && !connectionContext"
                :src="pleased"
                alt=""
              />
              <div :class="{ 'welcome-copy': state.screen === 'offer' }">
                <div class="heading">
                  <p v-if="title[2] && !connectionContext" class="eyebrow">
                    {{ title[2] }}
                  </p>
                  <div
                    v-if="state.screen === 'restriction'"
                    class="provider-identity"
                  >
                    <ProviderIcon :provider="warningProvider" />
                    <span
                      ><strong>{{ providerName(warningProvider) }}</strong
                      ><small>{{ accessLabel(warningMethod) }}</small></span
                    >
                  </div>
                  <component
                    :is="connectionContext ? 'h3' : 'h1'"
                    tabindex="-1"
                    >{{ title[0] }}</component
                  >
                  <p v-if="title[1]" class="muted">{{ title[1] }}</p>
                </div>
              </div>
              <div v-if="state.screen === 'offer'" class="bend-scene">
                <img :src="welcome" alt="" />
              </div>
              <p v-if="state.screen === 'success'" class="connection-receipt">
                <span aria-hidden="true">✓</span
                >{{ providerName(state.provider) }} connected to
                {{ workspaceLabel }}
              </p>
            </div>
            <div v-if="state.screen === 'offer'" class="choices entry-choices">
              <SituateButton
                variant="plain"
                type="button"
                class="choice"
                @click="action('own')"
              >
                <strong>Connect my provider</strong
                ><small
                  >Bring your subscription, key or other supported
                  access.</small
                ></SituateButton
              ><SituateButton
                variant="plain"
                type="button"
                class="choice"
                @click="action('managed')"
              >
                <strong>Situate managed AI</strong
                ><small
                  >Let Situate select suitable models with paid AI
                  access.</small
                >
              </SituateButton>
            </div>
            <section
              v-if="state.screen === 'http-warning'"
              class="access-warning"
            >
              <p>{{ transportCopy.warning }}</p>
              <p>{{ transportCopy.destination }}</p>
              <strong class="http-destination">{{
                state.httpDestination
              }}</strong>
            </section>
            <section
              v-if="state.screen === 'restriction' && policy"
              class="access-warning"
            >
              <p>{{ policy.detail }}</p>
              <a
                :href="policy.source"
                class="guidance-address"
                @click.prevent="
                  update((next) => {
                    next.handoff = securityCopy.sourceHandoff(policy!.source);
                  })
                "
                >{{ securityCopy.source(providerName(warningProvider)) }}</a
              >
              <template v-if="!policy.blocked">
                <p class="muted">{{ securityCopy.responsibility }}</p>
                <label class="warning-check">
                  <SituateCheckbox
                    appearance="plain"
                    id="warning-ack"
                    type="checkbox"
                    :checked="state.warningChecked"
                    @change="
                      update((next) => {
                        next.warningChecked = (
                          $event.target as HTMLInputElement
                        ).checked;
                      })
                    "
                  />
                  <span>{{ securityCopy.acknowledgement }}</span>
                </label>
              </template>
            </section>
            <p v-if="retained" class="muted connection-retained">
              {{
                securityCopy.retained(
                  providerName(current.connection!.provider),
                )
              }}
            </p>
            <template v-if="state.screen === 'providers'">
              <label class="field" for="search"
                >Find a provider<SituateInput
                  id="search"
                  type="search"
                  placeholder="Search by name"
                  :value="state.search"
                  @input="
                    update((next) => {
                      next.search = ($event.target as HTMLInputElement).value;
                    })
                  "
              /></label>
              <p role="status">
                {{ matches.length }} providers and connection types
              </p>
              <div class="providers">
                <SituateButton
                  variant="plain"
                  v-for="item in matches"
                  :key="item.id"
                  type="button"
                  :data-provider="item.id"
                  @click="update((next) => chooseProvider(next, item.id))"
                >
                  <ProviderIcon :provider="item.id" /><span
                    class="provider-copy"
                    ><strong>{{ item.name }}</strong
                    ><small>{{
                      alreadyConnected(item.id)
                        ? inventoryCopy.addAnother
                        : item.id === "typesafe"
                          ? "Classifier models"
                          : item.methods.includes("browser") ||
                              item.methods.includes("device")
                            ? "Provider sign-in available"
                            : item.id === "compatible"
                              ? "Hosted or local server"
                              : item.id === "extension"
                                ? "Provider-defined sign-in"
                                : state.explorationMode
                                  ? "Keys and other credential sources"
                                  : inventoryCopy.key
                    }}</small></span
                  >
                </SituateButton>
              </div>
              <div v-if="!matches.length" class="note">
                No matching provider. Try another name or choose a compatible
                endpoint.
              </div>
            </template>
            <template v-if="state.screen === 'methods'"
              ><div class="choices">
                <SituateButton
                  variant="plain"
                  v-for="id in authMethods"
                  :key="id"
                  type="button"
                  class="choice"
                  :data-method="id"
                  @click="update((next) => chooseMethod(next, id))"
                >
                  <strong>{{
                    state.provider === "openai" && id === "browser"
                      ? inventoryCopy.chatgpt
                      : methods[id][0]
                  }}</strong
                  ><small>{{
                    state.provider === "openai" && id === "browser"
                      ? inventoryCopy.chatgptDetail
                      : methods[id][1]
                  }}</small>
                </SituateButton>
              </div>
              <p class="muted">
                Your provider’s terms and charges apply. Situate’s managed AI
                terms do not apply to this connection.
              </p></template
            >
            <div
              v-if="['browser', 'copy-code'].includes(state.screen)"
              class="status-panel"
            >
              <component :is="connectionContext ? 'h4' : 'h2'">
                {{
                  state.browserOpened
                    ? "Waiting for sign-in"
                    : "Continue at the provider"
                }}
              </component>
              <p>
                {{
                  state.browserOpened
                    ? "Keep this workspace open. Returning to Situate does not by itself confirm access."
                    : "Your provider handles sign-in. No password is entered into Situate."
                }}
              </p>
              <SituateButton
                variant="primary"
                size="small"
                type="button"
                @click="action('open-browser')"
              >
                {{
                  state.browserOpened
                    ? "Open sign-in again"
                    : "Open sign-in in browser"
                }}
              </SituateButton>
            </div>
            <p v-if="state.screen === 'cloud'">
              {{
                state.method === "adc"
                  ? "Set up Google Cloud Application Default Credentials on this device, then provide the project and location."
                  : methods[state.method][1]
              }}
            </p>
            <form
              v-if="fields.length"
              id="auth-form"
              class="stack"
              novalidate
              @submit.prevent="
                state.screen === 'device'
                  ? update((next) => {
                      next.deviceIssued = true;
                    })
                  : validate()
              "
            >
              <AiFields
                :fields="plainFields"
                :state="state"
                @input="setField"
                @reveal="
                  update((next) => {
                    next.reveal = !next.reveal;
                  })
                "
              />
              <SituateDisclosure v-if="extraFields.length">
                <template #label>{{ extraFields[0].group }}</template>
                <div class="stack">
                  <AiFields
                    :fields="extraFields"
                    :state="state"
                    @input="setField"
                  />
                </div>
              </SituateDisclosure>
              <SituateButton
                variant="primary"
                size="small"
                v-if="state.screen === 'device'"
                type="submit"
              >
                Get device code
              </SituateButton>
            </form>
            <template v-if="state.screen === 'device'">
              <div
                v-if="state.provider !== 'github-copilot' || state.deviceIssued"
                class="status-panel"
              >
                <p>Device code</p>
                <p class="code">DEMO-ONLY</p>
                <SituateButton
                  variant="secondary"
                  size="small"
                  type="button"
                  @click="
                    update((next) => {
                      next.announcement =
                        'Device code ready to copy: DEMO-ONLY.';
                    })
                  "
                >
                  Copy code
                </SituateButton>
                <p>
                  {{
                    state.browserOpened
                      ? "Waiting for provider approval…"
                      : "Open the provider to authorize this code."
                  }}
                </p>
                <SituateButton
                  variant="primary"
                  size="small"
                  type="button"
                  @click="action('open-browser')"
                >
                  {{
                    state.browserOpened
                      ? "Open provider again"
                      : "Open provider"
                  }}
                </SituateButton>
              </div>
              <p class="muted">
                The provider checks for approval while this workspace is open.
                If the code expires, start again to get a new one.
              </p>
            </template>
            <p
              v-if="['browser', 'copy-code'].includes(state.screen)"
              class="muted"
            >
              Cancel stops this sign-in attempt in Situate. It does not revoke
              permission already granted at the provider.
            </p>
            <template v-if="state.screen === 'key'"
              ><p
                v-if="
                  state.provider === 'anthropic' && state.method === 'bearer'
                "
                class="muted"
              >
                Uses Anthropic bearer authentication, not an API-key header.
              </p>
              <p class="muted">
                Choose a provider whose processing terms suit your needs. This
                is separate from Situate managed AI.
              </p></template
            >
            <template v-if="state.screen === 'cloud'"
              ><div v-if="state.method === 'chain'" class="note">
                Use only credential sources you intend for this workspace.
                Existing device credentials must be configured before
                continuing.
              </div>
              <div class="note attention">
                This connection depends on credentials available on this device.
                Copying the workspace does not copy access to an external
                profile or file.
              </div></template
            >
            <template v-if="state.screen === 'endpoint'"
              ><p v-if="state.provider === 'llama.cpp'" class="muted">
                {{ securityCopy.localModelDefault }}
              </p>
              <div v-if="state.method === 'none'" class="note">
                No credentials will be sent. Use only with an endpoint that
                permits this.
              </div>
              <div class="note attention">
                API compatibility does not guarantee that this model supports
                every request. Local models run wherever your endpoint runs;
                this does not prevent other networking.
              </div></template
            >
            <template v-if="state.screen === 'advanced'"
              ><p v-if="state.method === 'extension'" class="muted">
                Provider extensions are trusted code, not sandboxed connections.
                Follow the provider’s instructions for additional steps.
              </p>
              <div class="note attention">
                {{
                  state.method === "command"
                    ? "Continuing allows this command to run for the connection. Stored-key commands may cache their result for the process lifetime; endpoint configuration commands may run for each request."
                    : "Only the selected source is configured for this workspace. If it is unavailable on another device, reconnect there."
                }}
              </div></template
            >
            <p
              v-if="['key', 'cloud', 'advanced'].includes(state.screen)"
              class="muted"
            >
              {{ securityCopy.storage }}
            </p>
            <template v-if="state.screen === 'connecting'"
              ><div class="status-panel" role="status">
                <component :is="connectionContext ? 'h4' : 'h2'"
                  >Checking access and saving connection</component
                >
                <p>
                  Keep this workspace open. Chat will be available when access
                  is ready.
                </p>
              </div>
              <p class="muted">Your chat draft has not been sent.</p></template
            >
            <template v-if="errors[state.screen]"
              ><div :class="decision ? 'muted' : 'note attention'" role="alert">
                {{
                  aiConnected(state)
                    ? securityCopy.retained(
                        providerName(current.connection!.provider),
                      )
                    : "Chat is not connected in this workspace. You can still work with local content."
                }}
              </div>
              <p v-if="state.screen === 'save-error'" class="muted">
                No saved replacement is confirmed. A provider-side permission
                may still exist.
              </p>
              <div class="inline">
                <SituateButton
                  variant="secondary"
                  size="small"
                  type="button"
                  @click="action('methods')"
                >
                  Choose another method</SituateButton
                ><SituateButton
                  variant="secondary"
                  size="small"
                  v-if="!connectionContext && !decision"
                  type="button"
                  @click="action('local')"
                >
                  Use local workspace
                </SituateButton>
              </div></template
            >
            <template v-if="state.screen === 'local'"
              ><label class="field" for="local-note"
                >Note<SituateTextarea
                  id="local-note"
                  rows="6"
                  :value="current.note"
                  @input="
                    update((next) => {
                      currentWorkspace(next).note = (
                        $event.target as HTMLTextAreaElement
                      ).value;
                    })
                  "
                />
              </label>
              <p role="status">
                Local editing available{{
                  aiConnected(state) ? "." : " · AI not connected."
                }}
              </p></template
            >
            <template v-if="isSettings || state.screen === 'success'">
              <div v-if="isSettings && reviewRequired" class="access-notice">
                <p>{{ securityCopy.guard }}</p>
                <SituateButton
                  variant="secondary"
                  size="small"
                  type="button"
                  @click="action('review-warning')"
                >
                  {{ securityCopy.review }}
                </SituateButton>
              </div>
              <div v-if="isSettings && problem" class="access-notice">
                <component :is="connectionContext ? 'h4' : 'h2'">{{
                  problem[0]
                }}</component>
                <p>{{ problem[1] }}</p>
              </div>
              <component
                :is="state.screen === 'success' ? SituateDisclosure : 'div'"
                v-if="current.connection"
                class="connection-overview"
              >
                <template v-if="state.screen === 'success'" #label>
                  Connection details
                </template>
                <component
                  :is="connectionContext ? 'h4' : 'h2'"
                  v-if="
                    state.screen !== 'success' &&
                    !current.unavailable &&
                    !reviewRequired
                  "
                >
                  Connected
                </component>
                <dl class="summary">
                  <template v-if="!connectionContext"
                    ><dt>Workspace</dt>
                    <dd>{{ workspaceLabel }}</dd></template
                  >
                  <dt>Provider</dt>
                  <dd>{{ providerName(current.connection.provider) }}</dd>
                  <dt>{{ securityCopy.signIn }}</dt>
                  <dd>{{ accessLabel(current.connection.method) }}</dd>
                </dl>
                <SituateDisclosure>
                  <template #label>{{ securityCopy.details }}</template>
                  <dl class="summary">
                    <template v-if="current.connection.endpoint">
                      <dt>Endpoint</dt>
                      <dd>{{ current.connection.endpoint }}</dd>
                    </template>
                    <template v-if="current.connection.source">
                      <dt>Source</dt>
                      <dd>{{ current.connection.source }}</dd>
                    </template>
                    <dt>{{ securityCopy.configuration }}</dt>
                    <dd>
                      {{ securityCopy.configurationLocation(workspaceLabel) }}
                    </dd>
                    <dt>{{ securityCopy.credentials }}</dt>
                    <dd>
                      {{
                        current.connection.method === "none"
                          ? securityCopy.noCredentials
                          : current.connection.source
                            ? securityCopy.externalStore
                            : securityCopy.localStore
                      }}
                    </dd>
                  </dl>
                  <p>{{ securityCopy.transfer }}</p>
                </SituateDisclosure>
              </component>
              <div v-else class="note">
                <component :is="connectionContext ? 'h4' : 'h2'">{{
                  securityCopy.setupTitle
                }}</component>
                <p>{{ securityCopy.notConnected }}</p>
              </div>
              <p
                v-if="state.screen === 'success' && !connectionContext"
                class="muted"
              >
                {{
                  current.draft
                    ? "Your draft is ready to review. Nothing has been sent."
                    : securityCopy.readyConversation
                }}
              </p>
              <template v-if="isSettings">
                <p v-if="state.screen === 'restored'" role="status">
                  {{ securityCopy.restored }}
                </p>
                <SituateDisclosure
                  v-if="current.connection"
                  class="connection-options"
                >
                  <template #label>{{ securityCopy.manage }}</template>
                  <div class="inline">
                    <SituateButton
                      variant="secondary"
                      size="small"
                      type="button"
                      @click="
                        ($event.currentTarget as HTMLElement).focus();
                        action('forget');
                      "
                    >
                      {{ securityCopy.forget }}
                    </SituateButton>
                    <SituateButton
                      variant="secondary"
                      size="small"
                      type="button"
                      @click="
                        ($event.currentTarget as HTMLElement).focus();
                        action('remove');
                      "
                    >
                      {{ securityCopy.remove }}
                    </SituateButton>
                  </div>
                  <h3>{{ securityCopy.revocationTitle }}</h3>
                  <p>{{ securityCopy.revocation }}</p>
                </SituateDisclosure>
                <SituateButton
                  variant="ghost"
                  size="small"
                  type="button"
                  class="quiet managed-option"
                  @click="action('managed')"
                >
                  Situate managed AI
                </SituateButton>
              </template>
            </template>
            <div
              v-if="state.screen === 'remove' && !confirmation"
              class="stack"
            >
              <p>{{ securityCopy.removeDetail }}</p>
              <p class="muted">{{ securityCopy.revocation }}</p>
            </div>
            <p id="announcement" role="status">{{ state.announcement }}</p>
          </div>
        </div>
        <footer v-if="actions.length" class="actions">
          <div v-for="button in actions" :key="button.action">
            <SituateButton
              :variant="button.primary ? 'primary' : 'secondary'"
              size="small"
              type="button"
              :data-action="button.action"
              :disabled="
                (button.action === 'acknowledge' && !state.warningChecked) ||
                (button.action === 'retry-store' && state.storeRetry)
              "
              @click="action(button.action)"
            >
              {{ button.label }}
            </SituateButton>
          </div>
        </footer>
      </component>
    </div>
    <SituateDialog
      id="skip-dialog"
      ref="skip"
      aria-labelledby="skip-title"
      aria-describedby="skip-description"
      @cancel.prevent.stop="closeDialog"
      @keydown="trap"
    >
      <h2 id="skip-title">Continue without AI?</h2>
      <p id="skip-description">
        Without AI access, Situate’s AI features, including chat, are
        unavailable. You can still read and edit local notes, tasks and
        documents. Connect AI later in Workspace settings → AI access.
      </p>
      <footer>
        <SituateButton
          variant="secondary"
          size="small"
          id="dismiss-skip"
          type="button"
          @click="closeDialog"
        >
          Cancel</SituateButton
        ><SituateButton
          variant="primary"
          size="small"
          type="button"
          @click="action('local')"
        >
          Continue without AI
        </SituateButton>
      </footer>
    </SituateDialog>
  </div>
  <EditorDialog
    v-if="confirmation"
    :title="heading(state, workspaceLabel)[0]"
    @close="action('settings')"
  >
    <div class="settings-dialog-body">
      <p>{{ heading(state, workspaceLabel)[1] }}</p>
      <template v-if="state.screen === 'remove'">
        <p>{{ securityCopy.removeDetail }}</p>
        <p>{{ securityCopy.revocation }}</p>
      </template>
      <div class="settings-dialog-actions">
        <SituateButton
          :variant="button.primary ? 'primary' : 'secondary'"
          size="small"
          v-for="button in footerActions(state)"
          :key="button.action"
          type="button"
          :autofocus="!button.primary || undefined"
          @click="action(button.action)"
        >
          {{ button.label }}
        </SituateButton>
      </div>
    </div>
  </EditorDialog>
</template>
<style scoped src="./ai.css"></style>
<style scoped>
.ai-view {
  min-height: 0;
  width: 100%;
  overflow: hidden;
  position: relative;
}
.setup-body {
  display: contents;
}
.mobile .shell {
  grid-template-columns: 1fr;
}
.mobile .sidebar {
  display: none;
}
.mobile .sidebar.navigation-open {
  display: flex;
  position: absolute;
  z-index: 2;
  inset: 76px 0 0;
  overflow: auto;
}
.mobile .header-actions {
  display: flex;
}
</style>
