<script setup lang="ts">
import {
  SituateButton,
  SituateDialog,
  SituateScrollbars,
  selectEnvironment,
} from "@situate/ui";
import { t, localizeError } from "@situate/localization";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  provide,
  useTemplateRef,
  watch,
} from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import RecoveryRoot from "./errors/RecoveryRoot.vue";
import { captureIncident, retainIncidentScopes } from "./errors/runtime";
import { installRecoveryLifecycle, recoveryPreparing } from "./errors/native";
import { retainedWorkspaces, releaseWorkspace } from "./files/sessions";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onBackButtonPress } from "@tauri-apps/api/app";
const DictationConfirmation = defineAsyncComponent(
  () => import("./dictation/DictationConfirmation.vue"),
);
import {
  confirmation,
  dictation,
  guardDictation,
  initializeDictation,
  stopDictationListeners,
} from "./dictation/runtime";
const AppShell = defineAsyncComponent(
  () => import("./components/AppShell.vue"),
);
const flushLayouts = async (scope?: string) =>
  (await import("./layout/session")).flushLayouts(scope);
let layoutRuntime: typeof import("./layout/runtime") | undefined;
import { recoveryMode, resumePlugins } from "./recovery";
const WorkspaceCloseDialog = defineAsyncComponent(
  () => import("./components/WorkspaceCloseDialog.vue"),
);
const WorkspaceEntry = defineAsyncComponent(
  () => import("./workspaces/WorkspaceEntry.vue"),
);
import FileLifecycle from "./files/FileLifecycle.vue";
import { LifecycleCoordinator } from "./lifecycle";
import {
  initializeUpdates,
  stopUpdatesListeners,
  updates,
} from "./updates/runtime";
import UpdateNotice from "./updates/UpdateNotice.vue";
const UpdateSettings = defineAsyncComponent(
  () => import("./updates/UpdateSettings.vue"),
);
import {
  diagnosticsFor,
  retainDiagnostics,
  stopDiagnostics,
} from "./diagnostics";
import {
  closeChats,
  refreshWorkspaceChats,
  workspaceChatActivity,
  saveChatDrafts,
} from "./ai/chat";
import { useVisualViewport } from "./use-visual-viewport";
import { useLocalization } from "./settings/useLocalization";
import { useAppearance } from "./settings/useAppearance";
import {
  action,
  snapshot,
  displayWorkspaceName,
  type RunAction,
  type Snapshot,
} from "./workspaces/api";

const AiSetup = defineAsyncComponent(() => import("./ai/AiSetup.vue"));
const loadOnboardingHost = () => import("./onboarding/OnboardingHost.vue");
const OnboardingHost = defineAsyncComponent(loadOnboardingHost);
const SetupFinale = defineAsyncComponent(
  () => import("./onboarding/SetupFinale.vue"),
);
import { creationTransition } from "./onboarding/creation-transition";
import { useSetupTransition } from "./onboarding/use-setup-transition";
import { panelExit, panelHandoff } from "./onboarding/setup-transition";
const error = ref<unknown>("");
const creationPending = ref(false);
const creationRoot = ref<HTMLElement>();
const creationClock = useSetupTransition(
  creationRoot,
  () => !!error.value,
  () => null,
);
provide(creationTransition, {
  frame: computed(() =>
    creationClock.active.value ? creationClock.frame.value : undefined,
  ),
  restoreFocus: ref(false),
  finish: creationClock.finish,
});
async function leaveCreation() {
  const { finished } = creationClock.start(0, 1, "step", [
    panelExit,
    panelHandoff,
  ]);
  let stop: (() => void) | undefined;
  try {
    await Promise.race([
      finished,
      new Promise<void>((resolve) => {
        stop = watch(
          () => creationClock.frame.value.phase,
          (phase) => {
            if (phase !== "leaving") resolve();
          },
          { immediate: true },
        );
      }),
    ]);
  } finally {
    stop?.();
  }
}
const creationAccent = ref<import("./settings/accents").Accent>();
let onboardingState: typeof import("./onboarding/session") | undefined;
import type { OnboardingRecord } from "./onboarding/types";
const setupProgress =
  shallowRef<
    ReturnType<typeof import("./onboarding/session").onboardingSession>
  >();
