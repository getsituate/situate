<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { t, localizeError } from "@situate/localization";
import {
  SituateButton,
  SituateDialog,
  SituateDisclosure,
  SituateIconButton,
  SituateTextarea,
} from "@situate/ui";
import RecoveryBend from "./RecoveryBend.vue";
import {
  dismissIncident,
  openIncident,
  recoveryState as state,
  resolveIncident,
  retryStartupInitialization,
  safeFailureCode,
} from "./runtime";
import { incidentDetails, problemReport } from "./report";
import { openRecoveryEmail, requestRecovery } from "./native";
import { startErrorRepair } from "./repair";
const props = defineProps<{
  mobile?: boolean;
  onRepairOpened?: (scope: string, conversationId: string) => Promise<void>;
}>();
const mobile = computed(
  () => props.mobile || /iPhone|iPad|iPod/iu.test(navigator.userAgent),
);
const dialog = ref<InstanceType<typeof SituateDialog>>();
const entry = ref<HTMLElement>();
const reportControl = ref<InstanceType<typeof SituateTextarea>>();
const busy = ref(false);
const error = ref("");
const version = ref("unknown");
const details = ref("");
const reportBody = ref("");
const mailOpened = ref(false);
const assignment = ref("");
const assignmentDurable = ref(false);
const incident = computed(() => state.active);
const title = computed(() =>
  t(
    state.page === "report"
      ? "errorRecovery.reportTitle"
      : state.page === "mail"
        ? "errorRecovery.mailTitle"
        : state.page === "repair"
          ? "errorRecovery.repair"
          : state.page === "reopen"
            ? "errorRecovery.reopen"
            : "errorRecovery.title",
  ),
);
let invoker: HTMLElement | undefined;
onMounted(() => {
  void getVersion()
    .then((value) => {
      version.value = value;
    })
    .catch(() => {});
});
watch(
  () => [state.active?.id, state.page] as const,
  async ([id, page], previous) => {
    error.value = "";
    if (id !== previous?.[0]) {
      details.value = "";
      assignment.value = "";
    }
    if (page && !previous?.[1])
      invoker =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined;
    if (page === "report" && incident.value && !details.value)
      details.value = incidentDetails(incident.value, version.value);
    await nextTick();
    if (page)
      dialog.value?.element
        ?.querySelector<HTMLElement>("[data-initial-focus]")
        ?.focus();
    else if (invoker?.isConnected) invoker.focus();
    else entry.value?.querySelector<HTMLElement>("button")?.focus();
    if (page === "repair" && incident.value && !assignment.value) void repair();
  },
  { immediate: true, flush: "post" },
);
function close() {
  if (!busy.value) dismissIncident();
}
function trapTab(event: KeyboardEvent) {
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey)
    return;
  const controls = Array.from(
    dialog.value?.element?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), textarea:not([disabled]), summary, [tabindex='0']",
    ) ?? [],
  ).filter((control) => control.getClientRects().length > 0);
  if (!controls.length) return;
  event.preventDefault();
  const index = controls.indexOf(document.activeElement as HTMLElement);
  controls[
    (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
  ]?.focus();
}
async function perform(action: () => Promise<void>) {
  if (busy.value) return;
  const current = incident.value;
  busy.value = true;
  error.value = "";
  try {
    await action();
  } catch (cause) {
    if (incident.value === current) {
      const code = safeFailureCode(cause);
      error.value =
        code === "unknown"
          ? t("errorRecovery.actionFailed")
          : localizeError(code);
    }
  } finally {
    busy.value = false;
  }
}
function recover() {
  const current = incident.value;
  if (!current) return;
  void perform(async () => {
    if (current.boundary === "startup") await retryStartupInitialization();
    else await requestRecovery("workspace", current.scope);
    resolveIncident(current);
  });
}
function restart() {
  if (mobile.value) {
    state.page = "reopen";
    return;
  }
  void perform(async () => {
    await requestRecovery("restart", incident.value?.scope);
  });
}
function email() {
  const current = incident.value;
  if (!current) return;
  reportBody.value = problemReport(current, details.value);
  void perform(async () => {
    const opened = await openRecoveryEmail(reportBody.value).catch(() => false);
    if (incident.value !== current || !state.incidents.includes(current))
      return;
    mailOpened.value = opened;
    state.page = "mail";
  });
}
async function repair() {
  const current = incident.value;
  if (!current) return;
  const safeDetails = details.value || incidentDetails(current, version.value);
  await perform(async () => {
    const result = await startErrorRepair({
      id: current.id,
      scope: current.scope,
      boundary: current.boundary,
      code: current.code,
      details: safeDetails,
    });
    if (incident.value !== current || !state.incidents.includes(current))
      return;
    if (result && result.assignment) assignment.value = result.assignment;
    assignmentDurable.value = !!result?.durable;
    if (result && result.blocked) error.value = localizeError(result.blocked);
    else {
      if (current.scope && result?.conversationId)
        await props.onRepairOpened?.(current.scope, result.conversationId);
      if (incident.value === current && state.incidents.includes(current))
        dismissIncident();
    }
  });
}
</script>
<template>
  <aside
    v-if="state.incidents.length && !state.page"
    ref="entry"
    class="recovery-entry"
    :aria-label="t('errorRecovery.review')"
  >
    <SituateButton
      v-for="item in state.incidents"
      :key="item.id"
      variant="secondary"
      size="small"
      @click="openIncident(item)"
      >{{ t("errorRecovery.review") }}</SituateButton
    >
  </aside>
  <SituateDialog
    ref="dialog"
    :open="!!state.page"
    :class="{ 'incident-dialog': state.page === 'unexpected' }"
    aria-labelledby="incident-title"
    aria-describedby="incident-description"
    :aria-busy="busy"
    @cancel.prevent="close"
    @keydown="trapTab"
  >
    <template #header>
      <h2 id="incident-title">{{ title }}</h2>
      <SituateIconButton
        v-if="state.page === 'unexpected'"
        icon="close"
        variant="quiet"
        :label="t('errorRecovery.dismiss')"
        :disabled="busy"
        @click="close"
      />
    </template>
    <template v-if="state.page === 'unexpected' && incident">
      <RecoveryBend
        :still="false"
        :seen="incident.gestureSeen"
        @played="incident.gestureSeen = true"
      />
      <p id="incident-description" class="incident-message">
        {{ t("errorRecovery.body") }}
      </p>
      <p v-if="!incident.scope && incident.boundary !== 'startup'">
        {{ t("errorRecovery.scopeUnavailable") }}
      </p>
      <SituateDisclosure
        :label="t('errorRecovery.more')"
        class="incident-options"
      >
        <div class="recovery-links">
          <SituateButton
            variant="ghost"
            :disabled="busy"
            @click="state.page = 'repair'"
            >{{ t("errorRecovery.repair") }}</SituateButton
          >
          <SituateButton
            v-if="incident.boundary !== 'startup'"
            variant="ghost"
            :disabled="busy"
            @click="restart"
            >{{
              t(mobile ? "errorRecovery.reopen" : "errorRecovery.restart")
            }}</SituateButton
          >
        </div>
      </SituateDisclosure>
    </template>
    <template v-else-if="state.page === 'report' && incident">
      <p id="incident-description">{{ t("errorRecovery.recipient") }}</p>
      <label for="incident-description-input">{{
        t("errorRecovery.description")
      }}</label>
      <SituateTextarea
        id="incident-description-input"
        v-model="incident.description"
        maxlength="2000"
        data-initial-focus
      />
      <SituateDisclosure
        :label="t('errorRecovery.details')"
        class="report-details"
      >
        <pre data-localization-content="user">{{ details }}</pre>
      </SituateDisclosure>
    </template>
    <template v-else-if="state.page === 'mail'">
      <p id="incident-description">
        {{
          t(
            mailOpened
              ? "errorRecovery.mailBody"
              : "errorRecovery.mailUnavailable",
          )
        }}
      </p>
      <label for="incident-report-text">{{
        t("errorRecovery.reportText")
      }}</label>
      <SituateTextarea
        id="incident-report-text"
        ref="reportControl"
        readonly
        :model-value="reportBody"
        data-initial-focus
        class="report-text"
      />
      <SituateButton variant="secondary" @click="reportControl?.select()">{{
        t("errorRecovery.select")
      }}</SituateButton>
    </template>
    <template v-else-if="state.page === 'repair'">
      <p id="incident-description">{{ t("errorRecovery.repairBody") }}</p>
      <p v-if="assignment">
        {{
          t(
            assignmentDurable
              ? "errorRecovery.assignmentSaved"
              : "errorRecovery.repairBlocked",
          )
        }}
      </p>
      <h3>{{ t("errorRecovery.assignment") }}</h3>
      <pre data-localization-content="user">{{ assignment }}</pre>
    </template>
    <p v-else-if="state.page === 'reopen'" id="incident-description">
      {{ t("errorRecovery.reopenBody") }}
    </p>
    <p v-if="busy" role="status">{{ t("errorRecovery.pending") }}</p>
    <p v-if="error" role="alert" data-localization-content="user">
      {{ error }}
    </p>
    <template #actions>
      <template v-if="state.page === 'unexpected'">
        <SituateButton
          variant="secondary"
          :disabled="busy"
          @click="state.page = 'report'"
          >{{ t("errorRecovery.report") }}</SituateButton
        >
        <SituateButton
          data-initial-focus
          :disabled="
            busy || (!incident?.scope && incident?.boundary !== 'startup')
          "
          @click="recover"
          >{{
            t(
              incident?.boundary === "startup"
                ? "errorRecovery.startupReload"
                : "errorRecovery.reload",
            )
          }}</SituateButton
        >
      </template>
      <template v-else-if="state.page === 'report'">
        <SituateButton variant="secondary" @click="close">{{
          t("errorRecovery.cancel")
        }}</SituateButton>
        <SituateButton :disabled="busy" @click="email">{{
          t("errorRecovery.email")
        }}</SituateButton>
      </template>
      <template v-else-if="state.page === 'mail'">
        <SituateButton variant="secondary" @click="state.page = 'report'">{{
          t("errorRecovery.back")
        }}</SituateButton>
        <SituateButton @click="close">{{
          t("errorRecovery.close")
        }}</SituateButton>
      </template>
      <template v-else>
        <SituateButton
          variant="secondary"
          data-initial-focus
          :disabled="busy"
          @click="close"
          >{{ t("errorRecovery.close") }}</SituateButton
        >
        <SituateButton
          v-if="state.page === 'repair'"
          :disabled="busy"
          @click="repair"
          >{{ t("errorRecovery.retryRepair") }}</SituateButton
        >
      </template>
    </template>
  </SituateDialog>
</template>
<style scoped>
.recovery-entry {
  position: fixed;
  right: 16px;
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 20;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  max-width: calc(100% - 32px);
}
.incident-message {
  text-align: center;
  max-width: 370px;
  margin-inline: auto;
}
.incident-options,
.report-details {
  margin-top: 24px;
}
.recovery-links {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.incident-dialog :deep(.situate-dialog-actions) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.incident-dialog :deep(.situate-dialog-actions .situate-button) {
  min-width: 0;
  padding-inline: 12px;
}
label + textarea {
  width: 100%;
  margin-top: 8px;
}
.report-text {
  min-height: 240px;
  width: 100%;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.6;
  background: var(--situate-paper);
  border-radius: 12px;
  padding: 16px;
}
</style>
