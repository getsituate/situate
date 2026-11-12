window.prepareOrdinaryWorkspaceSmoke = async () => {
  const invoke = window.nativeSmokeWait.invoke;
  const snapshot = await invoke("workspace_snapshot");
  if (!snapshot.onboarding) return;
  const scope = snapshot.current.id;
  const saved = await window.nativeSmokeWait.wait(
    () => invoke("onboarding_load", { scope }),
    "Ordinary workspace fixture setup did not finish loading",
  );
  if (
    saved.record?.step !== "access" ||
    saved.record.conversationId ||
    saved.record.description ||
    saved.record.ideas.length
  )
    throw new Error(
      "Ordinary workspace fixture contains authored onboarding progress",
    );
  await invoke("onboarding_save", {
    scope,
    expectedRevision: saved.revision,
    record: { ...saved.record, step: "complete" },
  });
  await invoke("workspace_action", {
    action: "ai-setup-done",
    id: scope,
    name: null,
  });
};

window.runOnboardingSmoke = async (info) => {
  if (info.role !== "primary") return false;
  const smoke = window.nativeSmokeWait;
  const invoke = smoke.invoke;
  const scope = info.scope;
  const assert = (value, code) => {
    if (!value) throw new Error(code);
  };
  const wait = (check, code) => smoke.wait(check, code, { timeout: 15000 });
  const load = () => invoke("onboarding_load", { scope });
  const request = (operation, extra = {}) =>
    invoke("files_request", {
      request: { workspaceId: scope, operation, ...extra },
    });
  const proposal =
    "# Native onboarding\n\nReview synthetic tasks each Friday.\n";
  const conversationId = "onboarding-smoke-conversation";
  const draft = "Keep my unsent question after reopening.";
  const saved = await load();
  assert(saved.record, "onboarding-initial-progress-missing");
  if (saved.record.step === "access") {
    assert(info.phase !== "reopen", "onboarding-progress-not-restored");
    await wait(
      () => document.querySelector(".setup-frame .setup-access-panel"),
      "onboarding-access-not-rendered",
    );
    assert(
      !document.querySelector(".topic-window"),
      "onboarding-initial-shell-bypass",
    );
    assert(
      ![...document.querySelectorAll("button")].some((button) =>
        ["Skip for now", "Continue without AI"].includes(
          button.textContent.trim(),
        ),
      ),
      "onboarding-manual-bypass-visible",
    );
    let rejection;
    try {
      await invoke("workspace_action", {
        action: "ai-setup-done",
        id: scope,
        name: null,
      });
    } catch (error) {
      rejection = String(error);
    }
    assert(
      rejection === "native.onboarding.storage.incomplete",
      "onboarding-native-gate-bypassed",
    );
    assert(
      saved.record.conversationId === null &&
        saved.record.fresh === false &&
        saved.record.intent === "help" &&
        saved.record.entered === false,
      "onboarding-conversation-defaults-invalid",
    );
    await invoke("ai_create_conversation", {
      scope,
      id: conversationId,
      title: "Synthetic setup",
      initial: { draft },
    });
    await invoke("onboarding_save", {
      scope,
      expectedRevision: saved.revision,
      record: {
        ...saved.record,
        conversationId,
        step: "proposal",
        intent: "keep",
        description: "A synthetic weekly review",
        sourceDescription: "Synthetic Markdown exports",
        proposal: await invoke("onboarding_prepare_instructions", {
          scope,
          text: proposal,
        }),
      },
    });
    window.location.reload();
    return true;
  }
  assert(
    saved.record.conversationId === conversationId,
    "onboarding-conversation-not-restored",
  );
  const chat = await invoke("ai_conversation_read", {
    scope,
    conversation: conversationId,
  });
  assert(
    chat.version === 2 &&
      chat.draft === draft &&
      !chat.messages.length &&
      !chat.runtime?.runs?.length,
    "onboarding-draft-lost-or-request-replayed",
  );
  assert(
    saved.record.proposal === proposal,
    "onboarding-proposal-not-restored",
  );
  const html = await invoke("onboarding_preview", {
    scope,
    text: "# Preview\n\n<script>window.bad = true</script>",
  });
  const preview = new DOMParser().parseFromString(html, "text/html");
  assert(
    preview.querySelector("h1")?.textContent === "Preview" &&
      !preview.querySelector("script"),
    "onboarding-preview-not-sanitized",
  );
  if (saved.record.step === "proposal") {
    assert(info.phase !== "reopen", "onboarding-entry-not-restored");
    // Seed legacy entry so reopening exercises migration without contacting a model.
    const created = await request("create", {
      path: ".situate/working-method.md",
      text: saved.record.proposal,
    });
    assert(
      created.status === "saved",
      "onboarding-instruction-fixture-not-saved",
    );
    const confirmed = await invoke("onboarding_save", {
      scope,
      expectedRevision: saved.revision,
      record: {
        ...saved.record,
        step: "sources",
        entered: true,
        instructionRevision: created.document.version.revision,
        instructionBase: created.document.version,
      },
    });
    assert(
      confirmed.record.step === "sources",
      "onboarding-legacy-fixture-not-retained",
    );
    await invoke("workspace_action", {
      action: "ai-setup-done",
      id: scope,
      name: null,
    });
    window.location.reload();
    return true;
  }
  await wait(
    async () => (await load()).record.step === "complete",
    "onboarding-guidance-not-completed",
  );
  const entered = await load();
  assert(
    entered.record.entered && !entered.record.paused,
    "onboarding-entry-not-restored",
  );
  await wait(
    async () =>
      document.querySelector(".topic-window") &&
      !(await invoke("workspace_snapshot")).onboarding,
    "onboarding-normal-workspace-not-entered",
  );
  assert(
    !document.querySelector(".setup-continuation") &&
      ![...document.querySelectorAll("button")].some(
        (button) => button.textContent.trim() === "Guided view",
      ),
    "onboarding-guidance-restored",
  );
  const files = await request("snapshot");
  assert(
    files.snapshot.entries.some(
      (entry) => entry.path === ".situate/working-method.md",
    ) &&
      !files.snapshot.entries.some(
        (entry) =>
          entry.path === "Situate" ||
          entry.path === "AGENTS.md" ||
          entry.path === ".situate/history.git",
      ),
    "onboarding-internal-instruction-boundary-invalid",
  );
  const read = await request("read", { path: ".situate/working-method.md" });
  assert(
    read.status === "ok" &&
      read.document.version.text === saved.record.proposal &&
      read.document.version.revision === saved.record.instructionRevision,
    "onboarding-confirmed-instructions-not-restored",
  );
  return false;
};
