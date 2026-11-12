<script setup lang="ts">
import { t, localizeError } from "@situate/localization";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import {
  SituateDialog,
  SituateInput,
  SituateField,
  SituateCheckbox,
  SituateSwitch,
  SituateButton,
} from "@situate/ui";
import ProviderIcon from "./ProviderIcon.vue";
import wordmark from "../../../../design/brand/assets/wordmark.svg";
import bend from "../../../../design/brand/bend/svg/wave-welcome.svg";
import pleased from "../../../../design/brand/bend/svg/celebrate-pleased.svg";
import {
  getStatus,
  removeConnection,
  saveConnection,
  type Config,
  type Status,
} from "./api";

import { useModelCatalog } from "./useModelCatalog";

const OpenAiBrowserLogin = defineAsyncComponent(
  () => import("./OpenAiBrowserLogin.vue"),
);
const CodexDeviceLogin = defineAsyncComponent(
  () => import("./CodexDeviceLogin.vue"),
);

const props = defineProps<{
  scope: string;
  workspaceName: string;
  created?: boolean;
  notice?: unknown;
  embedded?: boolean;
  required?: boolean;
  connection?: Config;
}>();
const emit = defineEmits<{ done: []; connected: [status: Status] }>();
const origin =
  props.embedded || props.required
    ? "providers"
    : props.created
      ? "offer"
      : "settings";
const stage = ref(
  props.connection
    ? props.connection.provider === "custom"
      ? "form"
      : "method"
    : origin,
);
const status = ref<Status | null>(null);
const {
  catalog,
  loading: catalogLoading,
  failed: catalogFailed,
  reload: reloadCatalog,
} = useModelCatalog(
  () =>
    stage.value !== "offer" &&
    (stage.value !== "settings" || !!status.value?.config),
);
const providers = computed(() =>
  (catalog.value?.providers ?? [])
    .filter((provider) =>
      ["openai", "openai-codex", "anthropic", "openrouter"].includes(
        provider.id,
      ),
    )
    .map((provider) =>
      provider.id === "openai-codex"
        ? { ...provider, name: t("ai.providers.codex") }
        : provider,
    ),
);
const openAiBrowserModels = computed(
  () => catalog.value?.openAiBrowserModels ?? [],
);
const modelAvailable = (
  model: Parameters<NonNullable<typeof catalog.value>["modelAvailable"]>[0],
) => catalog.value?.modelAvailable(model) ?? false;

const providerId = ref(props.connection?.provider ?? "");
const endpoint = ref(props.connection?.endpoint ?? "");
const label = ref(props.connection?.label ?? "");
const httpAcknowledged = ref(false);
const normalizedEndpoint = computed(() => {
  try {
    return new URL(endpoint.value.trim()).toString();
  } catch {
    return "";
  }
});
const needsHttpConsent = computed(
  () =>
    providerId.value === "custom" &&
    normalizedEndpoint.value.startsWith("http:"),
);
watch(endpoint, () => {
  httpAcknowledged.value = false;
});
const key = ref("");
const reveal = ref(false);
const error = ref<unknown>("");
const busy = ref(false);
const heading = useTemplateRef<HTMLElement>("heading");
const browserLogin =
  useTemplateRef<InstanceType<typeof OpenAiBrowserLogin>>("browserLogin");
const deviceLogin =
  useTemplateRef<InstanceType<typeof CodexDeviceLogin>>("deviceLogin");
const skipDialogControl =
  useTemplateRef<InstanceType<typeof SituateDialog>>("skipDialogControl");
const skipDialog = computed(() => skipDialogControl.value?.element);
const skipButtonControl =
  useTemplateRef<InstanceType<typeof SituateButton>>("skipButtonControl");
