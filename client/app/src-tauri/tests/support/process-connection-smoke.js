/* global fixture, scope, assignment, checkChanges, sourceWrite, sourceRequest, activateGroup, assertPublished, require, invoke, wait, onClosing */
const ids = ["process-connection", "process-consumer"];
const stdout = '{"count":3,"source":"offline"}\n';
const expected = { count: 3, source: "offline" };
const request = fixture.processRequest;
const holdRequest = fixture.processHoldRequest;
const provider = fixture.processConnection
  .replace('JSON.parse("PROCESS_REQUEST")', JSON.stringify(request))
  .replace('JSON.parse("PROCESS_HOLD_REQUEST")', JSON.stringify(holdRequest));
const lifecycle = (action) =>
  invoke(
    "smoke_plugin_process_lifecycle",
    { scope, action },
    { timeout: 3000 },
  );
for (const [index, id] of ids.entries()) {
  await sourceRequest({
    operation: "create",
    pluginId: id,
  });
  await sourceWrite(
    assignment,
    id,
    "plugin.json",
    JSON.stringify({
      schemaVersion: 2,
      id,
      name: id,
      description: "Offline process data",
      serviceEntry: "service.js",
      platforms: ["macos"],
      ...(index === 0
        ? { kind: "connection", exports: ["read", "hold"] }
        : { kind: "tool", exports: ["read", "hold"], dependencies: [ids[0]] }),
    }),
    true,
  );
  await sourceWrite(
    assignment,
    id,
    "service.js",
    index === 0 ? provider : fixture.processConsumer,
    true,
  );
}
async function verify(version) {
  await invoke("smoke_plugin_check_verify", { scope, version, enabled: false });
  await lifecycle("absent");
}
const history = () =>
  invoke("files_request", {
    request: { workspaceId: scope, operation: "history", path: "" },
  });
const processFixture = {
  executable: "/bin/sh",
  args: [...request.args],
  exitCode: 0,
  stdout,
  stderr: "",
};
function checks() {
  return ids.map((pluginId, index) => ({
    pluginId,
    timeoutMs: 30000,
    processes:
      index === 0
        ? [
            processFixture,
            {
              executable: holdRequest.executable,
              args: holdRequest.args,
              exitCode: 0,
              stdout: "",
              stderr: "",
            },
          ]
        : [],
    script: `
      const result = await ${index === 0 ? "plugin.invokeExport('read',{})" : "plugin.invokeTool('read',{}).then(result=>result.details)"};
      assert.equal(result.value, {count:3,source:'offline'});
      assert.equal(result.capability.implementation, 'syntheticProcess');
      assert.equal(result.reply.commandResult.Ok.stdout.text, ${JSON.stringify(stdout)});
      assert.equal(result.reply.commandResult.Ok.stderr.text, '');
      assert.equal(result.reply.commandResult.Ok.exitCode, 0);
      assert.equal(result.reply.beforeHistoryRevision, null);
      assert.equal(result.reply.afterHistoryRevision, null);
      const held = await ${index === 0 ? "plugin.invokeExport('hold',{})" : "plugin.invokeTool('hold',{}).then(result=>result.details)"};
      assert.equal(held.reply.commandResult.Ok.exitCode, 0);
      assert.equal(held.reply.beforeHistoryRevision, null);
    `,
  }));
}
const changes = ids.map((pluginId) => ({ pluginId }));
await verify("process-absent");
for (const kind of ["missing", "unmatched", "consumer-only"]) {
  const entries = checks();
  entries[0].processes =
    kind === "unmatched"
      ? [{ ...processFixture, args: [...request.args, "not-the-same-argv"] }]
      : [];
  if (kind === "missing") delete entries[0].processes;
  if (kind === "consumer-only") entries[1].processes = [processFixture];
  const failed = await checkChanges(
    assignment,
    {
      changes,
      checks: entries,
    },
    { allowError: true },
  );
  require(failed.passed ===
    false, `${kind} process fixture did not fail closed`);
  require(failed.results?.length === 2 &&
    failed.results.every(
      (result) => result.passed === false,
    ), `${kind} fixture crossed plugin boundaries`);
  try {
    const activation = await activateGroup(assignment, failed, true);
    require(!activation.activated, "Failed process check allowed activation");
  } catch (error) {
    require(String(error).includes(
      "native.plugins.checkInvalid",
    ), "Unexpected process activation rejection");
  }
  const installed = await invoke("plugin_runtime", {
    scope,
    request: { operation: "list" },
  });
  require(installed.plugins
    .filter((plugin) => ids.includes(plugin.id))
    .every(
      (plugin) => !plugin.enabled,
    ), "Failed process group partially enabled");
  await verify("process-absent");
}
const checked = await checkChanges(assignment, {
  changes,
  checks: checks(),
});
require(checked.results?.length === 2 &&
  checked.results.every(
    (result) => result.passed,
  ), "Matching process fixtures did not pass");
