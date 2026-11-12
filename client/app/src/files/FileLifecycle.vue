<script setup lang="ts">
import {
  SituateTextarea,
  SituateButton,
  SituateDialogActions,
} from "@situate/ui";
import { t } from "@situate/localization";
import { computed, onBeforeUnmount, ref } from "vue";
import FileDialog from "./FileDialog.vue";
import { localizeFileError } from "./api";
import {
  discardFile,
  flushWorkspace,
  loadWorkspace,
  releaseWorkspace,
  request,
  workspaceSession,
  type WorkspaceSession,
} from "./sessions";
import "./files.css";

interface Closure {
  sessions: WorkspaceSession[];
  token?: string;
  attempt: number;
  force?: boolean;
}
const pending = ref<Closure | null>(null);
const busy = ref(false);
const error = ref<unknown>("");
const confirmingDiscard = ref(false);
const confirmingForceClose = ref(false);
const dirty = computed(
  () =>
    pending.value?.sessions.flatMap((session) =>
      Object.values(session.files)
        .filter((file) => file.dirty)
        .map((file) => ({ session, file })),
    ) ?? [],
);
const canExport = computed(
  () =>
    dirty.value.length > 0 &&
    dirty.value.every(({ session }) => session.snapshot?.canExport === true),
);
let decide: ((approved: boolean) => void) | undefined;
let alive = true;
let generation = 0;
let transitioning = false;
let activeQuit: string | undefined;
let quitSessions: WorkspaceSession[] = [];
function current(closure: Closure): boolean {
  return alive && closure.attempt === generation;
}

