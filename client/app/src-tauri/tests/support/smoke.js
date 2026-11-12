(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const canonicalJson = (value) =>
    JSON.stringify(value, (_key, item) =>
      item !== null && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]]),
          )
        : item,
    );
  const waitFor = (check) =>
    window.nativeSmokeWait.wait(check, "Timed out waiting for the app shell", {
      timeout: 10000,
    });

  try {
    await invoke("smoke_progress", { stage: "shell-script" });
    await window.prepareOrdinaryWorkspaceSmoke();
    await waitFor(
      () =>
        document.querySelector(".topic-window") ||
        document.querySelector(".ai-setup"),
    );
    await invoke("smoke_progress", { stage: "localization-start" });
    await window.prepareLocalizationSmoke();
    await invoke("smoke_progress", { stage: "localization-ready" });
    if (document.querySelector(".ai-setup")) {
      const button = (text) =>
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent.trim() === text,
        );
      button("Skip for now").click();
      await waitFor(() => document.querySelector(".ai-setup dialog")?.open);
      button("Continue without AI").click();
    }
    await waitFor(() => document.querySelector(".topic-window"));
    if ((await invoke("smoke_phase")).pluginChecksMode) {
      await window.runPluginChecksSmoke();
      await invoke("smoke_shell_ready");
      return;
    }
    if ((await invoke("smoke_phase")).diagnostics) {
      await window.runDiagnosticsSmoke();
      await invoke("smoke_shell_ready");
      return;
    }
    await invoke("smoke_progress", { stage: "appearance-start" });
    await window.runAppearanceSmoke();
    await invoke("smoke_progress", { stage: "layout-start" });
    if (await window.runLayoutSmoke()) return;
    await invoke("smoke_progress", { stage: "layout-restored" });
    const phase = await invoke("smoke_phase");
    if (!phase.restart) {
      const start = await waitFor(() =>
        document.querySelector(".view-chooser .new-conversation"),
      );
      start.click();
      await waitFor(() => document.querySelector(".chat-pane textarea"));
      const input = document.querySelector(".chat-pane textarea");
      if (
        input.readOnly ||
        ![...document.querySelectorAll('.pane-title, [role="tab"]')].some(
          (title) => title.textContent.trim() === "New chat",
        ) ||
        document.querySelector(".chat-pane main, .chat-pane h1")
      ) {
        throw new Error("The empty chat did not render");
      }
      if (
        document
          .querySelector('button[aria-label="Send message"]')
          ?.getAttribute("aria-disabled") !== "true"
      ) {
        throw new Error("Chat is not gated without workspace AI access");
      }
      const dictation = await invoke("dictation_snapshot");
      const microphoneSelector = dictation.supported
        ? 'button[aria-label="Dictation settings"]'
        : 'button[aria-label="Dictate text"]';
      await window.nativeSmokeWait.wait(
        () =>
          document.querySelector(microphoneSelector)?.disabled ===
          !dictation.supported,
        "Dictation control did not reflect native support",
        { timeout: 10000 },
      );
      if (dictation.supported) {
        if (dictation.model !== "missing")
          throw new Error(
            "Unexpected provisioned speech model in the smoke fixture",
          );
        document.querySelector(microphoneSelector).click();
        await window.nativeSmokeWait.wait(
          () => document.querySelector(".chat-pane dialog[open]"),
          "Dictation download notice did not open",
          { timeout: 10000 },
        );
        if (
          !document
            .querySelector(".chat-pane dialog[open]")
            ?.textContent.includes("Dictation needs a download")
        ) {
          throw new Error(
            "Unprepared dictation does not explain its download requirement",
          );
        }
        document
          .querySelector(
            '.chat-pane dialog[open] button[aria-label="Close dialog"]',
          )
          .click();
        await window.nativeSmokeWait.wait(
          () => !document.querySelector(".chat-pane dialog[open]"),
          "Dictation download notice did not close",
          { timeout: 10000 },
        );
      }
    }
    await waitFor(() =>
      Array.from(document.images).every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    if (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth
    ) {
      throw new Error("The app shell overflows horizontally");
    }
    if (matchMedia("(min-width: 1184px)").matches) {
      await waitFor(() => document.querySelector(".desktop-sidebar"));
    } else {
      const trigger = document.querySelector(
        'button[aria-label="Open navigation"]',
      );
      const drawer = document.getElementById(
        trigger.getAttribute("aria-controls"),
      );
      trigger.click();
      await waitFor(
        () => drawer.open && trigger.getAttribute("aria-expanded") === "true",
      );
      if (
        !drawer.matches(":modal") ||
        !drawer.contains(document.activeElement)
      ) {
        throw new Error("Navigation did not open as a focused modal");
      }
      document.querySelector('button[aria-label="Close navigation"]').click();
      await waitFor(
        () => !drawer.open && trigger.getAttribute("aria-expanded") === "false",
      );
      if (document.activeElement !== trigger) {
        throw new Error("Navigation did not restore focus");
      }
    }

    for (const [command, args] of [
      ["layout_load", { workspaceId: "foreign-workspace" }],
      [
        "layout_save",
        {
          workspaceId: "foreign-workspace",
          expectedRevision: null,
          data: { version: 1, layout: {}, pinnedViews: [] },
        },
      ],
      ["ai_openai_start", { scope: "foreign-workspace" }],
      ["ai_conversations", { scope: "foreign-workspace" }],
      [
        "ai_conversation_read",
        { scope: "foreign-workspace", conversation: "ownership-probe" },
      ],
      [
        "ai_create_conversation",
        { scope: "foreign-workspace", id: "foreign", title: "Foreign" },
      ],
      ["ai_select_model", { scope: "foreign-workspace", model: "gpt-5.4" }],
      [
        "ai_conversation_snapshot",
        { scope: "foreign-workspace", conversation: "ownership-probe" },
      ],
      [
        "ai_conversation_action",
        {
          scope: "foreign-workspace",
          conversation: "ownership-probe",
          generation: crypto.randomUUID(),
          actionId: crypto.randomUUID(),
          action: {
            version: 1,
            type: "submit",
            input: { text: "Must not run", attachments: [], references: [] },
            timestamp: 1,
          },
        },
      ],
      [
        "plugin_development_status",
        { scope: "foreign-workspace", conversation: "ownership-probe" },
      ],
    ]) {
      let rejection;
      try {
        await invoke(command, args);
      } catch (error) {
        rejection = String(error);
      }
      if (rejection !== "native.workspace.session.inactive") {
        throw new Error(`${command} did not enforce workspace ownership`);
      }
    }

    const { current } = await invoke("workspace_snapshot");
    await invoke("smoke_login_ownership", { scope: current.id });
    const previous = await invoke("ai_conversations", { scope: current.id });
    const id = crypto.randomUUID();
    const args = { scope: current.id, conversation: id };
    const created = await invoke("ai_create_conversation", {
      scope: current.id,
      id,
      title: "Smoke conversation",
    });
    if (
      created.version !== 2 ||
      created.revision !== 0 ||
      created.messages.length ||
      created.draft ||
      created.development
    )
      throw new Error(
        "Fresh conversation contains history or development state",
      );
    const snapshot = await invoke("ai_conversation_snapshot", args);
    const expected = { text: "", attachments: [], references: [] };
    const input = { ...expected, text: "Unsent draft" };
    const actionId = crypto.randomUUID();
    const request = {
      ...args,
      generation: snapshot.generation,
      actionId,
      action: { version: 1, type: "draft", expected, input },
    };
    const saved = await invoke("ai_conversation_action", request);
    const replay = await invoke("ai_conversation_action", request);
    const reopened = await invoke("ai_conversation_read", args);
    if (
      saved.record.version !== 2 ||
      saved.record.draft !== input.text ||
      saved.record.messages.length ||
      saved.record.revision !== created.revision ||
      saved.position <= snapshot.position ||
      canonicalJson(replay.record) !== canonicalJson(saved.record) ||
      canonicalJson(reopened) !== canonicalJson(created)
    )
      throw new Error(
        "Native draft editing or receipt replay changed saved conversation state",
      );
    const reject = async (command, request, expected, message) => {
      let error;
      try {
        await invoke(command, request);
      } catch (failure) {
        error = String(failure);
      }
      if (
        expected instanceof RegExp
          ? !expected.test(error ?? "")
          : error !== expected
      )
        throw new Error(message);
    };
    await reject(
      "ai_conversation_action",
      { ...request, actionId: crypto.randomUUID() },
      "native.ai.conversation.conflict",
      "A stale draft field replacement was accepted",
    );
    await reject(
      "ai_conversation_action",
      {
        ...request,
        action: {
          ...request.action,
          input: { ...input, text: "Conflicting receipt" },
        },
      },
      "native.ai.conversation.conflict",
      "An action receipt was reused with different input",
    );
    await reject(
      "ai_conversation_action",
      {
        ...request,
        generation: crypto.randomUUID(),
        actionId: crypto.randomUUID(),
      },
      "native.ai.conversation.conflict",
      "A stale native generation was admitted",
    );
    await reject(
      "ai_conversation_action",
      {
        ...request,
        actionId: crypto.randomUUID(),
        action: { ...request.action, messages: [] },
      },
      "native.ai.conversation.versionInvalid",
      "A draft action accepted transcript replacement",
    );
    await reject(
      "ai_conversation_read",
      { ...args, record: reopened },
      "native.ai.conversation.versionInvalid",
      "The read-only getter accepted a replacement record",
    );
    await reject(
      "ai_create_conversation",
      {
        scope: current.id,
        id: crypto.randomUUID(),
        title: "Invalid execution state",
        initial: { draft: "", runtime: { runs: [] } },
      },
      /^(?:native\.ai\.conversation\.versionInvalid|invalid args[^\n]*unknown field .runtime.)/,
      "Conversation creation accepted execution state",
    );
    const status = await invoke("ai_status", { scope: current.id });
    if (status.config || status.available)
      throw new Error("Native smoke unexpectedly has AI provider access");
    const runId = crypto.randomUUID();
    const submitted = await invoke("ai_conversation_action", {
      ...args,
      generation: snapshot.generation,
      actionId: runId,
      action: {
        version: 1,
        type: "submit",
        input: {
          text: "Must not contact a provider",
          attachments: [],
          references: [],
        },
        timestamp: 1,
      },
    });
    if (submitted.actionId !== runId)
      throw new Error("Native submission lost its admitted action identity");
    const settled = await window.nativeSmokeWait.wait(
      async () => {
        const value = await invoke("ai_conversation_snapshot", args);
        return !value.taskActive && value;
      },
      "Provider-denied native admission did not drain",
      { timeout: 10000 },
    );
    const final = await invoke("ai_conversation_read", args);
    if (
      settled.error !== "native.ai.access.required" ||
      final.messages.length !== 1 ||
      final.messages[0].role !== "user" ||
      final.messages[0].content !== "Must not contact a provider" ||
      final.draft !== "" ||
      settled.record.draft !== input.text ||
      final.development ||
      final.runtime?.runs.length !== 1 ||
      final.runtime.runs[0].id !== runId ||
      final.runtime.runs[0].state !== "error" ||
      final.runtime.pending[0]?.text !== "Must not contact a provider"
    )
      throw new Error(
        `Provider-denied native submission lost retained input, changed history or did not settle with an error: ${JSON.stringify(
          {
            error: /^(?:native|chatQuestion|chat)\.[a-zA-Z0-9.]+$/.test(
              settled.error ?? "",
            )
              ? settled.error
              : "unrecognized",
            messageCount: final.messages.length,
            draftPreserved: settled.record.draft === input.text,
            unsavedDraftOnDisk: final.draft !== "",
            developmentPresent: !!final.development,
            runCount: final.runtime?.runs.length,
            runIdPreserved: final.runtime?.runs[0]?.id === runId,
            runState: final.runtime?.runs[0]?.state,
            pendingPreserved:
              final.runtime?.pending[0]?.text === "Must not contact a provider",
          },
        )}`,
      );
    const list = await invoke("ai_conversations", { scope: current.id });
    const expectedIds = new Set([id, ...previous.map((item) => item.id)]);
    if (
      list.length !== expectedIds.size ||
      new Set(list.map((item) => item.id)).size !== list.length ||
      list.some((item) => !expectedIds.has(item.id))
    )
      throw new Error(
        "Conversation index did not preserve exactly the created records",
      );

    // Persistence is exercised through real IPC, independently of unavailable chat actions.
    for (const text of [
      "  Hello, world 👋\nSecond line\t  ",
      "Replacement",
      "",
    ]) {
      await invoke("save_text", { text });
      await invoke("verify_smoke_text", { text });
    }
    await window.runPluginRuntimeSmoke();
    await window.runPluginChecksSmoke();
    await invoke("smoke_progress", { stage: "editor-start" });
    const navigation = document.querySelector(
      'button[aria-label="Open navigation"]',
    );
    if (navigation?.getClientRects().length) navigation.click();
    const conversationTitle = "Native editor conversation";
    const conversation = await waitFor(() =>
      [...document.querySelectorAll(".conversation-destination")].find(
        (button) => button.textContent.trim() === conversationTitle,
      ),
    );
    conversation.click();
    await waitFor(() => document.querySelector(".chat-pane textarea"));
    await window.runEditorSmoke(conversationTitle);
    await invoke("smoke_progress", { stage: "editor-finished" });
    await invoke("smoke_shell_ready");
  } catch (error) {
    await invoke("finish_smoke_test", { error: String(error) });
  }
})();
