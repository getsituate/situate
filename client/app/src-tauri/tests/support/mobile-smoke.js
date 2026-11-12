(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const wait = (check, message) =>
    window.nativeSmokeWait.wait(check, message, { timeout: 30000 });
  let stage = "bootstrap";
  try {
    const info = await invoke("mobile_smoke_info");
    if (info.phase === "cleanup") {
      await invoke("mobile_smoke_finish", { scope: null, failure: null });
      return;
    }
    const assert = (condition, message) => {
      if (!condition) throw new Error(message);
    };
    const sameIdentity = (actual, expected) =>
      actual &&
      Object.keys(actual).length === Object.keys(expected).length &&
      Object.keys(expected).every((key) => actual[key] === expected[key]);
    if (info.phase === "exercise") {
      stage = "workspace-parent";
      const parent = await invoke("smoke_parent");
      stage = "workspace-create";
      await invoke("smoke_create_fixture", {
        parent: parent.id,
        name: info.workspaceName,
      });
    }
    const opened = () =>
      wait(async () => {
        const snapshot = await invoke("workspace_snapshot");
        return (
          snapshot.ready &&
          snapshot.current?.name === info.workspaceName &&
          snapshot.current
        );
      }, "workspace-open");
    stage = "workspace-open";
    const workspace = await opened();
    const scope = workspace.id;
    stage = "workspace-prepare";
    await invoke("mobile_smoke_prepare", { scope });
    stage = "migration";
    const retained = await invoke("ai_conversation_snapshot", {
      scope,
      conversation: "compatibility",
    });
    assert(
      !retained.taskActive &&
        retained.record.draft === "written by A" &&
        !retained.record.runtime.runs.length,
      "migration-inactive-draft",
    );
    assert(
      retained.record.messages[0].content === "Retained synthetic message" &&
        retained.record.runtime.pending.length === 1 &&
        retained.record.runtime.pending[0].text === "Retained queued input" &&
        retained.record.runtime.pending[0].state === "pending",
      "migration-originals",
    );
    stage = "presentation";
    await wait(() => {
      document.querySelector(".unfolding-place button.skip")?.click();
      return document.querySelector(".topic-window");
    }, "application-shell");
    const conversation = info.conversation;
    const args = { scope, conversation };
    const file = (operation, extra = {}) =>
      invoke("files_request", {
        request: { workspaceId: scope, operation, ...extra },
      });
    if (info.phase === "exercise") {
      stage = "attachments";
      const text = await invoke("ai_attachment_put", {
        scope,
        mimeType: "text/plain",
        name: "ios-source.txt",
        bytes: Array.from(new TextEncoder().encode(info.textAttachment)),
      });
      const image = await invoke("ai_attachment_put", {
        scope,
        mimeType: "image/png",
        name: "ios-pixel.png",
        bytes: Array.from(atob(info.imageBase64), (character) =>
          character.charCodeAt(0),
        ),
      });
      stage = "references";
      assert(
        (
          await file("create", {
            path: "ios-reference.txt",
            text: info.referenceText,
          })
        ).status === "saved",
        "reference-source",
      );
      const captured = await file("captureReference", {
        path: "ios-reference.txt",
      });
      assert(
        captured.status === "ok" &&
          /^[a-f0-9]{40}$/.test(captured.reference.anchorRevision),
        "reference-captured",
      );
      stage = "conversation";
      await invoke("ai_create_conversation", {
        scope,
        id: conversation,
        title: "Native iOS smoke",
      });
      const initial = await invoke("ai_conversation_snapshot", args);
      const admitted = await invoke("ai_conversation_action", {
        ...args,
        generation: initial.generation,
        actionId: crypto.randomUUID(),
        action: {
          version: 1,
          type: "submit",
          input: {
            text: "Run the synthetic native iOS file and Worker checks.",
            attachments: [text, image],
            references: [captured.reference],
          },
          timestamp: Date.now(),
        },
      });
      assert(admitted.actionId, "admission-identity");
    }
    stage = "native-terminal";
    const terminal = await wait(async () => {
      const snapshot = await invoke("ai_conversation_snapshot", args);
      return (
        !snapshot.taskActive && snapshot.record.runtime?.runs.length && snapshot
      );
    }, "native-terminal");
    assert(
      !terminal.error &&
        terminal.record.version === 2 &&
        terminal.record.runtime.runs.at(-1).state === "completed",
      "native-result",
    );
    assert(
      terminal.record.messages.filter(
        (message) => message.role === "toolResult",
      ).length === 3,
      "native-tools",
    );
    const executor = (request) => invoke("plugin_executor", { scope, request });
    const descriptor = async () => {
      const snapshot = await executor({ operation: "snapshot" });
      const found = snapshot.plugins.find(
        (plugin) => plugin.pluginId === "native-ios-worker",
      );
      assert(found, "native-service");
      return found;
    };
    async function startWorker(exportName, path, text) {
      const service = await descriptor();
      const running = executor({
        operation: "invoke",
        pluginId: service.pluginId,
        generation: service.generation,
        exportName,
        args: {},
      });
      const outcome = running.then(
        (value) => ({ value }),
        () => ({ rejected: true }),
      );
      await wait(async () => {
        const listing = await file("snapshot");
        if (!listing.snapshot?.entries.some((entry) => entry.path === path))
          return false;
        const result = await file("read", { path });
        return (
          result.status === "ok" &&
          result.document.version.text === text &&
          (await executor({ operation: "activity" })).runningActions > 0
        );
      }, "worker-running");
      return { outcome, service };
    }
    if (info.phase === "exercise") {
      stage = "worker-enter";
      const { outcome } = await startWorker(
        "hang",
        "ios-worker-running.txt",
        "Synthetic Worker entered\n",
      );
      stage = "worker-stop";
      assert(window.nativeIOSCloseTrace, "close-trace-installed");
      window.nativeIOSCloseTrace.start();
      let stopped;
      try {
        stopped = await executor({ operation: "stop" });
      } catch (error) {
        window.nativeIOSCloseTrace.recordFailure(
          "plugin_executor",
          "stop",
          error,
        );
        throw error;
      } finally {
        window.nativeIOSCloseTrace.stop();
      }
      assert(stopped.runningActions === 0, "worker-drained");
      stage = "worker-outcome";
      const ended = await outcome;
      assert(
        ended.rejected || ended.value.outcome !== "completed",
        "worker-interrupted",
      );
      stage = "worker-idle";
      assert(
        (await executor({ operation: "activity" })).runningActions === 0,
        "worker-idle",
      );
      stage = "references";
      assert(
        (
          await file("rename", {
            path: "ios-reference.txt",
            destination: "ios-reference-moved.txt",
          })
        ).status === "ok",
        "reference-moved",
      );
      stage = "presentation";
      await showConversation(retained.record.title);
      const pendingToggle = await wait(
        () =>
          document.querySelector(
            '.chat-pane .pending-toggle[aria-expanded="false"]',
          ),
        "migration-pending-control",
      );
      pendingToggle.click();
      await wait(() => {
        const pane = document.querySelector(".chat-pane");
        const draft = pane?.querySelector("textarea");
        const queued = pane?.querySelector(".pending-preview");
        return (
          draft?.getClientRects().length &&
          draft.value === "written by A" &&
          pane.textContent.includes("Retained synthetic message") &&
          queued?.getClientRects().length &&
          queued.textContent.trim() === "Retained queued input"
        );
      }, "migration-conversation-presentation");
      stage = "workspace-close";
      const closing = await startWorker(
        "hangClose",
        "ios-worker-closing.txt",
        "Synthetic closing Worker entered\n",
      );
      const closeDialog = async () => {
        assert(
          !(await invoke("workspace_action", { action: "close", id: scope })),
          "close-must-wait",
        );
        return wait(
          () =>
            document.querySelector(
              'dialog[open][aria-labelledby="close-ai-title"]',
            ),
          "close-dialog",
        );
      };
      stage = "workspace-close-dialog";
      const cancelling = await closeDialog();
      stage = "workspace-close-cancel";
      cancelling.querySelectorAll("button")[0].click();
      await wait(
        () =>
          !document.querySelector(
            'dialog[open][aria-labelledby="close-ai-title"]',
          ),
        "cancel-close",
      );
      assert(
        (await executor({ operation: "activity" })).runningActions > 0,
        "cancel-kept-worker",
      );
      stage = "workspace-close-dialog";
      const aborting = await closeDialog();
      stage = "workspace-close-drain";
      assert(window.nativeIOSCloseTrace, "close-trace-installed");
      window.nativeIOSCloseTrace.start();
      aborting.querySelectorAll("button")[1].click();
      await wait(
        async () => !(await invoke("workspace_snapshot")).current,
        "workspace-closed",
      );
      const closedWorker = await closing.outcome;
      assert(
        closedWorker.rejected || closedWorker.value.outcome !== "completed",
        "close-drained-worker",
      );
      let refused = false;
      try {
        await invoke("ai_conversation_snapshot", args);
      } catch {
        refused = true;
      }
      assert(refused, "closed-workspace-authority");
      stage = "workspace-reopen";
      await invoke("workspace_action", { action: "open", id: scope });
      assert((await opened()).id === scope, "reopened-identity");
      const reopened = await invoke("ai_conversation_snapshot", args);
      assert(
        reopened.generation !== terminal.generation &&
          !reopened.taskActive &&
          !reopened.error,
        "reopened-owner",
      );
      refused = false;
      try {
        await invoke("ai_conversation_action", {
          ...args,
          generation: terminal.generation,
          actionId: crypto.randomUUID(),
          action: {
            version: 1,
            type: "draft",
            expected: { text: "", attachments: [], references: [] },
            input: {
              text: "Stale generation must not mutate",
              attachments: [],
              references: [],
            },
          },
        });
      } catch {
        refused = true;
      }
      assert(refused, "reopened-generation-authority");
      assert(
        (await executor({ operation: "activity" })).runningActions === 0,
        "reopened-worker-idle",
      );
    }
    stage = "attachments";
    const history = await invoke("ai_conversation_history", {
      ...args,
      before: null,
      limit: 128,
    });
    const submitted = history.entries.find(
      (entry) => entry.type === "message" && entry.data.input,
    );
    assert(
      submitted?.data.input.attachments.length === 2 &&
        submitted.data.input.references.length === 1,
      "retained-input",
    );
    for (const [index, expected] of [
      [0, Array.from(new TextEncoder().encode(info.textAttachment))],
      [
        1,
        Array.from(atob(info.imageBase64), (character) =>
          character.charCodeAt(0),
        ),
      ],
    ]) {
      const attachment = submitted.data.input.attachments[index];
      const read = await invoke("ai_attachment_read", {
        scope,
        id: attachment.id,
      });
      assert(
        sameIdentity(read.reference, attachment) &&
          JSON.stringify(read.bytes) === JSON.stringify(expected),
        "retained-attachment-bytes",
      );
    }
    stage = "references";
    const reference = submitted.data.input.references[0];
    const resolved = await file("resolveReference", { reference });
    assert(
      resolved.status === "ok" &&
        resolved.document.path === "ios-reference-moved.txt" &&
        resolved.document.version.text === info.referenceText &&
        sameIdentity(resolved.reference, reference),
      "retained-reference",
    );
    stage = "presentation";
    async function showConversation(title = terminal.record.title) {
      if (
        !document.querySelector(".conversation-destination")?.getClientRects()
          .length
      ) {
        const navigation = [
          ...document.querySelectorAll(
            "button.open-navigation, button.files-navigation",
          ),
        ].find((button) => button.getClientRects().length);
        navigation?.click();
      }
      const workspaceMenu = await wait(
        () =>
          [...document.querySelectorAll("button.workspace-menu")].find(
            (button) => button.getClientRects().length,
          ),
        "workspace-context-control",
      );
      workspaceMenu.click();
      await wait(
        () =>
          [
            ...document.querySelectorAll(
              '.workspace-actions .current-workspace[aria-current="true"]',
            ),
          ].some(
            (item) =>
              item.getClientRects().length &&
              item
                .querySelector('[data-localization-content="user"]')
                ?.textContent.trim() === info.workspaceName,
          ),
        "visible-workspace-context",
      );
      workspaceMenu.click();
      await wait(
        () =>
          ![
            ...document.querySelectorAll(
              '.workspace-actions .current-workspace[aria-current="true"]',
            ),
          ].some((item) => item.getClientRects().length),
        "workspace-context-dismissed",
      );
      const destination = await wait(
        () =>
          [...document.querySelectorAll(".conversation-destination")].find(
            (button) =>
              button.getClientRects().length &&
              button
                .querySelector(".conversation-title")
                ?.textContent.trim() === title,
          ),
        "conversation-navigation",
      );
      destination.click();
      await wait(
        () => document.querySelector(".chat-pane .messages"),
        "conversation-presentation",
      );
    }
    await showConversation();
    for (const toggle of document.querySelectorAll(
      '.work-history-toggle[aria-expanded="false"]',
    ))
      toggle.click();
    const presentedImage = await wait(
      () => document.querySelector(".chat-pane .chat-image img"),
      "attachment-image",
    );
    presentedImage.scrollIntoView({ block: "center" });
    await wait(() => {
      const image = document.querySelector(".chat-pane .chat-image img");
      return (
        image?.complete &&
        image.naturalWidth === 1 &&
        image.naturalHeight === 1 &&
        image.getClientRects().length &&
        document
          .querySelector(".chat-pane")
          .textContent.includes(info.textAttachment.trim())
      );
    }, "attachment-presentation");
    const referenceButton = await wait(
      () =>
        [
          ...document.querySelectorAll(".submitted-references .reference-open"),
        ].find((button) => button.textContent.includes(reference.path)),
      "reference-presentation",
    );
    referenceButton.click();
    await wait(
      () =>
        document
          .querySelector(".files-pane .document-location h3")
          ?.textContent.trim() === "ios-reference-moved.txt" &&
        (document
          .querySelector(".files-pane .text-document")
          ?.textContent.includes(info.referenceText.trim()) ||
          document
            .querySelector(".files-pane .source-text")
            ?.value.includes(info.referenceText.trim())),
      "reference-navigation",
    );
    await showConversation();
    stage = "worker-readback";
    const service = await descriptor();
    const readback = await executor({
      operation: "invoke",
      pluginId: service.pluginId,
      generation: service.generation,
      exportName: "readEffect",
      args: {},
    });
    assert(
      readback.outcome === "completed" &&
        readback.value === "Synthetic iOS Worker effect\n",
      "worker-restart",
    );
    stage = "verify";
    window.nativeIOSCloseTrace?.stop();
    await invoke("mobile_smoke_finish", {
      scope,
      failure: null,
      ipcTrace: window.nativeIOSCloseTrace?.snapshot(),
    });
  } catch {
    window.nativeIOSCloseTrace?.stop();
    await invoke("mobile_smoke_finish", {
      scope: null,
      failure: stage,
      ipcTrace: window.nativeIOSCloseTrace?.snapshot(),
    });
  }
})();
