(async () => {
  const smoke = window.nativeSmokeWait;
  const invoke = smoke.invoke;
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const state = (step = smoke) => step.invoke("workspace_snapshot");
  const act = async (action, id = null, name = null) =>
    action === "create" && !(await state()).mobile
      ? invoke("smoke_create_fixture", { parent: id, name })
      : invoke("workspace_action", { action, id, name });
  const wait = (check) =>
    smoke.wait(check, "Timed out waiting for workspace state");
  const entry = () =>
    wait(() => {
      const entry = document.querySelector(".workspace-entry");
      if (entry) return entry;
      document.querySelector(".unfolding-place button.skip")?.click();
      return false;
    });
  const shell = async () => {
    if ((await state()).mobile) {
      await window.prepareLocalizationSmoke();
      if ((await state()).aiSetup) {
        await wait(() => document.querySelector(".ai-setup"));
        const button = (text) =>
          [...document.querySelectorAll("button")].find(
            (button) => button.textContent.trim() === text,
          );
        button("Skip for now").click();
        await wait(() => document.querySelector(".ai-setup dialog")?.open);
        button("Continue without AI").click();
      }
      if ((await invoke("smoke_phase")).diagnostics) {
        await window.runDiagnosticsSmoke();
        await invoke("smoke_shell_ready");
        return;
      }
      await wait(
        () =>
          document.querySelector(".chat-pane") &&
          !document.querySelector(".workspace-notice"),
      );
      assert(
        !document.querySelector("textarea").readOnly,
        "Draft entry is unavailable",
      );
      assert(
        document
          .querySelector('button[aria-label="Send message"]')
          ?.getAttribute("aria-disabled") === "true",
        "Chat gate is missing",
      );
      for (const label of ["Dictate text"]) {
        assert(
          document.querySelector('button[aria-label="' + label + '"]')
            ?.disabled,
          "Unavailable action enabled",
        );
      }
      for (const text of [
        "  Hello, world 👋\nSecond line\t  ",
        "Replacement",
        "",
      ]) {
        await invoke("save_text", { text });
        await invoke("verify_smoke_text", { text });
      }
      await window.runEditorSmoke();
      await invoke("smoke_shell_ready");
    } else {
      // Shell readiness covers the entire child journey, not a single transition.
      // Its deadline belongs to the native process watchdog.
      const interval = (await invoke("smoke_phase")).diagnosticsProfile
        ? 1000
        : 25;
      while (!(await invoke("smoke_phase")).shellReady)
        await new Promise((resolve) => {
          setTimeout(resolve, interval);
        });
    }
  };
  try {
    await invoke("smoke_progress", { stage: "workspace-script" });
    await wait(async (step) => (await state(step)).ready);
    const phase = await invoke("smoke_phase");
    if (phase.entryCloseOnly) {
      assert((await state()).open.length === 0, "Entry has an open workspace");
      await entry();
      await invoke("finish_smoke_test", { error: null });
      return;
    }
    if (phase.pluginChecksMode) {
      if (phase.pluginChecksMode === "block") {
        assert(
          (await state()).open.length === 0,
          "Blocking check started with an open workspace",
        );
        const parent = await invoke("smoke_parent");
        await invoke("smoke_checkpoint", { restart: true });
        await act("create", parent.id, "Plugin-Checks");
      } else {
        assert(
          (await state()).open.length === 1,
          "Plugin check workspace was not restored",
        );
      }
      return;
    }
    if (phase.restart) {
      const restored = await state();
      assert(
        restored.open.length === 1 && restored.known.length === 1,
        "Restart restored a closed or unlisted workspace",
      );
      assert(
        restored.failures.length === (phase.picker ? 0 : 1),
        "Unexpected restore failures",
      );
      if (!phase.picker) {
        assert(
          restored.failures[0].location.name === "Unavailable test folder",
          "Wrong location failed restoration",
        );
        await act("close", restored.failures[0].location.id);
      }
      const b = restored.open[0];
      assert(b.id === restored.known[0].id, "Wrong workspace restored");
      await shell();
      await invoke("verify_smoke_registry", { known: [b.id], restore: [b.id] });
      if (phase.isolated) await invoke("smoke_close_window", { id: b.id });
      else await act("close", b.id);
      await wait(async (step) => (await state(step)).open.length === 0);
      assert((await state()).open.length === 0, "Last session did not close");
      await entry();
      await invoke("verify_smoke_registry", { known: [b.id], restore: [] });
      await invoke("smoke_checkpoint", { restart: false });
    } else {
      assert(
        (await state()).open.length === 0,
        "Initial smoke state was not empty",
      );
      await entry();
      const parent = await invoke(
        phase.picker ? "workspace_parent" : "smoke_parent",
        phase.picker ? { pick: true } : {},
        { timeout: phase.picker ? 300000 : 10000 },
      );
      assert(parent, "Folder selection was cancelled");
      const suffix = Date.now();
      const firstName = "Garden-" + suffix;
      await invoke("workspace_preflight", {
        parent: parent.id,
        name: firstName,
      });
      await act("create", parent.id, firstName);
      const a = (await state()).open[0];
      await shell();
      if (phase.diagnostics) {
        await invoke("finish_smoke_test", { error: null });
        return;
      }
      let collided = false;
      try {
        await act("create", parent.id, firstName);
      } catch (error) {
        if (error?.name === "NativeSmokeTimeout") throw error;
        collided = true;
      }
      assert(collided, "Creation reused an existing directory");
      await act("create", parent.id, "Reading-" + suffix);
      const b = (await state()).open.find((w) => w.id !== a.id);
      await shell();
      assert(b, "Second workspace did not open");
      await act("remove", a.id);
      await act("open", a.id);
      await act("open", a.id);
      const switched = await state();
      assert(
        switched.open.length === 2 && switched.known.length === 1,
        "Switching closed, duplicated, or re-listed a workspace",
      );
      await invoke("verify_smoke_registry", {
        known: [b.id],
        restore: [b.id, a.id],
      });
      if (!switched.mobile) {
        for (const workspaceId of [a.id, b.id]) {
          for (const [command, args] of [
            ["layout_load", { workspaceId }],
            [
              "layout_save",
              {
                workspaceId,
                expectedRevision: null,
                data: { version: 1, layout: {}, pinnedViews: [] },
              },
            ],
          ]) {
            let rejection;
            try {
              await invoke(command, args);
            } catch (error) {
              rejection = String(error);
            }
            assert(
              rejection === "native.workspace.session.inactive",
              "The entry window accessed another window's layout",
            );
          }
        }
      }
      await invoke("smoke_failure_cases");
      if ((await state()).mobile) await act("close", a.id);
      else await invoke("smoke_close_window", { id: a.id });
      await wait(
        async (step) => !(await state(step)).open.some((w) => w.id === a.id),
      );
      const closed = await state();
      assert(
        closed.open.length === 1,
        "Individual closure affected another workspace",
      );
      if (closed.mobile)
        assert(
          closed.current.id === b.id,
          "Mobile closure did not activate the remaining workspace",
        );
      await invoke("verify_smoke_registry", { known: [b.id], restore: [b.id] });
      if (!phase.picker) await invoke("smoke_unavailable_restore");
      await invoke("smoke_checkpoint", { restart: true });
      if (phase.isolated) {
        await invoke("smoke_start_recovery", { workspaceId: b.id });
        return;
      }
    }
    await invoke("finish_smoke_test", { error: null });
  } catch (error) {
    await invoke("finish_smoke_test", { error: String(error) });
  }
})();