const setupRecord = computed(() => setupProgress.value?.state.record);
useVisualViewport();
const state = ref<Snapshot | null>(null);
watch(
  () => state.value?.error,
  (failure) => {
    if (failure)
      captureIncident(
        state.value?.current ? "workspace" : "startup",
        failure,
        state.value?.current?.id,
      );
  },
);
provide(selectEnvironment, { mobile: computed(() => !!state.value?.mobile) });
const busy = ref(false);
const resumingPlugins = ref(false);
const recoveryError = ref<unknown>();
async function resumeAllPlugins() {
  const scope = state.value?.current?.id;
  if (!scope || resumingPlugins.value) return;
  resumingPlugins.value = true;
  recoveryError.value = undefined;
  try {
    await resumePlugins(scope);
  } catch (error) {
    recoveryError.value = error;
  } finally {
    resumingPlugins.value = false;
  }
}
let pendingAction: Promise<void> | undefined;
const entryVisible = ref(false);
const workspaceScope = computed(() =>
  entryVisible.value ? null : (state.value?.current?.id ?? null),
);
const {
  snapshot: appearanceSnapshot,
  accent,
  loading: appearanceLoading,
  saving: appearanceSaving,
  error: appearanceError,
  reload: reloadAppearance,
  update: updateAccent,
  flush: flushAppearance,
} = useAppearance(workspaceScope, creationAccent);
const {
  snapshot: localeSnapshot,
  loading: localeLoading,
  saving: localeSaving,
  error: localeError,
  reload: reloadLocale,
  update: updateLocale,
} = useLocalization(workspaceScope);
const appShell = useTemplateRef<InstanceType<typeof AppShell>>("appShell");
const settingsScope = ref("");
const globalUpdatesOpen = ref(false);
function showUpdates(): void {
  if (appShell.value && !dictation.owner) void appShell.value.showUpdates();
  else globalUpdatesOpen.value = true;
}
const closeDialogControl =
  useTemplateRef<InstanceType<typeof WorkspaceCloseDialog>>(
    "closeDialogControl",
  );
const closeDialog = computed(() => closeDialogControl.value?.element);
const closeDialogNeeded = ref(false);
const closeDialogReady = new Promise<HTMLDialogElement>((resolve) => {
  watch(
    closeDialog,
    (element) => {
      if (element) resolve(element);
    },
    { once: true },
  );
});
const closingModel = ref(false);
const stoppingClose = ref(false);
let closeScope: string | undefined;
async function showCloseDialog(
  scope = state.value?.current?.id,
  processes = false,
): Promise<void> {
  if (!scope || closeScope) return;
  closeScope = scope;
  closeDialogNeeded.value = true;
  closingModel.value =
    !processes && workspaceChatActivity(scope).selectingModel;
  const dialog = await closeDialogReady;
  if (alive && closeScope === scope) dialog.showModal();
}
const setup = useTemplateRef<InstanceType<typeof AiSetup>>("setup");
const onboarding =
  useTemplateRef<InstanceType<typeof OnboardingHost>>("onboarding");