await verify("process-absent");
await assertPublished(await activateGroup(assignment, checked));
await verify("process-absent");
const before = JSON.stringify(await history());
async function start(controller = new AbortController(), name = "read") {
  const service = await window.nativePluginService(scope, ids[1]);
  const settled = service.invoke(name, {}, controller.signal).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  return { service, controller, settled };
}
const preCancelled = new AbortController();
preCancelled.abort();
const cancelled = await start(preCancelled);
{
  const result = await cancelled.settled;
  require(result.error ||
    result.value?.isError, "Cancelled process returned success");
  await verify("process-absent");
  require(JSON.stringify(await history()) ===
    before, "Cancelled process changed workspace history");
}
const direct = await start();
{
  let finished = false;
  direct.settled.then(() => {
    finished = true;
  });
  await wait(() => {
    require(!document.querySelector(
      "dialog[open] pre",
    ), "Command execution requested confirmation");
    return finished;
  }, "Direct process execution did not finish");
  const result = await direct.settled;
  require(!result.error && !result.value?.isError, "Process consumer failed");
  const { capability, reply, value } = result.value.details;
  require(capability.available &&
    capability.platform === "macos" &&
    capability.requiresPathBackedWorkspace, "Native process capability differs");
  require(JSON.stringify(value) ===
    JSON.stringify(
      expected,
    ), "Actual process JSON differs from independent expectations");
  const command = reply.commandResult.Ok;
  require(!reply.isError &&
    command?.outcome === "exited" &&
    command.exitCode === 0 &&
    command.signal === null, "Actual process status differs");
  for (const [stream, text] of [
    [command.stdout, stdout],
    [command.stderr, ""],
  ]) {
    require(stream.text === text &&
      stream.capturedBytes === text.length &&
      stream.totalBytes === text.length &&
      !stream.truncated &&
      !stream.incomplete, "Actual process output differs");
  }
  require(reply.beforeHistoryRevision &&
    reply.afterHistoryRevision &&
    reply.beforeHistoryRevision !== reply.afterHistoryRevision &&
    reply.reconciliationError === null &&
    reply.attribution ===
      "uncertainExternalChangesMayCoexist", "Process history reconciliation differs");
  await verify("process-executed");
  const recorded = await invoke("change_revision", {
    scope,
    path: "process-result.md",
    revision: reply.afterHistoryRevision,
  });
  require(recorded.status === "available" &&
    recorded.text ===
      "# Process result\nOwned offline fixture.\n", "Process result missing from its recorded history revision");
}
await invoke("smoke_progress", {
  stage: "process-connection-offline-qualified",
});

const holding = await start(new AbortController(), "hold");
await wait(
  async () => (await lifecycle("running")).started,
  "Owned process did not write its start sentinel",
  { timeout: 5000 },
);
const prepared = await invoke("ai_prepare_close", { scope }, { timeout: 3000 });
require(prepared.processes, "Close preparation did not observe the running process");
await invoke("ai_cancel_close", { scope }, { timeout: 3000 });
require((await lifecycle("running"))
  .started, "Cancel close stopped the process");
await lifecycle("quit-blocked");
async function closeDialog() {
  document.querySelector("button.workspace-menu").click();
  await wait(
    () => document.querySelector("button.workspace-menu[aria-expanded=true]"),
    "Workspace menu did not open",
  );
  document.querySelector(".workspace-close button").click();
  let found;
  await wait(
    () =>
      (found = document.querySelector(
        'dialog[open][aria-labelledby="close-ai-title"]',
      )),
    "Running-process close dialog unavailable",
    { timeout: 3000 },
  );
  return found;
}
(await closeDialog()).querySelectorAll("button")[0].click();
await wait(
  () =>
    !document.querySelector('dialog[open][aria-labelledby="close-ai-title"]'),
  "Cancel did not dismiss the close dialog",
);
require((await lifecycle("running"))
  .started, "Cancelling the close dialog stopped the process");
let settled = false;
holding.settled.then(() => {
  settled = true;
});
await Promise.resolve();
require(!settled, "The long process finished before explicit Abort");
const abortDialog = await closeDialog();
require((await lifecycle("arm-close"))
  .armed, "Native close verification was not armed");
abortDialog.querySelectorAll("button")[1].click();
onClosing();