async function prepare(ids: string[], token?: string): Promise<boolean> {
  const closure: Closure = {
    sessions: [...new Set(ids)].map((id) => workspaceSession(id)),
    token,
    attempt: ++generation,
  };
  pending.value = closure;
  busy.value = true;
  error.value = "";
  confirmingDiscard.value = false;
  confirmingForceClose.value = false;
  for (const session of closure.sessions) session.closing = true;
  const decision = new Promise<boolean>((resolve) => {
    decide = resolve;
  });
  try {
    for (const session of closure.sessions) {
      await loadWorkspace(session);
      if (!current(closure)) return false;
      if (!session.snapshot || session.error)
        throw session.error || "files.theWorkspaceCouldNotBeCheckedForDrafts";
    }
    const saved = await Promise.all(closure.sessions.map(flushWorkspace));
    if (!current(closure)) return false;
    if (saved.every(Boolean)) finish(true);
  } catch (reason) {
    if (current(closure)) error.value = reason;
  } finally {
    if (current(closure)) busy.value = false;
  }
  return decision;
}
function finish(approved: boolean): void {
  if (!approved) {
    generation++;
    if (!pending.value?.token) {
      for (const session of pending.value?.sessions ?? [])
        session.closing = false;
    }
  }
  pending.value = null;
  const resolve = decide;
  decide = undefined;
  resolve?.(approved);
}
async function cancel(): Promise<void> {
  if (busy.value) return;
  const closure = pending.value;
  if (!closure) return;
  finish(false);
}
async function retry(): Promise<void> {
  const closure = pending.value;
  if (!closure || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    for (const session of closure.sessions) {
      await loadWorkspace(session);
      if (!current(closure)) return;
      if (session.error) throw session.error;
    }
    const saved = await Promise.all(closure.sessions.map(flushWorkspace));
    if (current(closure) && saved.every(Boolean)) finish(true);
  } catch (reason) {
    if (current(closure)) error.value = reason;
  } finally {
    if (current(closure)) busy.value = false;
  }
}
async function secureCopies(): Promise<void> {
  const closure = pending.value;
  if (!closure || busy.value || !canExport.value) return;
  busy.value = true;
  error.value = "";
  try {
    for (const { session, file } of dirty.value) {
      const reply = await request(session, {
        operation: "export",
        path: file.path,
        text: file.text,
      });
      if (!current(closure)) return;
      if (reply.status === "cancelled") {
        busy.value = false;
        await cancel();
        return;
      }
      if (reply.status !== "ok")
        throw new Error(
          reply.message ?? "files.noSecuredCopyWasConfirmedYourTextIsRetained",
        );
      await discardFile(session, file);
      if (!current(closure)) return;
    }
    finish(true);
  } catch (reason) {
    if (current(closure)) error.value = reason;
  } finally {
    if (current(closure)) busy.value = false;
  }
}
async function discard(): Promise<void> {
  const closure = pending.value;
  if (!closure || busy.value || !confirmingDiscard.value) return;
  busy.value = true;
  try {
    for (const { session, file } of dirty.value) {
      await discardFile(session, file);
      if (!current(closure)) return;
    }
    finish(true);
  } catch (reason) {
    if (current(closure)) error.value = reason;
  } finally {
    if (current(closure)) busy.value = false;
  }
}
function forceClose(): void {
  const closure = pending.value;
  if (!closure || closure.token || busy.value || !confirmingForceClose.value)
    return;
  closure.force = true;
  finish(true);
}
async function prepareClose(id: string): Promise<boolean> {
  if (transitioning || activeQuit) return false;
  transitioning = true;
  try {
    const approval = prepare([id]);
    const closure = pending.value;
    const attempt = generation;
    if (!(await approval) || attempt !== generation || !alive) return false;
    const session = workspaceSession(id);
    try {
      const reply = await request(session, {
        operation: "detach",
        ...(closure?.force ? { force: true } : {}),
      });
      if (attempt !== generation || !alive) return false;
      if (reply.status !== "ok")
        throw new Error(reply.message ?? "files.theWorkspaceCouldNotBeClosed");
      return true;
    } catch (reason) {
      session.closing = false;
      error.value = reason;
      return false;
    }
  } finally {
    transitioning = false;
  }
}
function completeClose(id: string, closed: boolean): void {
  const session = workspaceSession(id);
  if (closed) releaseWorkspace(session);
  else session.closing = false;
}
async function prepareRecovery(ids: string[], token: string): Promise<boolean> {
  if (transitioning || activeQuit) return false;
  transitioning = true;
  activeQuit = token;
  const attempt = ++generation;
  quitSessions = ids.map((id) => workspaceSession(id));
  for (const session of quitSessions) session.closing = true;
  try {
    for (const session of quitSessions) {
      await loadWorkspace(session);
      if (
        !alive ||
        generation !== attempt ||
        activeQuit !== token ||
        !session.snapshot ||
        session.error
      )
        return false;
    }
    const saved = await Promise.all(quitSessions.map(flushWorkspace));
    return (
      alive &&
      generation === attempt &&
      activeQuit === token &&
      saved.every(Boolean)
    );
  } catch {
    return false;
  } finally {
    transitioning = false;
  }
}
async function prepareQuit(ids: string[], token: string): Promise<boolean> {
  if (transitioning || activeQuit) return false;
  transitioning = true;
  activeQuit = token;
  quitSessions = ids.map((id) => workspaceSession(id));
  try {
    const approval = prepare(ids, token);
    const attempt = generation;
    return (
      (await approval) &&
      attempt === generation &&
      alive &&
      activeQuit === token
    );
  } finally {
    transitioning = false;
  }
}
function cancelQuit(token: string): void {
  if (token !== activeQuit) return;
  activeQuit = undefined;
  for (const session of quitSessions) session.closing = false;
  quitSessions = [];
  if (pending.value?.token === token) finish(false);
  else generation++;
  busy.value = false;
}
onBeforeUnmount(() => {
  alive = false;
  if (activeQuit) cancelQuit(activeQuit);
  finish(false);
});
defineExpose({
  prepareClose,
  completeClose,
  prepareQuit,
  prepareRecovery,
  cancelQuit,
});
</script>
<template>
  <FileDialog
    v-if="pending && (!busy || dirty.length)"
    :title="
      t(
        confirmingForceClose
          ? 'files.forceCloseTitle'
          : error && !dirty.length && !pending.token
            ? 'navigation.closeThisWorkspace'
            : 'files.keepYourUnsavedChanges',
      )
    "
    :busy="busy"
    @dismiss="cancel"
  >
    <div class="dialog-body">
      <p>
        {{
          error && !dirty.length
            ? t("files.theWorkspaceCouldNotBeCheckedForDrafts")
            : pending.token
              ? t("files.unsavedQuit")
              : t("files.unsavedClose")
        }}
      </p>
      <section
        v-for="{ session, file } in dirty"
        :key="`${session.id}:${file.path}`"
        class="closure-draft"
      >
        <h3 data-localization-content="user">{{ file.path }}</h3>
        <p>{{ localizeFileError(file.error) }}</p>
        <p>
          {{
            file.recovery === "persisted"
              ? t("files.aRecoveryDraftIsStoredLocally")
              : t("files.keepThisAppOpenUntilYourTextIsSecured")
          }}
        </p>
        <SituateTextarea
          appearance="plain"
          readonly
          :aria-label="t('files.retainedUnsavedSource')"
          :value="file.text"
        />
      </section>
      <p v-if="error" role="alert">{{ localizeFileError(error) }}</p>
      <p v-if="dirty.length && !canExport">
        {{ t("files.exportingASecuredCopyToAnotherLocationIsUnavailable") }}
      </p>
      <p v-if="confirmingDiscard">
        {{ t("files.discardAllTheseUnsavedChangesThisCannotBeUndone") }}
      </p>
      <p v-if="confirmingForceClose" role="alert">
        {{ t("files.forceCloseDetail") }}
      </p>
      <SituateDialogActions>
        <SituateButton
          variant="secondary"
          type="button"
          :disabled="busy"
          @click="cancel"
        >
          {{ t("navigation.cancel") }}</SituateButton
        ><SituateButton
          variant="secondary"
          type="button"
          :disabled="busy"
          @click="retry"
        >
          {{ t("files.retrySaves") }}</SituateButton
        ><SituateButton
          variant="secondary"
          type="button"
          :disabled="busy || !canExport"
          @click="secureCopies"
        >
          {{ t("files.exportCopies") }}</SituateButton
        ><SituateButton
          variant="secondary"
          v-if="!confirmingDiscard"
          type="button"
          :disabled="busy || !dirty.length"
          @click="confirmingDiscard = true"
        >
          {{ t("files.discardChanges") }}</SituateButton
        ><SituateButton
          variant="danger"
          v-else
          type="button"
          :disabled="busy"
          @click="discard"
        >
          {{ pending.token ? t("files.discardQuit") : t("files.discardClose") }}
        </SituateButton>
        <SituateButton
          v-if="!pending.token"
          :variant="confirmingForceClose ? 'danger' : 'secondary'"
          type="button"
          :disabled="busy"
          @click="
            confirmingForceClose ? forceClose() : (confirmingForceClose = true)
          "
        >
          {{
            t(
              confirmingForceClose
                ? "workspace.closeWorkspace"
                : "files.closeAnyway",
            )
          }}
        </SituateButton>
      </SituateDialogActions>
    </div>
  </FileDialog>
  <p v-else-if="error" class="file-lifecycle-error" role="alert">
    {{ localizeFileError(error) }}
  </p>
</template>
