import { invoke } from "@tauri-apps/api/core";
import { createFailureReporter } from "../diagnostics/failures";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readonly, shallowReactive, watch } from "vue";
import type { Component } from "vue";
import {
  recoveryMode,
  recoveryRevision,
  pluginMayExecute,
  resumePlugins,
} from "../recovery";
import { importPluginModule, loadHostModules } from "./module";
import { observeManualPersistence } from "./manual-persistence";
import { createPluginModule, type PluginModule } from "./module-source";
import {
  validateUiContributions,
  validateToolDescriptors,
} from "./contributions";
import type {
  InstalledPlugin,
  NativeServiceSnapshot,
  PluginUiHost,
  PluginList,
  PluginRequest,
  PluginRuntimeOptions,
  PluginUiContributions,
  PluginToolDescriptor,
  PluginDisableRequest,
  PluginDisableSnapshot,
  PluginDisableState,
} from "./types";

const recordFailure = createFailureReporter();
export type PluginStatus = "disabled" | "suppressed" | "loaded" | "failed";
export interface RuntimePlugin extends InstalledPlugin {
  status: PluginStatus;
  settingsId?: string;
  blockedBy?: {
    reason: "missing" | "cyclic" | "disabled" | "platform" | "dependency";
    pluginId: string;
  };
}
interface LoadedPlugin {
  tools: PluginToolDescriptor[];
  exports: string[];
  components: Record<string, Component>;
  executorGeneration: number;
  revisions: Record<string, string | null>;
  incarnations: Record<string, string>;
  invalidate: () => void;
  isAvailable: () => boolean;
  skills: string[];
  runs: number;
  retired: boolean;
  close: () => void;
}
const nativeErrors = new Set(
  [
    "stateInvalid",
    "stateConflict",
    "stateBusy",
    "stateSaveFailed",
    "stateOutcomeUnknown",
    "disabled",
    "recoveryBlocked",
    "unavailable",
    "readFailed",
    "invalidPath",
    "invalidManifest",
    "tooLarge",
  ].map((key) => `native.plugins.${key}`),
);
function safeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : error;
  return typeof message === "string" &&
    (nativeErrors.has(message) ||
      [
        "plugins.invalidContributions",
        "plugins.executionCancelled",
        "plugins.moduleImportInvalid",
        "plugins.moduleImportUnsupported",
        "plugins.moduleCycle",
        "plugins.moduleNotFound",
      ].includes(message))
    ? message
    : fallback;
}

function sanitizedError(error: unknown, fallback: string): Error {
  // Plugin exceptions can contain source or workspace data, including in their causes.
  return new Error(safeError(error, fallback));
}