const developmentHandoffFailed = ref(false);
const celebration = ref<{
  scope: string;
  record: OnboardingRecord;
  generation: number;
  startDevelopments: boolean;
  ready: boolean;
  finished: boolean;
  reveal: boolean;
  scale: number;
}>();
let handoffGeneration = 0;
let celebrationFocusScope: string | undefined;
watch(
  [appShell, celebration],
  ([shell, pending]) => {
    if (shell && pending?.ready && pending.finished) void finishCelebration();
    if (!pending && shell && celebrationFocusScope === workspaceScope.value) {
      const scope = celebrationFocusScope;
      const generation = handoffGeneration;
      const previousFocus = document.activeElement;
      celebrationFocusScope = undefined;
      // The async shell's v-show hook can still be queued in this post-flush pass.
      void nextTick(() => {
        if (
          currentHandoff(scope, generation) &&
          appShell.value === shell &&
          !celebration.value &&
          (document.activeElement === previousFocus ||
            document.activeElement === document.body) &&
          !document.querySelector('dialog[open], [aria-modal="true"]')
        )
          shell.focusNavigation();
      });
    }
  },
  { flush: "post" },
);
let closingLogin = false;
async function closeLoginWorkspace(): Promise<void> {
  const scope = state.value?.current?.id;
  if (!scope || closingLogin) return;
  closingLogin = true;
  try {
    await setup.value?.cancelAndWait();
    await onboarding.value?.cancelAndWait();
    await pendingAction;
    if (alive && state.value?.current?.id === scope) await run("close", scope);
  } catch {
    error.value = "navigation.signInCouldNotBeStoppedKeepThisWorkspace";
    await invoke("ai_cancel_close", { scope }).catch(() => {});
  } finally {
    closingLogin = false;
  }
}
async function closeWorkspace(): Promise<void> {
  const scope = state.value?.current?.id;
  if (!scope) return;
  await run("close", scope);
}
async function cancelClose(): Promise<void> {
  if (stoppingClose.value) return;
  const scope = closeScope;
  if (scope) await invoke("ai_cancel_close", { scope });
  closeScope = undefined;
  closeDialog.value?.close();
}
async function abortAndClose(): Promise<void> {
  const scope = closeScope;
  if (!scope || stoppingClose.value) return;
  stoppingClose.value = true;
  try {
    const { abortClose } = await import("./plugins/process-lifecycle");
    await abortClose(scope);
    await saveChatDrafts(scope);
    closeScope = undefined;
    closeDialog.value?.close();
    await run("close", scope);
  } catch {
    error.value =
      "navigation.saveTheConversationBeforeClosingReturnToTheWorkspace";
    stoppingClose.value = false;
    await cancelClose();
  } finally {
    stoppingClose.value = false;
  }
}
function currentHandoff(scope: string, generation: number) {
  return (
    alive &&
    generation === handoffGeneration &&
    state.value?.current?.id === scope &&
    !state.value.onboarding
  );
}
async function enterOnboardingApp(
  record: OnboardingRecord,
  firstEntry: boolean,
  startDevelopments = false,
) {
  const scope = state.value?.current?.id;
  if (!scope || !record.instructionRevision) return;
  if (celebration.value?.scope === scope) return;
  const generation = ++handoffGeneration;
  const showCelebration = firstEntry;
  if (showCelebration) {
    try {
      await import("./onboarding/SetupFinale.vue");
    } catch (cause) {
      error.value = cause;
      return;
    }
    if (
      !alive ||
      generation !== handoffGeneration ||
      state.value?.current?.id !== scope
    )
      return;
    celebration.value = {
      scope,
      record,
      generation,
      startDevelopments,
      ready: false,
      finished: false,
      reveal: false,
      scale: 1.045,
    };
  }
  if (!(await run("ai-setup-done"))) {
    if (celebration.value?.generation === generation)
      celebration.value = undefined;
    return;
  }
  await nextTick();
  if (!currentHandoff(scope, generation)) {
    if (celebration.value?.generation === generation)
      celebration.value = undefined;
    return;
  }
  developmentHandoffFailed.value = false;
  if (celebration.value?.generation === generation) {
    celebration.value.ready = true;
    if (celebration.value.finished) void finishCelebration();
  }
  try {
    layoutRuntime ??= await import("./layout/runtime");
    const ui = layoutRuntime.workspaceUi(scope);
    await ui.session.load();
    if (!currentHandoff(scope, generation)) return;
    const layout = ui.session.state.document?.layout;
    await refreshWorkspaceChats(scope);
    if (!currentHandoff(scope, generation)) return;
    if (record.conversationId) {
      const isCurrent = () =>
        currentHandoff(scope, generation) &&
        ui.session.state.document?.layout === layout;
      if (!isCurrent()) return;
      try {
        await ui.coordinator.open(
          { kind: "conversation", conversationId: record.conversationId },
          undefined,
          { isCurrent },
        );
      } catch (cause) {
        if (!isCurrent()) return;
        throw cause;
      }
      await ui.session.flush();
    }
    if (!currentHandoff(scope, generation)) return;
    if (!showCelebration && startDevelopments)
      await dispatchDevelopments(scope, record, generation);
  } catch (cause) {
    if (!currentHandoff(scope, generation)) return;
    celebration.value = undefined;
    error.value = cause;
  }
}
async function finishOnboarding(record: OnboardingRecord) {
  const scope = state.value?.current?.id;
  if (!scope || record.step !== "complete") return;
  const firstEntry = !record.entered;
  const { enterSetupApp } = await import("./onboarding/agent");
  await enterSetupApp(scope);
  if (state.value?.current?.id !== scope) return;
  const current = setupProgress.value?.state.record;
  if (current)
    await enterOnboardingApp(structuredClone(current), firstEntry, true);
}
watch(
  () => [workspaceScope.value, setupRecord.value?.step] as const,
  ([scope, step], [previousScope, previousStep]) => {
    if (
      scope &&
      scope === previousScope &&
      previousStep &&
      previousStep !== "complete" &&
      step === "complete" &&
      setupRecord.value &&
      !setupRecord.value.entered
    )
      void finishOnboarding(structuredClone(setupRecord.value)).catch(
        (cause) => {
          error.value = cause;
        },
      );
  },
);
async function finishCelebration() {
  const pending = celebration.value;
  if (!pending) return;
  pending.finished = true;
  if (
    !pending.ready ||
    !appShell.value ||
    !currentHandoff(pending.scope, pending.generation)
  )
    return;
  celebrationFocusScope = pending.scope;
  celebration.value = undefined;
  if (pending.startDevelopments)
    await dispatchDevelopments(
      pending.scope,
      pending.record,
      pending.generation,
    );
}
async function dispatchDevelopments(
  scope: string,
  record: OnboardingRecord,
  generation: number,
) {
  try {
    const { startSetupDevelopments } = await import("./onboarding/agent");
    if (!currentHandoff(scope, generation)) return;
    const failures = await startSetupDevelopments(scope, record);
    if (currentHandoff(scope, generation))
      developmentHandoffFailed.value = !!failures?.length;
  } catch {
    if (currentHandoff(scope, generation))
      developmentHandoffFailed.value = true;
  }
}
async function checkPendingDevelopments(scope: string) {
  const generation = handoffGeneration;
  try {
    onboardingState ??= await import("./onboarding/session");
    const { pendingSetupDevelopments } = await import("./onboarding/agent");
    const pending = await pendingSetupDevelopments(scope);
    if (currentHandoff(scope, generation))
      developmentHandoffFailed.value = pending;
  } catch {
    if (currentHandoff(scope, generation))
      developmentHandoffFailed.value = true;
  }
}
async function retryDevelopmentHandoff() {
  const generation = ++handoffGeneration;
  const scope = state.value?.current?.id;
  if (!scope) return;
  try {
    onboardingState ??= await import("./onboarding/session");
    const session = onboardingState.onboardingSession(scope);
    await session.retry();
    if (!currentHandoff(scope, generation)) return;
    const record = session.state.record;
    if (record?.step !== "complete") {
      developmentHandoffFailed.value = false;
      return;
    }
    const { startSetupDevelopments } = await import("./onboarding/agent");
    if (!currentHandoff(scope, generation)) return;
    const failures = await startSetupDevelopments(scope, record);
    if (currentHandoff(scope, generation))
      developmentHandoffFailed.value = !!failures?.length;
  } catch {
    if (currentHandoff(scope, generation))
      developmentHandoffFailed.value = true;
  }
}
async function finishSetup(): Promise<void> {
  settingsScope.value = "";
  if (state.value?.aiSetup) await run("ai-setup-done");
  if (state.value?.current) await refreshWorkspaceChats(state.value.current.id);
}
const entry = useTemplateRef<InstanceType<typeof WorkspaceEntry>>("entry");
const fileLifecycle =
  useTemplateRef<InstanceType<typeof FileLifecycle>>("fileLifecycle");
