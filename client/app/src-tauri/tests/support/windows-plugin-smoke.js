window.runWindowsPluginSmoke = async () => {
  const { invoke, wait } = window.nativeSmokeWait;
  const { current } = await invoke("workspace_snapshot");
  if (!current?.id) throw new Error("No workspace for the plugin fixture");
  const scope = current.id;
  const pluginId = "native-check";
  const conversation = crypto.randomUUID();
  const created = await invoke("plugin_development_create", {
    scope,
    request: {
      developmentId: conversation,
      pluginId,
      title: "Synthetic plugin development",
    },
  });
  const retained = await invoke("plugin_development_status", {
    scope,
    conversation,
  });
  if (
    !created.ready ||
    retained.conversation?.development?.pluginId !== pluginId
  )
    throw new Error("Development conversation was not retained");

  const source = (request) =>
    invoke("smoke_plugin_source_request", {
      scope,
      request: { pluginId, ...request },
    });
  await source({ operation: "create" });
  for (const [path, text] of [
    [
      "plugin.json",
      JSON.stringify({
        schemaVersion: 2,
        id: pluginId,
        name: "Synthetic plugin",
        description: "Return a fixed synthetic value.",
        serviceEntry: "service.js",
        exports: ["answer", "writeWithProcess"],
      }),
    ],
    [
      "service.js",
      `export default () => ({exports:{
        answer: () => 42,
        async writeWithProcess(_args, host) {
          const shell = await host.process.capability();
          if (!shell.available || shell.interpreterDialect !== 'windowsPowerShell')
            throw new Error('Windows PowerShell is unavailable');
          const reply = await host.process.run({
            executable: shell.interpreter,
            args: [...shell.interpreterArgs,
              "$ErrorActionPreference = 'Stop'; [IO.File]::WriteAllText((Join-Path $PWD 'process.md'), 'Written by PowerShell'); [Console]::Out.Write('done')"],
            timeoutMs: 15000,
          });
          if (reply.isError) return reply;
          return { ...reply, text: (await host.files.read('process.md')).text };
        },
      }});`,
    ],
  ])
    await source({ operation: "write", path, text, expectedRevision: null });
  const validated = await invoke("plugins_source", {
    scope,
    request: { operation: "validate", pluginId },
  });
  if (validated.manifest?.id !== pluginId)
    throw new Error("Plugin source did not validate");

  await wait(
    () => window.nativePluginChecks,
    "Native check bridge unavailable",
  );
  const checks = await window.nativePluginChecks({
    scope,
    conversation,
    runId: crypto.randomUUID(),
  });
  const checked = await checks.check(crypto.randomUUID(), {
    changes: [{ pluginId }],
    checks: [
      {
        pluginId,
        script: "assert.equal(await plugin.invokeExport('answer', {}), 42);",
      },
    ],
  });
  if (!checked.passed || !checked.checkId)
    throw new Error("Plugin Worker check failed");
  const activated = await checks.activate(crypto.randomUUID(), checked.checkId);
  if (!activated.activated || activated.followUpError)
    throw new Error("Plugin activation failed");
  const service = await window.nativePluginService(scope, pluginId);
  if ((await service.invoke("answer", {})) !== 42)
    throw new Error("Active plugin returned an unexpected result");
  const process = await service
    .invoke("writeWithProcess", {})
    .catch((error) => {
      throw new Error(`Plugin process export failed: ${String(error)}`);
    });
  const result = process.commandResult?.Ok;
  if (
    process.isError ||
    result?.outcome !== "exited" ||
    result.exitCode !== 0 ||
    result.stdout.text !== "done" ||
    process.text !== "Written by PowerShell" ||
    !process.beforeHistoryRevision ||
    !process.afterHistoryRevision ||
    process.beforeHistoryRevision === process.afterHistoryRevision
  )
    throw new Error(
      `Plugin process did not reconcile its write: ${JSON.stringify(process)}`,
    );
};
