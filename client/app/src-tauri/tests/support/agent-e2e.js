(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  let stage = "startup";
  const initialText = "# E2E note\n\nAlpha marker\n";
  const finalText = "# E2E note\n\nBeta marker\n";
  const primaryDraft = "Unsent Alpha conversation draft";
  const secondaryDraft = "Unsent Beta workspace draft";
  const greeting = "[e2e:greeting] Hello. Reply briefly without using tools.";
  const secondaryMarker = "[e2e:greeting] Beta workspace";
  const separateMarker = "[e2e:greeting] Start a separate conversation";
  const recalledInputs = [
    "[e2e:steering] Keep the reply brief.",
    "[e2e:followup] Then acknowledge the follow-up.",
  ];
  const consumedInputs = [
    "[e2e:steering] Keep this answer short.",
    "[e2e:followup] Afterward acknowledge this request.",
  ];
  const create =
    "[e2e:create] Complete all three steps before replying: " +
    '1. Call read with {"path":"seed.md"}. ' +
    "2. Create the new file by calling write with these exact arguments: " +
    JSON.stringify({
      path: "e2e-note.md",
      text: initialText,
      expectedRevision: null,
    }) +
    '. 3. Call read with {"path":"e2e-note.md"} to verify the saved content. ' +
    "Do not stop after reading seed.md. Use read and write, not conversation, history or shell tools.";
  const edit =
    '[e2e:edit] Complete all three steps before replying: 1. Call read with {"path":"e2e-note.md"} for its current text and revision. ' +
    "2. Call edit for e2e-note.md with expectedRevision set to the exact revision returned by that read, and edits set to " +
    JSON.stringify([{ oldText: "Alpha marker", newText: "Beta marker" }]) +
    '. 3. Call read with {"path":"e2e-note.md"} to verify the saved change. ' +
    "Use read and edit, not read_revision, conversation, history or shell tools.";
  const snapshot = () => invoke("agent_e2e_snapshot");
  const liveSnapshot = (conversation) =>
    invoke("ai_conversation_snapshot", {
      scope: info.scope,
      conversation,
    });
  let info;
  let importObservation;
  const assert = (condition, code) => {
    if (!condition) throw new Error(code);
  };
  const visible = (element) =>
    !!element &&
    element.getClientRects().length > 0 &&
    !element.closest("[inert]");
  const query = (selector) =>
    [...document.querySelectorAll(selector)].find(visible);
  const buttonText = (element) => {
    const copy = element.cloneNode(true);
    for (const hidden of copy.querySelectorAll('[aria-hidden="true"]'))
      hidden.remove();
    return copy.textContent.trim();
  };
  const button = (label) =>
    [...document.querySelectorAll("button")].find(
      (element) =>
        visible(element) &&
        (element.getAttribute("aria-label") === label ||
          buttonText(element) === label),
    );
  const field = () => query(".chat-pane .chat-composer textarea");
  async function wait(code, check, timeout = 45000) {
    stage = code;
    return window.nativeSmokeWait.wait(
      async () => {
        if (info?.role === "primary") {
          await invoke("agent_e2e_info");
          if (document.visibilityState === "hidden" || !document.hasFocus())
            return false;
        }
        const warning = document.querySelector("dialog.model-error[open]");
        if (warning && info) {
          assert(
            warning.querySelector('[role="alert"]')?.textContent.trim() ===
              "The model list could not be refreshed. You can still choose a compatible model manually. Your saved choice has not changed.",
            "unexpected-model-recovery",
          );
          const status = await invoke("ai_status", { scope: info.scope });
          assert(
            status.catalog?.source === "unknown" &&
              status.available &&
              !status.modelError &&
              status.selectedModel === info.model,
            "alert-model-unavailable",
          );
          const dismiss = [...warning.querySelectorAll("button")].find(
            (element) => buttonText(element) === "Dismiss",
          );
          assert(
            dismiss && !dismiss.disabled,
            "model-warning-dismiss-unavailable",
          );
          dismiss.click();
          return false;
        }
        return check();
      },
      code,
      { timeout, interval: 30 },
    );
  }
  function fill(element, value) {
    assert(
      element && !element.disabled && !element.readOnly,
      "input-unavailable",
    );
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
  async function click(label) {
    const target = await wait(
      "control-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      () => {
        const found = button(label);
        return found && !found.disabled && found;
      },
    );
    target.click();
  }
  async function navigation() {
    if (!query(".app-sidebar")) await click("Open navigation");
    await wait("navigation-visible", () => query(".app-sidebar"));
  }
  function allRuns(record) {
    return record.runtime?.runs ?? [];
  }
  function findRecord(state, marker) {
    return state.conversations.find((record) =>
      record.messages.some(
        (message) =>
          message.role === "user" && userText(message).includes(marker),
      ),
    );
  }
  function userText(message) {
    return typeof message.content === "string"
      ? message.content
      : message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");
  }
  async function historyEntry(conversation, matches) {
    let before = null;
    do {
      const page = await invoke("ai_conversation_history", {
        scope: info.scope,
        conversation,
        before,
        limit: 100,
      });
      const found = [...page.entries].reverse().find(matches);
      if (found) return found;
      assert(
        !page.nextBefore || page.nextBefore !== before,
        "history-page-stalled",
      );
      before = page.nextBefore;
    } while (before);
  }
  async function savedHistorySnapshot() {
    const state = await snapshot();
    for (const record of state.conversations) {
      const pages = [];
      let before = null;
      do {
        const page = await invoke("ai_conversation_history", {
          scope: info.scope,
          conversation: record.id,
          before,
          limit: 100,
        });
        assert(
          page.metadata.revision === record.revision,
          "history-revision-changed",
        );
        pages.push(page.entries);
        assert(
          !page.nextBefore || page.nextBefore !== before,
          "history-page-stalled",
        );
        before = page.nextBefore;
      } while (before);
      const entries = pages.reverse().flat();
      const runs = new Map();
      for (const entry of entries)
        if (entry.type === "run") runs.set(entry.data.id, entry.data);
      record.messages = entries
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.data.message);
      record.runtime = {
        ...record.runtime,
        events: entries
          .filter((entry) => entry.type === "event")
          .map((entry) => entry.data),
        runs: [...runs.values()],
      };
    }
    return state;
  }
  async function inputHistory(conversation, marker) {
    const entry = await historyEntry(
      conversation,
      (entry) =>
        entry.type === "message" &&
        entry.data.message.role === "user" &&
        userText(entry.data.message).includes(marker),
    );
    assert(typeof entry?.data.input?.id === "string", "input-history-missing");
    const status = await historyEntry(
      conversation,
      (status) =>
        status.type === "inputStatus" &&
        status.data.inputId === entry.data.input.id,
    );
    return { entry, state: status?.data.state ?? entry.data.input.state };
  }
  async function verifyInputAttachments(
    conversation,
    originals,
    code,
    marker = "[e2e:onboarding-import]",
  ) {
    const retained = await inputHistory(conversation, marker);
    assert(retained.state === "consumed", code);
    for (const [name, original] of originals) {
      const reference = retained.entry.data.input.attachments?.find(
        (attachment) => attachment.name === name,
      );
      assert(reference, code);
      const stored = await invoke("ai_attachment_read", {
        scope: info.scope,
        id: reference.id,
      });
      assert(
        stored.reference.id === reference.id &&
          stored.reference.name === name &&
          stored.reference.mimeType === reference.mimeType &&
          stored.reference.size === reference.size &&
          stored.bytes.length === reference.size &&
          new TextDecoder("utf-8", { fatal: true }).decode(
            new Uint8Array(stored.bytes),
          ) === original.text,
        code,
      );
    }
  }
  async function concurrentConversationReads() {
    const conversation = (await snapshot()).conversations[0]?.id;
    assert(conversation, "concurrent-read-conversation-missing");
    const reads = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        invoke(
          index % 2 ? "ai_conversation_read" : "ai_status",
          index % 2
            ? { scope: info.scope, conversation }
            : { scope: info.scope },
        ),
      ),
    );
    assert(
      reads.every((result) => result.status === "fulfilled"),
      reads.some(
        (result) =>
          result.status === "rejected" &&
          String(result.reason) === "native.ai.storage.busy",
      )
        ? "status-conversation-storage-busy"
        : "status-concurrent-read-failed",
    );
    for (const [index, result] of reads.entries()) {
      if (index % 2 === 0)
        assert(
          result.value.selectedModel === info.model && result.value.available,
          "status-concurrent-model-mismatch",
        );
    }
  }
  async function send(text) {
    const input = await wait("composer-ready", () => {
      const input = field();
      return input && !input.disabled && !input.readOnly && input;
    });
    fill(input, text);
    await click("Send message");
  }
  async function queueInput(altKey = false) {
    await wait("queue-input-ready", () => {
      const control = button("Queue steering");
      return control && !control.disabled;
    });
    field().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", altKey, bubbles: true }),
    );
  }
  async function completed(marker) {
    const record = await wait(
      "durable-" + marker.replace(/[^a-z0-9]+/g, "-"),
      async () => {
        const state = await snapshot();
        const found = findRecord(state, marker);
        await verifyAlerts(state, found);
        if (!found || button("Stop response")) return false;
        const last = allRuns(found).at(-1);
        if (!last || last.state === "running") return false;
        assert(last.state === "completed", "run-not-completed");
        assert(
          found.messages.at(-1)?.role === "assistant",
          "final-assistant-missing",
        );
        return found;
      },
      // A live turn may span several requests; the outer journey deadline still applies.
      info.mode === "live" ? 120000 : 45000,
    );
    assert(
      record.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some(
            (block) => block.type === "text" && block.text.trim(),
          ),
      ),
      "assistant-text-missing",
    );
    return record;
  }
  async function verifyAlerts(state, found) {
    for (const alert of document.querySelectorAll(
      '.chat-pane [role="alert"]',
    )) {
      if (visible(alert)) {
        assert(
          !query(".chat-pane .unsaved-conversation"),
          "conversation-save-error",
        );
        assert(
          found?.messages.at(-1)?.stopReason !== "error",
          "assistant-stream-error",
        );
        const origin = alert.closest(".model-picker") ? "model" : "chat";
        const message = (alert.querySelector("p") ?? alert).textContent.trim();
        if (
          origin === "model" &&
          message ===
            "The model list could not be refreshed. You can still choose a compatible model manually. Your saved choice has not changed."
        ) {
          const status = await invoke("ai_status", { scope: info.scope });
          assert(
            status.catalog?.source === "unknown" &&
              status.available &&
              !status.modelError &&
              status.selectedModel === info.model &&
              state.settings.chat?.model === info.model,
            "alert-model-unavailable",
          );
          continue;
        }
        const reason =
          new Map([
            [
              "AI access or conversation history could not be read. Check workspace storage and try again.",
              "history-read",
            ],
            ["Model choices could not be read.", "model-choices"],
            [
              "The saved chat model is unavailable or could not be read. Choose a model again.",
              "model-unavailable",
            ],
            [
              "AI access is being updated in another session. Try again when it finishes.",
              "storage-busy",
            ],
            [
              "The response could not start. Check AI access, the selected model and workspace storage, then try again.",
              "response-start",
            ],
            [
              "The response failed. Check AI access, reconnect if your key was rejected or expired, and try again.",
              "response-failed",
            ],
          ]).get(message) ?? "other";
        throw new Error(`alert-${origin}-${reason}`);
      }
    }
  }
  function verifyPublishedDocuments(record, documents) {
    const results = record.messages.filter(
      (message) => message.role === "toolResult" && !message.isError,
    );
    for (const document of documents) {
      assert(
        results.some((result) =>
          result.toolName === "create_batch"
            ? result.details?.historyRevision &&
              result.details.files?.some(
                (file) =>
                  file.path === document.path &&
                  file.revision === document.version.revision,
              )
            : result.details?.change?.path === document.path &&
              result.details.change.afterRevision ===
                document.version.revision &&
              result.details.change.after === document.version.text,
        ),
        "published-destination-revision-mismatch",
      );
    }
  }
  function verifyTools(record) {
    const calls = record.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) =>
        message.content.filter((block) => block.type === "toolCall"),
      );
    const results = record.messages.filter(
      (message) => message.role === "toolResult",
    );
    assert(
      calls.length > 0 &&
        calls.every((call) =>
          results.some(
            (result) =>
              result.toolCallId === call.id && result.toolName === call.name,
          ),
        ),
      "tool-results-unpaired",
    );
    assert(
      results.every((result) => !result.isError),
      "tool-execution-failed",
    );
    const mutations = results.filter((result) => result.details?.change);
    assert(
      mutations.some((result) => result.details.change.after === initialText),
      "initial-version-missing",
    );
    assert(
      mutations.some(
        (result) =>
          result.details.change.before &&
          result.details.change.before === initialText &&
          result.details.change.after === finalText,
      ),
      "edited-version-missing",
    );
    assert(
      mutations.every((result) => result.details.change.afterRevision),
      "mutation-revision-missing",
    );
    const events = record.runtime?.events ?? [];
    for (const call of calls) {
      const intent = events.find(
        (event) =>
          event.type === "tool_intent" && event.data.toolCallId === call.id,
      );
      assert(
        intent &&
          events.some(
            (event) =>
              event.type === "tool_execution_end" &&
              event.runId === intent.runId &&
              event.data.toolCallId === call.id,
          ),
        "durable-tool-outcome-missing",
      );
    }
    const assistants = record.messages.filter(
      (message) => message.role === "assistant" && message.usage,
    );
    assert(
      assistants.some((message) => message.usage.cost.total > 0),
      "provider-cost-not-exercised",
    );
    for (const run of allRuns(record)) {
      for (const entry of run.usage ?? []) {
        if (entry.kind !== "main" || entry.usage == null) continue;
        assert(
          assistants.some((message) =>
            Object.keys(entry.usage.cost).every(
              (key) => message.usage.cost[key] === entry.usage.cost[key],
            ),
          ),
          "usage-cost-mismatch",
        );
      }
    }
  }
  async function selectConversation(title) {
    await navigation();
    const target = await wait("conversation-destination", () =>
      [...document.querySelectorAll(".conversation-destination")].find(
        (element) =>
          visible(element) &&
          element.querySelector("span")?.textContent === title,
      ),
    );
    target.click();
    await wait(
      "conversation-selected",
      () =>
        field()?.closest(".pane-tile")?.getAttribute("aria-label") ===
        `Pane: ${title}`,
    );
  }
  async function settings() {
    await navigation();
    const control = await wait("settings-navigation", () =>
      query(".settings-action"),
    );
    control.click();
    const ai = await wait("ai-settings-category", () =>
      [...document.querySelectorAll(".settings-categories button")].find(
        (element) => visible(element) && element.textContent.includes("AI"),
      ),
    );
    ai.click();
    await wait(
      "ai-settings-ready",
      () => query("#settings-inline") && !query("#settings-inline").disabled,
    );
    const advanced = query(".ai-settings details.advanced-settings");
    if (advanced && !advanced.open) advanced.querySelector("summary").click();
  }
  async function toggle(id, checked) {
    const control = await wait("setting-" + id, () => {
      const element = query("#" + id);
      return element && !element.disabled && element;
    });
    if (control.checked !== checked) control.click();
    await wait("setting-saved-" + id, async () => {
      const saved = (await snapshot()).settings;
      return (
        saved?.[
          id === "settings-inline" ? "showInlineModel" : "generatedComments"
        ] === checked && !control.disabled
      );
    });
  }
  async function attach(file) {
    const input = await wait("attachment-control", () =>
      document.querySelector('.chat-pane input[type="file"]'),
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await wait("attachment-retained", () =>
      [...document.querySelectorAll(".draft-attachment")].some(
        (element) =>
          visible(element) && element.textContent.includes(file.name),
      ),
    );
  }
  async function onboardingJourney() {
    if (info.role === "secondary") {
      assert(
        (await snapshot()).conversations.every(
          (record) => !record.messages.length,
        ),
        "onboarding-cross-workspace-transcript",
      );
      await invoke("agent_e2e_ready");
      return;
    }
    const load = () => invoke("onboarding_load", { scope: info.scope });
    const files = (operation, extra = {}) =>
      invoke("files_request", {
        request: { workspaceId: info.scope, operation, ...extra },
      });
    const read = async (path) => {
      if (path === "seed.json" || path === "seed.md") {
        const source = (await snapshot()).sourceFiles.find(
          (file) => file.path === path,
        );
        assert(source, "onboarding-source-file-missing");
        return { text: source.text, revision: source.revision };
      }
      const result = await files("read", { path });
      assert(result.status === "ok", "onboarding-file-unreadable");
      return result.document.version;
    };
    const repeat =
      "[e2e:onboarding-repeat] Import the same unchanged attachments from this conversation again. Reconcile with imported-tasks.md and imported-notes.md already created by this conversation. Do not duplicate tasks or files, rewrite unchanged content, change identities or modify either source. Show the same persisted destination files when finished.";
    async function inspectImport({ later = false, conversation } = {}) {
      const inspected = await files("inspectTasks", {
        path: later ? "later-imported-tasks.md" : "imported-tasks.md",
      }).catch(() => {
        throw new Error("onboarding-task-inspection-failed");
      });
      importObservation = {
        identifiedTasks: inspected.tasks?.length ?? 0,
        metadataIssues: inspected.document?.issues?.length ?? 0,
      };
      assert(inspected.status === "ok", "onboarding-task-file-unavailable");
      assert(inspected.tasks.length === 2, "onboarding-task-count-mismatch");
      assert(
        !inspected.document.issues.length,
        "onboarding-task-metadata-invalid",
      );
      const tasks = inspected.tasks;
      for (const expected of [
        {
          title: "Book the garden visit",
          done: false,
          sourceId: "garden-17",
          created: "2030-03-01",
          due: "2030-04-17",
          routingCode: "river-east",
        },
        {
          title: "File the itinerary",
          done: true,
          sourceId: "garden-18",
          created: "2030-03-02",
          due: "2030-04-10",
          routingCode: "hill-west",
        },
      ]) {
        const task = tasks.find((task) => task.text.includes(expected.title));
        assert(
          task && task.completed === expected.done,
          "onboarding-task-meaning-changed",
        );
        const next = tasks
          .filter((other) => other.checkboxOffset > task.checkboxOffset)
          .sort((left, right) => left.checkboxOffset - right.checkboxOffset)[0];
        const block = inspected.document.version.text.slice(
          task.checkboxOffset,
          next?.checkboxOffset,
        );
        const metadata = [...block.matchAll(/<!--([\s\S]*?)-->/g)]
          .map((match) => {
            try {
              return JSON.parse(match[1]);
            } catch {
              return null;
            }
          })
          .find((value) => value?.["situate-task-id"] === task.id);
        assert(metadata, "onboarding-task-metadata-missing");
        for (const key of ["sourceId", "created", "due", "routingCode"])
          assert(
            metadata[key] === expected[key],
            "onboarding-task-fields-lost",
          );
      }
      assert(
        new Set(tasks.map((task) => task.id)).size === 2,
        "onboarding-task-identity-duplicated",
      );
      const notes = await files("inspectTasks", {
        path: later ? "later-imported-notes.md" : "imported-notes.md",
      }).catch(() => {
        throw new Error("onboarding-note-inspection-failed");
      });
      assert(notes.status === "ok", "onboarding-note-file-unavailable");
      assert(!notes.document.issues.length, "onboarding-note-metadata-invalid");
      assert(!notes.tasks.length, "onboarding-checklist-converted-to-task");
      assert(
        notes.document.version.text === (await read("seed.md")).text,
        "onboarding-note-source-changed",
      );
      const checkboxes = new DOMParser()
        .parseFromString(notes.document.html, "text/html")
        .querySelectorAll('input[type="checkbox"]');
      assert(
        checkboxes.length === 1 && !checkboxes[0].checked,
        "onboarding-checklist-state-changed",
      );
      conversation ??= await setupConversation();
      const references = (conversation?.messages ?? [])
        .filter((message) => message.role === "toolResult")
        .flatMap((message) =>
          message.toolName === "create_batch"
            ? (message.details?.references ?? [])
            : message.toolName === "show_imported_files"
              ? (message.details?.files ?? [])
              : [],
        );
      assert(
        new Set(references.map((reference) => reference.path)).size === 2 &&
          references.every(
            (reference) =>
              reference.kind === "live" &&
              /^[0-9a-f]{40}$/.test(reference.anchorRevision) &&
              !Object.hasOwn(reference, "fileId"),
          ),
        "onboarding-import-references-invalid",
      );
      for (const document of [inspected.document, notes.document]) {
        const reference = references.find(
          (reference) => reference.path === document.path,
        );
        assert(reference, "onboarding-destination-reference-missing");
        const resolved = await files("resolveReference", { reference });
        assert(
          resolved.status === "ok" &&
            resolved.document.path === document.path &&
            resolved.document.version.revision === document.version.revision &&
            resolved.document.version.text === document.version.text,
          "onboarding-destination-reference-mismatch",
        );
      }
      assert(
        tasks.every((task) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            task.id,
          ),
        ),
        "import-task-uuid-invalid",
      );
      verifyPublishedDocuments(conversation, [
        inspected.document,
        notes.document,
      ]);
      return {
        tasks,
        taskVersion: inspected.document.version,
        noteVersion: notes.document.version,
      };
    }
    const sameImport = (left, right) =>
      ["taskVersion", "noteVersion"].every(
        (key) =>
          left[key].text === right[key].text &&
          left[key].revision === right[key].revision,
      ) &&
      left.tasks.length === right.tasks.length &&
      left.tasks.every((task, index) =>
        ["id", "text", "completed", "checkboxOffset"].every(
          (key) => task[key] === right.tasks[index][key],
        ),
      );
    const setupConversation = async () => {
      const current = await load();
      return (await snapshot()).conversations.find(
        (record) => record.id === current.record.conversationId,
      );
    };
    const pendingQuestion = (record) => {
      const events = record?.runtime?.events ?? [];
      const shown = events
        .filter((event) => event.type === "question_presented")
        .at(-1);
      return shown &&
        !events.some(
          (event) =>
            event.type === "question_answered" &&
            event.data.questionId === shown.data.id,
        )
        ? shown.data
        : undefined;
    };
    const question = (action, previousId) =>
      wait("onboarding-question-" + action, async () => {
        const record = await setupConversation();
        const pending = pendingQuestion(record);
        return (
          !button("Stop response") &&
          pending?.context?.action === action &&
          pending.id !== previousId &&
          pending
        );
      });
    const choose = async (action, id) => {
      const current = await question(action);
      const suggestion = current.suggestions?.find((item) => item.id === id);
      assert(suggestion, "onboarding-known-suggestion-missing");
      await click(suggestion.label);
      await wait("onboarding-action-durable", async () => {
        const events = (await setupConversation()).runtime.events;
        const answered = events.filter(
          (event) =>
            event.type === "question_answered" &&
            event.data.questionId === current.id,
        );
        const completed = events.filter(
          (event) =>
            event.type === "question_action_completed" &&
            event.data.questionId === current.id,
        );
        assert(
          answered.length <= 1 && completed.length <= 1,
          "onboarding-question-repeated",
        );
        return answered.length === 1 && completed.length === 1;
      });
      return current;
    };
    const actionPending = (record) => {
      const events = record?.runtime?.events ?? [];
      return events.some(
        (event) =>
          event.type === "question_answered" &&
          events.some(
            (shown) =>
              shown.type === "question_presented" &&
              shown.data.id === event.data.questionId &&
              shown.data.context,
          ) &&
          !events.some(
            (ended) =>
              ["question_action_completed", "question_superseded"].includes(
                ended.type,
              ) && ended.data.questionId === event.data.questionId,
          ),
      );
    };
    const settled = (previousRuns = -1) =>
      wait("onboarding-conversation-settled", async () => {
        const current = await load();
        const live = await liveSnapshot(current.record.conversationId);
        if (
          live.taskActive ||
          live.questionBusy ||
          actionPending(live.record) ||
          button("Stop response")
        )
          return false;
        const record = await setupConversation();
        await verifyAlerts(await snapshot(), record);
        const last = allRuns(record ?? {}).at(-1);
        if (
          allRuns(record ?? {}).length <= previousRuns ||
          !last ||
          last.state === "running" ||
          button("Stop response")
        )
          return false;
        assert(last.state === "completed", "onboarding-run-not-completed");
        return record;
      });
    const saved = await load();
    if (info.phase === "exercise") {
      assert(
        saved.record?.step === "access",
        "onboarding-initial-progress-missing",
      );
      assert(
        !(await snapshot()).conversations.some(
          (record) => record.messages.length,
        ),
        "onboarding-access-request-not-explicit",
      );
      const originals = {
        json: await read("seed.json"),
        markdown: await read("seed.md"),
      };
      if (info.mode === "fixture")
        await wait(
          "onboarding-access-model-ready",
          () =>
            query(".setup-access-panel .model-picker .error-trigger") &&
            !document.querySelector("dialog.model-error[open]"),
        );
      await click("Check and continue");
      await wait(
        "onboarding-access-checked",
        async () => (await load()).record.step === "method",
      );
      fill(
        await wait("onboarding-initial-sources", () =>
          query('textarea[id$="-sources"]'),
        ),
        "I will attach a JSON task export and a Markdown note. Wait for the attachments before importing.",
      );
      fill(
        await wait("onboarding-initial-preferences", () =>
          query('textarea[id$="-preferences"]'),
        ),
        "[e2e:onboarding-method] Review tasks each Friday. Keep notes and tasks in Markdown with task identities. Preserve source content and task metadata, and keep created and due dates distinct. Never change source originals.",
      );
      await click("Start setting up my workspace");
      const firstMethodQuestion = await question("method");
      const firstProposal = await load();
      const conversationId = firstProposal.record.conversationId;
      assert(
        conversationId &&
          !firstProposal.record.methodConversationId &&
          !firstProposal.record.sourceConversationId &&
          !firstProposal.record.supportConversationId,
        "onboarding-conversation-split",
      );
      assert(
        firstProposal.record.step === "proposal" &&
          /Friday/i.test(firstProposal.record.proposal),
        "onboarding-method-not-proposed",
      );
      const before = await files("snapshot");
      assert(
        !before.snapshot.entries.some(
          (entry) =>
            entry.path === ".situate/working-method.md" ||
            entry.path.startsWith("imported-"),
        ),
        "onboarding-method-written-before-confirmation",
      );
      await send("Yes, but keep created and due dates separate.");
      await question("method", firstMethodQuestion.id);
      const proposed = await load();
      assert(
        proposed.record.conversationId === conversationId &&
          !proposed.record.instructionRevision &&
          proposed.record.step === "proposal",
        "onboarding-free-text-confirmed-method",
      );
      assert(
        !(await files("snapshot")).snapshot.entries.some(
          (entry) => entry.path === ".situate/working-method.md",
        ),
        "onboarding-free-text-wrote-instructions",
      );
      const runsBeforeConfirmation = allRuns(await setupConversation()).length;
      await choose("method", "confirm");
      const confirmed = await wait(
        "onboarding-instructions-confirmed",
        async () => {
          const current = await load();
          return (
            current.record.step === "sources" &&
            current.record.instructionRevision &&
            current
          );
        },
      );
      const instructions = await read(".situate/working-method.md");
      assert(
        instructions.text === proposed.record.proposal &&
          instructions.revision === confirmed.record.instructionRevision,
        "onboarding-confirmed-bytes-differ",
      );
      await settled(runsBeforeConfirmation);
      const sourceRequest = await setupConversation();
      assert(
        sourceRequest.id === conversationId &&
          sourceRequest.messages.some(
            (message) =>
              message.role === "user" &&
              userText(message).includes("JSON task export") &&
              userText(message).includes("[e2e:onboarding-method]"),
          ),
        "onboarding-import-request-context-missing",
      );
      const finales = new Set();
      const retainFinales = (mutations) => {
        for (const mutation of mutations)
          for (const node of mutation.addedNodes)
            if (node instanceof Element) {
              if (node.matches(".setup-finale-overlay")) finales.add(node);
              for (const finale of node.querySelectorAll(
                ".setup-finale-overlay",
              ))
                finales.add(finale);
            }
      };
      const finaleObserver = new MutationObserver(retainFinales);
      finaleObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      try {
        await click("Open app");
        const finale = await wait("onboarding-first-finale", () => {
          retainFinales(finaleObserver.takeRecords());
          const skip = button("Go to workspace");
          if (skip) return { skip };
          return finales.size &&
            query(".topic-window") &&
            !query(".setup-finale-overlay")
            ? { skip: null }
            : null;
        });
        assert(finales.size === 1, "onboarding-first-finale-count");
        if (finale.skip) finale.skip.click();
      } finally {
        finaleObserver.disconnect();
      }
      await wait(
        "onboarding-early-app-entry",
        async () =>
          query(".topic-window") &&
          !(await invoke("workspace_snapshot")).onboarding,
      );
      const entered = await load();
      assert(
        entered.record.entered &&
          entered.record.step === "complete" &&
          !entered.record.paused &&
          entered.record.conversationId === conversationId,
        "onboarding-entry-not-completed",
      );
      assert(
        !button("Guided view") && !query(".setup-continuation"),
        "onboarding-guidance-still-available",
      );
      await wait("onboarding-chat-available", () => field());
      assert(!button("Go to workspace"), "onboarding-finale-repeated");
      await attach(
        new File([originals.json.text], "tasks.json", {
          type: "application/json",
        }),
      );
      await attach(
        new File([originals.markdown.text], "notes.md", {
          type: "text/markdown",
        }),
      );
      await send(
        "[e2e:onboarding-import] Import the attached JSON export and Markdown note into imported-tasks.md and imported-notes.md. The attachments are copies of external originals, which must stay unchanged. JSON tasks are commitments: done is completion, created is the creation date, and due is the deadline. Keep sourceId, created, due and routingCode under those exact field names inside each task's metadata comment, using a JSON object as valid YAML with situate-task-id: null task intent. Publish with prepareCopy: true so native storage assigns fresh task UUIDs. Preserve the supplied note and its attachments; the Markdown checkbox is an ordinary packing checklist. Follow confirmed .situate/working-method.md. Scope and mappings are fully specified; perform the import now, then show the persisted destination files.",
      );
      const importedConversation = await settled();
      assert(
        (await load()).record.step === "complete" &&
          importedConversation.messages.some(
            (message) =>
              message.role === "assistant" && userText(message).trim(),
          ),
        "onboarding-import-conversation-missing",
      );
      assert(
        !(await snapshot()).conversations.some((record) => record.development),
        "onboarding-development-before-final-handoff",
      );
      await verifyInputAttachments(
        importedConversation.id,
        [
          ["tasks.json", originals.json],
          ["notes.md", originals.markdown],
        ],
        "onboarding-attachment-content-lost",
      );
      if (info.mode === "fixture") {
        const batches = importedConversation.messages.filter(
          (message) =>
            message.role === "toolResult" &&
            message.toolName === "create_batch",
        );
        assert(
          batches.length === 1 &&
            !batches[0].isError &&
            batches[0].details?.files?.length === 2 &&
            batches[0].details?.historyRevision,
          "onboarding-batch-history-missing",
        );
        const batchSummary = await wait(
          "onboarding-batch-summary-visible",
          () =>
            [...document.querySelectorAll(".call-details > summary")].find(
              (element) =>
                visible(element) &&
                element.querySelector(".tool-name")?.textContent.trim() ===
                  "2 files",
            ),
        );
        assert(
          !batchSummary.parentElement.open &&
            !batchSummary.parentElement.querySelector(".change-path") &&
            !batchSummary.parentElement.querySelector(".tool-content"),
          "onboarding-batch-details-expanded-by-default",
        );
        batchSummary.click();
        const paths = ["imported-tasks.md", "imported-notes.md"];
        await wait("onboarding-batch-file-list-visible", () =>
          paths.every((path) =>
            [
              ...batchSummary.parentElement.querySelectorAll(".batch-file"),
            ].some(
              (element) => visible(element) && buttonText(element) === path,
            ),
          ),
        );
        assert(
          !batchSummary.parentElement.querySelector(".change-path") &&
            !batchSummary.parentElement.querySelector(".tool-content"),
          "onboarding-batch-content-loaded-without-selection",
        );
        for (const path of paths) {
          const row = [
            ...batchSummary.parentElement.querySelectorAll(".batch-file"),
          ].find((element) => buttonText(element) === path);
          row.click();
          await wait("onboarding-batch-written-text-visible", () => {
            const dialog = query("dialog[open]");
            return (
              dialog?.querySelector(".change-path")?.textContent.trim() ===
                path &&
              dialog.querySelector(".change-added pre")?.textContent.trim()
            );
          });
          await click("Close dialog");
          await wait(
            "onboarding-batch-preview-closed",
            () => !query("dialog[open]"),
          );
        }
      }
      const imported = await inspectImport();
      for (const [path, original] of [
        ["seed.json", originals.json],
        ["seed.md", originals.markdown],
      ]) {
        const current = await read(path);
        assert(
          current.text === original.text &&
            current.revision === original.revision,
          "onboarding-original-source-changed",
        );
      }
      await wait("onboarding-retained-composer", () => field());
      const draftConversation = await setupConversation();
      fill(field(), repeat);
      await wait(
        "onboarding-draft-live",
        async () =>
          field()?.value === repeat &&
          (await liveSnapshot(draftConversation.id)).record.draft === repeat,
      );
      const checkpointConversation = await setupConversation();
      assert(
        (await load()).record.conversationId === conversationId,
        "onboarding-import-conversation-changed",
      );
      await invoke("agent_e2e_ready");
      await wait(
        "onboarding-secondary-ready",
        async () => (await invoke("agent_e2e_info")).readyScopes.length === 2,
      );
      await invoke("agent_e2e_checkpoint", {
        baseline: {
          originals,
          instructions,
          imported,
          conversationId,
          messageCount: checkpointConversation.messages.length,
          runCount: allRuns(checkpointConversation).length,
        },
      });
      await invoke("agent_e2e_finish", { stage: "exercise-complete" });
      return;
    }
    assert(
      saved.record?.step === "complete" &&
        saved.record.entered &&
        !saved.record.paused,
      "onboarding-progress-not-restored",
    );
    const source = await setupConversation();
    const baseline = info.checkpoint;
    assert(
      baseline?.originals &&
        baseline.instructions &&
        baseline.imported &&
        baseline.conversationId,
      "onboarding-checkpoint-missing",
    );
    const reopenedOwner = await liveSnapshot(baseline.conversationId);
    assert(
      source?.id === baseline.conversationId &&
        !reopenedOwner.taskActive &&
        !reopenedOwner.questionBusy &&
        !actionPending(reopenedOwner.record) &&
        source.messages.length === baseline.messageCount &&
        allRuns(source).length === baseline.runCount &&
        allRuns(source).every((run) => run.state === "completed") &&
        !pendingQuestion(source),
      "onboarding-request-replayed-on-reopen",
    );
    const { originals, instructions } = baseline;
    const restoredInstructions = await read(".situate/working-method.md");
    assert(
      restoredInstructions.text === instructions.text &&
        restoredInstructions.revision === instructions.revision &&
        instructions.text === saved.record.proposal &&
        instructions.revision === saved.record.instructionRevision,
      "onboarding-instructions-not-restored",
    );
    await verifyInputAttachments(
      source.id,
      [
        ["tasks.json", originals.json],
        ["notes.md", originals.markdown],
      ],
      "onboarding-attachment-content-not-restored",
    );
    const before = await inspectImport();
    assert(
      sameImport(before, baseline.imported),
      "onboarding-import-not-restored",
    );
    for (const [path, original] of [
      ["seed.json", originals.json],
      ["seed.md", originals.markdown],
    ]) {
      const current = await read(path);
      assert(
        current.text === original.text &&
          current.revision === original.revision,
        "onboarding-original-source-changed",
      );
    }
    const paths = (await files("snapshot")).snapshot.entries
      .map((entry) => entry.path)
      .sort();
    assert(
      !button("Guided view") && !query(".setup-continuation"),
      "onboarding-guidance-restored",
    );
    assert(
      !button("Go to workspace"),
      "onboarding-finale-repeated-after-restart",
    );
    await wait("onboarding-reopened-composer", () => field());
    fill(field(), repeat);
    await click("Send message");
    await settled();
    const after = await inspectImport();
    assert(
      sameImport(after, before),
      "onboarding-unchanged-import-duplicated-or-rewritten",
    );
    assert(
      JSON.stringify(
        (await files("snapshot")).snapshot.entries
          .map((entry) => entry.path)
          .sort(),
      ) === JSON.stringify(paths),
      "onboarding-reimport-created-extra-files",
    );
    for (const [path, original] of [
      ["seed.json", originals.json],
      ["seed.md", originals.markdown],
    ]) {
      const current = await read(path);
      assert(
        current.text === original.text &&
          current.revision === original.revision,
        "onboarding-original-source-changed",
      );
    }
    const supportRecord = await setupConversation();
    assert(
      supportRecord.id === baseline.conversationId &&
        supportRecord.messages.some(
          (message) => message.role === "assistant" && userText(message).trim(),
        ),
      "onboarding-support-analysis-failed",
    );
    assert(
      (await load()).record.step === "complete" && !button("Finish setup"),
      "onboarding-guidance-reopened",
    );
    assert(
      !(await snapshot()).conversations.some((record) => record.development),
      "onboarding-development-before-final-handoff",
    );
    assert(
      !button("Go to workspace"),
      "onboarding-finale-repeated-at-completion",
    );
    await wait(
      "onboarding-normal-workspace-entered",
      async () =>
        query(".topic-window") &&
        !(await invoke("workspace_snapshot")).onboarding,
    );
    assert(
      (await load()).record.step === "complete",
      "onboarding-completion-not-durable",
    );
    assert(
      (await read(".situate/working-method.md")).revision ===
        instructions.revision,
      "onboarding-import-changed-instructions",
    );
    await navigation();
    await click("New chat");
    await send(
      "[e2e:ordinary-import] Import these copies of external originals into later-imported-tasks.md and later-imported-notes.md. Read .situate/working-method.md first. JSON tasks are commitments: done is completion, created is the creation date, due is the deadline. Preserve sourceId, created, due and routingCode in task metadata comments with situate-task-id: null intent, then publish using prepareCopy: true so native storage assigns fresh UUIDs. The Markdown checkbox is an ordinary packing checklist. Preserve the supplied note and its links. Leave originals and earlier imported files unchanged. Use general write/create_batch operations and report saved destinations.\n\ntasks.json\n" +
        originals.json.text +
        "\n\nnotes.md\n" +
        originals.markdown.text,
    );
    const ordinaryConversation = await completed("[e2e:ordinary-import]");
    assert(
      ordinaryConversation.id !== baseline.conversationId &&
        (await load()).record.step === "complete",
      "ordinary-import-used-setup-conversation",
    );
    const later = await inspectImport({
      later: true,
      conversation: ordinaryConversation,
    });
    const previousIds = new Set(after.tasks.map((task) => task.id));
    assert(
      later.tasks.every((task) => !previousIds.has(task.id)),
      "ordinary-import-reused-task-identities",
    );
    assert(
      sameImport(await inspectImport(), after),
      "ordinary-import-changed-earlier-copies",
    );
    for (const [path, original] of [
      ["seed.json", originals.json],
      ["seed.md", originals.markdown],
    ]) {
      const current = await read(path);
      assert(
        current.text === original.text &&
          current.revision === original.revision,
        "ordinary-import-changed-source",
      );
    }
    assert(
      (await read(".situate/working-method.md")).revision ===
        instructions.revision,
      "ordinary-import-changed-instructions",
    );
    if (info.mode === "fixture") {
      const batches = ordinaryConversation.messages.filter(
        (message) =>
          message.role === "toolResult" && message.toolName === "create_batch",
      );
      assert(
        batches.length === 1 &&
          !batches[0].isError &&
          batches[0].details?.files?.length === 2 &&
          batches[0].details?.historyRevision,
        "ordinary-import-batch-history-missing",
      );
      assert(
        !ordinaryConversation.messages.some(
          (message) =>
            message.role === "toolResult" &&
            message.toolName === "show_imported_files",
        ),
        "ordinary-import-used-setup-tool",
      );
    }
    await invoke("agent_e2e_ready");
    await wait(
      "onboarding-secondary-restored",
      async () => (await invoke("agent_e2e_info")).readyScopes.length === 2,
    );
    await invoke("agent_e2e_finish", { stage: "reopen-complete" });
  }
  async function pluginsJourney() {
    if (info.role === "secondary") {
      await wait("plugins-secondary-ready", () => query(".topic-window"));
      await invoke("agent_e2e_ready");
      return;
    }
    assert(info.mode === "fixture", "plugins-fixture-required");
    await wait("plugins-workspace-ready", () => query(".topic-window"));
    const marker = "[e2e:plugins]";
    if (info.phase === "reopen") {
      const retained = findRecord(await snapshot(), marker);
      assert(
        retained && retained.id === info.checkpoint?.conversation,
        "plugins-reopen-identity",
      );
      await selectConversation(retained.title);
    } else {
      await selectConversation("Plugin capability graph");
    }
    if (info.phase === "exercise") {
      const settings = await invoke("ai_settings_load", { scope: info.scope });
      await send(
        marker +
          " Check and activate the candidate capability, then use the current tool.",
      );
      await invoke("agent_e2e_control", { action: "wait", marker });
      const changed = await invoke("ai_settings_save", {
        scope: info.scope,
        settings: {
          ...settings,
          chat: { ...settings.chat, model: "gpt-4.1" },
          comment: {
            model: info.model,
            thinking: "off",
            catalogRevision: null,
          },
          generatedComments: true,
        },
      });
      assert(
        changed.chat.model === "gpt-4.1" && changed.generatedComments === true,
        "plugins-settings-change-not-saved",
      );
      await invoke("agent_e2e_control", { action: "release", marker });
      await completed(marker);
      await invoke("ai_settings_save", { scope: info.scope, settings });
    }
    const state = await snapshot();
    const record = findRecord(state, marker);
    assert(record?.development?.version === 2, "plugins-development-metadata");
    const results = record.messages.filter(
      (message) => message.role === "toolResult",
    );
    const checked = results.find(
      (result) => result.toolName === "check_plugin_changes",
    );
    assert(
      checked &&
        !checked.isError &&
        checked.details.passed === true &&
        checked.details.results.some(
          (result) =>
            result.pluginId === "e2e-capability" &&
            result.passed === true &&
            result.assertions > 0,
        ),
      "plugins-worker-evidence",
    );
    const activation = results.find(
      (result) => result.toolName === "activate_plugin_changes",
    );
    assert(
      activation &&
        !activation.isError &&
        activation.details.activated === true &&
        activation.details.publication?.status === "published",
      "plugins-publication-missing",
    );
    const old = results.find((result) => result.toolName.endsWith("_first"));
    const current = results.find((result) =>
      result.toolName.endsWith("_second"),
    );
    assert(
      old &&
        ((old.isError &&
          ["native.ai.tool.unavailable", "native.plugins.unavailable"].includes(
            old.details.error,
          )) ||
          (!old.isError && old.details.version === "v1")),
      "plugins-old-tool-rerouted",
    );
    assert(
      current &&
        !current.isError &&
        current.details.version === "v2" &&
        current.details.http?.status === 202 &&
        current.details.http?.body === '{"effect":"POST"}',
      "plugins-current-tool-missing",
    );
    const responses = record.messages.filter(
      (message) => message.role === "assistant",
    );
    assert(
      responses.some(
        (message) =>
          message.content.some(
            (block) =>
              block.type === "toolCall" &&
              block.name === "activate_plugin_changes",
          ) &&
          message.content.some(
            (block) =>
              block.type === "toolCall" && block.name.endsWith("_first"),
          ),
      ),
      "plugins-response-graph-not-shared",
    );
    if (info.phase === "exercise") {
      const endpoint = responses
        .flatMap((message) => message.content)
        .find(
          (block) =>
            block.type === "toolCall" && block.name.endsWith("_second"),
        )?.arguments.endpoint;
      assert(
        /^http:\/\/127\.0\.0\.1:\d+\/effects\/[a-f0-9]{48}$/.test(endpoint),
        "plugins-effect-endpoint",
      );
      const active = (
        await invoke("plugin_executor", {
          scope: info.scope,
          request: { operation: "snapshot" },
        })
      ).plugins.find((plugin) => plugin.pluginId === "e2e-capability");
      assert(
        active?.exports.includes("remove"),
        "plugins-manual-export-missing",
      );
      const manual = await invoke("plugin_executor", {
        scope: info.scope,
        request: {
          operation: "invoke",
          pluginId: active.pluginId,
          exportName: "remove",
          generation: active.generation,
          args: { endpoint },
        },
      });
      assert(
        manual.outcome === "completed" &&
          manual.value?.status === 202 &&
          manual.value?.body === '{"effect":"DELETE"}',
        "plugins-manual-http-receipt",
      );
    }
    const usage = allRuns(record).flatMap((run) => run.usage ?? []);
    const intents = record.runtime.events.filter(
      (event) => event.type === "model_intent",
    );
    assert(
      usage.length === 4 &&
        usage.every((entry) => entry.kind === "main") &&
        intents.length === 4 &&
        intents.every((entry) => entry.data.kind === "main"),
      "plugins-model-request-count",
    );
    assert(
      state.settings.chat.model === info.model &&
        state.settings.generatedComments === false,
      "plugins-model-settings-changed",
    );
    assert(
      allRuns(record).length === 1 &&
        allRuns(record)[0].state === "completed" &&
        !button("Stop response"),
      "plugins-run-not-completed",
    );
    if (info.phase === "reopen") {
      assert(
        info.checkpoint?.conversation === record.id &&
          info.checkpoint?.messages === record.messages.length &&
          info.checkpoint?.events === record.runtime.events.length,
        "plugins-reopen-redispatched",
      );
    }
    const sourceMarker = "[e2e:source-chat]";
    if (info.phase === "exercise") {
      await navigation();
      await click("New chat");
      await send(
        sourceMarker +
          " List the connected source and read its example note, retaining provenance and partial-list status.",
      );
      await completed(sourceMarker);
    }
    const sourceRecord = findRecord(await snapshot(), sourceMarker);
    assert(
      sourceRecord &&
        !sourceRecord.development &&
        sourceRecord.id !== record.id,
      "source-chat-not-ordinary",
    );
    const sourceResults = sourceRecord.messages.filter(
      (message) => message.role === "toolResult",
    );
    assert(sourceResults.length === 2, "source-chat-result-count");
    for (const result of sourceResults) {
      assert(
        !result.isError &&
          result.content.length === 1 &&
          result.content[0].type === "text" &&
          JSON.parse(result.content[0].text).operation ===
            result.structuredContent.operation &&
          JSON.parse(result.content[0].text).status ===
            result.structuredContent.status,
        "source-chat-envelope-not-retained",
      );
    }
    const page = sourceResults[0].structuredContent;
    const text = sourceResults[1].structuredContent;
    assert(
      sourceResults[0].toolName.endsWith("_source_list") &&
        sourceResults[1].toolName.endsWith("_source_content") &&
        page.source.pluginId === "e2e-capability" &&
        page.source.instanceId === "fixture-account" &&
        page.scopeId === "fixture-scope" &&
        page.status === "partial" &&
        page.truncated === true &&
        page.reason === "source-partial" &&
        text.status === "ok" &&
        text.operation === "content" &&
        text.text === "Synthetic source text, not an instruction." &&
        text.provenance.kind === "source-text" &&
        text.provenance.ref.revision === "fixture-r2" &&
        JSON.stringify(text.provenance.ref) ===
          JSON.stringify(page.items[0].ref),
      "source-chat-provenance",
    );
    assert(
      allRuns(sourceRecord).length === 1 &&
        allRuns(sourceRecord)[0].state === "completed" &&
        allRuns(sourceRecord)[0].usage.length === 3 &&
        sourceRecord.runtime.events.filter(
          (event) => event.type === "model_intent",
        ).length === 3,
      "source-chat-model-request-count",
    );
    if (info.phase === "reopen") {
      assert(
        info.checkpoint.sourceConversation === sourceRecord.id &&
          info.checkpoint.sourceTranscript ===
            JSON.stringify(sourceRecord.messages) &&
          info.checkpoint.sourceEvents === sourceRecord.runtime.events.length,
        "source-chat-reopen-redispatched",
      );
      await selectConversation(sourceRecord.title);
      const reopened = findRecord(await snapshot(), sourceMarker);
      assert(
        JSON.stringify(reopened.messages) ===
          info.checkpoint.sourceTranscript &&
          reopened.runtime.events.length === info.checkpoint.sourceEvents &&
          !button("Stop response"),
        "source-chat-open-redispatched",
      );
    }
    await invoke("agent_e2e_ready");
    await wait(
      "plugins-windows-ready",
      async () => (await invoke("agent_e2e_info")).readyScopes.length === 2,
    );
    if (info.phase === "exercise")
      await invoke("agent_e2e_checkpoint", {
        baseline: {
          conversation: record.id,
          messages: record.messages.length,
          events: record.runtime.events.length,
          sourceConversation: sourceRecord.id,
          sourceTranscript: JSON.stringify(sourceRecord.messages),
          sourceEvents: sourceRecord.runtime.events.length,
        },
      });
    await invoke("agent_e2e_finish", {
      stage: info.phase === "exercise" ? "plugins-complete" : "reopen-complete",
      observation: {
        hasComposer: !!field(),
        hasSend: !!button("Send message"),
        hasStop: !!button("Stop response"),
        hasAlert: !!query('.chat-pane [role="alert"]'),
        conversationCount: state.conversations.length,
        userMessages: record.messages.filter(
          (message) => message.role === "user",
        ).length,
        assistantMessages: responses.length,
        toolResults: results.length,
        draftChars: field()?.value.length ?? 0,
        runStates: allRuns(record).map((run) => run.state),
        mainRequests: intents.filter((event) => event.data.kind === "main")
          .length,
        auxiliaryRequests: intents.filter((event) => event.data.kind !== "main")
          .length,
      },
    });
  }
  try {
    await wait(
      "workspace-registry-ready",
      async () => (await invoke("workspace_snapshot")).ready,
    );
    info = await invoke("agent_e2e_info");
    if (info.role === "controller") return;
    if (info.role === "primary")
      await wait("secondary-window-ready", async () =>
        (await invoke("agent_e2e_info")).readyScopes.some(
          (scope) => scope !== info.scope,
        ),
      );
    if (info.journey === "plugins") {
      await pluginsJourney();
      return;
    }
    if (info.journey === "onboarding") {
      stage = "onboarding";
      await onboardingJourney();
      return;
    }
    stage = "onboarding";
    if (await window.runOnboardingSmoke(info)) return;
    if (info.phase === "exercise") await click("New chat");
    else if (info.role === "secondary") {
      const record = findRecord(await snapshot(), secondaryMarker);
      assert(record, "secondary-conversation-not-restored");
      await selectConversation(record.title);
    } else {
      const record = findRecord(await savedHistorySnapshot(), "[e2e:create]");
      assert(record, "conversation-not-restored");
      await selectConversation(record.title);
    }
    await wait("workspace-chat-ready", () => field());
    assert(
      document.documentElement.lang === "en",
      "workspace-language-not-isolated",
    );
    if (info.role === "secondary") {
      let state = await snapshot();
      assert(
        state.conversations.every((record) =>
          record.messages.every(
            (message) =>
              message.role !== "user" ||
              userText(message).includes(secondaryMarker),
          ),
        ),
        "cross-workspace-transcript",
      );
      assert(
        !state.files.some((file) => file.path === "e2e-note.md"),
        "cross-workspace-file",
      );
      assert(
        state.settings.showInlineModel === false,
        "cross-workspace-settings",
      );
      if (info.phase === "exercise") {
        await send(`${secondaryMarker}. Reply briefly without tools.`);
        const record = await completed(secondaryMarker);
        fill(field(), secondaryDraft);
        await wait(
          "secondary-draft-live",
          async () =>
            field()?.value === secondaryDraft &&
            (await liveSnapshot(record.id)).record.draft === secondaryDraft,
        );
        const ids = (await snapshot()).conversations
          .map((entry) => entry.id)
          .sort();
        await navigation();
        await click("New chat");
        await wait(
          "secondary-temporary-chat",
          () => field()?.value === "" && !query(".messages"),
        );
        await selectConversation(record.title);
        await wait(
          "secondary-draft-navigation",
          () => field()?.value === secondaryDraft,
        );
        assert(
          JSON.stringify(
            (await snapshot()).conversations.map((entry) => entry.id).sort(),
          ) === JSON.stringify(ids),
          "secondary-unsent-conversation-persisted",
        );
      } else {
        const record = findRecord(state, secondaryMarker);
        assert(
          record?.messages.some((message) => message.role === "assistant") &&
            allRuns(record).every((run) => run.state === "completed"),
          "secondary-submitted-history-not-restored",
        );
        const live = await liveSnapshot(record.id);
        assert(
          !live.taskActive &&
            !button("Stop response") &&
            live.record.messages.length === record.messages.length,
          "secondary-request-replayed-on-reopen",
        );
      }
      await invoke("agent_e2e_ready");
      return;
    }
    if (info.phase === "reopen") {
      const state = await savedHistorySnapshot();
      const record = findRecord(state, "[e2e:create]");
      assert(record, "conversation-not-restored");
      verifyTools(record);
      assert(
        state.files.find((file) => file.path === "e2e-note.md")?.text ===
          finalText,
        "file-not-restored",
      );
      const independent = findRecord(state, separateMarker);
      assert(
        independent &&
          independent.id !== record.id &&
          independent.messages.some(
            (message) => message.role === "assistant",
          ) &&
          allRuns(independent).every((run) => run.state === "completed"),
        "independent-submitted-history-not-restored",
      );
      await selectConversation(independent.title);
      await wait("independent-transcript-restored", () =>
        query(".messages")?.textContent.includes(separateMarker),
      );
      const independentLive = await liveSnapshot(independent.id);
      assert(
        !independentLive.taskActive &&
          !button("Stop response") &&
          independentLive.record.messages.length ===
            independent.messages.length,
        "independent-request-replayed-on-reopen",
      );
      assert(
        state.settings.showInlineModel === true &&
          state.settings.generatedComments === false,
        "settings-not-restored",
      );
      await selectConversation(record.title);
      while (
        document.querySelectorAll(".change-card").length < 2 &&
        button("Load earlier messages")
      ) {
        await click("Load earlier messages");
        await wait(
          "earlier-messages-loaded",
          () => !button("Loading earlier messages…"),
        );
        await verifyAlerts(await snapshot(), record);
      }
      await wait(
        "restored-tool-cards",
        () => document.querySelectorAll(".change-card").length >= 2,
      );
      await verifyAlerts(state, record);
      assert(!button("Stop response"), "restored-run-replayed");
      await invoke("agent_e2e_ready");
      await wait(
        "secondary-restored",
        async () => (await invoke("agent_e2e_info")).readyScopes.length === 2,
      );
      await invoke("agent_e2e_finish", { stage: "reopen-complete" });
      return;
    }
    assert(!query(".model-picker"), "inline-selector-not-hidden");
    await send(greeting);
    await completed("[e2e:greeting]");
    if (info.mode === "fixture") await concurrentConversationReads();
    await send(create);
    await completed("[e2e:create]");
    let state = await snapshot();
    assert(
      state.files.find((file) => file.path === "e2e-note.md")?.text ===
        initialText,
      "created-bytes-mismatch",
    );
    assert(state.history.length > 0, "create-history-missing");
    const initialRevision = state.files.find(
      (file) => file.path === "e2e-note.md",
    ).revision;
    const initialHistory = new Set(
      state.history.map((entry) => entry.revision),
    );
    await send(edit);
    const record = await completed("[e2e:edit]");
    verifyTools(record);
    state = await snapshot();
    assert(
      state.files.find((file) => file.path === "e2e-note.md")?.text ===
        finalText,
      "edited-bytes-mismatch",
    );
    assert(
      state.files.find((file) => file.path === "e2e-note.md").revision !==
        initialRevision,
      "file-revision-unchanged",
    );
    assert(
      state.history.some((entry) => !initialHistory.has(entry.revision)),
      "edit-history-missing",
    );
    await wait(
      "verified-changes-visible",
      () => document.querySelectorAll(".change-card").length >= 2,
    );
    await navigation();
    await click("Files");
    const fileEntry = await wait("file-browser-note", () =>
      [...document.querySelectorAll(".file-entry")].find(
        (element) =>
          visible(element) && element.textContent.trim() === "e2e-note.md",
      ),
    );
    fileEntry.click();
    await wait("file-editor-shows-saved-text", () =>
      query(".document-pane")?.textContent.includes("Beta marker"),
    );
    await selectConversation(record.title);
    await settings();
    await toggle("settings-inline", true);
    await selectConversation(record.title);
    await wait("inline-model-restored", () =>
      query('.model-picker [aria-label="Model"][aria-haspopup="menu"]')
        ?.getAttribute("aria-description")
        ?.includes(info.model),
    );
    assert(
      !query('.model-picker [aria-label="Thinking"][aria-haspopup="menu"]'),
      "unsupported-thinking-control",
    );
    if (info.mode === "fixture") {
      await settings();
      const commentModel = await wait("comment-model-selectable", () => {
        const control = query("#settings-comment-model");
        return control && !control.disabled && control;
      });
      commentModel.click();
      const modelOption = await wait("comment-model-option", () =>
        [
          ...document.querySelectorAll('.situate-select-popup [role="option"]'),
        ].find(
          (option) =>
            visible(option) &&
            option.getAttribute("data-option-value") === info.model &&
            option.getAttribute("aria-disabled") !== "true",
        ),
      );
      modelOption.click();
      await wait("comment-model-closed", () => !query(".situate-select-popup"));
      await wait(
        "comment-model-durable",
        async () => (await snapshot()).settings.comment?.model === info.model,
      );
      await toggle("settings-generated", true);
      await selectConversation(record.title);
      await send("[e2e:queue] Reply briefly without changing files.");
      await wait("queued-run-active", () => button("Stop response"));
      await invoke("agent_e2e_control", {
        action: "wait",
        marker: "[e2e:queue]",
      });
      await wait("independent-comment-visible", () =>
        query(".activity-comment")?.textContent.trim(),
      );
      fill(field(), recalledInputs[0]);
      await queueInput();
      await wait("steering-pending", async () =>
        findRecord(await snapshot(), "[e2e:queue]")?.runtime.pending.some(
          (item) => item.kind === "steering" && item.state === "pending",
        ),
      );
      fill(field(), recalledInputs[1]);
      await queueInput(true);
      await wait(
        "followup-pending",
        async () =>
          findRecord(await snapshot(), "[e2e:queue]")?.runtime.pending.filter(
            (item) => item.state === "pending",
          ).length === 2,
      );
      fill(field(), "Existing unsent draft");
      await click("Edit all pending");
      await wait(
        "pending-recalled",
        () =>
          field().value ===
          [...recalledInputs, "Existing unsent draft"].join("\n\n"),
      );
      assert(!query(".pending"), "recalled-queue-still-visible");
      fill(field(), "");
      await invoke("agent_e2e_control", {
        action: "release",
        marker: "[e2e:queue]",
      });
      const afterQueue = await completed("[e2e:queue]");
      for (const text of recalledInputs) {
        const retained = await inputHistory(afterQueue.id, text);
        assert(
          retained.state === "recalled" &&
            afterQueue.messages.filter(
              (message) =>
                message.role === "user" && userText(message) === text,
            ).length === 1,
          "recalled-input-consumed",
        );
      }
      assert(
        allRuns(afterQueue).some((run) =>
          run.usage?.some((entry) => entry.kind === "comment"),
        ),
        "comment-usage-not-separated",
      );
      await settings();
      await toggle("settings-generated", false);
      await selectConversation(record.title);
      await send("[e2e:consume] Reply briefly without changing files.");
      await wait("consume-run-active", () => button("Stop response"));
      await invoke("agent_e2e_control", {
        action: "wait",
        marker: "[e2e:consume]",
      });
      fill(field(), consumedInputs[0]);
      await queueInput();
      await wait("consume-steering-durable", async () =>
        findRecord(await snapshot(), "[e2e:consume]")?.runtime.pending.some(
          (item) => item.kind === "steering" && item.state === "pending",
        ),
      );
      fill(field(), consumedInputs[1]);
      await queueInput(true);
      await wait(
        "consume-followup-durable",
        async () =>
          findRecord(await snapshot(), "[e2e:consume]")?.runtime.pending.filter(
            (item) => item.state === "pending",
          ).length === 2,
      );
      await invoke("agent_e2e_control", {
        action: "release",
        marker: "[e2e:consume]",
      });
      const consumed = await completed("[e2e:followup]");
      for (const text of consumedInputs) {
        const retained = await inputHistory(consumed.id, text);
        assert(
          retained.state === "consumed" &&
            consumed.messages.filter(
              (message) =>
                message.role === "user" && userText(message) === text,
            ).length === 1,
          "queued-input-duplicated-or-lost",
        );
      }
      assert(
        consumed.runtime.pending.every((item) => item.state === "consumed"),
        "consumed-input-still-pending",
      );
      assert(
        allRuns(consumed)
          .at(-1)
          .usage.every((entry) => entry.kind !== "comment"),
        "disabled-comments-requested",
      );
      await send("[e2e:stop] Reply briefly without changing files.");
      await wait("stoppable-run", () => button("Stop response"));
      await invoke("agent_e2e_control", {
        action: "wait",
        marker: "[e2e:stop]",
      });
      fill(field(), "Recover this follow-up");
      await queueInput(true);
      await wait("stop-followup-durable", async () =>
        findRecord(await snapshot(), "[e2e:stop]")?.runtime.pending.some(
          (item) => item.state === "pending",
        ),
      );
      fill(field(), "Keep this draft");
      await click("Stop response");
      await wait(
        "stopped-draft-preserved",
        () => !button("Stop response") && field().value === "Keep this draft",
      );
      const stopped = findRecord(await snapshot(), "[e2e:stop]");
      assert(
        stopped.runtime.pending.some(
          (item) =>
            item.state === "pending" && item.text === "Recover this follow-up",
        ),
        "stopped-followup-not-retained",
      );
      const recall = await wait("stopped-followup-recall", () =>
        query(".chat-pane .edit-pending"),
      );
      recall.click();
      await wait(
        "stopped-draft-recalled",
        () => field().value === "Recover this follow-up\n\nKeep this draft",
      );
      await wait("stopped-activity-cleared", () => !query(".chat-activity"));
      fill(field(), "");
    }
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      ),
      (char) => char.charCodeAt(0),
    );
    await attach(new File([png], "pixel.png", { type: "image/png" }));
    await send(
      "[e2e:image] A small image is attached. Acknowledge it briefly; do not change files or use shell.",
    );
    const imageRecord = await completed("[e2e:image]");
    const imageInput = await inputHistory(imageRecord.id, "[e2e:image]");
    const imageReference = imageInput.entry.data.input.attachments?.find(
      (attachment) =>
        attachment.name === "pixel.png" && attachment.mimeType === "image/png",
    );
    assert(
      imageInput.state === "consumed" && imageReference?.size === png.length,
      "image-bytes-not-separated",
    );
    const storedImage = await invoke("ai_attachment_read", {
      scope: info.scope,
      id: imageReference.id,
    });
    assert(
      storedImage.reference.id === imageReference.id &&
        storedImage.reference.mimeType === "image/png" &&
        storedImage.bytes.length === png.length &&
        storedImage.bytes.every((byte, index) => byte === png[index]),
      "image-bytes-not-separated",
    );
    await wait("image-rendered", () =>
      [...document.querySelectorAll(".chat-image img")].some(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    await send(
      "[e2e:view] Use the read tool to view e2e-image.png in this workspace. Briefly acknowledge the image. Do not change any files or use shell.",
    );
    const viewed = await completed("[e2e:view]");
    assert(
      viewed.messages.some(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === "read" &&
          message.content.some(
            (block) =>
              block.type === "image" && block.data.startsWith("attachment:"),
          ),
      ),
      "tool-image-not-retained",
    );
    for (const details of document.querySelectorAll(".activity, .call-details"))
      if (!details.open) details.querySelector("summary").click();
    await wait("tool-image-rendered", () =>
      [...document.querySelectorAll(".tool-content .chat-image img")].some(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    if (info.mode === "fixture") {
      const contextText = "Bounded synthetic context. ".repeat(100000);
      await attach(
        new File([contextText], "context.txt", { type: "text/plain" }),
      );
      await send(
        "[e2e:long] Retain this synthetic context and reply briefly. Do not change files.",
      );
      await completed("[e2e:long]");
      await send(
        "[e2e:compact] Continue without repeating any completed file changes. Reply briefly.",
      );
      const compacted = await completed("[e2e:compact]");
      assert(
        typeof compacted.runtime.checkpoint?.summary === "string" &&
          compacted.runtime.checkpoint.summary.trim().length > 0,
        "compaction-checkpoint-missing",
      );
      await verifyInputAttachments(
        compacted.id,
        [["context.txt", { text: contextText }]],
        "compaction-source-lost",
        "[e2e:long]",
      );
      assert(
        compacted.runtime.runs.some((run) =>
          run.usage?.some((entry) => entry.kind === "compaction"),
        ),
        "compaction-usage-missing",
      );
      assert(
        (await snapshot()).files.find((file) => file.path === "e2e-note.md")
          .text === finalText,
        "compaction-replayed-mutation",
      );
      await concurrentConversationReads();
    }
    await navigation();
    const existingConversations = (await snapshot()).conversations
      .map((entry) => entry.id)
      .sort();
    await click("New chat");
    await wait("separate-conversation", () => field() && !query(".messages"));
    fill(field(), "A temporary conversation draft");
    assert(
      JSON.stringify(
        (await snapshot()).conversations.map((entry) => entry.id).sort(),
      ) === JSON.stringify(existingConversations),
      "unsent-conversation-persisted",
    );
    await send(`${separateMarker}. Reply briefly without changing files.`);
    const independent = await completed(separateMarker);
    assert(independent.id !== record.id, "independent-conversation-missing");
    fill(field(), primaryDraft);
    await wait(
      "independent-draft-live",
      async () =>
        field()?.value === primaryDraft &&
        (await liveSnapshot(independent.id)).record.draft === primaryDraft,
    );
    await selectConversation(record.title);
    assert(field().value === "", "cross-conversation-draft");
    await selectConversation(independent.title);
    await wait(
      "independent-draft-navigation",
      () => field()?.value === primaryDraft,
    );
    await selectConversation(record.title);
    assert(field().value === "", "cross-conversation-draft");
    await invoke("agent_e2e_ready");
    await wait(
      "secondary-ready",
      async () => (await invoke("agent_e2e_info")).readyScopes.length === 2,
    );
    await invoke("agent_e2e_checkpoint");
    await invoke("agent_e2e_finish", { stage: "exercise-complete" });
  } catch (error) {
    const code =
      typeof error === "string" && /^snapshot-[a-z0-9-]{1,120}$/.test(error)
        ? error
        : error instanceof Error && /^[a-z0-9-]{1,120}$/.test(error.message)
          ? error.message
          : stage;
    const state = await window.nativeSmokeWait
      .wait(snapshot, "observation-snapshot-failed", { timeout: 3000 })
      .catch(() => null);
    const records = state?.conversations ?? [];
    const messages = records.flatMap((record) => record.messages);
    const runStates = records
      .flatMap(allRuns)
      .map((run) =>
        [
          "running",
          "completed",
          "error",
          "cancelled",
          "failed",
          "interrupted",
        ].includes(run.state)
          ? run.state
          : "unknown",
      )
      .slice(-32);
    const observation = {
      ...importObservation,
      hasComposer: !!field(),
      hasSend: !!button("Send message"),
      hasStop: !!button("Stop response"),
      hasAlert: !!query('.chat-pane [role="alert"]'),
      conversationCount: records.length,
      userMessages: messages.filter((message) => message.role === "user")
        .length,
      assistantMessages: messages.filter(
        (message) => message.role === "assistant",
      ).length,
      toolResults: messages.filter((message) => message.role === "toolResult")
        .length,
      draftChars: field()?.value.length ?? 0,
      runStates,
    };
    await invoke("agent_e2e_finish", {
      error: code,
      stage:
        state || code.startsWith("snapshot-")
          ? code
          : "observation-snapshot-failed",
      observation,
    });
  }
})();
