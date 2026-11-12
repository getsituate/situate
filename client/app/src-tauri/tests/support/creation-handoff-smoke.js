(async () => {
  const smoke = window.nativeSmokeWait;
  const invoke = smoke.invoke;
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const wait = (check, message, { foreground = true } = {}) =>
    smoke.wait(async () => {
      if (foreground) {
        const state = await invoke("smoke_window_state", { focus: true });
        if (
          !state.visible ||
          !state.focused ||
          document.visibilityState !== "visible" ||
          !document.hasFocus()
        )
          return false;
      }
      return check();
    }, message);
  const snapshot = () => invoke("workspace_snapshot");
  const button = (label) =>
    [...document.querySelectorAll("button")].find((element) => {
      const copy = element.cloneNode(true);
      copy
        .querySelectorAll('[aria-hidden="true"]')
        .forEach((node) => node.remove());
      return (
        (copy.querySelector("strong") ?? copy).textContent.trim() === label
      );
    });
  const act = (action, id = null) => invoke("workspace_action", { action, id });
  async function appearance(scope, accent, background, foreground) {
    await wait(() => {
      const panel = document.querySelector(".setup-access-panel");
      return (
        panel &&
        !panel.closest("[inert]") &&
        document.querySelector(".setup-steps .active .badge-fill")
      );
    }, "AI connection transition did not finish").catch((error) => {
      const panel = document.querySelector(".setup-panel");
      error.message += ` (visibility: ${document.visibilityState}, focus: ${document.hasFocus()}, phase: ${panel?.dataset.transitionPhase ?? "missing"}, inert: ${!!panel?.inert})`;
      throw error;
    });
    await wait(
      () => document.documentElement.dataset.workspaceAccent === accent,
      "Workspace accent did not load",
    );
    if (!document.querySelector(".setup-frame .situate-button--normal")) {
      const provider = await wait(
        () => button("OpenAI-compatible server"),
        "Provider selection did not render",
      );
      provider.click();
      await wait(
        () => document.querySelector(".setup-frame .situate-button--normal"),
        "AI connection form did not render",
      );
    }
    const fill = document.querySelector(".setup-steps .active .badge-fill");
    const primary = document.querySelector(
      ".setup-frame .situate-button--normal",
    );
    assert(
      getComputedStyle(fill).backgroundColor === background,
      "Progress accent differs from the workspace",
    );
    assert(
      getComputedStyle(primary).backgroundColor === background,
      "Button accent differs from the workspace",
    );
    assert(
      getComputedStyle(primary).color === foreground,
      "Button foreground does not match its accent",
    );
    const stored = await invoke("appearance_snapshot", { scope });
    assert(
      stored.accent === accent && stored.revision && stored.writable,
      "Creation appearance was not persisted",
    );
    const progress = await invoke("onboarding_load", { scope });
    assert(
      progress.record.step === "access" && !progress.record.entered,
      "Creation did not retain required AI setup",
    );
  }
  async function unchanged(before, originalDocument) {
    const after = await invoke("smoke_window_state");
    for (const key of ["label", "process", "identity", "navigations", "size"])
      assert(
        JSON.stringify(after[key]) === JSON.stringify(before[key]),
        "Creation changed window state: " + key,
      );
    assert(
      document === originalDocument && after.visible,
      "Creation replaced the document or hid its window",
    );
    return after;
  }
  async function create(name, accent) {
    await invoke("smoke_progress", { stage: "handoff-create-start" });
    button("Create a workspace").click();
    await wait(() => {
      document.querySelector(".unfolding-place button.skip")?.click();
      return document.querySelector("#workspace-name");
    }, "Workspace creation did not render");
    const field = await wait(() => {
      const input = document.querySelector("#workspace-name");
      return (
        input &&
        !input.disabled &&
        document.querySelector("#workspace-parent")?.value &&
        input
      );
    }, "Workspace creation fields did not become ready");
    field.focus();
    field.value = name;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    document
      .querySelector('input[type="radio"][value="' + accent + '"]')
      .click();
    const confirm = await wait(() => {
      const element = button("Create workspace");
      return element && !element.disabled && element;
    }, "Workspace creation did not become available").catch((error) => {
      throw new Error(
        `${error.message} (name retained: ${field.value === name}, field connected: ${field.isConnected}, alert: ${document.querySelector('[role="alert"]')?.textContent.trim() ?? "none"})`,
      );
    });
    const before = await invoke("smoke_window_state");
    const originalDocument = document;
    confirm.click();
    await invoke("smoke_progress", { stage: "handoff-create-submitted" });
    const current = await wait(
      async () => (await snapshot()).current,
      "Created workspace did not activate",
    );
    await invoke("smoke_progress", { stage: "handoff-workspace-owned" });
    await appearance(
      current.id,
      accent,
      accent === "tangerine" ? "rgb(255, 135, 77)" : "rgb(48, 92, 244)",
      accent === "tangerine" ? "rgb(48, 32, 62)" : "rgb(255, 254, 250)",
    );
    const after = await unchanged(before, originalDocument);
    assert(
      JSON.stringify(after.windows) === JSON.stringify(before.windows),
      "Creation opened a replacement window",
    );
    return { current, before, originalDocument };
  }
  try {
    await invoke("smoke_progress", { stage: "handoff-startup" });
    await wait(
      async () => (await snapshot()).ready,
      "Workspace startup did not finish",
      { foreground: false },
    );
    const phase = (await invoke("smoke_phase")).handoff;
    const initial = await snapshot();
    await invoke("smoke_progress", {
      stage: initial.current
        ? "handoff-initial-workspace"
        : "handoff-initial-entry",
    });
    if (phase === "reopen") {
      if (!initial.current) return;
      await appearance(
        initial.current.id,
        "tangerine",
        "rgb(255, 135, 77)",
        "rgb(48, 32, 62)",
      );
      assert(
        !document.querySelector(".workspace-create, .unfolding-place"),
        "Reopening replayed creation",
      );
      const before = await invoke("smoke_window_state");
      const originalDocument = document;
      await act("open", initial.current.id);
      const after = await unchanged(before, originalDocument);
      assert(
        JSON.stringify(after.windows) === JSON.stringify(before.windows),
        "Opening an active workspace duplicated its window",
      );
      await invoke("verify_smoke_registry", {
        known: [initial.current.id],
        restore: [initial.current.id],
      });
      await invoke("smoke_checkpoint", { restart: false });
      await invoke("finish_smoke_test", { error: null });
      return;
    }
    if (!initial.current) {
      await wait(
        () => button("Create a workspace"),
        "Workspace entry did not render",
      );
      const primary = (await invoke("smoke_window_state")).label === "main";
      if (primary) {
        const parent = await invoke("smoke_parent");
        const before = await invoke("smoke_window_state");
        const originalDocument = document;
        await invoke("smoke_failed_creation", { parent: parent.id });
        await unchanged(before, originalDocument);
      }
      const created = await create(
        primary ? "Orange garden" : "Blue garden",
        primary ? "tangerine" : "cobalt",
      );
      const file = await invoke("files_request", {
        request: {
          workspaceId: created.current.id,
          operation: "create",
          path: "native-editor.md",
          text: "# Field notes\n\nReview open notes on Friday.\n",
        },
      });
      assert(file.status === "saved", "Recovery fixture was not saved");
      await invoke("smoke_shell_ready");
      if (!primary) return;
      await act("entry");
      await wait(
        async () =>
          (await snapshot()).open.length === 2 &&
          (await invoke("smoke_phase")).shellReady,
        "Second workspace did not activate in its entry window",
        { foreground: false },
      );
      await appearance(
        created.current.id,
        "tangerine",
        "rgb(255, 135, 77)",
        "rgb(48, 32, 62)",
      );
      await unchanged(created.before, created.originalDocument);
      await invoke("smoke_failure_cases");
      const second = (await snapshot()).open.find(
        (entry) => entry.id !== created.current.id,
      );
      await invoke("smoke_close_window", { id: second.id });
      await wait(
        async () => (await snapshot()).open.length === 1,
        "Closing the second workspace affected the first",
      );
      await unchanged(created.before, created.originalDocument);
      await invoke("verify_smoke_registry", {
        known: [created.current.id, second.id],
        restore: [created.current.id],
      });
      await act("remove", second.id);
      await invoke("smoke_checkpoint", { restart: true });
      await invoke("finish_smoke_test", { error: null });
    } else {
      throw new Error("Creation fixture started in an existing workspace");
    }
  } catch (error) {
    await invoke("finish_smoke_test", { error: String(error) });
  }
})();
