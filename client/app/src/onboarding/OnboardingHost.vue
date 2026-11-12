<script setup lang="ts">
import "@situate/localization/onboarding";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { localizeError, t } from "@situate/localization";
import { SituateButton, SituateDialog } from "@situate/ui";
import AiSetup from "../ai/AiSetup.vue";
import ChatModelPicker from "../ai/ChatModelPicker.vue";
import ChatPane from "../components/ChatPane.vue";
import { getStatus, selectChatModel, type Status } from "../ai/api";
import { workspaceChat } from "../ai/chat";
import { ownsDictation } from "../dictation/runtime";
import { workspaceUi } from "../layout/runtime";
import type { ViewTarget } from "../layout/navigation";
import { filesRequest, type FileDocument } from "../files/api";
import { workspaceSession } from "../files/sessions";
import RenderedFile from "../files/RenderedFile.vue";
import { onboardingSession } from "./session";
import {
  checkSetupAccess,
  startSetupConversation,
  restoreSetupConversation,
  enterSetupApp,
  recoverSetupQuestion,
  finishOnboarding,
  continueSetupSupport,
} from "./agent";
import type { OnboardingRecord } from "./types";
import { canAnswerOnboardingQuestion } from "./questions";
import OnboardingView from "./OnboardingView.vue";
import SetupFrame from "./SetupFrame.vue";
import ErrorActions from "../errors/ErrorActions.vue";

const props = defineProps<{
  scope: string;
  workspacePath: string;
  workspaceName: string;
  initialFrom?: number;
  notice?: unknown;
  inert?: boolean;
}>();
const emit = defineEmits<{
  enter: [record: OnboardingRecord, firstEntry: boolean];
  workspaces: [];
}>();
const session = onboardingSession(props.scope);
const state = session.state;
const status = ref<Status | null>(null);
const ready = ref(false),
  busy = ref(false),
  showAccess = ref(false),
  changingConnection = ref(false),
  modelSaving = ref(false);
const accessCheck = ref<
  "idle" | "checking" | "success" | "failure" | "cancelled"
>("idle");
const accessStatus = computed(
  () =>
    ({
      idle: "",
      checking: t("onboarding.access.checking"),
      success: t("onboarding.access.success"),
      failure: t("onboarding.access.failure"),
      cancelled: t("onboarding.access.cancelled"),
    })[accessCheck.value],
);
const error = ref<unknown>();
const setup = ref<InstanceType<typeof AiSetup>>();
const conversationId = ref<string | null>(null);
const reader = ref<FileDocument | null>(null);
function closeReader() {
  readGeneration++;
  reader.value = null;
}
const connected = computed(
  () =>
    !!status.value?.available &&
    !!status.value.selectedModel &&
    !status.value.modelError,
);
const access = computed(
  () => showAccess.value || !connected.value || state.record?.step === "access",
);
const chat = computed(() =>
  conversationId.value
    ? workspaceChat(props.scope, conversationId.value)
    : undefined,
);
const recoverable = computed(
  () =>
    !!chat.value &&
    !chat.value.state.running &&
    !chat.value.state.unsaved &&
    !chat.value.state.questionBusy &&
    !chat.value.state.questions.some(
      (question) =>
        question.status === "pending" && question.context === undefined,
    ) &&
    !["support", "complete"].includes(state.record?.step ?? ""),
);
const canFinish = computed(
  () =>
    !!chat.value &&
    !chat.value.state.running &&
    !chat.value.state.unsaved &&
    !chat.value.state.questionBusy &&
    !chat.value.state.questionActionPending,
);
const canContinueSupport = computed(
  () =>
    canFinish.value &&
    !chat.value!.state.attachmentBusy &&
    !ownsDictation(props.scope, conversationId.value!) &&
    chat.value!.state.questions.every(
      (question) =>
        question.status !== "pending" ||
        canAnswerOnboardingQuestion(
          props.scope,
          conversationId.value!,
          question,
        ),
    ),
);
let alive = true,
  readGeneration = 0;
