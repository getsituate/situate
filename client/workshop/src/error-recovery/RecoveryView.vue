<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  SituateButton,
  SituateIconButton,
  SituateDialog,
  SituateDisclosure,
  SituateTextarea,
  SituateNotice,
} from "../ui";
import RecoveryBend from "./RecoveryBend.vue";
import c from "../localization/en.error-recovery.json";
import {
  reportText,
  incidentDetails,
  type RecoveryAction,
  type RecoveryState,
} from "./model";
const props = defineProps<{ state: RecoveryState; mobile: boolean }>();
const emit = defineEmits<{ action: [action: RecoveryAction] }>();
const send = (action: RecoveryAction) => emit("action", action);
const dialog = ref<InstanceType<typeof SituateDialog>>();
const recovery = ref<InstanceType<typeof SituateButton>>();
const draft = ref<InstanceType<typeof SituateTextarea>>();
const report = ref<InstanceType<typeof SituateTextarea>>();
const heading = ref<HTMLElement>();
const origin = ref<HTMLElement>();
const title = computed(() =>
  props.state.dialog === "unexpected"
    ? c.oops
    : props.state.dialog === "report"
      ? c.reportTitle
      : props.state.dialog === "mail"
        ? c.draftTitle
        : c.reopen,
);
const text = computed(() => reportText(props.state));
function open(value: RecoveryState["dialog"], event?: Event) {
  if (!props.state.dialog)
    origin.value = event?.currentTarget as HTMLElement | undefined;
  send({ type: "dialog", dialog: value });
}
function restoreFocus() {
  if (props.state.dialog) return;
  if (heading.value) heading.value.focus();
  else if (origin.value?.isConnected) origin.value.focus();
  else recovery.value?.focus();
}
function restartApplication(event?: Event) {
  if (props.mobile) open("reopen", event);
  else send({ type: "restart" });
}
watch(
  () => props.state.dialog,
  async (value, previous) => {
    await nextTick();
    if (value) {
      const target = dialog.value?.element?.querySelector<HTMLElement>(
        "[data-initial-focus]",
      );
      target?.focus();
    } else if (!value && previous) {
      restoreFocus();
    }
  },
  { immediate: true, flush: "post" },
);
watch(
  () => props.state.screen,
  async () => {
    await nextTick();
    heading.value?.focus();
  },
);
function trapTab(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const items = Array.from(
    dialog.value?.element?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), textarea:not([disabled]), input:not([disabled]), summary, [tabindex='0']",
    ) ?? [],
  ).filter((element) => element.getClientRects().length > 0);
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
  items[next]?.focus();
}
function returnToDraft() {
  send({ type: "return" });
  void nextTick(() => {
    if (draft.value) draft.value.focus();
    else recovery.value?.focus();
  });
}
</script>
<template>
  <main class="recovery-workflow" :class="{ mobile }">
    <header class="recovery-header">
      <strong>{{ state.startup ? c.app : c.workspace }}</strong>
      <nav v-if="!state.startup" :aria-label="c.workspace">
        <SituateButton variant="ghost" @click="send({ type: 'library' })">{{
          c.notes
        }}</SituateButton>
        <SituateButton
          v-if="state.screen !== 'notes' && state.failed"
          ref="recovery"
          variant="ghost"
          @click="open('unexpected', $event)"
          >{{ c.recovery }}</SituateButton
        >
      </nav>
      <SituateButton
        v-if="!state.startup"
        variant="ghost"
        @click="restartApplication($event)"
        >{{ mobile ? c.reopen : c.restart }}</SituateButton
      >
    </header>
    <p
      v-if="state.notice && !state.dialog"
      class="recovery-status"
      role="status"
    >
      {{ state.notice }}
    </p>
    <section
      v-if="state.startup && state.screen === 'notes'"
      class="startup-recovery"
    >
      <SituateButton
        ref="recovery"
        variant="secondary"
        @click="open('unexpected', $event)"
        >{{ c.recovery }}</SituateButton
      >
    </section>
    <template v-if="state.screen === 'repair'">
      <section class="repair-conversation" aria-labelledby="repair-title">
        <h1 id="repair-title" ref="heading" tabindex="-1">
          {{ state.startup ? c.startupRepairTitle : c.repairTitle }}
        </h1>
        <SituateNotice tone="warning">{{ c.repairUnavailable }}</SituateNotice>
        <h2>{{ c.assignment }}</h2>
        <p>{{ state.startup ? c.startupAssignment : c.assignmentBody }}</p>
        <div class="recovery-actions">
          <SituateButton @click="send({ type: 'retry-repair' })">{{
            c.retryRepair
          }}</SituateButton>
          <SituateButton variant="secondary" @click="returnToDraft">{{
            state.startup ? c.startupReturn : c.return
          }}</SituateButton>
        </div>
      </section>
    </template>
    <section
      v-else-if="state.screen === 'library' && !state.startup"
      class="notes-library"
    >
      <h1 ref="heading" tabindex="-1">{{ c.notes }}</h1>
      <SituateButton
        variant="secondary"
        @click="send({ type: 'select-note', note: 'weekend' })"
        >{{ c.noteTitle }}</SituateButton
      >
      <SituateButton
        variant="secondary"
        @click="send({ type: 'select-note', note: 'garden' })"
        >{{ c.gardenTitle }}</SituateButton
      >
    </section>
    <div v-else-if="!state.startup" class="recovery-workspace">
      <section class="healthy-pane" aria-labelledby="note-title">
        <span class="pane-label">{{ c.notes }}</span>
        <h1 id="note-title">
          {{ state.note === "weekend" ? c.noteTitle : c.gardenTitle }}
        </h1>
        <p>{{ state.note === "weekend" ? c.noteBody : c.gardenBody }}</p>
        <template v-if="state.note === 'weekend'">
          <label for="recovery-note">{{ c.draft }}</label>
          <SituateTextarea
            id="recovery-note"
            ref="draft"
            :model-value="state.draft"
            @update:model-value="send({ type: 'draft', value: String($event) })"
          />
          <p class="draft-state">
            {{ state.savedDraft === state.draft ? c.saved : c.unsaved }}
          </p>
          <SituateButton variant="secondary" @click="send({ type: 'save' })">{{
            c.save
          }}</SituateButton>
        </template>
      </section>
      <section class="plugin-pane" aria-labelledby="reading-title">
        <header>
          <span class="pane-label">{{ c.plugin }}</span>
        </header>
        <div v-if="state.failed" class="pane-failure">
          <h2 id="reading-title">{{ c.paneTitle }}</h2>
          <p>{{ c.paneBody }}</p>
          <div class="recovery-actions">
            <SituateButton @click="send({ type: 'reload' })">{{
              c.reload
            }}</SituateButton>
            <SituateButton
              variant="secondary"
              @click="send({ type: 'repair' })"
              >{{ c.repair }}</SituateButton
            >
          </div>
          <SituateButton
            v-if="state.escalated"
            ref="recovery"
            variant="ghost"
            @click="open('unexpected', $event)"
            >{{ c.recovery }}</SituateButton
          >
          <SituateButton
            v-else
            variant="ghost"
            @click="open('report', $event)"
            >{{ c.report }}</SituateButton
          >
        </div>
        <div v-else class="reading-list">
          <h2 id="reading-title">{{ c.plugin }}</h2>
          <p>{{ c.healthy }}</p>
          <ul>
            <li v-for="book in c.books" :key="book">{{ book }}</li>
          </ul>
        </div>
        <SituateNotice
          v-if="state.escalated"
          tone="warning"
          class="uncertain-request"
          >{{ c.uncertain }}</SituateNotice
        >
      </section>
    </div>
    <SituateDialog
      ref="dialog"
      :open="!!state.dialog"
      :class="{ 'incident-dialog': state.dialog === 'unexpected' }"
      aria-labelledby="recovery-dialog-title"
      aria-describedby="recovery-dialog-body"
      @cancel.prevent="open(null)"
      @close="restoreFocus"
      @keydown="trapTab"
    >
      <template #header>
        <h2 id="recovery-dialog-title">{{ title }}</h2>
        <SituateIconButton
          v-if="state.dialog === 'unexpected'"
          icon="close"
          :label="c.dismiss"
          variant="quiet"
          @click="open(null)"
        />
      </template>
      <template v-if="state.dialog === 'unexpected'">
        <RecoveryBend
          :still="state.still"
          :seen="state.gestureSeen"
          @played="send({ type: 'gesture' })"
        />
        <p id="recovery-dialog-body" class="incident-message">
          {{ c.unexpectedBody }}
        </p>
        <SituateDisclosure :label="c.more" class="incident-options">
          <div class="recovery-links">
            <SituateButton variant="ghost" @click="send({ type: 'repair' })">{{
              c.repair
            }}</SituateButton>
            <SituateButton
              v-if="!state.startup"
              variant="ghost"
              @click="restartApplication($event)"
              >{{ mobile ? c.reopen : c.restart }}</SituateButton
            >
          </div>
        </SituateDisclosure>
        <p v-if="state.notice" role="status">{{ state.notice }}</p>
      </template>
      <template v-else-if="state.dialog === 'report'">
        <p id="recovery-dialog-body">
          {{ c.to }}: <strong>{{ c.recipient }}</strong>
        </p>
        <label for="report-description">{{ c.description }}</label>
        <SituateTextarea
          id="report-description"
          data-initial-focus
          :model-value="state.description"
          maxlength="2000"
          @update:model-value="
            send({ type: 'description', value: String($event) })
          "
        />
        <SituateDisclosure :label="c.details" class="report-details">
          <pre>{{ incidentDetails(state) }}</pre>
        </SituateDisclosure>
      </template>
      <template v-else-if="state.dialog === 'mail'">
        <p id="recovery-dialog-body">
          {{
            state.mail === "missing"
              ? c.mailMissing
              : state.mail === "offline"
                ? c.offline
                : c.draftBody
          }}
        </p>
        <label for="report-text">{{ c.reportText }}</label>
        <SituateTextarea
          id="report-text"
          ref="report"
          data-initial-focus
          readonly
          :model-value="text"
          class="report-text"
        />
        <div class="recovery-links">
          <SituateButton variant="secondary" @click="report?.select()">{{
            c.select
          }}</SituateButton>
        </div>
      </template>
      <p v-if="state.dialog === 'reopen'" id="recovery-dialog-body">
        {{ c.iosBody }}
      </p>
      <template #actions>
        <SituateButton
          v-if="state.dialog === 'reopen'"
          data-initial-focus
          @click="open(null)"
          >{{ c.close }}</SituateButton
        >
        <SituateButton
          v-if="state.dialog === 'unexpected'"
          variant="secondary"
          @click="open('report')"
          >{{ c.report }}</SituateButton
        >
        <SituateButton
          v-if="state.dialog === 'unexpected'"
          data-initial-focus
          @click="send({ type: 'recover' })"
          >{{
            state.startup ? c.startupRetry : c.workspaceReload
          }}</SituateButton
        >
        <SituateButton
          v-if="state.dialog === 'report'"
          variant="secondary"
          @click="open(null)"
          >{{ c.cancel }}</SituateButton
        >
        <SituateButton v-if="state.dialog === 'report'" @click="open('mail')">{{
          c.email
        }}</SituateButton>
        <SituateButton
          v-if="state.dialog === 'mail'"
          variant="secondary"
          @click="open('report')"
          >{{ c.back }}</SituateButton
        >
        <SituateButton v-if="state.dialog === 'mail'" @click="open(null)">{{
          c.close
        }}</SituateButton>
      </template>
    </SituateDialog>
  </main>
