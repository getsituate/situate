window.runScriptFailureFixture = () =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve();
      throw new Error("PRIVATE_DIAGNOSTIC_CONTENT_SENTINEL");
    }, 0);
  });
window.runDiagnosticsSmoke = async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const wait = async (check, message) => {
    const deadline = Date.now() + 10000;
    while (!check()) {
      if (Date.now() >= deadline) throw new Error(message);
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
  };
  const scope = (await invoke("workspace_snapshot")).current.id;
  if (await invoke("diagnostics_register", { scope: "foreign-workspace" }))
    throw new Error("A foreign workspace acquired a diagnostic producer");
  let rejected = false;
  try {
    await invoke("diagnostics_emit", new Uint8Array(65537));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("An oversized diagnostic batch was accepted");
  const request = (operation, fields = {}) =>
    invoke("files_request", {
      request: { workspaceId: scope, operation, ...fields },
    });
  await request("snapshot");
  const created = await request("create", { path: "diagnostic-smoke.md" });
  await request("save", {
    path: "diagnostic-smoke.md",
    base: created.document.version,
    text:
      created.document.version.text + "# PRIVATE_DIAGNOSTIC_CONTENT_SENTINEL\n",
  });
  const navigation = document.querySelector(
    'button[aria-label="Open navigation"]',
  );
  if (navigation?.getBoundingClientRect().width) navigation.click();
  const filesButton = () =>
    [...document.querySelectorAll("button.nav-destination")].find(
      (button) => button.textContent.trim() === "Files",
    );
  await wait(filesButton, "Files navigation is unavailable");
  filesButton().click();
  const fileButton = () =>
    [...document.querySelectorAll("button.file-entry")].find(
      (button) =>
        button.getAttribute("aria-description") === "diagnostic-smoke.md",
    );
  await wait(fileButton, "The diagnostic fixture is not listed");
  fileButton().click();
  await wait(
    () =>
      document.body.textContent.includes("PRIVATE_DIAGNOSTIC_CONTENT_SENTINEL"),
    "The native file did not render",
  );
  await window.runScriptFailureFixture();
  const profile = (await invoke("smoke_phase")).diagnosticsProfile;
  if (profile) {
    await invoke("workspace_action", { action: "open", id: scope, name: null });
    await wait(
      () => document.visibilityState === "visible",
      "The measurement window is hidden",
    );
    const pause = (milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      });
    const percentile = (values, fraction) => {
      values.sort((a, b) => a - b);
      return values.length
        ? values[
            Math.min(values.length - 1, Math.floor(values.length * fraction))
          ]
        : null;
    };
    const measure = async (phase, operation) => {
      const frames = [];
      const requests = [];
      let previous = performance.now();
      const started = previous;
      let visible = document.visibilityState === "visible";
      const visibilityChanged = () => {
        visible &&= document.visibilityState === "visible";
      };
      document.addEventListener("visibilitychange", visibilityChanged);
      let frame;
      const tick = (now) => {
        frames.push(now - previous);
        previous = now;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      try {
        await operation(requests);
      } finally {
        cancelAnimationFrame(frame);
        document.removeEventListener("visibilitychange", visibilityChanged);
      }
      const ui = {
        requests: requests.length,
        duration_ms: performance.now() - started,
        request_p95_ms: percentile(requests, 0.95) ?? 0,
        frame_p95_ms: percentile(frames, 0.95),
        frame_max_ms: percentile(frames, 1),
        visible: visible && document.visibilityState === "visible",
      };
      await invoke("smoke_measure_diagnostics", { phase, ui });
      if (!ui.visible)
        throw new Error("The measurement window was hidden during the phase");
    };
    await pause(1000);
    await invoke("smoke_measure_diagnostics", { phase: "ready", ui: null });
    await measure("idle", async () => {
      await pause(10000);
    });
    await measure("burst", async (requests) => {
      for (let index = 0; index < 1000; index++) {
        const started = performance.now();
        const reply = await request("snapshot");
        if (reply.status !== "ok")
          throw new Error("A measured file request failed");
        requests.push(performance.now() - started);
      }
    });
    if (profile === "healthy") await invoke("smoke_verify_diagnostics");
    await invoke("smoke_progress", { stage: "diagnostics-measured" });
  } else {
    await invoke("smoke_verify_diagnostics");
    await invoke("smoke_progress", { stage: "diagnostics-verified" });
  }
};