const skipButton = computed(() => skipButtonControl.value?.element);
let alive = true;
const provider = computed(() =>
  providers.value.find((provider) => provider.id === providerId.value),
);
const methods = computed(() =>
  providerId.value === "openai-codex"
    ? [{ id: "device" }]
    : (provider.value?.methods ?? []).filter(
        (method) =>
          (!props.connection ||
            method.id === (props.connection.auth ?? "api_key")) &&
          (method.id === "api_key" ||
            (method.id === "oauth" && providerId.value === "openai")),
      ),
);
const choices = computed(() => [
  ...providers.value.map((provider) => ({
    id: provider.id,
    name: provider.name,
  })),
  {
    id: "custom",
    name: t("ai.compatibleEndpoint"),
  },
]);
const apiKeyHelp = computed(() =>
  t(
    providerId.value === "custom"
      ? "ai.connections.serverKeyHelp"
      : providerId.value === "anthropic"
        ? "ai.connections.anthropicKeyHelp"
        : providerId.value === "openrouter"
          ? "ai.connections.openrouterKeyHelp"
          : "ai.connections.openaiKeyHelp",
  ),
);
const models = computed(
  () => provider.value?.models.filter(modelAvailable) ?? [],
);
const savedCatalogEmpty = computed(() => {
  const saved = status.value;
  return (
    saved?.config &&
    saved.config.provider !== "custom" &&
    (saved.catalog?.source === "account" ||
      saved.catalog?.source === "provider") &&
    catalog.value &&
    !catalog.value.availableChatModels(saved.config, saved.catalog).length
  );
});
const savedProvider = computed(() =>
  status.value?.config?.provider === "custom"
    ? status.value.config.endpoint
    : (providers.value.find(
        (provider) => provider.id === status.value?.config?.provider,
      )?.name ?? status.value?.config?.provider),
);
const unavailable = computed(() =>
  status.value?.reason === "native.ai.access.platform"
    ? status.value.reason
    : "",
);
const title = computed(
  () =>
    ({
      offer: t("ai.makeRoomForYourNextIdea"),
      settings: t("ai.aiAccess"),
      providers: t("ai.chooseAProvider"),
      method: t("ai.connectProvider", { name: provider.value?.name ?? "" }),
      form:
        providerId.value === "custom"
          ? t("ai.connectAnEndpoint")
          : t("ai.connectProvider", { name: provider.value?.name ?? "" }),
      browser: t("ai.signInToOpenAI"),
      device: t("ai.device.title"),
      saved:
        status.value?.config?.auth === "oauth"
          ? t("ai.aiAccessConnected")
          : t("ai.aiAccessSaved"),
      remove: t("ai.removeAIAccess"),
    })[stage.value] ?? t("ai.aiAccess"),
);
const subtitle = computed(
  () =>
    ({
      offer: t("ai.connectAIToTurnYourNotesAndPlansInto"),
      settings: t("ai.workspaceConnection", { name: props.workspaceName }),
    })[stage.value],
);
const eyebrow = computed(() =>
  stage.value === "offer"
    ? t("ai.yourWorkspaceIsReady")
    : stage.value === "saved"
      ? t("ai.readyWhenYouAre")
      : stage.value === "settings"
        ? t("ai.workspaceSettings")
        : t("ai.aiAccess"),
);
watch(stage, async () => {
  error.value = "";
  await nextTick();
  heading.value?.focus();
});
watch(providerId, () => {
  key.value = "";
  reveal.value = false;
});
onMounted(async () => {
  try {
    const result = await getStatus(props.scope);
    if (alive) status.value = result;
  } catch {
    if (alive) error.value = "ai.aiAccessCouldNotBeReadCloseThisScreen";
  }
  await nextTick();
  heading.value?.focus();
});
onBeforeUnmount(() => {
  alive = false;
  key.value = "";
  skipDialog.value?.close();
});
function done(): void {
  if (props.required && !status.value?.available) return;
  key.value = "";
  emit("done");
}
function choose(id: string): void {
  providerId.value = id;
  stage.value = id === "custom" ? "form" : "method";
}
function back(): void {
  key.value = "";
  if (
    props.embedded &&
    props.connection &&
    (stage.value === "method" || providerId.value === "custom")
  ) {
    done();
    return;
  }
  if (stage.value === "form")
    stage.value = providerId.value === "custom" ? "providers" : "method";
  else if (stage.value === "method") stage.value = "providers";
  else stage.value = stage.value === "remove" ? "settings" : origin;
}
function methodAvailable(id: string): boolean {
  if (unavailable.value) return false;
  if (id === "device") return providerId.value === "openai-codex";
  return id === "api_key"
    ? models.value.length > 0
    : id === "oauth" &&
        providerId.value === "openai" &&
        openAiBrowserModels.value.length > 0;
}
function connected(result: Status): void {
  if (!alive || busy.value || !["browser", "device"].includes(stage.value))
    return;
  status.value = result;
  stage.value = "saved";
  emit("connected", result);
}
async function cancelAndWait(): Promise<void> {
  await browserLogin.value?.cancelAndWait();
  await deviceLogin.value?.cancelAndWait();
}
defineExpose({ cancelAndWait });
async function cancelBrowser(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await cancelAndWait();
    const result = await getStatus(props.scope);
    if (alive) {
      status.value = result;
      stage.value = "method";
    }
  } catch (reason) {
    if (alive)
      error.value =
        typeof reason === "string" && reason.startsWith("native.ai.")
          ? reason
          : "ai.couldNotFinishReturningToAIAccessKeepThis";
  } finally {
    if (alive) busy.value = false;
  }
}
async function save(): Promise<void> {
  if (busy.value || (needsHttpConsent.value && !httpAcknowledged.value)) return;
  busy.value = true;
  error.value = "";
  const config: Config = {
    provider: providerId.value,
    endpoint: providerId.value === "custom" ? normalizedEndpoint.value : null,
    ...(props.connection?.connectionId
      ? { connectionId: props.connection.connectionId }
      : {}),
    ...(label.value.trim() ? { label: label.value.trim() } : {}),
    ...(needsHttpConsent.value
      ? { httpAcknowledgement: normalizedEndpoint.value }
      : {}),
  };
  try {
    const saved = await saveConnection(props.scope, config, key.value);
    if (!alive) return;
    key.value = "";
    if (!saved.available || !saved.config)
      throw new Error("ai.theSavedConnectionIsUnavailable");
    status.value = saved;
    stage.value = "saved";
    emit("connected", saved);
  } catch (reason) {
    if (!alive) return;
    const uncertain = "native.ai.access.durability";
    error.value =
      typeof reason === "string" && reason.startsWith("native.ai.")
        ? reason
        : "ai.aiAccessCouldNotBeConfirmedCheckTheEndpoint";
    if (reason === uncertain) {
      try {
        const current = await getStatus(props.scope);
        if (alive) status.value = current;
      } catch {
        if (alive) status.value = null;
      }
    }
  } finally {
    if (alive) busy.value = false;
  }
}
async function remove(): Promise<void> {
  busy.value = true;
  try {
    await removeConnection(props.scope);
    if (alive) {
      status.value = {
        config: null,
        available: false,
        reason: null,
        selectedModel: null,
        modelError: null,
      };
      stage.value = "settings";
    }
  } catch {
    if (alive) error.value = "ai.aiAccessCouldNotBeRemovedStopAnyResponse";
  } finally {
    if (alive) busy.value = false;
  }
}
function cancelSkip(): void {
  skipDialog.value?.close();
  skipButton.value?.focus();
}
</script>

