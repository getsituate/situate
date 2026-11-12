<script setup lang="ts">
import {
  type DeepReadonly,
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from "vue";
import { t, localizeError } from "@situate/localization";
import "@situate/localization/plugin-management";
import { SituateButton, SituateDialogActions } from "@situate/ui";
import { workspaceUi } from "../layout/runtime";
import { recoveryMode } from "../recovery";
import type { PluginRuntime, RuntimePlugin } from "./runtime";
import { openPluginSettings } from "./management";
import PluginCard from "./management/PluginCard.vue";
import FileEditor from "../files/FileEditor.vue";
import PluginUninstallDialog from "./management/PluginUninstallDialog.vue";
import DevelopmentHelpDialog from "./DevelopmentHelpDialog.vue";
import ErrorActions from "../errors/ErrorActions.vue";
import bend from "../../../../design/brand/bend/svg/wave-welcome.svg";
import curiousBend from "../../../../design/brand/bend/svg/point-curious.svg";
import "./management/layout.css";
const props = defineProps<{
  scope: string;
  selectedPlugin?: string;
  onDevelop: (pluginId?: string) => Promise<void>;
}>();
const emit = defineEmits<{ opened: [] }>();
const runtime = shallowRef<PluginRuntime>();
const error = ref<unknown>();
const inventoryError = ref<unknown>();
let failedAction: string | undefined;
const loading = ref(true);
const busy = ref(false);
const selected = ref<string>();
const disabling = ref<string>();
const uninstalling = ref<string>();
const uninstallStatus = ref<"confirm" | "pending" | "error" | "unknown">(
  "confirm",
);
const uncertainUninstalls = new Map<string, string | undefined>();
const announcement = ref("");
const attempted = ref(false);
const disableError = ref<unknown>();
const statusText = ref<HTMLElement>();
const operation = computed(() => {
  const pending = runtime.value?.state.disabling;
  return attempted.value &&
    pending &&
    pending.pluginId === disabling.value &&
    !(
      pending.phase === "failed" &&
      pending.error === "native.plugins.stateConflict"
    )
    ? pending
    : undefined;
});
const runningActions = computed(() => operation.value?.runningActions ?? []);
const statusMessage = computed(() => {
  const pending = operation.value;
  if (!pending) return "";
  if (pending.checking) return t("pluginManagement.disableChecking");
  if (pending.phase === "uncertain")
    return t("pluginManagement.disableUncertain");
  if (pending.phase === "failed") return t("pluginManagement.disableFailed");
  if (pending.phase === "saving") return t("pluginManagement.disableSaving");
  if (pending.stopRequested) return t("pluginManagement.disableStopping");
  const count = runningActions.value.reduce(
    (sum, action) => sum + action.count,
    0,
  );
  if (count) return t("pluginManagement.disableWaiting", { count });
  if (pending.pendingRequests)
    return t("pluginManagement.disableWaitingRequests", {
      count: pending.pendingRequests,
    });
  return t("pluginManagement.disablePreparing");
});
const heading = ref<HTMLElement>();
const root = ref<HTMLElement>();
let generation = 0;
let invoker: HTMLElement | null = null;
const plugins = computed(() => runtime.value?.state.plugins ?? []);
const inspected = computed(() =>
  plugins.value.find((p) => p.id === selected.value),
);
const target = computed(() =>
  plugins.value.find((p) => p.id === disabling.value),
);
const uninstallTarget = computed(() =>
  plugins.value.find((p) => p.id === uninstalling.value),
);
const uninstallConsumers = computed(() => {
  const id = uninstalling.value;
  if (!id || !runtime.value) return [];
  const affected = new Set(runtime.value.affectedPluginIds(id));
  return plugins.value
    .filter((plugin) => plugin.id !== id && affected.has(plugin.id))
    .map((plugin) => ({
      id: plugin.id,
      name: plugin.manifest?.name || plugin.id,
    }));
});
const runningUninstallActions = computed(() =>
  uninstalling.value
    ? (runtime.value?.runningActions(uninstalling.value) ?? 0)
    : 0,
);
watch(plugins, async (inventory, previous) => {
  if (loading.value) return;
  function removedOrReplaced(id: string) {
    const plugin = inventory.find((item) => item.id === id);
    const former = previous.find((item) => item.id === id);
    return !plugin || (former && plugin.incarnation !== former.incarnation);
  }
  const missingSelected = selected.value && removedOrReplaced(selected.value);
  const missingTarget =
    uninstalling.value && removedOrReplaced(uninstalling.value);
  const missingDisable = disabling.value && removedOrReplaced(disabling.value);
  if (!missingSelected && !missingTarget && !missingDisable) return;
  selected.value = undefined;
  uninstalling.value = undefined;
  disabling.value = undefined;
  await nextTick();
  heading.value?.focus();
});
const affectedConsumers = computed(() => {
  const id = disabling.value;
  if (!id || !runtime.value) return [];
  const affected = new Set(runtime.value.affectedPluginIds(id));
  return plugins.value.filter(
    (plugin) => plugin.id !== id && plugin.enabled && affected.has(plugin.id),
  );
});
function pluginName(id: string) {
  return plugins.value.find((plugin) => plugin.id === id)?.manifest?.name || id;
}
function consumers(id: string) {
  return plugins.value
    .filter((plugin) => plugin.manifest?.dependencies?.includes(id))
    .map((plugin) => ({
      id: plugin.id,
      name: plugin.manifest?.name || plugin.id,
    }));
}
const inventoryFailure = computed(
  () => inventoryError.value || runtime.value?.state.error,
);
const actionFailure = computed(
  () => error.value || runtime.value?.state.actionError,
);
watch(
  () => runtime.value?.state.status,
  (status) => {
    if (status === "ready" && !runtime.value?.state.error) {
      inventoryError.value = undefined;
      if (
        failedAction?.startsWith("enable:") ||
        failedAction?.startsWith("resume:")
      ) {
        error.value = undefined;
        failedAction = undefined;
      }
    }
  },
);
watch(
  () => props.scope,
  async (scope) => {
    const current = ++generation;
    runtime.value = undefined;
    selected.value = props.selectedPlugin;
    disabling.value = undefined;
    uninstalling.value = undefined;
    uncertainUninstalls.clear();
    announcement.value = "";
    attempted.value = false;
    disableError.value = undefined;
    error.value = undefined;
    failedAction = undefined;
    inventoryError.value = undefined;
    loading.value = true;
    busy.value = false;
    try {
      const instance = await workspaceUi(scope).plugins;
      if (current !== generation) return;
      if (!instance) throw new Error("plugins.workspaceUnavailable");
      runtime.value = instance;
      await instance.ready;
    } catch (cause) {
      if (
        current === generation &&
        (!runtime.value || runtime.value.state.status !== "ready")
      )
        inventoryError.value = cause;
    } finally {
      if (current === generation) {
        loading.value = false;
        await nextTick();
        heading.value?.focus();
      }
    }
  },
  { immediate: true },
);
watch(
  () => props.selectedPlugin,
  (id) => {
    selected.value = id;
  },
);
onBeforeUnmount(() => ++generation);
async function retryInventory() {
  if (busy.value) return;
  const current = generation;
  busy.value = true;
  try {
    const instance = runtime.value ?? (await workspaceUi(props.scope).plugins);
    if (current !== generation) return;
    if (!instance) throw new Error("plugins.workspaceUnavailable");
    runtime.value = instance;
    await instance.refresh(undefined, true);
    if (current === generation) inventoryError.value = undefined;
  } catch (cause) {
    if (current === generation) inventoryError.value = cause;
  } finally {
    if (current === generation) busy.value = false;
  }
}
function dismissActionError() {
  error.value = undefined;
  failedAction = undefined;
  runtime.value?.dismissActionError();
}
async function perform(key: string, action: () => Promise<unknown>) {
  if (busy.value) return;
  const current = generation;
  busy.value = true;
  try {
    await action();
    if (current === generation && failedAction === key) {
      error.value = undefined;
      failedAction = undefined;
    }
  } catch (cause) {
    if (current === generation) {
      error.value = cause;
      failedAction = key;
    }
  } finally {
    if (current === generation) busy.value = false;
  }
}
function develop(id?: string) {
  void perform(`develop:${id ?? ""}`, () => props.onDevelop(id));
}
function toggle(plugin: DeepReadonly<RuntimePlugin>, event: MouseEvent) {
  if (busy.value) return;
  if (plugin.enabled) {
    invoker = event.currentTarget as HTMLElement;
    invoker.focus();
    const pending = runtime.value?.state.disabling;
    const ongoing =
      pending && !["disabled", "cancelled", "failed"].includes(pending.phase);
    disabling.value = ongoing ? pending.pluginId : plugin.id;
    attempted.value = !!ongoing;
    disableError.value = undefined;
  } else if (recoveryMode() !== undefined) {
    void perform(`enable:${plugin.id}`, () =>
      runtime.value!.setEnabled(plugin.id, true),
    );
  }
}
async function closeDialog() {
  const pending = operation.value;
  if (
    pending &&
    ["starting", "waiting"].includes(pending.phase) &&
    !pending.stopRequested
  )
    void runtime.value?.cancelDisable();
  disabling.value = undefined;
  attempted.value = false;
  await nextTick();
  if (invoker?.isConnected) invoker.focus();
}
watch(
  () => [operation.value?.phase, runtime.value?.state.status] as const,
  ([phase, status]) => {
    if ((phase === "disabled" && status !== "loading") || phase === "cancelled")
      void closeDialog();
  },
);
async function disable() {
  const id = disabling.value;
  if (!id) return;
  attempted.value = true;
  disableError.value = undefined;
  const current = generation;
  const pending = runtime.value!.setEnabled(id, false);
  await nextTick();
  statusText.value?.focus();
  try {
    await pending;
  } catch (cause) {
    if (current === generation) disableError.value = cause;
  }
}
async function controlDisable(action: "stop" | "check") {
  if (action === "stop") void runtime.value!.stopDisabling();
  else void runtime.value!.checkDisableStatus();
  await nextTick();
  statusText.value?.focus();
}
async function inspect(id: string) {
  selected.value = id;
  await nextTick();
  heading.value?.focus();
}
async function backToPlugins() {
  const id = selected.value;
  selected.value = undefined;
  await nextTick();
  const card = Array.from(
    root.value?.querySelectorAll<HTMLElement>("[data-plugin-id]") ?? [],
  ).find((el) => el.dataset.pluginId === id);
  card?.querySelector<HTMLElement>('[data-action="view-files"]')?.focus();
}
function back(): boolean {
  if (uninstalling.value) {
    if (uninstallStatus.value !== "pending") void closeUninstall();
    return true;
  }
  if (disabling.value) {
    void closeDialog();
    return true;
  }
  if (selected.value) {
    void backToPlugins();
    return true;
  }
  return false;
}
function openUninstall(id: string) {
  if (busy.value) return;
  invoker = document.activeElement as HTMLElement | null;
  const plugin = plugins.value.find((item) => item.id === id);
  if (!plugin) return;
  uninstallStatus.value =
    runtime.value?.uninstallOutcomeUnknown?.(id) ||
    (uncertainUninstalls.has(id) &&
      uncertainUninstalls.get(id) === plugin.incarnation)
      ? "unknown"
      : "confirm";
  uninstalling.value = id;
}
async function closeUninstall() {
  if (uninstallStatus.value === "pending") return;
  uninstalling.value = undefined;
  await nextTick();
  if (invoker?.isConnected) invoker.focus();
  else heading.value?.focus();
}
async function disableInstead() {
  const id = uninstalling.value;
  if (!id || !["confirm", "error"].includes(uninstallStatus.value)) return;
  uninstalling.value = undefined;
  await nextTick();
  disabling.value = id;
}
async function uninstall() {
  const instance = runtime.value;
  const plugin = uninstallTarget.value;
  if (
    !instance ||
    !plugin ||
    busy.value ||
    !["confirm", "error"].includes(uninstallStatus.value) ||
    uninstallConsumers.value.length ||
    runningUninstallActions.value
  )
    return;
  const current = generation;
  const name = plugin.manifest?.name || plugin.id;
  uninstallStatus.value = "pending";
  busy.value = true;
  try {
    await instance.uninstall(plugin.id);
    if (current !== generation) return;
    uninstalling.value = undefined;
    selected.value = undefined;
    announcement.value = t("pluginManagement.uninstall.success", { name });
    await nextTick();
    heading.value?.focus();
  } catch (cause) {
    if (current !== generation) return;
    const message = cause instanceof Error ? cause.message : cause;
    const safeToRetry =
      message === "native.plugins.stateBusy" ||
      message === "native.plugins.stateConflict";
    if (safeToRetry) {
      uninstallStatus.value = "error";
    } else {
      uncertainUninstalls.set(plugin.id, plugin.incarnation);
      try {
        await instance.synchronizeInventory();
      } catch {
        // A failed inventory read cannot establish whether removal happened.
      }
      if (current !== generation) return;
      uninstallStatus.value = "unknown";
      if (!plugins.value.some((item) => item.id === plugin.id)) {
        announcement.value = t("pluginManagement.uninstall.unknownOutcome", {
          name,
        });
        await nextTick();
        heading.value?.focus();
      }
    }
  } finally {
    if (current === generation) busy.value = false;
  }
}
defineExpose({ back });
function settings(id: string) {
  const current = generation;
  void perform(`settings:${id}`, async () => {
    const opened = await openPluginSettings(
      workspaceUi(props.scope),
      plugins.value.find((p) => p.id === id),
    );
    if (opened && current === generation) emit("opened");
  });
}
</script>
<template>
  <section
    ref="root"
    class="plugin-view"
    :class="selected ? 'plugin-files-view' : 'plugin-collection-view'"
  >
    <main class="plugin-main">
      <div class="plugin-heading">
        <SituateButton
          v-if="selected"
          variant="ghost"
          size="small"
          class="plugin-text"
          @click="back"
          >‹ {{ t("pluginManagement.back") }}</SituateButton
        >
        <div class="plugin-title-row">
          <div>
            <h1
              ref="heading"
              tabindex="-1"
              :data-localization-content="selected ? 'user' : undefined"
            >
              {{
                selected
                  ? inspected?.manifest?.name || selected
                  : t("pluginManagement.title")
              }}
            </h1>
            <p v-if="!selected && plugins.length" class="plugin-intro">
              {{ t("pluginManagement.intro") }}
            </p>
          </div>
          <aside v-if="!selected && plugins.length" class="plugin-create-panel">
            <img :src="bend" alt="" width="88" height="96" />
            <div>
              <h2>{{ t("pluginManagement.createTitle") }}</h2>
              <p>{{ t("pluginManagement.createHelp") }}</p>
              <SituateButton :disabled="busy" @click="develop()"
                >{{ t("pluginManagement.newPlugin") }}
                <span aria-hidden="true">↗</span></SituateButton
              >
            </div>
          </aside>
        </div>
      </div>
      <div v-if="inventoryFailure" role="alert">
        <p>{{ localizeError(inventoryFailure) }}</p>
        <SituateButton :disabled="busy" @click="retryInventory">{{
          t("navigation.retry")
        }}</SituateButton>
        <ErrorActions
          boundary="plugins"
          :error="inventoryFailure"
          :scope="scope"
        />
      </div>
      <div v-if="actionFailure" role="alert">
        <p>{{ localizeError(actionFailure) }}</p>
        <SituateButton variant="ghost" @click="dismissActionError">{{
          t("pluginManagement.uninstall.close")
        }}</SituateButton>
        <ErrorActions
          boundary="plugins"
          :error="actionFailure"
          :scope="scope"
        />
      </div>
      <FileEditor
        v-if="selected"
        :key="selected"
        :workspace-id="scope"
        :workspace-name="inspected?.manifest?.name || selected"
        :plugin-id="selected"
        embedded
        @leave="backToPlugins"
      />
      <p
        v-else-if="
          loading || (runtime?.state.status === 'loading' && !plugins.length)
        "
        role="status"
      >
        {{ t("pluginManagement.loading") }}
      </p>
      <template v-else-if="plugins.length || !inventoryFailure">
        <section
          v-if="!plugins.length"
          class="plugin-first-tool"
          :aria-label="t('pluginManagement.empty')"
        >
          <div class="plugin-first-tool-art" aria-hidden="true">
            <img :src="curiousBend" alt="" width="320" height="320" />
          </div>
          <div class="plugin-first-tool-copy">
            <h2>{{ t("pluginManagement.empty") }}</h2>
            <p>{{ t("pluginManagement.emptyBody") }}</p>
            <div class="plugin-first-tool-actions">
              <SituateButton :disabled="busy" @click="develop()"
                >{{ t("pluginManagement.newPlugin") }}
                <span aria-hidden="true">↗</span></SituateButton
              >
            </div>
          </div>
        </section>
        <h2 v-if="plugins.length" class="plugin-collection-label">
          {{ t("pluginManagement.collection") }}
          <span>{{ plugins.length }}</span>
        </h2>
        <section
          v-if="plugins.length"
          class="plugin-list plugin-card-grid"
          :aria-label="t('pluginManagement.installed')"
        >
          <PluginCard
            v-for="plugin in plugins"
            :key="plugin.id"
            :plugin="plugin"
            :consumers="consumers(plugin.id)"
            :blocked-by-name="
              plugin.blockedBy
                ? pluginName(plugin.blockedBy.pluginId)
                : undefined
            "
            :busy="busy"
            :can-enable="!inventoryFailure && recoveryMode() !== undefined"
            @uninstall="openUninstall(plugin.id)"
            @resume="
              perform(`resume:${plugin.id}`, () => runtime!.resume(plugin.id))
            "
            @develop="develop(plugin.id)"
            @inspect="inspect(plugin.id)"
            @settings="settings(plugin.id)"
            @toggle="toggle(plugin, $event)"
          />
        </section>
      </template>
    </main>
    <p role="status" class="plugin-announcement">{{ announcement }}</p>
    <PluginUninstallDialog
      v-if="uninstallTarget"
      :name="uninstallTarget.manifest?.name || uninstallTarget.id"
      :enabled="uninstallTarget.enabled"
      :affected="uninstallConsumers"
      :running="runningUninstallActions"
      :status="uninstallStatus"
      @close="closeUninstall"
      @disable="disableInstead"
      @confirm="uninstall"
    />
    <DevelopmentHelpDialog
      v-if="target"
      :title="
        t('pluginManagement.disableTitle', {
          name: target.manifest?.name || target.id,
        })
      "
      @close="closeDialog"
    >
      <div class="plugin-dialog">
        <template v-if="operation">
          <p ref="statusText" role="status" aria-atomic="true" tabindex="-1">
            {{ statusMessage }}
          </p>
          <ul v-if="runningActions.length && operation.phase === 'waiting'">
            <li
              v-for="action in runningActions"
              :key="action.pluginId"
              data-localization-content="user"
            >
              {{ pluginName(action.pluginId) }} ({{ action.count }})
            </li>
          </ul>
          <p v-if="operation.phase === 'waiting' && !operation.stopRequested">
            {{ t("pluginManagement.disableCancelHelp") }}
          </p>
          <p v-if="operation.phase === 'waiting'">
            {{ t("pluginManagement.disableExternalEffects") }}
          </p>
          <p v-if="disableError && operation.phase === 'failed'">
            {{ localizeError(disableError) }}
          </p>
          <SituateDialogActions>
            <SituateButton variant="secondary" autofocus @click="closeDialog">{{
              ["starting", "waiting", "failed"].includes(operation.phase) &&
              !operation.stopRequested
                ? t("pluginManagement.cancelDisabling")
                : t("pluginManagement.disableClose")
            }}</SituateButton>
            <SituateButton
              v-if="operation.phase === 'waiting' && !operation.stopRequested"
              variant="ghost"
              @click="controlDisable('stop')"
              >{{ t("pluginManagement.disableAbortNow") }}</SituateButton
            >
            <SituateButton
              v-if="operation.phase === 'failed'"
              @click="disable()"
              >{{ t("pluginManagement.disableRetry") }}</SituateButton
            >
            <SituateButton
              v-if="operation.phase === 'uncertain' && !operation.checking"
              @click="controlDisable('check')"
              >{{ t("pluginManagement.disableCheck") }}</SituateButton
            >
          </SituateDialogActions>
        </template>
        <template v-else>
          <p v-if="disableError" role="alert">
            {{ localizeError(disableError) }}
          </p>
          <p>{{ t("pluginManagement.disableBody") }}</p>
          <template v-if="affectedConsumers.length">
            <h3>{{ t("pluginManagement.affectedConsumers") }}</h3>
            <ul>
              <li
                v-for="consumer in affectedConsumers"
                :key="consumer.id"
                data-localization-content="user"
              >
                {{ consumer.manifest?.name || consumer.id }}
              </li>
            </ul>
            <p>{{ t("pluginManagement.explicitDependentEnable") }}</p>
          </template>
          <p>{{ t("pluginManagement.disableWaitsForActions") }}</p>
          <SituateDialogActions>
            <SituateButton
              variant="secondary"
              autofocus
              :disabled="busy"
              @click="closeDialog"
              >{{ t("pluginManagement.cancel") }}</SituateButton
            ><SituateButton :disabled="busy" @click="disable()">{{
              t("pluginManagement.disable")
            }}</SituateButton>
          </SituateDialogActions>
        </template>
      </div>
    </DevelopmentHelpDialog>
  </section>
</template>
