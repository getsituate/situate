window.prepareLocalizationSmoke = async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const scope = (await invoke("workspace_snapshot")).current.id;
  const current = await invoke("localization_snapshot", { scope });
  const preferences = {
    language: "en",
    formats: { time: "12", date: "mdy", number: "dot-comma" },
  };
  await invoke("localization_update", {
    scope,
    preferences,
    expected: { language: current.language, formats: current.formats },
  });
  const deadline = Date.now() + 10000;
  while (document.documentElement.lang !== "en") {
    if (Date.now() > deadline)
      throw new Error("English smoke preferences were not applied");
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }
};

window.runEditorSmoke = async (conversationTitle) => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const workspace = (await invoke("workspace_snapshot")).current;
  assert(workspace, "No native editor workspace");
  const request = (operation, extra = {}) =>
    invoke("files_request", {
      request: { workspaceId: workspace.id, operation, ...extra },
    });
  const path = "native-editor.md";
  const phase = await invoke("smoke_phase");
  await window.runReferenceSmoke(phase.restart);
  if (phase.restart && phase.isolated) {
    await request("snapshot");
    await window.runRecoverySmoke(true);
    return;
  }
  const snapshot = (await request("snapshot")).snapshot;
  assert(snapshot.writable, "Disposable native workspace is not writable");
  if (snapshot.entries.some((entry) => entry.path === path))
    await request("delete", { path });
  let reply = await request("create", { path });
  const initial =
    reply.document.version.text +
    "# Native editor\n\nAlpha\n\nBeta\n\nPRIVATE_DIAGNOSTIC_CONTENT_SENTINEL\n";
  reply = await request("save", {
    path,
    base: reply.document.version,
    text: initial,
  });
  assert(reply.status === "saved", "Initial native editor save failed");
  const base = reply.document.version;
  const editor = initial.replace("Alpha", "Editor");
  await request("stage", { path, base, text: editor });
  assert(
    (await request("snapshot")).snapshot.drafts.some(
      (draft) => draft.text === editor,
    ),
    "Staged draft was not retained",
  );
  let rejected = false;
  try {
    await request("detach");
  } catch {
    rejected = true;
  }
  assert(rejected, "Detaching discarded a retained draft");
  await invoke("smoke_editor_file", {
    workspaceId: workspace.id,
    text: initial.replace("Beta", "External"),
    verify: false,
  });
  reply = await request("save", { path, base, text: editor });
  let merged = initial.replace("Alpha", "Editor").replace("Beta", "External");
  assert(
    reply.status === "saved" && reply.document.version.text === merged,
    "Native Git merge did not return the saved live content",
  );
  await invoke("smoke_editor_file", {
    workspaceId: workspace.id,
    text: merged,
    verify: true,
  });
  assert(
    reply.submittedRevision &&
      reply.submittedRevision !== reply.document.version.revision,
    "Submitted editor hash was confused with the merged stored version",
  );
  reply = await request("save", {
    path,
    base: { text: editor, revision: reply.submittedRevision },
    text: editor.replace("Editor", "Editor newer"),
  });
  merged = merged.replace("Editor", "Editor newer");
  assert(
    reply.status === "saved" && reply.document.version.text === merged,
    "Newer typing lost the external addition or caused a false conflict",
  );
  await invoke("smoke_editor_file", {
    workspaceId: workspace.id,
    text: merged,
    verify: true,
  });
  const history = (await request("history", { path })).history;
  assert(
    history.length >= 4 &&
      history.some(
        (entry) =>
          entry.message.split("\n\n")[0] === "native.history.externalChanges",
      ),
    "Independent external history is missing",
  );
  const preview = await request("read", {
    path,
    text: "<script>alert(1)</script>\n\n# Draft preview",
  });
  assert(
    preview.document.version.text === merged,
    "Rendering a draft changed the disk version",
  );
  assert(
    !preview.document.html.includes("<script>") &&
      preview.document.html.includes("Draft preview"),
    "Draft rendering executed raw HTML",
  );
  const conflictBase = reply.document.version;
  const candidate = merged.replace("Editor", "Chosen");
  await invoke("smoke_editor_file", {
    workspaceId: workspace.id,
    text: merged.replace("Editor", "Outside"),
    verify: false,
  });
  reply = await request("save", { path, base: conflictBase, text: candidate });
  assert(
    reply.status === "conflict" &&
      reply.editor === candidate &&
      reply.external.text.includes("Outside"),
    "Native conflict candidates are incomplete",
  );
  assert(
    reply.base.text === conflictBase.text &&
      reply.base.revision === conflictBase.revision,
    "The conflict ancestor was replaced by the external candidate",
  );
  await invoke("smoke_editor_file", {
    workspaceId: workspace.id,
    text: merged.replace("Editor", "Newer"),
    verify: false,
  });
  const changed = await request("resolve", {
    path,
    token: reply.token,
    choice: "editor",
  });
  assert(
    changed.status === "changed",
    "Stale conflict choice overwrote a newer external change",
  );
  reply = await request("save", { path, base: conflictBase, text: candidate });
  assert(
    reply.status === "conflict" && reply.external.text.includes("Newer"),
    "Conflict refresh lost the newer candidate",
  );
  reply = await request("resolve", {
    path,
    token: reply.token,
    choice: "editor",
  });
  assert(reply.status === "saved", "Native conflict resolution failed");
  await invoke("smoke_editor_file", {
    workspaceId: workspace.id,
    text: candidate,
    verify: true,
  });
  rejected = false;
  try {
    await request("resource", { path: "../outside.png" });
  } catch {
    rejected = true;
  }
  assert(rejected, "A resource escaped the workspace");
  rejected = false;
  try {
    await request("save", {
      workspaceId: "unknown",
      path,
      base: reply.document.version,
      text: "wrong workspace",
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "An unknown workspace accepted a write");
  const literal = "literal#%25.md";
  if (
    (await request("snapshot")).snapshot.entries.some(
      (entry) => entry.path === literal,
    )
  )
    await request("delete", { path: literal });
  await request("create", { path: literal });
  assert(
    (await request("openExternal", { path: literal })).document.path ===
      literal,
    "Exact tree path was parsed as a URI",
  );
  assert(
    (
      await request("openExternal", {
        href: "literal%23%2525.md#section",
        destination: path,
      })
    ).document.path === literal,
    "Rendered href was decoded more than once",
  );
  rejected = false;
  try {
    await request("openExternal", {
      path: literal,
      href: "other.md",
      destination: path,
    });
  } catch {
    rejected = true;
  }
  assert(rejected, "Mixed file-path and href input was accepted");
  const waitFor = async (probe, description) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const value = await probe();
      if (value) return value;
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
    throw new Error(description);
  };
  await invoke("smoke_progress", { stage: "editor-localization" });
  const draft = document.querySelector(".chat-pane textarea");
  const originalDraft = draft.value;
  draft.value = "Keep this draft unchanged.";
  draft.dispatchEvent(new Event("input", { bubbles: true }));
  const localized = {
    language: "de",
    formats: { time: "24", date: "ymd", number: "dot-apostrophe" },
  };
  await invoke("smoke_localization_replace", {
    scope: workspace.id,
    preferences: localized,
  });
  await waitFor(
    () =>
      document.documentElement.lang === "de" &&
      draft.placeholder === "Nachricht…" &&
      [
        ...document.querySelectorAll(
          '.pane-title, [role="tab"], .mobile-tab-trigger',
        ),
      ].some(
        (title) =>
          title.textContent.trim() === (conversationTitle ?? "Neuer Chat"),
      ),
    "Changed workspace language was not received from storage",
  );
  assert(
    draft.isConnected && draft.value === "Keep this draft unchanged.",
    "Receiving language settings reset the chat draft",
  );
  const stored = await invoke("localization_snapshot", { scope: workspace.id });
  assert(
    stored.language === "de" &&
      stored.formats.time === "24" &&
      stored.formats.date === "ymd" &&
      stored.formats.number === "dot-apostrophe",
    "Independent formats were not persisted",
  );
  await window.prepareLocalizationSmoke();
  await waitFor(
    () =>
      document.documentElement.lang === "en" &&
      draft.placeholder === "Message…" &&
      [
        ...document.querySelectorAll(
          '.pane-title, [role="tab"], .mobile-tab-trigger',
        ),
      ].some(
        (title) =>
          title.textContent.trim() === (conversationTitle ?? "New chat"),
      ),
    "English labels were not restored",
  );
  draft.value = originalDraft;
  draft.dispatchEvent(new Event("input", { bubbles: true }));
  await invoke("smoke_progress", { stage: "editor-open-file" });
  const navigation = document.querySelector(
    'button[aria-label="Open navigation"]',
  );
  if (navigation?.getBoundingClientRect().width) navigation.click();
  const filesButton = await waitFor(
    () =>
      [...document.querySelectorAll("button.nav-destination")].find(
        (button) => button.textContent.trim() === "Files",
      ),
    "Files navigation is unavailable",
  );
  filesButton.click();
  await window.waitSmokeFileTarget(workspace.id);
  const entry = await waitFor(
    () =>
      [...document.querySelectorAll("button.file-entry")].find(
        (button) => button.getAttribute("aria-description") === path,
      ),
    "The native file tree did not show the saved file",
  );
  entry.click();
  await window.waitSmokeFileTarget(workspace.id, path);
  const heading = await waitFor(
    () => document.querySelector(".markdown h1"),
    "The native document did not open",
  );
  await invoke("smoke_progress", { stage: "editor-source-roundtrip" });
  let actions;
  const readButton = await window.withSmokeReadMenuTrace(async (snapshot) => {
    heading.click();
    const sourceAtBlock = await waitFor(
      () => document.querySelector("textarea.source-text:not([readonly])"),
      "Clicking native rendered text did not open source",
    );
    try {
      await waitFor(
        () =>
          document.querySelector("textarea.source-text:not([readonly])")
            ?.selectionStart === candidate.indexOf("# Native editor"),
        "Rendered source position did not include file metadata",
      );
    } catch (error) {
      throw new Error(
        `${String(error)} (expected ${candidate.indexOf("# Native editor")}, observed ${document.querySelector("textarea.source-text:not([readonly])")?.selectionStart}, originalConnected ${sourceAtBlock.isConnected})`,
        { cause: error },
      );
    }
    actions = document.querySelector('button[aria-label="File actions"]');
    actions.click();
    try {
      return await waitFor(
        () =>
          [
            ...document.querySelectorAll(
              '[popover]:popover-open [role="menuitemradio"]',
            ),
          ].find((button) => button.textContent.trim() === "Read"),
        "The read action is unavailable",
      );
    } catch (error) {
      throw new Error(
        `${String(error)}; Read-menu trace: ${JSON.stringify(snapshot())}`,
        { cause: error },
      );
    }
  });
  readButton.click();
  await waitFor(
    () => document.querySelector(".markdown h1"),
    "Reading mode was not restored",
  );
  actions.click();
  const sourceButton = await waitFor(
    () =>
      [
        ...document.querySelectorAll(
          '[popover]:popover-open [role="menuitemradio"]',
        ),
      ].find((button) => button.textContent.trim() === "Edit source"),
    "The source action is unavailable",
  );
  sourceButton.click();
  const textarea = await waitFor(
    () => document.querySelector("textarea.source-text:not([readonly])"),
    "The native source editor is unavailable",
  );
  await invoke("smoke_progress", { stage: "editor-autosave" });
  const typed = textarea.value + "\nNext review: Friday.\n";
  textarea.value = typed;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  await waitFor(
    async () =>
      (await request("read", { path })).document.version.text === typed,
    "Native editor input was not automatically saved",
  );
  await invoke("smoke_editor_file", {
    workspaceId: workspace.id,
    text: typed,
    verify: true,
  });
  await waitFor(
    async () => (await request("snapshot")).snapshot.drafts.length === 0,
    "Successful saving left a draft behind",
  );
  await invoke("smoke_progress", { stage: "editor-pane-history" });
  const navigationState = async () => {
    const { layout } = (
      await invoke("layout_load", { workspaceId: workspace.id })
    ).data;
    const tab = layout.tabs.find((item) => item.id === layout.activeTabId);
    return tab.panes.find((pane) => pane.id === tab.activePaneId).navigation;
  };
  const steps = (await navigationState()).cursor;
  for (
    let step = 0;
    step < steps && !document.querySelector(".chat-pane");
    step++
  ) {
    const back = await waitFor(
      () =>
        [
          ...document.querySelectorAll(
            'button[aria-label="Back in this pane"]',
          ),
        ].find((button) => !button.disabled),
      "Pane history is unavailable",
    );
    const cursor = (await navigationState()).cursor;
    back.click();
    await waitFor(
      async () => (await navigationState()).cursor < cursor,
      "Pane history did not retain its previous position",
    );
  }
  await waitFor(
    () => document.querySelector(".chat-pane"),
    "Pane history did not restore the conversation",
  );
};

