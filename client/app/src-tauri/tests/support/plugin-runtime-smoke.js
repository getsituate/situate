window.runPluginRuntimeSmoke = async () => {
  const { invoke, wait } = window.nativeSmokeWait;
  const phase = await invoke("smoke_phase");
  if (!phase.pluginDrafts) return;
  const { current } = await invoke("workspace_snapshot");
  const request = (request) =>
    invoke("plugin_runtime", { scope: current.id, request });
  if (!phase.restart) {
    await invoke("smoke_plugin_runtime_source", { scope: current.id });
    let error;
    try {
      await request({ operation: "load", pluginId: "native-counter" });
    } catch (caught) {
      error = String(caught);
    }
    if (
      error !== "native.plugins.recoveryBlocked" ||
      window.nativePluginInitializations
    ) {
      throw new Error("Recovery allowed an enabled plugin to execute");
    }
    await invoke("smoke_progress", { stage: "plugin-runtime-suppressed" });
    return;
  }
  await wait(
    () => window.nativePluginOpen,
    "The enabled plugin UI did not load",
  );
  await wait(async () => {
    try {
      return await window.nativePluginOpen("native-counter:counter");
    } catch (error) {
      if (String(error).includes("layoutHost.viewUnavailable")) return false;
      throw error;
    }
  }, "The plugin view was not registered");
  const counter = () =>
    document.querySelector('[data-native-plugin="counter"]');
  await wait(counter, "The plugin counter did not mount");
  if (counter().querySelector("output").textContent !== "0")
    throw new Error("The plugin counter did not initialize independently");
  counter().querySelector("button").click();
  await wait(
    () => counter()?.querySelector("output").textContent === "1",
    "The compiled plugin template did not react to interaction",
  );
  await window.nativePluginOpen("native-counter:settings");
  await wait(
    () => document.querySelector('[data-native-plugin="settings"]'),
    "Plugin settings did not mount",
  );
  await window.nativePluginOpen("native-counter:counter");
  await wait(
    () => counter()?.querySelector("output").textContent === "1",
    "Navigation discarded workspace plugin state",
  );
  if (window.nativePluginInitializations !== 1)
    throw new Error("View navigation reinitialized the plugin");
  let listing = await request({ operation: "list" });
  if (
    !listing.plugins.some(
      (plugin) => plugin.id === "native-counter" && plugin.enabled,
    ) ||
    !listing.plugins.some(
      (plugin) => plugin.id === "native-review" && !plugin.enabled,
    )
  ) {
    throw new Error("Plugin enabled state was not retained independently");
  }
  const runtime = await window.nativePluginRuntime(current.id);
  async function unavailableInitializers() {
    const pending = [];
    async function bounded(operation, milliseconds, message) {
      let timer;
      const work = Promise.resolve().then(operation);
      pending.push(work);
      try {
        return await Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), milliseconds);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    const fixture = (operation) =>
      invoke("smoke_plugin_runtime_source", { scope: current.id, operation });
    const snapshot = (milliseconds) =>
      bounded(
        () =>
          invoke(
            "plugin_executor",
            {
              scope: current.id,
              request: { operation: "snapshot" },
            },
            { timeout: milliseconds },
          ),
        milliseconds,
        "Unavailable service initialization blocked the native snapshot",
      );
    function healthy(snapshot) {
      const service = snapshot.plugins.find(
        (plugin) => plugin.pluginId === "native-counter",
      );
      if (
        !service ||
        service.tools.length !== 1 ||
        !service.exports.includes("readCount")
      )
        throw new Error("A failed initializer hid the healthy native service");
      return service;
    }
    function warning(snapshot, id) {
      if (snapshot.plugins.some((plugin) => plugin.pluginId === id))
        throw new Error(
          "An unavailable initializer returned a healthy descriptor",
        );
      const row = snapshot.unavailable?.find(
        (plugin) => plugin.pluginId === id,
      );
      if (
        !row ||
        row.reason !== "initializationUnavailable" ||
        typeof row.pluginName !== "string" ||
        typeof row.error !== "string" ||
        (row.incarnation !== undefined && typeof row.incarnation !== "string")
      )
        throw new Error("The native initialization warning was missing");
      return row;
    }
    async function read(service) {
      const result = await bounded(
        () =>
          invoke("plugin_executor", {
            scope: current.id,
            request: {
              operation: "invoke",
              pluginId: service.pluginId,
              exportName: "readCount",
              args: {},
              generation: service.generation,
            },
          }),
        5000,
        "A failed initializer blocked a healthy native export",
      );
      if (result.outcome !== "completed" || result.value !== 1)
        throw new Error("The healthy native export lost its retained state");
    }
    await invoke("smoke_progress", {
      stage: "plugin-runtime-initialization-start",
    });
    try {
      await fixture("prepareFailedInitializer");
      const first = await snapshot(15000);
      const failure = warning(first, "native-failing-init");
      if (failure.error !== "plugins.checkFailed")
        throw new Error(
          "The throwing service did not report its initial failure",
        );
      const initial = healthy(first);
      await read(initial);
      await fixture("prepareHungInitializer");
      const timedOut = await snapshot(45000);
      const hung = warning(timedOut, "native-hung-init");
      if (
        JSON.stringify(warning(timedOut, "native-failing-init")) !==
        JSON.stringify(failure)
      )
        throw new Error(
          "An unchanged throwing initializer was evaluated again",
        );
      await read(healthy(timedOut));
      const cached = await snapshot(2000);
      if (
        JSON.stringify(warning(cached, "native-failing-init")) !==
          JSON.stringify(failure) ||
        JSON.stringify(warning(cached, "native-hung-init")) !==
          JSON.stringify(hung) ||
        healthy(cached).generation !== initial.generation
      )
        throw new Error(
          "Repeated capture restarted a failed or healthy generation",
        );
      await read(healthy(cached));
    } finally {
      await bounded(
        () =>
          invoke("plugin_executor", {
            scope: current.id,
            request: { operation: "stop" },
          }),
        5000,
        "Initialization workers did not stop",
      );
      const outstanding = pending.slice();
      await bounded(
        () => Promise.allSettled(outstanding),
        5000,
        "Initialization requests did not settle after native stop",
      );
      await fixture("clearFailedInitializers");
    }
    await invoke("smoke_progress", {
      stage: "plugin-runtime-initialization-complete",
    });
  }
  await unavailableInitializers();
  await runtime.refresh();
  listing = await request({ operation: "list" });
  async function disableHeldRoot(stop) {
    const service = await window.nativePluginService(
      current.id,
      "native-counter",
    );
    if (service.descriptor.tools.length !== 1)
      throw new Error("The native counter tool was unavailable");
    let work, disabling;
    let workSettled = false,
      workErrorCode,
      lastDisable;
    const safeCode = (error) => {
      const code = typeof error === "string" ? error : error?.message;
      return typeof code === "string" &&
        /^(native|plugins)\.[A-Za-z0-9.]{1,150}$/.test(code)
        ? code
        : undefined;
    };
    try {
      work = service.invoke(stop ? "hang" : "hold", {}).then(
        () => ({ completed: true }),
        (error) => ({ completed: false, error }),
      );
      void work.then((result) => {
        workSettled = true;
        workErrorCode = safeCode(result.error);
      });
      await wait(
        async () =>
          (
            await invoke("plugin_executor", {
              scope: current.id,
              request: { operation: "activity" },
            })
          ).runningActions > 0,
        "The native service invocation did not start",
      );
      disabling = runtime.setEnabled("native-counter", false);
      void disabling.catch(() => undefined);
      try {
        await wait(async () => {
          const pending = runtime.state.disabling;
          if (pending?.phase !== "waiting") return false;
          const snapshot = await invoke("plugin_disable", {
            scope: current.id,
            request: { operation: "status", id: pending.id },
          });
          lastDisable = snapshot;
          return (
            snapshot.phase === "waiting" &&
            snapshot.runningActions.some(
              (action) =>
                action.pluginId === "native-counter" && action.count >= 1,
            )
          );
        }, "Disabling did not wait for the actual native service");
      } catch (error) {
        const currentListing = await request({ operation: "list" });
        throw new Error(
          `${String(error)} ${JSON.stringify({
            frontendPhase: runtime.state.disabling?.phase,
            frontendError: safeCode(runtime.state.disabling?.error),
            backendPhase: lastDisable?.phase,
            backendError: safeCode(lastDisable?.error),
            rootCounts: lastDisable?.runningActions
              ?.filter((action) => action.pluginId === "native-counter")
              .map((action) => action.count),
            workSettled,
            workErrorCode,
            listingRevisionMatchesOriginal:
              currentListing.revision === listing.revision,
          })}`,
          { cause: error },
        );
      }
      if (stop) await runtime.stopDisabling();
      else {
        await runtime.cancelDisable();
        if (runtime.state.disabling?.phase !== "cancelled")
          throw new Error("Cancelling disabling was not acknowledged");
        let settled = false;
        work.then(() => {
          settled = true;
        });
        await Promise.resolve();
        if (settled)
          throw new Error("Cancelling disabling stopped native work");
        await service.invoke("release", {});
      }
      const [result] = await Promise.all([work, disabling]);
      if (stop ? result.completed : !result.completed)
        throw new Error("The native invocation returned an unexpected outcome");
      const durable = await request({ operation: "list" });
      const enabled = durable.plugins.find(
        (plugin) => plugin.id === "native-counter",
      )?.enabled;
      if (stop) {
        const activity = await invoke("plugin_executor", {
          scope: current.id,
          request: { operation: "activity" },
        });
        if (
          enabled !== false ||
          activity.runningActions !== 0 ||
          runtime.state.disabling?.phase !== "disabled"
        )
          throw new Error(
            "Stopping a hung worker did not drain and durably disable it",
          );
      } else if (enabled !== true || durable.revision !== listing.revision)
        throw new Error("Cancelled disabling changed durable plugin state");
    } finally {
      if (["starting", "waiting"].includes(runtime.state.disabling?.phase))
        await runtime.cancelDisable().catch(() => undefined);
      await invoke("plugin_executor", {
        scope: current.id,
        request: { operation: "stop" },
      });
      await Promise.allSettled([work, disabling]);
    }
  }
  await disableHeldRoot(false);
  await disableHeldRoot(true);
  await runtime.setEnabled("native-counter", true);
  const restored = await request({ operation: "list" });
  if (
    !restored.plugins.some(
      (plugin) => plugin.id === "native-counter" && plugin.enabled,
    ) ||
    runtime.state.plugins.find((plugin) => plugin.id === "native-counter")
      ?.status !== "loaded"
  )
    throw new Error("Re-enabling did not restore the counter runtime");
  const original = listing.plugins.find(
    (plugin) => plugin.id === "native-counter",
  );
  const fixture = (operation) =>
    invoke("smoke_plugin_runtime_source", {
      scope: current.id,
      operation,
    });
  await fixture("remove");
  await wait(
    async () =>
      !(await request({ operation: "list" })).plugins.some(
        (plugin) => plugin.id === "native-counter",
      ) && !counter(),
    "External plugin removal did not reach the live runtime",
  );
  const management = () => document.querySelector(".plugins-action");
  await wait(management, "Plugin management action is unavailable");
  management().click();
  const card = () =>
    document.querySelector('[data-plugin-id="native-counter"]');
  await wait(
    () => document.querySelector('[data-plugin-id="native-review"]'),
    "Plugin management did not open",
  );
  if (card()) throw new Error("External removal left an installed plugin card");
  await fixture("reinstall");
  await wait(card, "The fresh installation did not appear");
  await wait(async () => {
    const fresh = (await request({ operation: "list" })).plugins.find(
      (plugin) => plugin.id === "native-counter",
    );
    return fresh?.incarnation && fresh.incarnation !== original.incarnation;
  }, "Reinstallation reused the removed plugin identity");
  const settings = await wait(() => {
    const action = card()?.querySelector(".plugin-row-links .plugin-text");
    return action && !action.disabled ? action : null;
  }, "The fresh plugin settings action is unavailable");
  settings.click();
  await wait(
    () => document.querySelector('[data-native-plugin="settings"]'),
    "The fresh plugin settings did not open",
  );
  await wait(async () => {
    try {
      return await window.nativePluginOpen("native-counter:counter");
    } catch (error) {
      if (String(error).includes("layoutHost.viewUnavailable")) return false;
      throw error;
    }
  }, "The fresh plugin view was not registered");
  await wait(
    () => counter()?.querySelector("output").textContent === "0",
    "The fresh installation inherited the old counter state",
  );
  management().click();
  await wait(card, "Plugin management did not show the fresh installation");
  card().querySelector('[data-action="more"]').click();
  await wait(
    () => document.querySelector('[role="menuitem"]'),
    "The plugin menu did not open",
  );
  document.querySelector('[role="menuitem"]').click();
  const confirm = () =>
    document.querySelector(
      ".plugin-uninstall-dialog[open] .situate-button--danger",
    );
  await wait(confirm, "The uninstall confirmation did not open");
  if (confirm().disabled)
    throw new Error("The idle plugin could not be uninstalled");
  confirm().click();
  await wait(
    () => !card() && !document.querySelector(".plugin-uninstall-dialog[open]"),
    "Uninstall did not remove the installed plugin card",
  );
  await fixture("assertAbsent");
  await invoke("smoke_progress", { stage: "plugin-runtime-interacted" });
};