let attempt: AbortController | undefined;
let operation: Promise<void> | undefined;

async function initialize() {
  workspaceUi(props.scope);
  await session.load();
  if (!alive) return;
  status.value = await getStatus(props.scope);
  const restored = await restoreSetupConversation(props.scope);
  if (!alive) return;
  conversationId.value = restored?.id ?? null;
  ready.value = true;
}
async function selectSetupModel(model: string | null) {
  if (!model || modelSaving.value || busy.value) return false;
  modelSaving.value = true;
  accessCheck.value = "idle";
  try {
    status.value = await selectChatModel(props.scope, model);
    return connected.value;
  } catch (cause) {
    if (alive) error.value = cause;
    return false;
  } finally {
    modelSaving.value = false;
  }
}
async function perform(
  action:
    | "start"
    | "enter"
    | "finish"
    | "support"
    | "pause"
    | "resume"
    | "retry"
    | "access"
    | "recover",
  signal: AbortSignal,
) {
  if (action === "retry") {
    await session.retry();
    await chat.value?.retrySave();
    if (!ready.value) await initialize();
    return;
  }
  await session.flush();
  signal.throwIfAborted();
  const record = state.record;
  if (!record) throw new Error("native.onboarding.storage.invalid");
  if (action === "access") {
    status.value = await getStatus(props.scope);
    signal.throwIfAborted();
    if (!connected.value) throw new Error("onboarding.accessRequired");
    await checkSetupAccess(props.scope, signal);
    signal.throwIfAborted();
    accessCheck.value = "success";
    await session.update(
      {
        step: record.step === "access" ? "method" : record.step,
        paused: false,
      },
      signal,
    );
    showAccess.value = false;
  } else if (action === "start") {
    const started = await startSetupConversation(props.scope, signal);
    if (alive) conversationId.value = started.id;
  } else if (action === "enter") {
    const firstEntry = !record.entered;
    await enterSetupApp(props.scope);
    signal.throwIfAborted();
    emit("enter", structuredClone(state.record!), firstEntry);
  } else if (action === "finish") {
    if (!canFinish.value) throw new Error("native.onboarding.storage.conflict");
    await finishOnboarding(props.scope, signal);
  } else if (action === "support") {
    if (!canContinueSupport.value)
      throw new Error("native.onboarding.storage.conflict");
    const { completion } = await continueSetupSupport(
      props.scope,
      structuredClone(record),
      signal,
    );
    void completion.catch((cause) => {
      if (alive) error.value = cause;
    });
  } else if (action === "pause") {
    await setup.value?.cancelAndWait();
    await session.update({ paused: true }, signal);
  } else if (action === "resume") {
    await session.update({ paused: false }, signal);
  } else if (action === "recover") await recoverSetupQuestion(props.scope);
}
async function run(action: Parameters<typeof perform>[0]) {
  if (busy.value) return operation;
  const current = new AbortController();
  attempt = current;
  busy.value = true;
  error.value = undefined;
  if (action === "access") accessCheck.value = "checking";
  operation = perform(action, current.signal)
    .catch((cause) => {
      if (alive && !current.signal.aborted) {
        if (action === "access" && accessCheck.value !== "success")
          accessCheck.value = "failure";
        else error.value = cause;
      }
    })
    .finally(() => {
      if (attempt === current) {
        attempt = undefined;
        operation = undefined;
        if (alive) busy.value = false;
      }
    });
  return operation;
}
async function cancelAccessCheck() {
  attempt?.abort();
  await operation;
  if (alive) accessCheck.value = "cancelled";
}
async function cancelAndWait() {
  attempt?.abort();
  await Promise.allSettled([
    setup.value?.cancelAndWait(),
    ...[conversationId.value]
      .filter((id): id is string => !!id)
      .map((id) => workspaceChat(props.scope, id).abortAndWait()),
  ]);
  await operation;
  await session.flush();
}
async function readTarget(target: ViewTarget) {
  if (target.kind !== "view" || target.viewId !== "files" || !target.contentId)
    return;
  const generation = ++readGeneration;
  try {
    const reply = await filesRequest(
      target.revision
        ? {
            workspaceId: props.scope,
            operation: "revision",
            path: target.contentId,
            revision: target.revision,
            exactPath: true,
          }
        : {
            workspaceId: props.scope,
            operation: "read",
            path: target.contentId,
          },
    );
    if (alive && generation === readGeneration) {
      if (reply.status !== "ok") throw new Error("references.unavailable");
      reader.value = reply.document;
    }
  } catch (cause) {
    if (alive && generation === readGeneration) error.value = cause;
  }
}
watch(
  () => chat.value?.state.questions,
  async () => {
    if (!alive) return;
    await session.retry().catch((cause) => {
      if (alive) error.value = cause;
    });
  },
  { deep: true },
);
watch(
  () => chat.value?.state.running,
  async (running, before) => {
    if (!running && before && alive) {
      await session.retry().catch((cause) => {
        if (alive) error.value = cause;
      });
      const next = await getStatus(props.scope).catch(() => null);
      if (alive && next) status.value = next;
    }
  },
);
onMounted(() =>
  initialize().catch((cause) => {
    if (alive) error.value = cause;
  }),
);
onBeforeUnmount(() => {
  alive = false;
  readGeneration++;
  attempt?.abort();
  void session.flush().catch(() => {});
});
defineExpose({ cancelAndWait, flush: session.flush });
</script>
<template>
  <SetupFrame
    v-if="!ready || state.loading || !state.record"
    :inert="inert || undefined"
    :step="1"
    :initial-from="initialFrom"
    :blocked="!!(error || state.error)"
  >
    <p role="status">
      {{
        error || state.error
          ? t("onboarding.loadFailed")
          : t("navigation.openingWorkspaces")
      }}
    </p>
    <p v-if="error || state.error" role="alert">
      {{ localizeError(error || state.error) }}
    </p>
    <SituateButton v-if="error || state.error" @click="run('retry')">{{
      t("onboarding.retry")
    }}</SituateButton>
    <template v-if="error || state.error">
      <SituateButton variant="secondary" @click="emit('workspaces')">{{
        t("errorRecovery.workspaces")
      }}</SituateButton>
      <ErrorActions
        boundary="onboarding"
        :error="error || state.error"
        :scope="scope"
      />
    </template>
  </SetupFrame>
  <OnboardingView
    v-else
    :inert="inert || undefined"
    :state="state.record"
    :workspace-path="workspacePath"
    :workspace-name="workspaceName"
    :initial-from="initialFrom"
    :busy="busy"
    :connected="connected"
    :access="access"
    :access-configured="!!status?.config && !changingConnection"
    :started="!!conversationId"
    :can-finish="canFinish"
    :can-continue-support="canContinueSupport"
    :error="
      error ||
      state.error ||
      notice ||
      (chat?.state.questionActionPending ? chat.state.error : undefined)
    "
    @patch="session.patch"
    @action="run"
  >
    <template #access>
      <AiSetup
        v-if="!status?.config || changingConnection"
        ref="setup"
        class="setup-access"
        :scope="scope"
        :workspace-name="workspaceName"
        required
        embedded
        @connected="
          status = $event;
          changingConnection = false;
        "
        @done="run('access')"
      />
      <template v-else>
        <div class="setup-model">
          <p>{{ t("onboarding.access.modelLabel") }}</p>
          <ChatModelPicker
            appearance="field"
            :workspace-scope="scope"
            :label="t('onboarding.access.modelLabel')"
            :allow-inheritance="false"
            :status="status"
            :saving="modelSaving || busy"
            :running="busy"
            :unsaved="!!chat?.state.unsaved"
            :select-model="selectSetupModel"
          />
        </div>
        <div class="setup-check-status" :data-state="accessCheck">
          <p class="setup-check-reserve" aria-hidden="true">
            {{ t("onboarding.access.checkDetail") }}
          </p>
          <p class="setup-check-reserve" aria-hidden="true">
            {{ t("onboarding.access.failure") }}
          </p>
          <p role="status" aria-live="polite" aria-atomic="true">
            {{ accessStatus || t("onboarding.access.checkDetail") }}
          </p>
        </div>
        <div class="setup-access-actions">
          <SituateButton
            v-if="accessCheck === 'checking'"
            variant="secondary"
            @click="cancelAccessCheck"
            >{{ t("onboarding.access.cancel") }}</SituateButton
          >
          <SituateButton
            v-else
            variant="secondary"
            :disabled="busy"
            @click="
              changingConnection = true;
              accessCheck = 'idle';
            "
            >{{ t("onboarding.access.change") }}</SituateButton
          >
          <SituateButton
            :disabled="busy || modelSaving || !connected"
            @click="run('access')"
            >{{
              t(
                accessCheck === "failure" || accessCheck === "cancelled"
                  ? "onboarding.access.retry"
                  : "onboarding.access.check",
              )
            }}</SituateButton
          >
        </div>
      </template>
    </template>
    <template #notices>
      <div v-if="recoverable" class="setup-recovery">
        <SituateButton
          variant="ghost"
          size="small"
          :disabled="busy"
          @click="run('recover')"
          >{{ t("onboarding.conversation.recover") }}</SituateButton
        >
      </div>
      <div
        v-if="chat?.state.error && !chat.state.running"
        class="setup-recovery"
      >
        <SituateButton
          variant="ghost"
          size="small"
          @click="showAccess = true"
          >{{ t("onboarding.access.change") }}</SituateButton
        >
      </div>
    </template>
    <template #conversation>
      <ChatPane
        v-if="conversationId"
        :workspace-scope="scope"
        :conversation-id="conversationId"
        embedded
        @navigate="readTarget"
      />
    </template>
  </OnboardingView>
  <SituateDialog
    :inert="inert || undefined"
    :open="!!reader"
    class="setup-reader"
    :aria-label="reader?.path"
    @close="closeReader"
    @cancel="closeReader"
  >
    <template v-if="reader">
      <h1 data-dialog-title data-localization-content="user">
        {{ reader.path }}
      </h1>
      <p>{{ t("files.readOnly") }}</p>
      <RenderedFile
        :session="workspaceSession(scope)"
        :path="reader.path"
        :text="reader.version.text"
        :document="reader"
        :editable="false"
        @navigate="
          readTarget({ kind: 'view', viewId: 'files', contentId: $event })
        "
      />
    </template>
    <template #actions
      ><SituateButton variant="secondary" @click="closeReader">{{
        t("onboarding.close")
      }}</SituateButton></template
    >
  </SituateDialog>
</template>
<style scoped>
.setup-access-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.setup-recovery {
  padding: 4px 16px;
  flex: none;
}
.setup-reader {
  width: min(960px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
}
.setup-access :deep(.ai-content) {
  max-width: none;
  margin: 0;
  gap: 24px;
}
.setup-access :deep(.ai-provider-grid) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-height: 360px;
  overflow: auto;
  padding: 4px;
  margin: -4px;
}
.setup-model {
  display: grid;
  gap: var(--situate-space-2);
  min-width: 0;
}
.setup-model :deep(.model-picker),
.setup-model :deep(.situate-select),
.setup-model :deep(.manual-trigger) {
  width: 100%;
  max-width: none;
}
.setup-check-status {
  min-height: 3.2em;
  padding: 12px 16px;
  border-radius: var(--situate-radius-control);
  background: var(--situate-accent-soft, var(--situate-lilac));
  display: grid;
  align-items: center;
}
.setup-check-status[data-state="idle"] {
  background: transparent;
}
.setup-check-status p {
  grid-area: 1 / 1;
  margin: 0;
}
.setup-check-reserve {
  visibility: hidden;
}
@media (max-width: 420px) {
  .setup-access :deep(.ai-provider-grid) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