<template>
  <section
    class="ai-setup"
    :class="{ 'ai-embedded': embedded }"
    aria-labelledby="ai-heading"
  >
    <header v-if="!embedded">
      <img
        :src="wordmark"
        :alt="t('navigation.situate')"
        width="110"
        height="34"
      /><span>{{ t("ai.workspaceHeading", { name: workspaceName }) }}</span>
    </header>
    <div class="ai-content" :class="{ 'ai-complete': stage === 'saved' }">
      <ol
        v-if="created"
        class="ai-progress"
        :aria-label="t('ai.workspaceSetup')"
      >
        <li class="done">
          <span aria-hidden="true">✓</span>{{ t("ai.workspaceReady") }}
        </li>
        <li
          :class="stage === 'saved' ? 'done' : 'active'"
          :aria-current="stage !== 'saved' ? 'step' : undefined"
        >
          <span data-localization-content="formatted" aria-hidden="true">{{
            stage === "saved" ? "✓" : "2"
          }}</span
          >{{ t("ai.aiAccess") }}
        </li>
        <li
          :class="{ done: stage === 'saved' }"
          :aria-current="stage === 'saved' ? 'step' : undefined"
        >
          <span data-localization-content="formatted" aria-hidden="true">{{
            stage === "saved" ? "✓" : "3"
          }}</span
          >{{ t("ai.ready") }}
        </li>
      </ol>
      <p v-if="notice" class="ai-note" role="alert">
        {{ localizeError(notice) }}
      </p>
      <p
        v-if="
          status?.available &&
          !error &&
          ['providers', 'method', 'form', 'browser'].includes(stage)
        "
        class="ai-note"
      >
        {{ t("ai.currentAccessRetained", { name: savedProvider ?? "" }) }}
      </p>
      <div
        :class="{
          'ai-welcome-scene': stage === 'offer',
          'ai-success-scene': stage === 'saved',
        }"
      >
        <div class="ai-heading">
          <p class="ai-eyebrow">{{ eyebrow }}</p>
          <h1 id="ai-heading" ref="heading" tabindex="-1">{{ title }}</h1>
          <p v-if="subtitle" class="ai-subtitle">{{ subtitle }}</p>
        </div>
        <div
          v-if="stage === 'offer' || stage === 'saved'"
          class="ai-bend-scene"
        >
          <img
            class="ai-bend"
            :src="stage === 'saved' ? pleased : bend"
            width="180"
            height="180"
            alt=""
          />
        </div>
      </div>
      <p v-if="unavailable" role="status">{{ localizeError(unavailable) }}</p>
      <template v-if="stage === 'offer'">
        <div class="ai-choices ai-entry-choices">
          <SituateButton
            variant="plain"
            class="ai-primary-choice"
            type="button"
            :disabled="!!unavailable || !status"
            @click="stage = 'providers'"
          >
            <strong>{{ t("ai.connectMyProvider") }}</strong
            ><small>{{ t("ai.bringYourOwnKeyOrOtherSupportedAccess") }}</small
            ><span aria-hidden="true">→</span>
          </SituateButton>
          <SituateButton variant="plain" type="button" disabled>
            <strong>{{ t("ai.situateManagedAI") }}</strong
            ><small>{{ t("ai.managedAccessIsNotAvailableYet") }}</small
            ><span aria-hidden="true">→</span>
          </SituateButton>
        </div>
      </template>
      <template v-else-if="stage === 'settings'">
        <p
          v-if="status?.config"
          :data-localization-content="
            status.config.provider === 'custom' ? undefined : 'identity'
          "
        >
          {{
            status.config.provider === "custom"
              ? t("ai.compatibleEndpoint")
              : savedProvider
          }}
        </p>
        <p v-if="status?.config?.endpoint" data-localization-content="user">
          {{ status.config.endpoint }}
        </p>
        <p v-if="status?.config?.auth === 'oauth'">
          {{ t("ai.signedInWithChatGPT") }}
        </p>
        <p v-if="status?.reason && !unavailable" role="status">
          {{ localizeError(status.reason) }}
        </p>
        <p v-if="!status?.available && !status?.reason">
          {{ t("ai.thisWorkspaceHasNoConnectedAIAccessChatIs") }}
        </p>
        <p>
          {{ t("ai.credentialsAreEncryptedInThisWorkspaceTheDecryptionKey") }}
        </p>
        <SituateButton
          :disabled="!!unavailable || !status"
          @click="stage = 'providers'"
          >{{
            status?.available ? t("ai.changeAIAccess") : t("ai.connectAIAccess")
          }}</SituateButton
        >
        <SituateButton
          variant="secondary"
          size="small"
          v-if="status?.config || (status?.reason && !unavailable)"
          type="button"
          @click="stage = 'remove'"
        >
          {{ t("ai.removeAIAccessDetail") }}
        </SituateButton>
      </template>
      <template v-else-if="stage === 'providers' && catalog">
        <div class="ai-provider-grid" role="group" :aria-label="title">
          <SituateButton
            variant="plain"
            v-for="item in choices"
            :key="item.id"
            class="ai-provider-choice"
            type="button"
            @click="choose(item.id)"
          >
            <ProviderIcon :provider="item.id" />
            <strong
              :data-localization-content="
                item.id === 'custom' ? undefined : 'identity'
              "
              >{{ item.name }}</strong
            ><span class="ai-provider-arrow" aria-hidden="true">→</span>
          </SituateButton>
        </div>
      </template>
      <div v-else-if="stage === 'method'" class="ai-connection-panel">
        <SituateField
          id="ai-connection-label"
          :label="t('ai.connections.label')"
          v-slot="{ controlAttrs }"
        >
          <SituateInput v-bind="controlAttrs" v-model="label" maxlength="120" />
        </SituateField>
        <div class="ai-choices ai-method-list" role="group" :aria-label="title">
          <SituateButton
            variant="plain"
            v-for="method in methods"
            :key="method.id"
            class="ai-method-choice"
            type="button"
            :aria-labelledby="`ai-method-${method.id}`"
            :aria-describedby="`ai-method-${method.id}-help`"
            :disabled="!methodAvailable(method.id)"
            @click="
              stage =
                method.id === 'device'
                  ? 'device'
                  : method.id === 'oauth'
                    ? 'browser'
                    : 'form'
            "
          >
            <strong :id="`ai-method-${method.id}`">{{
              method.id === "device"
                ? t("ai.device.title")
                : method.id === "oauth" && providerId === "openai"
                  ? t("ai.signInWithChatGPT")
                  : method.id === "oauth"
                    ? t("ai.browserMethod")
                    : t("ai.apiKeyMethod")
            }}</strong
            ><small :id="`ai-method-${method.id}-help`">{{
              !methodAvailable(method.id)
                ? t("ai.notAvailableHereYet")
                : method.id === "device"
                  ? t("ai.connections.codexHelp")
                  : method.id === "oauth"
                    ? t("ai.connections.chatgptHelp")
                    : apiKeyHelp
            }}</small>
            <span class="ai-provider-arrow" aria-hidden="true">→</span>
          </SituateButton>
        </div>
        <p v-if="provider && !methods.length">
          {{ t("ai.browserAndDeviceSignInAreNotAvailableFor") }}
        </p>
        <p
          v-if="
            methods.some((method) => method.id === 'api_key') && !models.length
          "
        >
          {{ t("ai.thisProviderHasNoChatModelWithASupported") }}
        </p>
      </div>
      <fieldset
        v-else-if="stage === 'browser'"
        class="ai-browser-fields"
        :disabled="busy"
        :aria-label="t('ai.openaiBrowserSignIn')"
      >
        <OpenAiBrowserLogin
          ref="browserLogin"
          :scope="scope"
          :connection-id="connection?.connectionId"
          :label="label.trim() || undefined"
          @connected="connected"
        />
      </fieldset>
      <CodexDeviceLogin
        v-else-if="stage === 'device'"
        ref="deviceLogin"
        :scope="scope"
        :connection-id="connection?.connectionId"
        :label="label.trim() || undefined"
        @connected="connected"
      />
      <form
        v-else-if="stage === 'form'"
        id="ai-form"
        class="ai-connection-panel"
        @submit.prevent="save"
      >
        <SituateField
          id="ai-connection-label"
          :label="t('ai.connections.label')"
          v-slot="{ controlAttrs }"
        >
          <SituateInput
            v-bind="controlAttrs"
            v-model="label"
            maxlength="120"
            :disabled="busy"
          />
        </SituateField>
        <template v-if="providerId === 'custom'">
          <SituateField
            id="ai-endpoint"
            :label="t('ai.openaiCompatibleEndpoint')"
            :help="t('ai.chatCompletionsOnlyUseHTTPSForHostedEndpointsOr')"
            v-slot="{ controlAttrs }"
          >
            <SituateInput
              v-bind="controlAttrs"
              v-model="endpoint"
              type="url"
              :placeholder="t('ai.httpLocalhost11434V1')"
              required
              :disabled="busy"
            />
          </SituateField>
          <div v-if="needsHttpConsent" class="ai-note">
            <p>
              {{
                t("ai.connections.httpWarning", {
                  endpoint: normalizedEndpoint,
                })
              }}
            </p>
            <label class="ai-reveal"
              ><SituateCheckbox
                appearance="plain"
                v-model="httpAcknowledged"
                type="checkbox"
                :disabled="busy"
                required
              />{{ t("ai.connections.httpConsent") }}</label
            >
          </div>
        </template>
        <SituateField
          id="ai-key"
          :label="providerId === 'custom' ? t('ai.optionalKey') : t('ai.key')"
          :help="apiKeyHelp"
          v-slot="{ controlAttrs }"
        >
          <SituateInput
            v-bind="controlAttrs"
            v-model="key"
            :type="reveal ? 'text' : 'password'"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :required="providerId !== 'custom'"
            :disabled="busy"
          />
        </SituateField>
        <label class="ai-reveal"
          ><SituateSwitch v-model="reveal" />{{ t("ai.showKey") }}</label
        >
        <p>{{ t("ai.savingDoesNotContactTheProviderOrVerifyThis") }}</p>
      </form>
      <template v-else-if="stage === 'saved'"
        ><p class="ai-receipt">
          <span aria-hidden="true">✓</span>
          {{
            t("ai.configured", {
              provider: savedProvider ?? "",
              name: workspaceName,
            })
          }}
        </p>
        <p v-if="status?.config?.auth === 'oauth'">
          {{ t("ai.signedInToOpenAIModelAvailabilityDependsOnYour") }}
        </p>
        <p v-else>{{ t("ai.noTestMessageWasSentAccessWillBeChecked") }}</p>
        <p v-if="status?.catalog?.source === 'unknown'" role="alert">
          {{ t("ai.models.lookupFailed") }}
        </p>
        <p v-else-if="savedCatalogEmpty" role="status">
          {{ t("ai.models.empty") }}
        </p>
        <p v-if="!status?.selectedModel && !savedCatalogEmpty">
          {{ t("ai.chooseAModelInChatBeforeSendingAMessage") }}
        </p></template
      >
      <template v-else-if="stage === 'remove'"
        ><p>
          {{ t("ai.removeConsequences", { name: workspaceName }) }}
        </p></template
      >
      <p v-if="catalogLoading" role="status">{{ t("ai.loadingModels") }}</p>
      <div v-if="catalogFailed" role="alert">
        <p>{{ t("ai.modelChoicesCouldNotBeRead") }}</p>
        <SituateButton
          variant="secondary"
          size="small"
          type="button"
          @click="reloadCatalog"
        >
          {{ t("ai.retryLoadingModels") }}
        </SituateButton>
      </div>
      <p v-if="error" role="alert">{{ localizeError(error) }}</p>
      <p v-if="busy" role="status">
        {{
          stage === "browser" ? t("ai.cancellingSignIn") : t("ai.savingChanges")
        }}
      </p>
    </div>
    <footer>
      <SituateButton
        variant="secondary"
        size="small"
        v-if="stage === 'offer' && !required"
        ref="skipButtonControl"
        type="button"
        @click="skipDialog?.showModal()"
      >
        {{ t("ai.skipForNow") }}
      </SituateButton>
      <SituateButton
        variant="secondary"
        size="small"
        v-else-if="stage === 'browser' || stage === 'device'"
        type="button"
        :disabled="busy"
        @click="cancelBrowser"
      >
        {{ t("ai.cancelSignIn") }}
      </SituateButton>
      <SituateButton
        variant="secondary"
        size="small"
        v-else-if="stage === 'saved'"
        type="button"
        @click="stage = 'settings'"
      >
        {{ t("ai.connectionSettings") }}
      </SituateButton>
      <SituateButton
        variant="secondary"
        size="small"
        v-else-if="embedded && !required && stage === 'providers'"
        type="button"
        @click="done"
      >
        {{ t("navigation.cancel") }}
      </SituateButton>
      <SituateButton
        variant="secondary"
        size="small"
        v-else-if="stage === 'settings' && (!required || status?.available)"
        type="button"
        @click="done"
      >
        {{ t(required ? "onboarding.checkAccess" : "ai.continueToWorkspace") }}
      </SituateButton>
      <div v-else class="ai-back-actions">
        <SituateButton
          variant="secondary"
          size="small"
          type="button"
          :disabled="busy"
          @click="back"
        >
          {{ t("workspace.back") }}</SituateButton
        ><SituateButton
          variant="secondary"
          size="small"
          v-if="stage === 'form'"
          type="button"
          :disabled="busy"
          @click="
            key = '';
            embedded ? done() : (stage = origin);
          "
        >
          {{ t("navigation.cancel") }}
        </SituateButton>
      </div>
      <SituateButton v-if="stage === 'saved'" @click="done">{{
        required ? t("onboarding.checkAccess") : t("ai.continueToWorkspace")
      }}</SituateButton>
      <SituateButton
        v-if="stage === 'form'"
        type="submit"
        form="ai-form"
        :busy="busy"
        :disabled="!!unavailable"
        >{{ t("ai.saveAIAccess") }}</SituateButton
      >
      <SituateButton
        v-if="stage === 'remove'"
        :disabled="busy"
        @click="remove"
        >{{ t("ai.removeAIAccessDetail") }}</SituateButton
      >
    </footer>
    <SituateDialog
      v-if="!required"
      ref="skipDialogControl"
      aria-labelledby="skip-heading"
      @cancel.prevent="cancelSkip"
    >
      <h2 id="skip-heading">{{ t("ai.continueWithoutAI") }}</h2>
      <p>{{ t("ai.youCanUseLocalContentChatAndAIActions") }}</p>
      <template #actions>
        <SituateButton variant="secondary" type="button" @click="cancelSkip">
          {{ t("navigation.cancel") }}</SituateButton
        ><SituateButton @click="done">{{
          t("ai.continueWithoutAIDetail")
        }}</SituateButton>
      </template>
    </SituateDialog>
  </section>
