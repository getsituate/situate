/* global fixture, scope, assignment, checkChanges, sourceWrite, sourceRequest, activateGroup, assertPublished, list, require, denied, invoke */
const ids = [
  "public-repositories",
  "workspace-brief",
  "repository-reader-a",
  "repository-reader-b",
];
const repos = ["octocat/Hello-World", "rust-lang/rust"];
const brief = "# Public repository brief\nSynthetic workspace note.\n";
const shapes = repos.map((full_name) => ({
  full_name,
  private: false,
  html_url: `https://github.com/${full_name}`,
  default_branch: full_name.startsWith("octocat/") ? "master" : "main",
}));
const responses = Object.fromEntries(
  shapes.map((repo) => [
    `GET https://api.github.com/repos/${repo.full_name}`,
    { status: 200, body: JSON.stringify(repo) },
  ]),
);
const manifests = ids.map((id, index) => ({
  schemaVersion: 2,
  id,
  name: id,
  description: "Public read-only repository brief",
  serviceEntry: "service.js",
  platforms: ["macos"],
  ...(index < 2
    ? {
        kind: "connection",
        exports: index === 0 ? ["read", "configure"] : ["read", "write"],
      }
    : {
        kind: "tool",
        exports: ["read", "select"],
        uiEntry: "ui.js",
        dependencies: ids.slice(0, 2),
      }),
}));
const sources = [
  fixture.publicRepositoryConnection,
  fixture.publicRepositoryFiles,
  ...ids
    .slice(2)
    .map((id) =>
      fixture.publicRepositoryConsumer.replaceAll("CONSUMER_ID", id),
    ),
];
sources[2] = sources[2].replace(
  "const read = async (_args, host) => {",
  "const read = async (_args, host) => {\n    if (_args.undeclaredDependency) return host.dependencies.invoke('repository-reader-b', 'read', {});",
);
require(sources[2].includes(
  "if (_args.undeclaredDependency)",
), "Consumer dependency probe is unavailable");
for (let index = 0; index < ids.length; index++) {
  await sourceRequest({
    operation: "create",
    pluginId: ids[index],
  });
  await sourceWrite(
    assignment,
    ids[index],
    "plugin.json",
    JSON.stringify(manifests[index]),
    true,
  );
  await sourceWrite(assignment, ids[index], "service.js", sources[index], true);
  if (index > 1)
    await sourceWrite(
      assignment,
      ids[index],
      "ui.js",
      fixture.publicRepositoryUi.replaceAll("CONSUMER_ID", ids[index]),
      true,
    );
}
function checks(failConsumer = false) {
  return ids.map((pluginId, index) => ({
    pluginId,
    timeoutMs: 30000,
    fixtures: {
      files: index === 1 ? { "repository-brief.md": brief } : {},
      config:
        index === 0
          ? { "sources.json": JSON.stringify(repos) }
          : index > 1
            ? { "selection.json": JSON.stringify([repos[index - 2]]) }
            : {},
    },
    responses: index === 0 ? responses : {},
    script:
      index === 0
        ? `
      const selected = ${JSON.stringify(repos)};
      assert.equal((await plugin.invokeExport('read',{sources:[selected[0]]}))[0].fullName, 'octocat/Hello-World');
      async function rejects(action, reason) { let message=''; try {await action();} catch(error) {message=String(error);} assert.ok(message.includes(reason)); }
      let file=await host.config.read('sources.json');
      await rejects(()=>plugin.invokeTool('configure',{sources:['tauri-apps/tauri'],expectedRevision:'stale-revision'}),'configuration-save-unconfirmed');
      assert.equal((await host.config.read('sources.json')).text,file.text);
      await host.config.write('sources.json','[]',file.revision);
      await rejects(()=>plugin.invokeExport('read',{sources:[selected[0]]}),'not-configured');
      file=await host.config.read('sources.json');
      await host.config.write('sources.json',JSON.stringify([...selected,'synthetic/missing']),file.revision);
      await rejects(()=>plugin.invokeExport('read',{sources:['unselected/repository']}),'source-not-selected');
      await rejects(()=>plugin.invokeExport('read',{sources:['synthetic/missing']}),'native.plugins');
      file=await host.config.read('sources.json');
      await host.config.write('sources.json',JSON.stringify(selected),file.revision);
    `
        : index === 1
          ? `assert.equal(await plugin.invokeExport('read',{}),${JSON.stringify(brief)});`
          : `
      const before = (await host.config.read('selection.json')).text;
      const result = await plugin.invokeTool('read',{});
      assert.equal(result.details.repositories.map(repo=>repo.fullName),[${JSON.stringify(repos[index - 2])}]);
      assert.equal(result.details.note,${JSON.stringify(brief)});
      let rejected=false;
      try {await plugin.invokeTool('select',{sources:['tauri-apps/tauri'],expectedRevision:'stale-revision'});}catch(error){rejected=String(error).includes('configuration-save-unconfirmed');}
      assert.ok(rejected);
      assert.equal((await host.config.read('selection.json')).text,before);
      await preview.open({viewId:'${pluginId}:brief'});
      assert.equal((await preview.step({action:'read',selector:'output'})),'No repository data loaded.');
      await preview.step({action:'click',selector:'button'});
      let displayed;
      for(let attempt=0;attempt<100 && !displayed;attempt++){
        try {displayed=JSON.parse((await preview.step({action:'read',selector:'output'})));}catch{}
        if(!displayed)await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.equal(displayed?.repositories?.map(repo=>repo.fullName),[${JSON.stringify(repos[index - 2])}]);
      assert.equal(displayed?.note,${JSON.stringify(brief)});
      ${failConsumer && index === 3 ? "assert.ok(false,'repository-reader-b incompatible interface');" : ""}
    `,
  }));
}
const changes = ids.map((pluginId) => ({ pluginId }));
const checkGroup = (entries, allowError = false) =>
  checkChanges(assignment, { changes, checks: entries }, { allowError });