const quitCancellationPending = ref(false);
const chatQuitPending = ref(false);
const lifecycle = new LifecycleCoordinator(
  () => fileLifecycle.value,
  (message) => {
    error.value = message;
  },
  (pending) => {
    quitCancellationPending.value = pending;
  },
  async (scopes?: readonly string[]) => {
    const owned =
      scopes ??
      (state.value?.mobile
        ? state.value.open.map((workspace) => workspace.id)
        : state.value?.current
          ? [state.value.current.id]
          : []);
    const { hasRunningProcesses } = await import("./plugins/process-lifecycle");
    if (await hasRunningProcesses(owned.map((id) => ({ id }))))
      throw new Error("native.ai.quit.responsesPending");
    await nextTick();
    if (localeSaving.value) throw new Error("native.recovery.failed");
    if (
      !scopes ||
      (workspaceScope.value && scopes.includes(workspaceScope.value))
    )
      await flushAppearance();
    if (scopes) {
      for (const scope of scopes) {
        await onboardingState?.currentOnboarding(scope)?.flush();
        await saveChatDrafts(scope);
        await flushLayouts(scope);
      }
    } else {
      await onboardingState?.flushOnboarding();
      await saveChatDrafts();
      await flushLayouts();
    }
  },
  (scope) => guardDictation(scope, true),
);
const lifecycleListeners: UnlistenFn[] = [];
let stopRecoveryLifecycle: (() => void) | undefined;
const workspaceRenderEpoch = ref(0);
async function revealErrorRepair(
  scope: string,
  conversationId: string,
): Promise<void> {
  if (state.value?.current?.id !== scope || !appShell.value)
    throw new Error("plugins.workspaceUnavailable");
  await appShell.value.revealConversation(conversationId);
}
async function refreshAfterRecovery(scopes: readonly string[]): Promise<void> {
  const retained = (state.value?.open ?? [])
    .map((workspace) => workspace.id)
    .filter((id) => !scopes.includes(id));
  closeChats(retained);
  layoutRuntime?.retainWorkspaceUi(retained);
  onboardingState?.retainOnboarding(retained);
  for (const session of retainedWorkspaces())
    if (scopes.includes(session.id)) releaseWorkspace(session);
  if (state.value?.current && scopes.includes(state.value.current.id))
    workspaceRenderEpoch.value++;
  await refresh();
  if (state.value?.current && scopes.includes(state.value.current.id))
    await Promise.all([reloadAppearance(), reloadLocale()]);
}
async function retryQuitCancellation(): Promise<void> {
  await lifecycle.retryCancellation();
  chatQuitPending.value = lifecycle.quitting;
  if (!quitCancellationPending.value) error.value = "";
}
let alive = true;
let revision = 0;
let unlisten: UnlistenFn | undefined;
let unlistenClose: UnlistenFn | undefined;
let unlistenLoginClose: UnlistenFn | undefined;
let unlistenQuit: UnlistenFn | undefined;
let removeBack: (() => void) | undefined;
async function refresh(): Promise<void> {
  const request = ++revision;
  try {
    const value = await snapshot();
    if (alive && request === revision) {
      if (value.open.length) layoutRuntime ??= await import("./layout/runtime");
      if (value.onboardingAvailable && value.current)
        onboardingState ??= await import("./onboarding/session");
      if (!alive || request !== revision) return;
      if (state.value?.current?.id !== value.current?.id) {
        developmentHandoffFailed.value = false;
        celebration.value = undefined;
        celebrationFocusScope = undefined;
        handoffGeneration++;
      }
      setupProgress.value =
        value.onboardingAvailable && value.current
          ? onboardingState?.onboardingSession(value.current.id)
          : undefined;
      const progress = setupProgress.value;
      void progress?.load().catch((cause) => {
        if (alive && setupProgress.value === progress) error.value = cause;
      });
      state.value = value;
      if (value.onboardingAvailable && value.current && !value.onboarding)
        void checkPendingDevelopments(value.current.id);
      retainDiagnostics(
        value.mobile
          ? value.open.map((workspace) => workspace.id)
          : value.current
            ? [value.current.id]
            : [],
      );
      retainIncidentScopes(value.open.map((workspace) => workspace.id));
      closeChats(value.open.map((workspace) => workspace.id));
      onboardingState?.retainOnboarding(
        value.open.map((workspace) => workspace.id),
      );
      layoutRuntime?.retainWorkspaceUi(
        value.open.map((workspace) => workspace.id),
      );
    }
  } catch (e) {
    if (alive) error.value = e;
  }
}
const run: RunAction = async (command, id, name, accent) => {
  if (busy.value) return false;
  if (
    ["entry", "open", "pick", "create", "background"].includes(command) &&
    !(await guardDictation())
  )
    return false;
  if (command === "close" && id && !state.value?.ready) {
    await refresh();
    if (!state.value?.ready) return false;
  }
  const ownsClosingFiles =
    command === "close" &&
    !!id &&
    (!!state.value?.mobile || state.value?.current?.id === id);
  const logger = diagnosticsFor(
    (
      state.value?.mobile
        ? state.value.open.some((workspace) => workspace.id === id)
        : state.value?.current?.id === id
    )
      ? id
      : undefined,
  );
  const diagnosticAction = {
    entry: "navigate",
    create: "create",
    pick: "open",
    open: "open",
    remove: "delete",
    close: "close",
    regrant: "connect",
    reload: "retry",
    background: "navigate",
    quit: "stop",
    "ai-setup-done": "connect",
  }[command];
  const context = logger.action(diagnosticAction, "button", "workspace");
  const operation = logger.operation(
    "workspace",
    diagnosticAction,
    "workspace",
    context,
  );
  busy.value = true;
  let finish!: () => void;
  pendingAction = new Promise((resolve) => {
    finish = resolve;
  });
  error.value = "";
  try {
    if (!(await lifecycle.reconcile())) {
      operation.finish("rejected", "unavailable");
      return false;
    }
    if (ownsClosingFiles) {
      const { prepareClose } = await import("./plugins/process-lifecycle");
      const processes = await prepareClose(id!);
      if (!alive || (!state.value?.mobile && state.value?.current?.id !== id)) {
        await invoke("ai_cancel_close", { scope: id });
        operation.finish("cancelled", "cancelled");
        return false;
      }
      const chat = workspaceChatActivity(id!);
      if (processes || chat.running || chat.selectingModel) {
        void showCloseDialog(id, processes);
        operation.finish("rejected", "unavailable");
        return false;
      }
    }
    await flushAppearance();
    if (ownsClosingFiles) {
      await nextTick();
      await onboardingState?.onboardingSession(id!).flush();
      await saveChatDrafts(id);
      await flushLayouts(id);
    }
    if (command === "create") {
      if (state.value?.onboardingAvailable) await loadOnboardingHost();
      creationAccent.value = accent;
      creationPending.value = !!state.value?.onboardingAvailable;
    }
    const outcome = ownsClosingFiles
      ? await lifecycle.close(id!, () => action(command, id, name))
      : (await action(command, id, name, accent))
        ? "closed"
        : "deferred";
    if (outcome === "cancelled") {
      operation.finish("cancelled", "cancelled");
      if (state.value?.current?.id === id) {
        try {
          await invoke("ai_cancel_close", { scope: id });
        } catch {
          error.value =
            "navigation.theCloseDecisionCouldNotBeCancelledKeepThis";
        }
      }
      return false;
    }
    const changed = outcome === "closed";
    if (changed && command === "create") {
      entryVisible.value = false;
    }
    operation.finish(changed ? "success" : "rejected");
    await refresh();
    if (changed && creationPending.value && state.value?.onboarding)
      await leaveCreation();
    return changed;
  } catch (e) {
    operation.finish("failure", "unknown");
    if (command === "close" && id === state.value?.current?.id) {
      await invoke("ai_cancel_close", { scope: id }).catch(() => {});
    }
    error.value = e;
    return false;
  } finally {
    creationPending.value = false;
    creationAccent.value = undefined;
    busy.value = false;
    pendingAction = undefined;
    finish();
  }
};
async function showEntry(): Promise<void> {
  if (state.value?.mobile) {
    try {
      await flushAppearance();
      entryVisible.value = true;
    } catch (failure) {
      error.value = failure;
    }
  } else await run("entry");
}
async function backToWorkspace(): Promise<void> {
  entryVisible.value = false;
  error.value = "";
  await nextTick();
  appShell.value?.focusNavigation();
}
function nativeBack(): void {
  const input = document.activeElement;
  // Android consumes Back while the IME is open, before this callback is delivered.
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)
    input.blur();
  const dialog = Array.from(
    document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
  ).pop();
  const popup = Array.from(
    (dialog ?? document).querySelectorAll<HTMLElement>("[popover]"),
  )
    .reverse()
    .find(
      (element) =>
        element.matches(":popover-open") &&
        !element.closest("dialog:not([open])"),
    );
  if (popup) {
    popup.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    return;
  }
  if (dialog) {
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    return;
  }
  if (entry.value?.back() || appShell.value?.back()) return;
  void run("background");
}
onMounted(async () => {
  if (!isTauri()) {
    error.value = "navigation.openSituateInTheInstalledAppToChooseAnd";
    return;
  }
  try {
    const stop = await listen("workspaces-changed", () => {
      void refresh();
    });
    if (!alive) {
      stop();
      return;
    }
    unlisten = stop;
    const stopClose = await listen<{
      scope?: string;
      processes?: boolean;
    } | null>(
      "ai-close-requested",
      (event) =>
        void showCloseDialog(event.payload?.scope, event.payload?.processes),
    );
    if (!alive) {
      stopClose();
      return;
    }
    unlistenClose = stopClose;
    const stopLoginClose = await listen("ai-login-close-requested", () => {
      void closeLoginWorkspace();
    });
    if (!alive) {
      stopLoginClose();
      return;
    }
    unlistenLoginClose = stopLoginClose;
    const stopQuit = await listen<string>("ai-quit-blocked", (event) => {
      error.value = event.payload;
    });
    if (!alive) {
      stopQuit();
      return;
    }
    unlistenQuit = stopQuit;
    for (const [name, callback] of [
      [
        "dictation-close-requested",
        (id: string) => {
          void run("close", id);
        },
      ],
      [
        "files-close-requested",
        (id: string) => {
          void run("close", id);
        },
      ],
      [
        "updates-prepare-requested",
        (token: string) => {
          chatQuitPending.value = true;
          void lifecycle.prepareUpdate(token).finally(() => {
            chatQuitPending.value = lifecycle.quitting;
          });
        },
      ],
      [
        "updates-preparation-cancelled",
        (token: string) => {
          lifecycle.cancelUpdate(token);
          chatQuitPending.value = lifecycle.quitting;
        },
      ],
      [
        "files-quit-requested",
        (token: string) => {
          chatQuitPending.value = true;
          void lifecycle.quit(token).finally(() => {
            chatQuitPending.value = lifecycle.quitting;
          });
        },
      ],
      [
        "files-quit-cancelled",
        (token: string) => {
          lifecycle.cancelQuit(token);
          chatQuitPending.value = lifecycle.quitting;
        },
      ],
    ] as const) {
      const stopLifecycle = await listen<string>(name, (event) => {
        if (typeof event.payload === "string") callback(event.payload);
      });
      if (!alive) {
        stopLifecycle();
        return;
      }
      lifecycleListeners.push(stopLifecycle);
    }
    try {
      stopRecoveryLifecycle = await installRecoveryLifecycle(
        lifecycle,
        refreshAfterRecovery,
      );
    } catch (cause) {
      captureIncident("resource", cause, undefined, false);
    }
    if (!alive) {
      stopRecoveryLifecycle?.();
      return;
    }
    void initializeUpdates();
    await initializeDictation();
    await refresh();
    if (/Android/iu.test(navigator.userAgent)) {
      const subscription = await onBackButtonPress(nativeBack);
      if (alive)
        removeBack = () => {
          void subscription.unregister();
        };
      else void subscription.unregister();
    }
  } catch (e) {
    error.value = e;
  }
});
onBeforeUnmount(() => {
  stopDiagnostics();
  stopDictationListeners();
  stopUpdatesListeners();
  stopRecoveryLifecycle?.();
  alive = false;
  revision++;
  unlisten?.();
  unlistenClose?.();
  unlistenLoginClose?.();
  unlistenQuit?.();
  lifecycleListeners.forEach((stop) => stop());
  removeBack?.();
});
</script>