</template>

<style scoped>
.ai-setup.ai-embedded {
  height: auto;
  min-height: 0;
}
.ai-embedded .ai-content {
  padding: 0;
  overflow: visible;
  gap: 20px;
}
.ai-embedded footer {
  padding: 20px 0 0;
  margin-top: 20px;
}
.ai-embedded h1 {
  font-family: inherit;
  font-size: 22px;
  letter-spacing: normal;
}
.ai-embedded .ai-eyebrow {
  display: none;
}
.ai-setup {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-width: 0;
  background: var(--situate-surface);
  color: var(--situate-ink);
}
header,
footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 32px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--situate-line);
}
header {
  --ai-gutter: 32px;
  padding-top: max(20px, env(safe-area-inset-top));
  padding-bottom: 20px;
}
header span {
  color: var(--situate-muted);
  font-size: 13px;
  overflow-wrap: anywhere;
}
footer {
  --ai-gutter: 32px;
  border-top: 1px solid var(--situate-line);
  border-bottom: 0;
  padding-bottom: max(
    16px,
    var(--app-safe-area-bottom, env(safe-area-inset-bottom))
  );
}
.ai-back-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ai-content {
  --ai-gutter: 40px;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scroll-padding: 20px;
  padding: 28px 40px;
  display: grid;
  align-content: start;
  gap: 24px;
}
.ai-heading {
  display: grid;
  gap: 12px;
}
h1 {
  font-family: var(--situate-font-display);
  font-size: clamp(26px, 3.5vw, 34px);
  font-weight: 600;
  line-height: 1.16;
  letter-spacing: -0.04em;
  margin: 0;
}
h1:focus {
  outline: none;
}
p {
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.ai-subtitle {
  color: var(--situate-muted);
}
.ai-browser-fields {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.ai-setup .ai-content .ai-provider-grid,
.ai-method-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  max-height: none;
  padding: 0;
  margin: 0;
  width: 100%;
  max-width: 640px;
  border: 1px solid var(--situate-control-line);
  border-radius: 20px;
  overflow: hidden;
}
.ai-provider-grid > .ai-provider-choice {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 16px;
  min-width: 0;
  min-height: 68px;
  padding: 14px 20px;
  border: 0;
  border-radius: 0;
  text-align: left;
}
.ai-provider-choice + .ai-provider-choice {
  border-top: 1px solid var(--situate-line);
}
.ai-provider-choice strong {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}
.ai-provider-arrow {
  color: var(--situate-muted);
  font-size: 22px;
  text-align: center;
}
.ai-provider-choice:hover .ai-provider-arrow,
.ai-provider-choice:focus:where(html:not([data-input-modality="pointer"]) *)
  .ai-provider-arrow,
.ai-method-choice:hover .ai-provider-arrow,
.ai-method-choice:focus:where(html:not([data-input-modality="pointer"]) *)
  .ai-provider-arrow {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.ai-provider-grid
  > .ai-provider-choice:focus:where(
    html:not([data-input-modality="pointer"]) *
  ),
.ai-method-list
  > .ai-method-choice:focus:where(html:not([data-input-modality="pointer"]) *) {
  outline: var(--situate-stroke-focus) solid
    var(--situate-accent-strong, var(--situate-cobalt));
  outline-offset: var(--situate-focus-offset);
  border-radius: var(--situate-radius-small);
}
.ai-choices small {
  font-size: 14px;
  color: var(--situate-muted);
}
.ai-connection-panel,
.ai-browser-fields {
  width: 100%;
  max-width: 640px;
}
.ai-connection-panel {
  display: grid;
  gap: 24px;
}
.ai-choices.ai-method-list {
  gap: 0;
}
.ai-method-list > .ai-method-choice {
  grid-template-columns: minmax(0, 1fr) 24px;
  gap: 6px 16px;
  padding: 20px;
  border: 0;
  border-radius: 0;
}
.ai-method-list > .ai-method-choice + .ai-method-choice {
  border-top: 1px solid var(--situate-line);
}
.ai-method-choice strong {
  font-size: 16px;
  line-height: 1.4;
}
.ai-method-choice small {
  grid-column: 1;
  line-height: 1.6;
}
.ai-method-choice .ai-provider-arrow {
  grid-column: 2;
  grid-row: 1 / 3;
  align-self: center;
}
.ai-note {
  background: var(--situate-paper);
  border: 1px solid var(--situate-line);
  border-radius: 12px;
  padding: 20px;
}
.ai-progress {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
  color: var(--situate-muted);
  font-size: 13px;
}
.ai-progress li {
  display: flex;
  align-items: center;
  gap: 7px;
}
.ai-progress li > span {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--situate-control-line);
  border-radius: 50%;
  flex-shrink: 0;
}
.ai-progress .done > span {
  background: var(--situate-accent-soft, var(--situate-lilac));
  border-color: var(--situate-accent-soft, var(--situate-lilac));
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.ai-progress .active {
  color: var(--situate-ink);
  font-weight: 600;
}
.ai-progress .active > span {
  background: var(--situate-accent, var(--situate-ink));
  color: var(--situate-accent-on, var(--situate-surface));
  border-color: var(--situate-accent-edge, var(--situate-ink));
}
.ai-welcome-scene {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 12px;
  align-items: center;
}
.ai-welcome-scene h1 {
  font-size: 38px;
  max-width: 12ch;
}
.ai-eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 13px;
  font-weight: 600;
  color: var(--situate-muted);
}
.ai-welcome-scene .ai-eyebrow {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
.ai-bend-scene {
  background: var(--situate-lilac);
  border-radius: 100px 100px 24px 24px;
}
.ai-bend {
  display: block;
  width: 180px;
  height: 180px;
}
.ai-entry-choices small {
  grid-column: 1;
  color: var(--situate-muted);
}
.ai-entry-choices span {
  grid-column: 2;
  grid-row: 1 / 3;
  align-self: center;
  font-size: 24px;
}
.ai-choices.ai-entry-choices > button {
  grid-template-columns: minmax(0, 1fr) 20px;
  gap: 4px 16px;
  padding: 20px 24px;
}
.ai-entry-choices .ai-primary-choice:not(:disabled) {
  background: var(--situate-accent, var(--situate-ink));
  color: var(--situate-accent-on, var(--situate-surface));
  border-color: var(--situate-accent-edge, var(--situate-ink));
}
.ai-entry-choices .ai-primary-choice:hover:not(:disabled) {
  background: var(--situate-accent-strong, var(--situate-violet-deep));
  color: var(--situate-surface);
}
.ai-choices .ai-primary-choice:not(:disabled) small {
  color: var(--situate-accent-on, var(--situate-on-plum-muted));
}
.ai-choices .ai-primary-choice:hover:not(:disabled) small {
  color: var(--situate-accent-soft, var(--situate-on-plum-muted));
}
.ai-success-scene {
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  text-align: center;
  gap: 20px;
}
.ai-success-scene .ai-bend-scene {
  border-radius: 50%;
}
.ai-receipt {
  text-align: center;
  border-block: 1px solid var(--situate-line);
  padding: 12px 16px;
}
.ai-receipt span {
  color: var(--situate-accent-strong, var(--situate-violet-deep));
}
@media (prefers-reduced-motion: no-preference) {
  .ai-complete .ai-bend {
    animation: ai-arrival var(--situate-duration-settle)
      var(--situate-ease-settle) both;
  }
  @keyframes ai-arrival {
    from {
      transform: scale(0.92) rotate(-5deg);
    }
    to {
      transform: scale(1) rotate(0);
    }
  }
}
@media (max-width: 700px) {
  .ai-content {
    --ai-gutter: 20px;
    padding: 24px 20px;
    gap: 20px;
  }
}
@media (max-width: 500px) {
  header {
    --ai-gutter: 20px;
    padding: max(16px, env(safe-area-inset-top)) 20px 16px;
  }
  header img {
    width: 88px;
    height: auto;
  }
  footer {
    --ai-gutter: 16px;
    padding: 12px 16px
      max(12px, var(--app-safe-area-bottom, env(safe-area-inset-bottom)));
  }
  .ai-content {
    padding: 20px;
  }
  .ai-choices.ai-entry-choices > button {
    padding: 16px;
  }
  .ai-provider-grid > .ai-provider-choice {
    gap: 12px;
    padding: 12px;
    min-height: 64px;
  }
  .ai-progress {
    font-size: 11px;
    gap: 6px;
  }
  .ai-progress li {
    gap: 4px;
  }
  .ai-progress li > span {
    width: 20px;
    height: 20px;
  }
  .ai-welcome-scene {
    grid-template-columns: 1fr;
  }
  .ai-welcome-scene h1 {
    font-size: 32px;
    max-width: 15ch;
  }
  .ai-welcome-scene .ai-bend-scene {
    grid-row: 1;
    justify-self: center;
  }
  .ai-bend {
    width: 160px;
    height: 160px;
  }
}
.ai-choices {
  display: grid;
  gap: 12px;
}
.ai-choices > button {
  display: grid;
  gap: 4px;
  align-content: start;
  padding: 18px 20px;
  border-radius: 16px;
}
button:not(:where(.situate-button--normal)) {
  min-height: 48px;
  padding: 10px 16px;
  border: 1px solid var(--situate-control-line);
  border-radius: var(--situate-radius-pill);
  background: var(--situate-surface);
  color: var(--situate-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
button:not(:where(.situate-button--normal)):hover:not(:disabled) {
  background: var(--situate-accent-soft, var(--situate-lilac));
}
button:not(:where(.situate-button--normal)):disabled {
  cursor: not-allowed;
  background: var(--situate-paper);
}
.ai-setup .situate-button--small {
  min-height: 48px;
  padding: 10px 16px;
  font: inherit;
  text-align: left;
}
button strong,
button small {
  overflow-wrap: anywhere;
}
button:not(:where(.situate-button--normal)):disabled {
  color: var(--situate-muted);
}
label {
  display: block;
  margin-block: 18px 6px;
}
header,
.ai-content,
footer {
  padding-left: max(var(--ai-gutter), env(safe-area-inset-left, 0px));
  padding-right: max(var(--ai-gutter), env(safe-area-inset-right, 0px));
}
.ai-reveal {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 44px;
  margin: 0;
  cursor: pointer;
}
</style>