window.runRecoverySmoke = async (restored) => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const workspace = (await invoke("workspace_snapshot")).current;
  const fixture = (action) =>
    invoke("smoke_recovery_file", { workspaceId: workspace.id, action });
  const wait = async (probe, description) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await probe();
      if (result) return result;
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }
    throw new Error(description);
  };
  const expected = await fixture(restored ? "inspect" : "protect");
  assert(expected, "The durable recovery fixture is missing");
  const navigation = document.querySelector(
    'button[aria-label="Open navigation"]',
  );
  if (navigation?.getBoundingClientRect().width) navigation.click();
  (
    await wait(
      () =>
        [...document.querySelectorAll("button.nav-destination")].find(
          (button) => button.textContent.trim() === "Files",
        ),
      "Files navigation is unavailable",
    )
  ).click();
  await window.waitSmokeFileTarget(workspace.id);
  (
    await wait(
      () =>
        [...document.querySelectorAll("button.file-entry")].find(
          (button) =>
            button.getAttribute("aria-description") === "native-editor.md",
        ),
      "The recovery file is missing",
    )
  ).click();
  await window.waitSmokeFileTarget(workspace.id, "native-editor.md");
  (
    await wait(
      () => document.querySelector('button[aria-label="File actions"]'),
      "File actions are unavailable",
    )
  ).click();
  (
    await wait(
      () =>
        [
          ...document.querySelectorAll(
            '[popover]:popover-open [role="menuitemradio"]',
          ),
        ].find((button) => button.textContent.trim() === "Edit source"),
      "Edit source is unavailable",
    )
  ).click();
  const textarea = await wait(
    () => document.querySelector("textarea.source-text:not([readonly])"),
    "The recovered source editor is unavailable",
  );
  if (restored) {
    assert(
      textarea.value === expected.text,
      "Restart did not restore the exact editor text",
    );
    assert(
      document
        .querySelector(".document-footer")
        .textContent.includes("Recovery draft stored"),
      "Restored text is not identified as durable",
    );
    await fixture("inspect");
    void (async () => {
      const button = (text) =>
        [...document.querySelectorAll("dialog[open] button")].find(
          (item) => !item.disabled && item.textContent.trim() === text,
        );
      const discard = await wait(
        () => button("Discard changes…"),
        "Closing did not retain the recovered draft",
      );
      assert(
        document.querySelector('textarea[aria-label="Retained unsaved source"]')
          .value === expected.text,
        "Closing changed the recovered text",
      );
      discard.click();
      (
        await wait(
          () => button("Discard and close"),
          "Discarding did not require confirmation",
        )
      ).click();
    })().catch((error) =>
      invoke("finish_smoke_test", { error: String(error) }),
    );
  } else {
    assert(
      textarea.value === expected.original,
      "The original source differs before the failed save",
    );
    textarea.value = expected.text;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(
      () =>
        document
          .querySelector(".document-footer")
          ?.textContent.includes("Recovery draft stored"),
      "The editor did not acknowledge durable draft staging",
    );
    await wait(
      () =>
        document
          .querySelector('.file-notice[role="alert"]')
          ?.textContent.includes("read-only"),
      "The target save did not fail",
    );
    assert(
      textarea.value === expected.text,
      "The failed save changed editor text",
    );
    await window.runScriptFailureFixture();
    await invoke("smoke_verify_diagnostics");
    await fixture("acknowledge");
  }
};