const failed = await checkGroup(checks(true), true);
require(failed.passed === false &&
  ids
    .slice(0, 3)
    .every(
      (id) =>
        failed.results?.find((item) => item.pluginId === id)?.passed === true,
    ) &&
  failed.results?.find((item) => item.pluginId === ids[3])?.passed ===
    false, "Named consumer failure did not preserve the other successful checks");
await denied(async () => {
  const result = await activateGroup(assignment, failed, true);
  if (!result.activated) throw new Error("publication-denied");
}, "Failed consumer allowed publication");
require((await list()).plugins
  .filter((plugin) => ids.includes(plugin.id))
  .every((plugin) => !plugin.enabled), "Failed group partially enabled");
// HTTP failures run through the provider's synthetic host, never a live fallback.
for (const [status, reason] of [
  [401, "access-denied"],
  [403, "access-denied"],
  [404, "missing-resource"],
  [503, "http-failure:503"],
]) {
  const entries = checks();
  entries[0].responses = {
    ...responses,
    [`GET https://api.github.com/repos/${repos[0]}`]: { status, body: "{}" },
  };
  entries[0].script = `let message='';try {await plugin.invokeExport('read',{sources:['octocat/Hello-World']});}catch(error){message=String(error);}assert.ok(message.includes('${reason}'));`;
  // Only the consumer selecting the failing repository should fail.
  const result = await checkGroup(entries, true);
  require(result.passed === false &&
    result.results?.find((item) => item.pluginId === ids[0])?.passed === true &&
    result.results?.find((item) => item.pluginId === ids[2])?.passed ===
      false &&
    result.results?.find((item) => item.pluginId === ids[3])?.passed ===
      true, `HTTP ${status} check results did not match the selected repositories: ${JSON.stringify(result.results?.map(({ pluginId, passed, assertions }) => ({ pluginId, passed, assertions })))}`);
}
const checked = await checkGroup(checks());
await assertPublished(await activateGroup(assignment, checked));
async function service(id, name, args) {
  return (await window.nativePluginService(scope, id)).invoke(
    name,
    args,
    new AbortController().signal,
  );
}
await service(ids[0], "configure", { sources: repos, expectedRevision: null });
for (let index = 2; index < 4; index++)
  await service(ids[index], "select", {
    sources: [repos[index - 2]],
    expectedRevision: null,
  });
await service(ids[1], "write", { text: brief, expectedRevision: null });
const inspectStores = () => invoke("smoke_public_repository_stores", { scope });
async function originalStores() {
  const snapshot = await inspectStores();
  require(snapshot[1].text ===
    brief, "Versioned workspace brief was not saved");
  return JSON.stringify(snapshot);
}
const original = await originalStores();
// Changing an export's implementation requires both declared consumers to retest.
await sourceWrite(
  assignment,
  ids[0],
  "service.js",
  sources[0].replace(
    "exports: { read, configure }",
    "exports: { read: async (args, host) => (await read(args, host)).map(repo => ({ ...repo, interfaceVersion: 2 })), configure }",
  ),
);
const retests = checks();
for (let index = 2; index < 4; index++)
  retests[index].script +=
    "assert.equal((await plugin.invokeTool('read',{})).details.repositories[0].interfaceVersion,2);";
const missingRetests = await checkChanges(
  assignment,
  { changes: [{ pluginId: ids[0] }], checks: retests.slice(0, 2) },
  { allowError: true },
);
require(missingRetests.needsChecks?.includes(ids[2]) &&
  missingRetests.needsChecks?.includes(
    ids[3],
  ), "Shared interface change did not require both retained consumers");
const changed = await checkChanges(assignment, {
  changes: [{ pluginId: ids[0] }],
  checks: retests,
});
require((await originalStores()) ===
  original, "Synthetic checks changed original configuration or workspace stores");
require(ids
  .slice(2)
  .every((id) =>
    changed.checked?.some((plugin) => plugin.pluginId === id),
  ), "Shared change omitted affected consumers");
await assertPublished(await activateGroup(assignment, changed));
// Read active configuration revisions without fetching repository metadata.
const [before] = await inspectStores();
await service(ids[0], "configure", {
  sources: [...repos, "tauri-apps/tauri"],
  expectedRevision: before.revision,
});
const retained = await inspectStores();
for (let index = 2; index < 4; index++) {
  require(retained[index].text ===
    JSON.stringify([
      repos[index - 2],
    ]), "Adding a shared source widened a consumer selection");
}
if (fixture.publicRepositoryLive) {
  for (let index = 2; index < 4; index++) {
    const result = await service(ids[index], "read", {});
    const metadata = result.details.repositories;
    require(metadata.length === 1 &&
      metadata[0].fullName === repos[index - 2] &&
      metadata[0].url === `https://github.com/${repos[index - 2]}` &&
      typeof metadata[0].branch === "string" &&
      metadata[0].branch.length > 0 &&
      metadata[0].interfaceVersion === 2 &&
      result.details.note ===
        brief, "Live metadata differs from independently known repository expectations");
    await invoke("smoke_progress", {
      stage: `public-repository-live-get:${repos[index - 2]}`,
    });
  }
}

await denied(
  () => service(ids[2], "read", { undeclaredDependency: true }),
  "Consumer accessed an undeclared dependency",
  "native.plugins.checkInvalid",
);
await invoke("smoke_progress", {
  stage: fixture.publicRepositoryLive
    ? "public-repository-live-qualified"
    : "public-repository-offline-qualified",
});