export function createPluginRuntime(options: PluginRuntimeOptions) {
  const state = shallowReactive({
    status: "idle" as "idle" | "loading" | "ready" | "failed" | "disposed",
    error: null as string | null,
    actionError: null as string | null,
    plugins: [] as RuntimePlugin[],
    disabling: null as PluginDisableState | null,
  });
  let actionErrorRevision = 0;
  function recordActionError(error: unknown, fallback: string) {
    ++actionErrorRevision;
    state.actionError = safeError(error, fallback);
  }
  const controller = new AbortController();
  const enabled = new Map<string, boolean>();
  const disableEpoch = new Map<string, number>();
  const registrations = new Map<string, (() => void)[]>();
  const linkedModules = new Set<PluginModule>();
  const pendingHosts = new Set<() => void>();
  const contributionCleanups = new Set<() => void>();
  const loaded = new Map<string, LoadedPlugin>();
  const activeActions = shallowReactive(new Map<string, number>());
  const retiring = new Map<{ runs: number; close: () => void }, string>();
  function closeWhenIdle(
    id: string,
    instance: { runs: number; close: () => void },
  ) {
    if (instance.runs === 0 && !(activeActions.get(id) ?? 0)) {
      retiring.delete(instance);
      instance.close();
    } else retiring.set(instance, id);
  }
  const gates = new Set<string>();
  const drainListeners = new Set<() => void>();
  let quiescing = false;
  let recoveryRefreshPending = false;
  let resuming = false;
  function affected(ids: readonly string[]): Set<string> {
    const result = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const plugin of state.plugins)
        if (
          !result.has(plugin.id) &&
          plugin.manifest?.dependencies?.some((id) => result.has(id))
        ) {
          result.add(plugin.id);
          changed = true;
        }
    }
    return result;
  }
  /** New affected actions fail busy until the callback settles; refresh committed code inside it. */
  async function withQuiescent<T>(
    ids: readonly string[],
    callback: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    requireCurrent();
    if (signal?.aborted) throw new Error("plugins.executionCancelled");
    if (quiescing || saving || resuming)
      throw new Error("native.plugins.stateBusy");
    quiescing = true;
    const targets = affected(ids);
    targets.forEach((id) => gates.add(id));
    try {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          drainListeners.delete(check);
          signal?.removeEventListener("abort", abort);
          controller.signal.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(new Error("plugins.executionCancelled"));
        const check = () => {
          if (![...targets].some((id) => (activeActions.get(id) ?? 0) > 0))
            finish();
        };
        drainListeners.add(check);
        signal?.addEventListener("abort", abort, { once: true });
        controller.signal.addEventListener("abort", abort, { once: true });
        if (signal?.aborted || controller.signal.aborted) abort();
        else check();
      });
      requireCurrent();
      if (signal?.aborted) throw new Error("plugins.executionCancelled");
      return await callback();
    } finally {
      targets.forEach((id) => gates.delete(id));
      quiescing = false;
      flushRecoveryRefresh();
    }
  }
  let revision: string | null = null;
  let listed = false;
  let inventory: PluginList | undefined;
  let synchronizing = false;
  const uncertainRemovals = new Map<string, string | undefined>();
  let generation = 0;
  let disposed = false;
  let saving = false;
  let latestReady: Promise<void>;
  let supersede: () => void = () => undefined;
  const request = <T>(request: PluginRequest) =>
    invoke<T>("plugin_runtime", { scope: options.scope, request });
  const current = () => !disposed && options.isCurrent();
  const executable = (id: string) =>
    current() && pluginMayExecute(options.scope, id);
  function requireCurrent() {
    if (!current()) throw new Error("plugins.workspaceUnavailable");
  }
  function requireExecutable(id: string) {
    requireCurrent();
    if (!pluginMayExecute(options.scope, id))
      throw new Error("native.plugins.recoveryBlocked");
  }
  const persistence = observeManualPersistence(
    options.scope,
    current,
    (error) => {
      if (current())
        recordActionError(error, "native.plugins.stateOutcomeUnknown");
    },
  );
  let stopUpdates: UnlistenFn | undefined;
  const updatesReady = (async () => {
    const stop = await listen<{ scope: string; pluginIds: string[] }>(
      "plugin-executor-updated",
      ({ payload }) => {
        if (
          !current() ||
          payload.scope !== options.scope ||
          !Array.isArray(payload.pluginIds) ||
          !payload.pluginIds.length ||
          payload.pluginIds.some((id) => typeof id !== "string" || !id)
        )
          return;
        void refresh(undefined, true, affected(payload.pluginIds)).catch(
          () => undefined,
        );
      },
    );
    if (!current()) stop();
    else stopUpdates = stop;
  })();
  void updatesReady.catch(() => undefined);
  function release(id: string) {
    for (const unregister of registrations.get(id) ?? []) unregister();
    registrations.delete(id);
    options.registry.removePlugin(id);
  }
  function retire(id: string) {
    release(id);
    const instance = loaded.get(id);
    if (!instance) return;
    loaded.delete(id);
    instance.retired = true;
    closeWhenIdle(id, instance);
  }
  function closePendingHosts() {
    for (const close of pendingHosts) close();
    pendingHosts.clear();
  }
  function clearContributions() {
    for (const id of loaded.keys()) retire(id);
  }
  function block(id: string) {
    enabled.set(id, false);
    disableEpoch.set(id, (disableEpoch.get(id) ?? 0) + 1);
    retire(id);
  }
  async function performRefresh(
    pluginId?: string,
    preserve = false,
    group?: ReadonlySet<string>,
  ): Promise<void> {
    requireCurrent();
    if (saving) throw new Error("native.plugins.stateBusy");
    const turn = ++generation;
    const priorActionError = actionErrorRevision;
    const previousInventory = inventory;
    let inventoryRead = false;
    closePendingHosts();
    state.status = "loading";
    if (!group) {
      if (pluginId === undefined) {
        if (!preserve) clearContributions();
      } else retire(pluginId);
    }
    const previous = new Map(
      state.plugins.map((plugin) => [plugin.id, plugin]),
    );
    const valid = () => current() && turn === generation;
    const staged = new Map<string, LoadedPlugin>();
    const publications: (() => void)[] = [];
    const retired: (() => void)[] = [];
    const groupViews: {
      pluginId: string;
      enabled: boolean;
      views: NonNullable<PluginUiContributions["views"]>;
    }[] = [];
    const available = (id: string) =>
      staged.get(id) ?? (group?.has(id) ? undefined : loaded.get(id));
    try {
      await Promise.all([persistence.ready, updatesReady]);
      if (!valid()) return;
      const result = await request<PluginList>({ operation: "list" });
      const snapshot: NativeServiceSnapshot = result.plugins.some(
        (plugin) => plugin.enabled && executable(plugin.id) && !plugin.error,
      )
        ? await invoke<NativeServiceSnapshot>("plugin_executor", {
            scope: options.scope,
            request: { operation: "snapshot" },
          })
        : { plugins: [] };
      inventoryRead = true;
      const definitions = new Map(
        snapshot.plugins.map((entry) => [entry.pluginId, entry]),
      );
      const unavailable = new Map(
        (snapshot.unavailable ?? []).map((entry) => [
          entry.pluginId,
          entry.error,
        ]),
      );
      if (!valid()) return;
      const before = new Map(
        inventory?.plugins.map((plugin) => [plugin.id, plugin]),
      );
      const ids = new Set(result.plugins.map((plugin) => plugin.id));
      const changed = new Set<string>();
      for (const id of before.keys()) if (!ids.has(id)) changed.add(id);
      for (const plugin of result.plugins)
        if (
          before.has(plugin.id) &&
          JSON.stringify(before.get(plugin.id)) !== JSON.stringify(plugin)
        )
          changed.add(plugin.id);
      if (inventory && inventory.revision !== result.revision && !changed.size)
        for (const id of before.keys()) changed.add(id);
      if (!group) for (const id of affected([...changed])) block(id);
      inventory = structuredClone({
        ...result,
        plugins: result.plugins.map((plugin) =>
          group && !group.has(plugin.id)
            ? (before.get(plugin.id) ?? plugin)
            : plugin,
        ),
      });
      revision = result.revision;
      listed = true;
      for (const id of enabled.keys()) if (!ids.has(id)) block(id);
      for (const plugin of result.plugins) {
        if (plugin.enabled !== true && enabled.get(plugin.id) === true)
          block(plugin.id);
        enabled.set(plugin.id, plugin.enabled === true);
      }
      const plugins: RuntimePlugin[] = result.plugins.map((plugin) => ({
        ...plugin,
        enabled: plugin.enabled === true,
        error:
          plugin.error === null
            ? null
            : safeError(plugin.error, "plugins.loadFailed"),
        ...(loaded.has(plugin.id)
          ? { settingsId: previous.get(plugin.id)?.settingsId }
          : {}),
        status: loaded.has(plugin.id)
          ? "loaded"
          : plugin.error
            ? "failed"
            : plugin.enabled !== true
              ? "disabled"
              : "suppressed",
      }));
      if (!group) state.plugins = plugins;
      const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
      const ordered: RuntimePlugin[] = [];
      const visiting = new Set<string>();
      const visited = new Map<string, boolean>();
      function visit(plugin: RuntimePlugin): boolean {
        if (visited.has(plugin.id)) return visited.get(plugin.id)!;
        if (visiting.has(plugin.id)) {
          plugin.blockedBy = { reason: "cyclic", pluginId: plugin.id };
          return false;
        }
        visiting.add(plugin.id);
        const platform =
          !plugin.manifest?.platforms ||
          plugin.manifest.platforms.includes(options.platform ?? "macos");
        if (!platform)
          plugin.blockedBy = { reason: "platform", pluginId: plugin.id };
        const usable =
          !plugin.error &&
          plugin.enabled &&
          executable(plugin.id) &&
          platform &&
          (plugin.manifest?.dependencies ?? []).every((id) => {
            const dependency = byId.get(id);
            if (dependency && visit(dependency)) return true;
            plugin.blockedBy ??= {
              reason: !dependency
                ? "missing"
                : !dependency.enabled
                  ? "disabled"
                  : dependency.blockedBy?.reason === "cyclic"
                    ? "cyclic"
                    : "dependency",
              pluginId: id,
            };
            return false;
          });
        visiting.delete(plugin.id);
        visited.set(plugin.id, !!usable);
        if (!usable && plugin.enabled && executable(plugin.id)) {
          plugin.status = "failed";
          plugin.error ??= "native.plugins.unavailable";
        }
        ordered.push(plugin);
        return !!usable;
      }
      plugins.forEach(visit);
      if (!group)
        for (const plugin of plugins)
          if (plugin.status === "failed" && loaded.has(plugin.id))
            block(plugin.id);
      const names = new Set([
        ...(options.builtinToolNames ?? []),
        ...[...loaded.entries()]
          .filter(([id]) => !group?.has(id))
          .flatMap(([, instance]) => instance.tools.map((tool) => tool.name)),
      ]);
      for (const plugin of ordered) {
        if (!valid()) return;
        if (
          (loaded.has(plugin.id) && !group?.has(plugin.id)) ||
          !executable(plugin.id) ||
          !plugin.enabled ||
          plugin.error
        )
          continue;
        const releases: (() => void)[] = [];
        const revisions: Record<string, string | null> = {
          [plugin.id]: plugin.revision ?? null,
        };
        const incarnations: Record<string, string> = plugin.incarnation
          ? { [plugin.id]: plugin.incarnation }
          : {};
        for (const id of plugin.manifest?.dependencies ?? []) {
          Object.assign(revisions, available(id)?.revisions);
          Object.assign(incarnations, available(id)?.incarnations);
        }
        Object.freeze(revisions);
        Object.freeze(incarnations);
        let stale = false;
        let factoryAvailable = true;
        let closeHost: () => void = () => undefined;
        try {
          requireExecutable(plugin.id);
          const missing = plugin.manifest?.dependencies?.find(
            (id) => !available(id),
          );
          if (missing) {
            plugin.blockedBy = { reason: "dependency", pluginId: missing };
            throw new Error("native.plugins.unavailable");
          }
          const definition = definitions.get(plugin.id);
          if (!definition)
            throw new Error(
              unavailable.get(plugin.id) ??
                unavailable.get(null) ??
                "native.plugins.unavailable",
            );
          if (
            definition.revision !== (plugin.revision ?? null) ||
            (plugin.incarnation !== undefined &&
              definition.incarnation !== plugin.incarnation)
          )
            throw new Error("native.plugins.unavailable");
          const source = definition.source;
          if (!valid()) return;
          requireExecutable(plugin.id);
          if (
            enabled.get(plugin.id) !== true ||
            source.manifest.id !== plugin.id
          )
            throw new Error("plugins.invalidContributions");
          const exported = definition.exports;
          if (
            exported.some((name) => !source.manifest.exports?.includes(name)) ||
            source.manifest.exports?.some((name) => !exported.includes(name))
          )
            throw new Error("plugins.invalidContributions");
          let contributions: unknown = {};
          if (source.uiEntry !== null) {
            const modules = await loadHostModules();
            if (!valid()) return;
            requireExecutable(plugin.id);
            const linked = createPluginModule(source, "ui");
            linkedModules.add(linked);
            closeHost = () => {
              if (linkedModules.delete(linked)) linked.dispose();
            };
            pendingHosts.add(closeHost);
            const module = await importPluginModule(linked.url);
            if (!valid()) {
              closeHost();
              return;
            }
            requireExecutable(plugin.id);
            if (typeof module.default !== "function")
              throw new Error("plugins.invalidContributions");
            const epoch = disableEpoch.get(plugin.id) ?? 0;
            const guard = {
              isCurrent: () =>
                factoryAvailable &&
                !stale &&
                executable(plugin.id) &&
                enabled.get(plugin.id) === true &&
                (disableEpoch.get(plugin.id) ?? 0) === epoch,
            };
            const requireAvailable = () => {
              requireExecutable(plugin.id);
              if (!guard.isCurrent())
                throw new Error("native.plugins.unavailable");
            };
            const dependencies = new Map(
              (source.manifest.dependencies ?? []).map((id) => [
                id,
                available(id),
              ]),
            );
            const invokeExport = async (
              id: string,
              name: string,
              args: unknown,
              provider:
                | {
                    exports: string[];
                    executorGeneration: number;
                    isAvailable(): boolean;
                  }
                | undefined,
            ) => {
              requireAvailable();
              if (
                gates.has(plugin.id) ||
                !provider?.isAvailable() ||
                !provider.exports.includes(name)
              )
                throw new Error("native.plugins.unavailable");
              requireExecutable(id);
              const actionIds = Object.keys(revisions);
              for (const id of actionIds)
                activeActions.set(id, (activeActions.get(id) ?? 0) + 1);
              try {
                const reply = await invoke("plugin_executor", {
                  scope: options.scope,
                  request: {
                    operation: "invoke",
                    pluginId: id,
                    exportName: name,
                    args,
                    generation: provider.executorGeneration,
                  },
                });
                return await persistence.unwrap(reply, id);
              } catch (error) {
                recordFailure("view", error, options.scope);
                throw sanitizedError(error, "plugins.executionFailed");
              } finally {
                for (const id of actionIds)
                  activeActions.set(id, (activeActions.get(id) ?? 1) - 1);
                for (const [instance, id] of retiring)
                  closeWhenIdle(id, instance);
                for (const check of drainListeners) check();
              }
            };
            const host: PluginUiHost = {
              ...modules,
              service: {
                invoke: (name, args) =>
                  invokeExport(plugin.id, name, args, {
                    exports: exported,
                    executorGeneration: definition.generation,
                    isAvailable: guard.isCurrent,
                  }),
              },
              dependencies: {
                invoke: (id, name, args) =>
                  invokeExport(id, name, args, dependencies.get(id)),
                component: (id, name) => {
                  requireAvailable();
                  const provider = dependencies.get(id);
                  if (
                    !provider?.isAvailable() ||
                    !Object.hasOwn(provider.components, name) ||
                    !executable(id) ||
                    enabled.get(id) !== true
                  )
                    throw new Error("native.plugins.unavailable");
                  return provider.components[name];
                },
              },
              navigation: {
                open: (target, ticket, _guard, presentation) => {
                  requireAvailable();
                  return options.coordinator.open(
                    target,
                    ticket,
                    guard,
                    presentation,
                  );
                },
                reveal: (viewId, contentId, revision) => {
                  requireAvailable();
                  return options.coordinator.reveal(
                    viewId,
                    contentId,
                    revision,
                    guard,
                  );
                },
              },
            };
            contributions = await module.default(host);
            const value = contributions as {
              dispose?: () => void | Promise<void>;
            } | null;
            const closeModule = closeHost;
            let closed = false;
            closeHost = () => {
              if (closed) return;
              closed = true;
              factoryAvailable = false;
              contributionCleanups.delete(closeHost);
              closeModule();
              try {
                void Promise.resolve(
                  typeof value?.dispose === "function"
                    ? value.dispose()
                    : undefined,
                ).catch(() => {
                  if (current())
                    recordActionError(null, "plugins.cleanupFailed");
                });
              } catch {
                if (current()) recordActionError(null, "plugins.cleanupFailed");
              }
            };
            pendingHosts.delete(closeModule);
            pendingHosts.add(closeHost);
            contributionCleanups.add(closeHost);
          }
          if (!valid()) {
            closeHost();
            return;
          }
          requireExecutable(plugin.id);
          const validated = validateUiContributions(contributions, plugin.id);
          const snapshots = validateToolDescriptors(definition.tools, names);
          const publish = () => {
            if (!group && validated.views?.length)
              releases.push(
                options.registry.registerPlugin({
                  pluginId: plugin.id,
                  enabled: true,
                  views: validated.views,
                }),
              );
            if (!group && validated.settings)
              releases.push(
                options.registry.registerPlugin({
                  pluginId: plugin.id,
                  enabled: true,
                  views: [validated.settings],
                }),
              );
            registrations.set(plugin.id, releases);
            loaded.set(plugin.id, instance);
          };
          const instance = {
            exports: exported,
            components: validated.components ?? {},
            executorGeneration: definition.generation,
            revisions,
            incarnations,
            invalidate: () => {
              stale = true;
            },
            isAvailable: () => !stale,
            runs: 0,
            retired: false,
            close: closeHost,
            tools: snapshots,
            skills: source.skills.map(
              (skill) =>
                `Plugin: ${plugin.id}\nSkill: ${skill.path}\n\n${skill.text}`,
            ),
          };
          if (group) {
            staged.set(plugin.id, instance);
            groupViews.push({
              pluginId: plugin.id,
              enabled: true,
              views: [
                ...(validated.views ?? []),
                ...(validated.settings ? [validated.settings] : []),
              ],
            });
            publications.push(publish);
          } else publish();
          snapshots.forEach((tool) => names.add(tool.name));
          plugin.status = "loaded";
          if (validated.settings) plugin.settingsId = validated.settings.id;
        } catch (error) {
          factoryAvailable = false;
          closeHost();
          releases.forEach((unregister) => unregister());
          if (!valid()) return;
          if (!group) options.registry.removePlugin(plugin.id);
          plugin.status = "failed";
          plugin.error = safeError(error, "plugins.loadFailed");
        } finally {
          pendingHosts.delete(closeHost);
        }
      }
      if (valid()) {
        if (group) {
          if ([...group].some((id) => byId.get(id)?.status !== "loaded")) {
            for (const instance of staged.values()) instance.close();
            throw new Error("plugins.loadFailed");
          }
          const publishViews = options.registry.preparePluginBatch(
            group,
            groupViews,
          );
          for (const id of group) {
            const old = loaded.get(id);
            old?.invalidate();
            if (old) {
              old.retired = true;
              retired.push(() => closeWhenIdle(id, old));
            }
            loaded.delete(id);
            registrations.delete(id);
          }
          for (const publish of publications) publish();
          publishViews();
        }
        state.plugins = plugins.map((plugin) => ({ ...plugin }));
        state.status = "ready";
        state.error = null;
        if (priorActionError === actionErrorRevision) state.actionError = null;
        for (const close of retired) close();
      }
    } catch (error) {
      if (!valid()) return;
      if (group) {
        for (const instance of staged.values()) instance.close();
        if (inventoryRead) {
          inventory = previousInventory;
          state.status = "ready";
          recordActionError(error, "plugins.loadFailed");
          throw sanitizedError(error, "plugins.loadFailed");
        }
      }
      listed = false;
      for (const id of enabled.keys()) block(id);
      clearContributions();
      state.status = "failed";
      state.error = safeError(error, "plugins.loadFailed");
      throw sanitizedError(error, state.error);
    } finally {
      if (group && !valid())
        for (const instance of staged.values()) instance.close();
    }
  }
  function refresh(
    pluginId?: string,
    preserve = false,
    group?: ReadonlySet<string>,
  ): Promise<void> {
    supersede();
    const superseded = new Promise<void>((resolve) => {
      supersede = resolve;
    });
    latestReady = Promise.race([
      performRefresh(pluginId, preserve, group),
      superseded,
    ]);
    // Keep failures observable without an unhandled startup rejection.
    void latestReady.catch(() => undefined);
    return latestReady;
  }
  let disablePoll: { id: string; task: Promise<void> } | undefined;
  let disableStarting: string | undefined;
  const disableCancelIntent = new Set<string>();
  let disableSequence = 0;
  let disableApplied: string | undefined;
  const disableTargets = new Set<string>();
  const disablingPending = () =>
    state.disabling &&
    !["disabled", "cancelled", "failed"].includes(state.disabling.phase);
  function releaseDisable() {
    for (const id of disableTargets) gates.delete(id);
    disableTargets.clear();
    resuming = false;
    flushRecoveryRefresh();
  }
  async function applyDisable(snapshot: PluginDisableSnapshot) {
    if (!current() || snapshot.id !== state.disabling?.id) return;
    state.disabling = { ...state.disabling, ...snapshot, checking: false };
    if (["saving", "disabled", "cancelled", "failed"].includes(snapshot.phase))
      disableCancelIntent.delete(snapshot.id);
    if (snapshot.phase === "disabled" && disableApplied !== snapshot.id) {
      disableApplied = snapshot.id;
      ++generation;
      closePendingHosts();
      supersede();
      for (const id of disableTargets) block(id);
      try {
        await refresh(snapshot.pluginId);
      } catch {
        // Refresh retains the inventory failure for management.
      } finally {
        releaseDisable();
      }
    } else if (snapshot.phase === "cancelled" || snapshot.phase === "failed") {
      releaseDisable();
    }
  }
  async function disableRequest(request: PluginDisableRequest) {
    const sequence = ++disableSequence;
    let result: PluginDisableSnapshot;
    try {
      result = await invoke<PluginDisableSnapshot>("plugin_disable", {
        scope: options.scope,
        request,
      });
    } catch (error) {
      if (
        !current() ||
        sequence !== disableSequence ||
        state.disabling?.id !== request.id
      )
        return;
      const knownFailure =
        request.operation === "begin" &&
        [
          "native.plugins.stateBusy",
          "native.plugins.stateConflict",
          "native.plugins.stateInvalid",
          "native.plugins.invalidPath",
        ].includes(safeError(error, ""));
      state.disabling = {
        ...state.disabling,
        phase: knownFailure ? "failed" : "uncertain",
        error: safeError(error, "native.plugins.stateOutcomeUnknown"),
        checking: false,
      };
      if (knownFailure) {
        disableCancelIntent.delete(request.id);
        releaseDisable();
      } else if (
        request.operation === "begin" &&
        disableCancelIntent.has(request.id)
      )
        await disableRequest({ operation: "cancel", id: request.id });
      return;
    }
    if (sequence === disableSequence) {
      await applyDisable(result);
      if (result.phase === "waiting" && disableCancelIntent.has(result.id))
        await disableRequest({ operation: "cancel", id: result.id });
    }
  }
  function pollDisable(): Promise<void> {
    const id = state.disabling!.id;
    if (disablePoll?.id === id) return disablePoll.task;
    const pending = (async () => {
      while (
        current() &&
        state.disabling?.id === id &&
        ["waiting", "saving"].includes(state.disabling.phase)
      ) {
        await disableRequest({ operation: "status", id });
        if (
          !current() ||
          state.disabling?.id !== id ||
          !["waiting", "saving"].includes(state.disabling.phase)
        )
          break;
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, 250);
          controller.signal.addEventListener("abort", done, { once: true });
          if (controller.signal.aborted) done();
        });
      }
    })();
    const task = pending.finally(() => {
      if (disablePoll?.id === id) disablePoll = undefined;
    });
    disablePoll = { id, task };
    return task;
  }
  async function disablePlugin(pluginId: string) {
    requireCurrent();
    if (saving || quiescing || resuming || disablingPending())
      throw new Error("native.plugins.stateBusy");
    if (!listed) throw new Error("native.plugins.stateInvalid");
    const retrying = state.disabling?.phase === "failed";
    for (const id of affected([pluginId])) {
      disableTargets.add(id);
      gates.add(id);
    }
    resuming = true;
    const id = crypto.randomUUID();
    disableStarting = id;
    state.disabling = {
      id,
      pluginId,
      phase: "starting",
      runningActions: [],
      pendingRequests: 0,
      error: null,
      stopRequested: false,
      checking: false,
    };
    try {
      if (retrying) {
        const listing = await request<PluginList>({ operation: "list" });
        if (
          !current() ||
          state.disabling?.id !== id ||
          state.disabling.phase === "cancelled"
        )
          return;
        if (
          inventory &&
          JSON.stringify(listing.plugins) !== JSON.stringify(inventory.plugins)
        )
          throw new Error("native.plugins.stateConflict");
        revision = listing.revision;
      }
      if (
        !current() ||
        state.disabling?.id !== id ||
        state.disabling.phase === "cancelled"
      )
        return;
      disableStarting = undefined;
      await disableRequest({
        operation: "begin",
        id,
        pluginId,
        expectedRevision: revision,
      });
      await pollDisable();
    } catch (error) {
      if (current() && state.disabling?.id === id) {
        state.disabling = {
          ...state.disabling,
          phase: "failed",
          error: safeError(error, "plugins.saveFailed"),
        };
        disableCancelIntent.delete(id);
        releaseDisable();
      }
    }
    const result = state.disabling;
    if (
      result?.id === id &&
      (result.phase === "failed" || result.phase === "uncertain")
    )
      throw new Error(result.error ?? "plugins.saveFailed");
  }
  async function controlDisable(operation: "cancel" | "stop" | "status") {
    requireCurrent();
    const currentDisable = state.disabling;
    if (
      !currentDisable ||
      ["disabled", "cancelled", "failed"].includes(currentDisable.phase)
    )
      return;
    if (operation === "cancel" && currentDisable.phase === "starting") {
      if (disableStarting === currentDisable.id)
        await applyDisable({ ...currentDisable, phase: "cancelled" });
      else disableCancelIntent.add(currentDisable.id);
      return;
    }
    state.disabling = {
      ...currentDisable,
      stopRequested: currentDisable.stopRequested || operation === "stop",
      checking: operation === "status",
    };
    await disableRequest({ operation, id: currentDisable.id });
    if (disablingPending() && state.disabling?.phase !== "uncertain")
      void pollDisable();
  }
  async function setEnabled(pluginId: string, value: boolean): Promise<void> {
    if (!value) return disablePlugin(pluginId);
    requireCurrent();
    if (recoveryMode() === undefined)
      throw new Error("native.plugins.recoveryBlocked");
    if (saving || quiescing || resuming)
      throw new Error("native.plugins.stateBusy");
    if (!listed) throw new Error("native.plugins.stateInvalid");
    ++generation;
    closePendingHosts();
    supersede();
    resuming = true;
    saving = true;
    try {
      try {
        const result = await request<{ revision: string }>({
          operation: "setEnabled",
          pluginId,
          enabled: true,
          expectedRevision: revision,
        });
        if (!current()) return;
        revision = result.revision;
      } catch (error) {
        listed = false;
        block(pluginId);
        if (current()) {
          recordActionError(error, "plugins.saveFailed");
        }
        throw sanitizedError(error, "plugins.saveFailed");
      } finally {
        saving = false;
      }
      if (current()) {
        if (recoveryMode() === true)
          await resumePlugins(options.scope, pluginId);
        await refresh(pluginId);
      }
    } finally {
      resuming = false;
      flushRecoveryRefresh();
    }
  }
  async function synchronizeInventory() {
    requireCurrent();
    if (
      synchronizing ||
      saving ||
      quiescing ||
      resuming ||
      state.status === "loading"
    )
      return;
    synchronizing = true;
    const turn = generation;
    try {
      const result = await request<PluginList>({ operation: "list" });
      if (!current() || turn !== generation || saving || quiescing || resuming)
        return;
      if (
        !listed ||
        state.status === "failed" ||
        state.actionError !== null ||
        JSON.stringify(result) !== JSON.stringify(inventory)
      )
        await refresh(undefined, true);
    } catch (cause) {
      if (current() && turn === generation) {
        for (const id of loaded.keys()) block(id);
        listed = false;
        state.status = "failed";
        state.error = safeError(cause, "plugins.loadFailed");
      }
      throw sanitizedError(cause, "plugins.loadFailed");
    } finally {
      synchronizing = false;
    }
  }
  function uninstallOutcomeUnknown(pluginId: string) {
    const plugin = state.plugins.find((plugin) => plugin.id === pluginId);
    return (
      !!plugin &&
      uncertainRemovals.has(pluginId) &&
      uncertainRemovals.get(pluginId) === plugin.incarnation
    );
  }
  async function uninstall(pluginId: string): Promise<void> {
    requireCurrent();
    if (uninstallOutcomeUnknown(pluginId))
      throw new Error("native.plugins.stateOutcomeUnknown");
    if (saving || quiescing || resuming || state.status === "loading")
      throw new Error("native.plugins.stateBusy");
    if (!listed || !state.plugins.some((plugin) => plugin.id === pluginId))
      throw new Error("native.plugins.stateConflict");
    if ([...affected([pluginId])].some((id) => id !== pluginId))
      throw new Error("native.plugins.stateConflict");
    if ((activeActions.get(pluginId) ?? 0) > 0)
      throw new Error("native.plugins.stateBusy");
    const incarnation = state.plugins.find(
      (plugin) => plugin.id === pluginId,
    )?.incarnation;
    saving = true;
    gates.add(pluginId);
    let failure: Error | undefined;
    try {
      const result = await request<{ revision: string | null }>({
        operation: "uninstall",
        pluginId,
        expectedRevision: revision,
      });
      if (current()) revision = result.revision;
    } catch (cause) {
      failure = sanitizedError(cause, "plugins.saveFailed");
      if (
        !["native.plugins.stateBusy", "native.plugins.stateConflict"].includes(
          failure.message,
        )
      )
        uncertainRemovals.set(pluginId, incarnation);
      if (failure.message === "native.plugins.stateOutcomeUnknown")
        block(pluginId);
    } finally {
      saving = false;
      gates.delete(pluginId);
      flushRecoveryRefresh();
    }
    if (current()) {
      try {
        await refresh(undefined, true);
      } catch (cause) {
        failure ??= sanitizedError(cause, "plugins.loadFailed");
      }
    }
    if (failure) throw failure;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    ++generation;
    supersede();
    controller.abort();
    persistence.dispose();
    stopUpdates?.();
    stopRecovery();
    closePendingHosts();
    clearContributions();
    for (const close of contributionCleanups) close();
    if (
      state.disabling &&
      ["starting", "waiting"].includes(state.disabling.phase)
    )
      void invoke("plugin_disable", {
        scope: options.scope,
        request: { operation: "cancel", id: state.disabling.id },
      }).catch(() => undefined);
    disableCancelIntent.clear();
    state.status = "disposed";
  }
  function getToolDescriptors(): PluginToolDescriptor[] {
    if (!current() || saving || state.status !== "ready") return [];
    return [...loaded.entries()]
      .filter(
        ([id]) =>
          enabled.get(id) === true && executable(id) && !disableTargets.has(id),
      )
      .flatMap(([, instance]) =>
        instance.tools.map((tool) => structuredClone(tool)),
      );
  }
  function flushRecoveryRefresh() {
    if (
      !recoveryRefreshPending ||
      quiescing ||
      saving ||
      resuming ||
      !current()
    )
      return;
    recoveryRefreshPending = false;
    if (
      state.plugins.some(
        (plugin) =>
          plugin.enabled &&
          executable(plugin.id) &&
          plugin.status === "suppressed",
      )
    )
      void refresh(undefined, true).catch(() => undefined);
  }
  const stopRecovery = watch(recoveryRevision, () => {
    for (const id of loaded.keys()) if (!executable(id)) block(id);
    recoveryRefreshPending = true;
    flushRecoveryRefresh();
  });
  void refresh();
  return {
    state: readonly(state),
    get ready() {
      return latestReady;
    },
    initialize: () => latestReady,
    refresh: (pluginId?: string, preserve = false) => {
      if (quiescing || saving || resuming)
        return Promise.reject(new Error("native.plugins.stateBusy"));
      return refresh(pluginId, preserve);
    },
    setEnabled,
    dismissActionError: () => {
      state.actionError = null;
    },
    uninstall,
    uninstallOutcomeUnknown,
    synchronizeInventory,
    runningActions: (pluginId: string) => activeActions.get(pluginId) ?? 0,
    cancelDisable: () => controlDisable("cancel"),
    stopDisabling: () => controlDisable("stop"),
    checkDisableStatus: () => controlDisable("status"),
    get hasRunningProcesses() {
      return [...activeActions.values()].some((count) => count > 0);
    },
    affectedPluginIds: (pluginId: string) => [...affected([pluginId])],
    withQuiescent,
    refreshGroup(ids: readonly string[]) {
      const group = affected(ids);
      if (quiescing) {
        if ([...group].some((id) => !gates.has(id)))
          return Promise.reject(new Error("native.plugins.stateBusy"));
        return refresh(undefined, true, group);
      }
      return withQuiescent([...group], () => refresh(undefined, true, group));
    },
    async resume(pluginId?: string) {
      requireCurrent();
      if (saving || quiescing || resuming)
        throw new Error("native.plugins.stateBusy");
      resuming = true;
      try {
        await resumePlugins(options.scope, pluginId);
        await refresh(undefined, true);
      } finally {
        resuming = false;
        flushRecoveryRefresh();
      }
    },
    dispose,
    getToolDescriptors,
  };
}
export type PluginRuntime = ReturnType<typeof createPluginRuntime>;
