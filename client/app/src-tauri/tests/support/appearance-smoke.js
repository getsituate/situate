window.runAppearanceSmoke = async () => {
  const ipc = window.__TAURI_INTERNALS__;
  const invoke = ipc.invoke;
  const scope = (await invoke("workspace_snapshot")).current.id;
  const empty = await invoke("appearance_snapshot", { scope: null });
  if (empty.accent !== "violet" || empty.writable || empty.revision !== null)
    throw new Error(
      "Appearance outside a workspace is not a read-only default",
    );
  for (const command of ["appearance_snapshot", "appearance_update"]) {
    let rejected = false;
    try {
      await invoke(command, {
        scope: `unowned-${scope}`,
        accent: "sky",
        expectedRevision: null,
      });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Appearance accepted an unowned workspace");
  }
  const initial = await invoke("appearance_snapshot", { scope });
  if (!initial.writable) {
    let error;
    try {
      await invoke("appearance_update", {
        scope,
        accent: "sky",
        expectedRevision: initial.revision,
      });
    } catch (failure) {
      error = String(failure);
    }
    if (error !== "native.appearance.readOnly")
      throw new Error("Provider appearance accepted an unsupported write");
    return;
  }
  const marker = `native-appearance:${scope}`;
  const phase = await invoke("smoke_phase");
  if (phase.restart || sessionStorage.getItem(marker)) {
    if (initial.accent !== "lemon" || !initial.revision)
      throw new Error("Appearance did not survive workspace restoration");
    return;
  }
  if (initial.accent !== "violet" || initial.revision !== null)
    throw new Error("New workspace inherited another workspace's appearance");
  const saved = await invoke("appearance_update", {
    scope,
    accent: "cobalt",
    expectedRevision: null,
  });
  const reopened = await invoke("appearance_snapshot", { scope });
  if (
    saved.accent !== "cobalt" ||
    !saved.writable ||
    !saved.revision ||
    JSON.stringify(saved) !== JSON.stringify(reopened)
  )
    throw new Error("Appearance did not persist through native IPC");
  for (const [accent, expectedRevision, expectedError] of [
    ["sky", null, "native.appearance.changed"],
    ["green", saved.revision, "native.appearance.invalid"],
  ]) {
    let error;
    try {
      await invoke("appearance_update", { scope, accent, expectedRevision });
    } catch (failure) {
      error = String(failure);
    }
    if (error !== expectedError)
      throw new Error("Appearance accepted an invalid or stale update");
  }
  const change = { received: false };
  const callback = ipc.transformCallback((event) => {
    if (event.payload.scope === scope) change.received = true;
  });
  const eventId = await invoke("plugin:event|listen", {
    event: "appearance-changed",
    target: { kind: "Any" },
    handler: callback,
  });
  try {
    await invoke("smoke_appearance_replace", { scope });
    const deadline = Date.now() + 10000;
    while (!change.received && Date.now() < deadline)
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    const external = await invoke("appearance_snapshot", { scope });
    if (
      !change.received ||
      external.accent !== "lemon" ||
      external.revision === saved.revision
    )
      throw new Error("External appearance changes were not observed");
  } finally {
    await invoke("plugin:event|unlisten", {
      event: "appearance-changed",
      eventId,
    });
    ipc.unregisterCallback(callback);
  }
  sessionStorage.setItem(marker, "saved");
  await invoke("smoke_progress", { stage: "appearance-ipc-saved" });
};