</template>
<style scoped>
.recovery-workflow {
  height: 100%;
  overflow: auto;
  background: var(--situate-paper);
  color: var(--situate-ink);
}
.recovery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--situate-control-line);
  gap: 16px;
}
.recovery-header nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.notes-library {
  padding: 32px;
  display: grid;
  align-content: start;
  gap: 16px;
  max-width: 660px;
  margin: auto;
}
.recovery-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  min-height: calc(100% - 80px);
}
.healthy-pane,
.plugin-pane {
  padding: clamp(24px, 4vw, 64px);
  min-width: 0;
}
.plugin-pane {
  border-left: 1px solid var(--situate-control-line);
  background: var(--situate-surface);
  display: flex;
  flex-direction: column;
  gap: 32px;
}
.pane-label,
.draft-state {
  color: var(--situate-muted);
  font-size: var(--situate-text-small);
}
h1 {
  font-size: var(--situate-text-title);
  line-height: 1.2;
  margin: 28px 0 16px;
}
.recovery-workspace h2 {
  font-size: var(--situate-text-lead);
  line-height: 1.35;
}
p {
  line-height: 1.6;
}
.healthy-pane label {
  display: block;
  margin-top: 36px;
  margin-bottom: 10px;
}
.healthy-pane textarea {
  width: 100%;
  min-height: 160px;
}
.recovery-actions,
.recovery-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
.pane-failure {
  margin: auto 0;
}
.pane-failure > .situate-button {
  margin-top: 16px;
}
.uncertain-request {
  margin-top: auto;
}
.recovery-status {
  padding: 16px 28px;
  margin: 0;
}
.startup-recovery {
  min-height: 65%;
  display: grid;
  place-items: center;
  padding: 24px;
}
.repair-conversation {
  max-width: 660px;
  margin: 24px auto;
  padding: 24px;
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
.incident-message {
  text-align: center;
  max-width: 370px;
  margin-inline: auto;
}
.incident-options {
  margin-top: 24px;
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
.report-details {
  margin-top: 20px;
}
label + textarea {
  width: 100%;
  margin-top: 8px;
}
.report-text {
  min-height: 240px;
}
.mobile .recovery-workspace {
  grid-template-columns: 1fr;
}
.mobile .plugin-pane {
  border-left: 0;
  border-top: 1px solid var(--situate-control-line);
  min-height: 340px;
}
@media (max-width: 650px) {
  .recovery-workspace {
    grid-template-columns: 1fr;
  }
  .plugin-pane {
    border-left: 0;
    border-top: 1px solid var(--situate-control-line);
    min-height: 340px;
  }
  .recovery-header {
    padding-inline: 20px;
  }
}
</style>
