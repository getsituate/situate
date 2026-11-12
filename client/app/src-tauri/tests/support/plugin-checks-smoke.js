window.runPluginChecksSmoke = async () => {
  const { invoke, wait } = window.nativeSmokeWait;
  const phase = await invoke("smoke_phase");
  if (!phase.pluginDrafts) return;
  const mode = phase.pluginChecksMode;
  const recovery = await invoke("plugin_recovery_mode");
  if (!mode && recovery) return;
  if ((mode === "repair") !== recovery)
    throw new Error("Plugin checks smoke started in the wrong recovery mode");
  const { current } = await invoke("workspace_snapshot");
  if (!current?.id) throw new Error("Plugin checks smoke has no workspace");
  const scope = current.id;
  const fixture = await invoke("smoke_plugin_check_prepare", { scope });
  if (fixture.selected === false) return;
  await wait(
    () => window.nativePluginChecks,
    "Native check bridge unavailable",
  );
  const counter = fixture.conversationId,
    connection = fixture.connectionId,
    consumer = fixture.consumerId;
  const require = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  async function denied(operation, message, expected) {
    let error;
    try {
      await operation();
    } catch (caught) {
      error = String(caught);
    }
    require(error && (!expected || error.includes(expected)), message);
  }
  const contexts = new Map();
  async function checksFor(conversation) {
    if (!contexts.has(conversation))
      contexts.set(
        conversation,
        await window.nativePluginChecks({
          scope,
          conversation,
          runId: crypto.randomUUID(),
        }),
      );
    return contexts.get(conversation);
  }
  async function checkChanges(conversation, args) {
    await invoke("smoke_progress", { stage: "plugin-check-started" });
    const result = await (
      await checksFor(conversation)
    ).check(crypto.randomUUID(), args);
    await invoke("smoke_progress", { stage: "plugin-check-complete" });
    return result;
  }
  const activateGroup = async (conversation, checked) =>
    (await checksFor(conversation)).activate(
      crypto.randomUUID(),
      checked.checkId,
    );
  const inspect = async (conversation, args) =>
    (await checksFor(conversation)).inspect(crypto.randomUUID(), args);
  const sourceRequest = (request) =>
    invoke("smoke_plugin_source_request", { scope, request });
  async function sourceWrite(
    _conversation,
    pluginId,
    path,
    text,
    create = false,
  ) {
    const before = create
      ? null
      : (await sourceRequest({ operation: "read", pluginId, path })).version
          .revision;
    return sourceRequest({
      operation: "write",
      pluginId,
      path,
      text,
      expectedRevision: before,
    });
  }
  const list = () =>
    invoke("plugin_runtime", { scope, request: { operation: "list" } });
  const verifyCounter = (version, enabled) =>
    invoke("smoke_plugin_check_verify", { scope, version, enabled });
  async function startAssignment(origin) {
    const result = await invoke("smoke_plugin_assignment", {
      scope,
      id: crypto.randomUUID(),
      origin,
    });
    require(result.ready &&
      result.conversation.version === 2 &&
      result.conversation.development?.version ===
        2, "Synthetic grouped assignment was not native v2");
    return result.conversation.id;
  }
  async function assertPublished(result) {
    require(result.activated &&
      result.publication.status ===
        "published", "Related code was not published");
    require(!result.followUpError, "Published plugin UI did not refresh");
    const current = await list();
    for (const selected of result.plugins) {
      const active = current.plugins.find(
        (plugin) => plugin.id === selected.pluginId,
      );
      require(active?.enabled &&
        active.revision ===
          selected.revision, "Group active revisions differ from checked selection");
    }
  }
  async function createSharedSources(
    assignment,
    providerSource,
    consumerSource,
  ) {
    for (const [id, source] of [
      [connection, providerSource],
      [consumer, consumerSource],
    ]) {
      await sourceRequest({ operation: "create", pluginId: id });
      await sourceWrite(
        assignment,
        id,
        "plugin.json",
        JSON.stringify({
          schemaVersion: 2,
          id,
          name: id,
          description: "Synthetic reusable connection checks",
          serviceEntry: "service.js",
          exports: id === consumer ? ["read", "readRetained"] : ["read"],
          ...(id === consumer
            ? { kind: "tool", dependencies: [connection] }
            : { kind: "connection" }),
        }),
        true,
      );
      await sourceWrite(assignment, id, "service.js", source, true);
    }
  }
  const readService = async (service) =>
    (await service.invoke("read", {})).details;
  const grouped = (conversation, providerVersion, consumerVersion) =>
    checkChanges(conversation, {
      changes: [{ pluginId: connection }, { pluginId: consumer }],
      checks: groupChecks(providerVersion, consumerVersion),
    });
  const checkCounter = (conversation) =>
    checkChanges(conversation, {
      changes: [{ pluginId: fixture.pluginId }],
      checks: [{ pluginId: fixture.pluginId, ...counterChecks }],
    });
  async function verifyImage(result) {
    const images = result.images;
    require(images.length ===
      1, "Preview did not return exactly one native capture");
    const image = images[0];
    const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
    require(image.mimeType === "image/png" &&
      bytes.length > 100 &&
      bytes.length <= 8 * 1024 * 1024, "Native capture bounds invalid");
    require([137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, i) => bytes[i] === byte,
    ), "Capture PNG signature invalid");
    const header = new DataView(bytes.buffer);
    const width = header.getUint32(16),
      height = header.getUint32(20);
    require(width > 96 &&
      height > 48 &&
      width <= 2048 &&
      height <= 2048 &&
      width * height <= 4000000, "Capture dimensions invalid");
    const decoded = new Image();
    decoded.src = `data:image/png;base64,${image.data}`;
    await decoded.decode();
    require(decoded.naturalWidth === width &&
      decoded.naturalHeight === height, "Capture did not decode");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(decoded, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    let blue = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        Math.abs(pixels[i] - 33) <= 3 &&
        Math.abs(pixels[i + 1] - 165) <= 3 &&
        Math.abs(pixels[i + 2] - 216) <= 3 &&
        pixels[i + 3] === 255
      )
        blue++;
    require(blue > 1000, "Native capture did not contain fixture pixels");
  }
  const queryAction = "- [ ] Synthetic action #task";
  const queryNote = "Plain note";
  const counterChecks = {
    script: `
      assert.equal(plugin.skill('SKILL.md'), 'Count synthetic interactions.');
      const query = {extensions:['.md']};
      const entries = await host.files.list(query, host.signal);
      assert.equal(entries.map(file => file.path), ['query-a.md','query-b.MD']);
      const matches = await host.files.search({...query,text:'#task'}, host.signal);
      assert.equal(matches.map(file => file.path), ['query-a.md']);
      const versions = await host.files.readMany(entries.map(file => file.path), host.signal);
      assert.equal(versions.map(file => file.text), ${JSON.stringify([queryAction, queryNote])});
      const beforeQuery = await host.files.read('query-a.md');
      assert.equal(versions[0].revision, beforeQuery.revision);
      for (const area of ['files','config','data']) {
        const before = await host[area].read('trial.txt');
        assert.equal(before.text, 'synthetic');
        await host[area].write('trial.txt', 'changed only in test', before.revision);
        assert.equal((await host[area].read('trial.txt')).text, 'changed only in test');
      }
      assert.equal(await host.credentials.get('token'), 'synthetic-token');
      await host.credentials.set('token', 'changed synthetic token');
      assert.equal(await host.credentials.get('token'), 'changed synthetic token');
      let denied = false;
      try { await host.network.request({url:'https://example.invalid/unmatched'}); } catch { denied = true; }
      assert.ok(denied);
      assert.equal((await host.network.request({url:'https://example.invalid/items',method:'POST',body:'synthetic'})).body, 'synthetic reply');
      assert.equal((await plugin.invokeTool('count',{})).content[0].text, '0');
      await preview.open({viewId:'native-check:counter'});
      assert.equal((await preview.step({action:'read',selector:'output'})), '0');
      await preview.step({action:'click',selector:'button'});
      let displayed;
      do {
        displayed = await preview.step({action:'read',selector:'output'});
      } while (displayed !== '1' && !host.signal.aborted);
      assert.equal(displayed, '1');
      await preview.step({action:'capture'});
    `,
    fixtures: {
      files: {
        "trial.txt": "synthetic",
        "query-a.md": queryAction,
        "query-b.MD": queryNote,
        "query-ignored.txt": "Not Markdown",
      },
      config: { "trial.txt": "synthetic" },
      data: { "trial.txt": "synthetic" },
      credentials: { token: "synthetic-token" },
    },
    responses: {
      "POST https://example.invalid/items": {
        status: 201,
        body: "synthetic reply",
      },
    },
    timeoutMs: 30000,
  };
  function groupChecks(providerVersion, consumerVersion) {
    return [
      {
        pluginId: connection,
        timeoutMs: 30000,
        fixtures: {
          files: { "connection-trial.txt": "synthetic connection" },
          config: { "trial.txt": "connection config" },
          data: { "trial.txt": "connection data" },
          credentials: { token: "connection credential" },
        },
        responses: {
          "POST https://example.invalid/connection": {
            status: 200,
            body: "connection reply",
          },
        },
        script: `
          const value = await plugin.invokeExport('read',{fixture:true});
          assert.equal(value,{version:${JSON.stringify(providerVersion)},config:'connection config',data:'connection data',credential:'connection credential',reply:'connection reply'});
          assert.equal((await host.files.read('connection-trial.txt')).text,'synthetic connection');
          let denied=false; try {await host.network.request({url:'https://example.invalid/consumer',method:'POST',body:'synthetic'});} catch {denied=true;}
          assert.ok(denied);
        `,
      },
      {
        pluginId: consumer,
        timeoutMs: 30000,
        fixtures: {
          files: { "consumer-trial.txt": "synthetic consumer" },
          config: { "trial.txt": "consumer config" },
          data: { "trial.txt": "consumer data" },
          credentials: { token: "consumer credential" },
        },
        responses: {
          "POST https://example.invalid/consumer": {
            status: 200,
            body: "consumer reply",
          },
        },
        script: `
          const result = await plugin.invokeTool('read',{fixture:true});
          assert.equal(result.details,{version:${JSON.stringify(consumerVersion)},provider:{version:${JSON.stringify(providerVersion)},config:'connection config',data:'connection data',credential:'connection credential',reply:'connection reply'},config:'consumer config',data:'consumer data',credential:'consumer credential'});
          assert.equal((await host.files.read('consumer-trial.txt')).text,'synthetic consumer');
          assert.equal((await host.files.read('connection-trial.txt')).text,'synthetic connection');
          assert.equal((await host.network.request({url:'https://example.invalid/consumer',method:'POST',body:'synthetic'})).body,'consumer reply');
          let denied=false; try {await host.network.request({url:'https://example.invalid/connection',method:'POST',body:'synthetic'});} catch {denied=true;}
          assert.ok(denied);
        `,
      },
    ];
  }
  async function qualify(script, names, values) {
    const Run = Object.getPrototypeOf(async function () {}).constructor;
    await new Run(...names, script)(...values);
  }
  if (
    fixture.documentSourceOnly ||
    fixture.processConnectionOnly ||
    fixture.publicRepositoryOnly
  ) {
    const origin = crypto.randomUUID();
    await invoke("ai_create_conversation", {
      scope,
      id: origin,
      title: "Synthetic native connection qualification",
    });
    const assignment = await startAssignment(origin);
    let closing = false;
    if (fixture.documentSourceOnly)
      await qualify(
        fixture.documentSourceSmoke,
        [
          "fixture",
          "scope",
          "assignment",
          "checkChanges",
          "sourceWrite",
          "sourceRequest",
          "activateGroup",
          "assertPublished",
          "list",
          "require",
          "denied",
          "invoke",
          "wait",
        ],
        [
          fixture,
          scope,
          assignment,
          checkChanges,
          sourceWrite,
          sourceRequest,
          activateGroup,
          assertPublished,
          list,
          require,
          denied,
          invoke,
          wait,
        ],
      );
    else if (fixture.processConnectionOnly)
      await qualify(
        fixture.processSmoke,
        [
          "fixture",
          "scope",
          "assignment",
          "checkChanges",
          "sourceWrite",
          "sourceRequest",
          "activateGroup",
          "assertPublished",
          "require",
          "invoke",
          "wait",
          "onClosing",
        ],
        [
          fixture,
          scope,
          assignment,
          checkChanges,
          sourceWrite,
          sourceRequest,
          activateGroup,
          assertPublished,
          require,
          invoke,
          wait,
          () => {
            closing = true;
          },
        ],
      );
    else
      await qualify(
        fixture.publicRepositorySmoke,
        [
          "fixture",
          "scope",
          "assignment",
          "checkChanges",
          "sourceWrite",
          "sourceRequest",
          "activateGroup",
          "assertPublished",
          "list",
          "require",
          "denied",
          "invoke",
        ],
        [
          fixture,
          scope,
          assignment,
          checkChanges,
          sourceWrite,
          sourceRequest,
          activateGroup,
          assertPublished,
          list,
          require,
          denied,
          invoke,
        ],
      );
    if (!closing) await invoke("finish_smoke_test", { error: null });
    return;
  }
  if (mode === "block") {
    await invoke("smoke_plugin_runtime_source", { scope });
    const installed = await list();
    if (
      ![connection, consumer].every((id) =>
        installed.plugins.some((plugin) => plugin.id === id),
      )
    ) {
      const origin = crypto.randomUUID();
      await invoke("ai_create_conversation", {
        scope,
        id: origin,
        title: "Synthetic recovery setup",
      });
      const assignment = await startAssignment(origin);
      await createSharedSources(
        assignment,
        fixture.connectionEdited,
        fixture.consumerSecond,
      );
      await assertPublished(
        await activateGroup(
          assignment,
          await grouped(assignment, "edited", "second"),
        ),
      );
    }
    await checkChanges(counter, {
      changes: [{ pluginId: fixture.pluginId }],
      checks: [
        {
          pluginId: fixture.pluginId,
          script:
            'await preview.open({viewId:"native-check:block"});assert.ok((await preview.step({action:"read"})).length>0);',
          timeoutMs: 10000,
        },
      ],
    });
    throw new Error("Blocking preview unexpectedly returned");
  }
  if (mode === "repair" || mode === "repaired") {
    require(!window.nativeBlockingFactory, "Blocking UI executed during recovery or restart");
    if (mode === "repair") {
      await sourceWrite(
        counter,
        fixture.pluginId,
        "service.js",
        fixture.editedSource,
      );
      await sourceWrite(counter, fixture.pluginId, "ui.js", fixture.uiSource);
      const origin = crypto.randomUUID();
      await invoke("ai_create_conversation", {
        scope,
        id: origin,
        title: "Synthetic recovery request",
      });
      const assignment = await startAssignment(origin);
      await assertPublished(
        await activateGroup(
          assignment,
          await grouped(assignment, "edited", "second"),
        ),
      );
      await denied(
        () =>
          invoke("plugin_runtime", {
            scope,
            request: { operation: "load", pluginId: "native-counter" },
          }),
        "Group activation resumed an unrelated plugin",
        "native.plugins.recoveryBlocked",
      );
    }
    const checked = await checkCounter(counter);
    require(checked.passed, "Native counter check failed during recovery");
    await verifyImage(checked);
    await assertPublished(await activateGroup(counter, checked));
    await verifyCounter("edited", true);
    if (mode === "repair") {
      await denied(
        () =>
          invoke("plugin_runtime", {
            scope,
            request: { operation: "load", pluginId: "native-counter" },
          }),
        "Counter check resumed an unrelated plugin",
        "native.plugins.recoveryBlocked",
      );
      await invoke("plugin_recovery_resume", {
        scope,
        pluginId: "native-counter",
      });
      await wait(async () => {
        try {
          return (
            await window.nativePluginService(scope, "native-counter")
          ).descriptor.exports.includes("count");
        } catch {
          return false;
        }
      }, "Individual resumption did not expose its native service");
      await invoke("smoke_progress", { stage: "plugin-counter-resumed" });
      await invoke("plugin_recovery_resume", { scope, pluginId: null });
      await wait(
        async () => !(await invoke("plugin_recovery_mode")),
        "Resume all did not leave recovery",
      );
      const review = (await list()).plugins.find(
        (plugin) => plugin.id === "native-review",
      );
      require(review && !review.enabled, "Resume enabled a disabled plugin");
    }
    await invoke("smoke_progress", {
      stage:
        mode === "repair"
          ? "plugin-check-repaired-source"
          : "plugin-check-repaired-activated",
    });
    await invoke("finish_smoke_test", { error: null });
    return;
  }
  require(!mode, "Unknown plugin checks smoke phase");
  const origin = crypto.randomUUID();
  await invoke("ai_create_conversation", {
    scope,
    id: origin,
    title: "Synthetic connection request",
  });
  const assignment = await startAssignment(origin);
  await createSharedSources(
    assignment,
    fixture.connectionFirst,
    fixture.consumerFirst,
  );
  const originalSource = await sourceRequest({
    operation: "read",
    pluginId: connection,
    path: "service.js",
  });
  await denied(
    () =>
      sourceRequest({
        operation: "write",
        pluginId: connection,
        path: "service.js",
        text: "unexpected",
        expectedRevision: "stale-revision",
      }),
    "Stale source revision was overwritten",
  );
  await denied(
    () =>
      sourceRequest({
        operation: "read",
        pluginId: connection,
        path: "../../check-retained.txt",
      }),
    "Source inspection escaped its package",
  );
  require((
    await sourceRequest({
      operation: "read",
      pluginId: connection,
      path: "service.js",
    })
  ).version.text ===
    originalSource.version
      .text, "Rejected source mutation changed retained code");
  const failedChecks = groupChecks("first", "first");
  failedChecks[1].script += "\nassert.ok(false);";
  const failed = await checkChanges(assignment, {
    changes: [{ pluginId: connection }, { pluginId: consumer }],
    checks: failedChecks,
  });
  require(!failed.passed, "A failed consumer check reported success");
  const consumerFailure = failed.results.find(
    (result) => result.pluginId === consumer,
  );
  require(consumerFailure?.assertions > 0 &&
    consumerFailure.failure?.assertion === consumerFailure.assertions + 1 &&
    consumerFailure.failure?.operator === "ok" &&
    consumerFailure.failure?.actual === "false" &&
    consumerFailure.failure?.expected ===
      "true", "Failed comparison evidence was lost");
  require(consumerFailure.observations?.length >
    0, "Failed check lost host observations");
  const failureReport = JSON.stringify(failed.results);
  require(!failureReport.includes("consumer credential") &&
    !failureReport.includes("connection credential") &&
    !failureReport.includes(
      "consumer reply",
    ), "Check observations exposed fixture payloads");
  await denied(
    () => activateGroup(assignment, failed),
    "Failed checks allowed publication",
    "native.plugins.checkInvalid",
  );
  require((await list()).plugins
    .filter((plugin) => [connection, consumer].includes(plugin.id))
    .every(
      (plugin) => !plugin.enabled,
    ), "Failed checks partially enabled source code");
  const checked = await grouped(assignment, "first", "first");
  require(checked.passed, "Initial grouped check failed");
  require((await inspect(assignment, { checkId: checked.checkId })).passed ===
    true, "Grouped receipt was not inspectable");
  await sourceWrite(
    assignment,
    connection,
    "service.js",
    fixture.connectionSecond,
  );
  const stale = await activateGroup(assignment, checked);
  require(stale.publication.status === "needsRecheck" &&
    !stale.activated, "Source drift did not require fresh checks");
  require((await list()).plugins
    .filter((plugin) => [connection, consumer].includes(plugin.id))
    .every((plugin) => !plugin.enabled), "Stale group partially enabled code");
  await assertPublished(
    await activateGroup(
      assignment,
      await grouped(assignment, "second", "first"),
    ),
  );
  const oldService = await window.nativePluginService(scope, consumer);
  const activeVersions = await readService(oldService);
  require(activeVersions.version === "first" &&
    activeVersions.provider?.version ===
      "second", "Consumer did not invoke its active native connection");
  const readRetained = (service) => service.invoke("readRetained", {});
  require((await readRetained(oldService)).text ===
    "original workspace", "Active native service could not read retained workspace data");
  await sourceWrite(
    assignment,
    connection,
    "service.js",
    fixture.connectionEdited,
  );
  await sourceWrite(assignment, consumer, "service.js", fixture.consumerSecond);
  const retainedVersions = await readService(oldService);
  require(retainedVersions.version === "first" &&
    retainedVersions.provider?.version ===
      "second", "Editing sources changed the active native dependency graph");
  const publication = await activateGroup(
    assignment,
    await grouped(assignment, "edited", "second"),
  );
  await assertPublished(publication);
  require((
    await inspect(assignment, { attempt: publication.publication.attempt })
  ).publication?.status ===
    "published", "Durable publication was not inspectable");
  await denied(
    () => readService(oldService),
    "Revoked native service generation executed after publication",
    "native.plugins.unavailable",
  );
  await denied(
    () => readRetained(oldService),
    "Revoked native service generation accessed workspace data",
    "native.plugins.unavailable",
  );
  const nextService = await window.nativePluginService(scope, consumer);
  require((await readRetained(nextService)).text ===
    "original workspace", "Replacement native service could not read retained workspace data");
  const nextVersions = await readService(nextService);
  require(nextVersions.version === "second" &&
    nextVersions.provider?.version ===
      "edited", "Group exposed mixed consumer/provider versions");
  const notified = await invoke("ai_conversation_read", {
    scope,
    conversation: origin,
  });
  require(notified.runtime.events.some(
    (event) =>
      event.type === "plugin_available" && event.data.pluginId === connection,
  ), "Activation did not retain origin availability");
  require(!notified.messages.length &&
    !(notified.runtime.runs ?? [])
      .length, "Availability replayed the origin request");
  await invoke("smoke_progress", { stage: "plugin-group-checks-qualified" });
  await sourceWrite(
    counter,
    fixture.pluginId,
    "service.js",
    fixture.firstSource,
  );
  const hung = await checkChanges(counter, {
    changes: [{ pluginId: fixture.pluginId }],
    checks: [
      {
        pluginId: fixture.pluginId,
        script: "await plugin.invokeExport('hang',{});assert.ok(false);",
        timeoutMs: 500,
      },
    ],
  });
  require(!hung.passed, "A non-cooperative check worker did not stop at its deadline");
  const counterResult = await checkCounter(counter);
  require(counterResult.passed, "Native counter check failed");
  await verifyImage(counterResult);
  await assertPublished(await activateGroup(counter, counterResult));
  await verifyCounter("first", true);
  const drift = await checkCounter(counter);
  await sourceWrite(
    counter,
    fixture.pluginId,
    "service.js",
    fixture.editedSource,
  );
  const rejected = await activateGroup(counter, drift);
  require(!rejected.activated &&
    rejected.publication.status ===
      "needsRecheck", "Changed native source reused an old check");
  await verifyCounter("first", true);
  await invoke("smoke_progress", { stage: "plugin-checks-qualified" });
};