<template>
  <RecoveryRoot :mobile="state?.mobile" :on-repair-opened="revealErrorRepair" />
  <div
    ref="creationRoot"
    class="application"
    :class="{ 'application-recovery': recoveryMode() }"
  >
    <aside v-if="recoveryMode()" class="recovery-notice" role="status">
      <strong>{{ t("recovery.active") }}</strong>
      <span>{{ t("recovery.exitHelp") }}</span>
      <SituateButton
        v-if="state?.current"
        variant="secondary"
        size="small"
        :disabled="resumingPlugins"
        @click="resumeAllPlugins"
        >{{ t("recovery.resumeAll") }}</SituateButton
      >
      <SituateButton
        v-if="workspaceScope"
        variant="ghost"
        size="small"
        @click="appShell?.showPlugins()"
        >{{ t("recovery.manage") }}</SituateButton
      >
      <span v-if="recoveryError" role="alert">{{
        localizeError(recoveryError)
      }}</span>
    </aside>
    <SituateScrollbars />
    <FileLifecycle ref="fileLifecycle" />
    <UpdateNotice
      v-if="
        updates.supported &&
        state?.ready &&
        (!state.current ||
          entryVisible ||
          state.aiSetup ||
          settingsScope === state.current.id ||
          appShell)
      "
      @open="showUpdates"
    />
    <SituateDialog
      v-if="globalUpdatesOpen && updates.supported"
      :open="true"
      aria-labelledby="global-updates-title"
      @cancel.prevent="globalUpdatesOpen = false"
    >
      <template #header
        ><h2 id="global-updates-title">{{ t("updates.title") }}</h2></template
      >
      <UpdateSettings />
      <template #actions
        ><SituateButton
          variant="secondary"
          @click="globalUpdatesOpen = false"
          >{{ t("updates.close") }}</SituateButton
        ></template
      >
    </SituateDialog>
    <DictationConfirmation v-if="confirmation" />
    <aside v-if="quitCancellationPending" class="workspace-notice" role="alert">
      <span>{{ t("files.quitCancellationPending") }}</span>
      <SituateButton
        variant="secondary"
        size="small"
        type="button"
        @click="retryQuitCancellation"
      >
        {{ t("files.retryQuitCancellation") }}
      </SituateButton>
    </aside>
    <section
      v-if="!state?.ready || state.error"
      class="startup"
      aria-labelledby="startup-title"
    >
      <h1 id="startup-title">{{ t("navigation.situate") }}</h1>
      <p v-if="state?.error || error" role="alert">
        {{ localizeError(state?.error || error) }}
      </p>
      <p v-else role="status">{{ t("navigation.openingWorkspaces") }}</p>
      <SituateButton
        variant="secondary"
        size="small"
        v-if="isTauri() && (error || state?.error)"
        type="button"
        :disabled="busy"
        @click="state?.error ? run('reload') : refresh()"
      >
        {{ t("navigation.retry") }}
      </SituateButton>
    </section>
    <WorkspaceEntry
      v-else-if="creationPending || !state.current || entryVisible"
      ref="entry"
      :inert="recoveryPreparing"
      :state="state"
      :run="run"
      :busy="busy"
      :error="error"
      @back="backToWorkspace"
      @opened="entryVisible = false"
    />
    <OnboardingHost
      v-else-if="!celebration && state.onboarding"
      ref="onboarding"
      :inert="recoveryPreparing"
      :key="`${state.current.id}:${workspaceRenderEpoch}`"
      :scope="state.current.id"
      :workspace-path="state.current.display"
      :notice="error"
      :workspace-name="displayWorkspaceName(state.current)"
      @enter="enterOnboardingApp"
      @workspaces="showEntry"
    />
    <AiSetup
      v-else-if="
        !celebration && (state.aiSetup || settingsScope === state.current.id)
      "
      ref="setup"
      :inert="recoveryPreparing"
      :key="`${state.current.id}:${workspaceRenderEpoch}`"
      :scope="state.current.id"
      :workspace-name="displayWorkspaceName(state.current)"
      :created="state.aiSetup"
      :notice="error"
      @done="finishSetup"
    />
    <template v-else-if="!state.onboarding">
      <div
        v-if="developmentHandoffFailed && !celebration"
        class="workspace-notice"
        role="alert"
      >
        <span>{{ t("chat.developmentUnavailable") }}</span>
        <SituateButton @click="retryDevelopmentHandoff">{{
          t("navigation.retry")
        }}</SituateButton>
      </div>
      <div
        v-if="!celebration && (error || state.failures.length)"
        class="workspace-notice"
      >
        <span role="status">{{
          error
            ? localizeError(error)
            : t("navigation.someWorkspacesCouldntBeReopened")
        }}</span>
        <SituateButton
          variant="ghost"
          size="small"
          type="button"
          class="text-action"
          @click="showEntry"
        >
          {{ t("navigation.review") }}
        </SituateButton>
      </div>
      <AppShell
        :key="`${state.current.id}:${workspaceRenderEpoch}`"
        ref="appShell"
        v-show="!celebration || celebration.reveal"
        :style="
          celebration ? { transform: `scale(${celebration.scale})` } : undefined
        "
        :aria-hidden="celebration ? true : undefined"
        :inert="
          busy ||
          chatQuitPending ||
          recoveryPreparing ||
          celebration?.scope === state.current.id
        "
        :workspace-name="displayWorkspaceName(state.current)"
        :open-workspaces="state.open"
        :current-workspace-id="state.current.id"
        :mobile="state.mobile"
        :appearance="appearanceSnapshot"
        :accent="accent"
        :appearance-loading="appearanceLoading"
        :appearance-saving="appearanceSaving"
        :appearance-error="appearanceError"
        @accent="updateAccent"
        @retry-appearance="reloadAppearance()"
        :localization="localeSnapshot"
        :localization-loading="localeLoading"
        :localization-saving="localeSaving"
        :localization-error="localeError"
        @preferences="updateLocale"
        @retry-localization="reloadLocale"
        @workspaces="showEntry"
        @close-workspace="closeWorkspace"
        @open-workspace="run('open', $event)"
        @connect="settingsScope = state.current.id"
      >
      </AppShell>
    </template>
    <SetupFinale
      v-if="celebration && state?.current?.id === celebration.scope"
      :workspace-name="displayWorkspaceName(state.current)"
      :ready="celebration.ready && !!appShell"
      @presentation="celebration && Object.assign(celebration, $event)"
      @finished="finishCelebration"
    />
    <WorkspaceCloseDialog
      v-if="closeDialogNeeded"
      ref="closeDialogControl"
      :selecting-model="closingModel"
      :busy="stoppingClose"
      @cancel="cancelClose"
      @abort="abortAndClose"
    />
  </div>
</template>

<style scoped>
.application {
  height: 100%;
}
.application-recovery {
  display: flex;
  flex-direction: column;
}
.application-recovery > :deep(.app-shell) {
  height: auto;
}
.recovery-notice {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--situate-line);
  background: var(--situate-surface);
  font-size: var(--situate-text-caption);
}
.startup {
  padding: max(24px, env(safe-area-inset-top)) 18px
    max(24px, var(--app-safe-area-bottom, env(safe-area-inset-bottom)));
  max-width: 640px;
  max-height: 100%;
  overflow: auto;
  margin: auto;
  overflow-wrap: anywhere;
}
.startup button {
  min-height: 48px;
}
.workspace-notice button {
  min-height: 48px;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--situate-radius-control);
  background: transparent;
  color: var(--situate-accent-strong, var(--situate-violet-deep));
  text-align: left;
}
.workspace-notice {
  position: fixed;
  bottom: max(16px, var(--app-safe-area-bottom, env(safe-area-inset-bottom)));
  left: 16px;
  right: 16px;
  z-index: 3;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  background: var(--situate-paper);
  border: 1px solid var(--situate-line);
  border-radius: var(--situate-radius-control);
}
</style>
