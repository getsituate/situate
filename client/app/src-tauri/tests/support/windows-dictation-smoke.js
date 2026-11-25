window.runWindowsDictationSmoke = async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const wait = window.nativeSmokeWait.wait;
  const select = (s) => document.querySelector(s);
  await invoke("smoke_progress", { stage: "dictation-model" });
  await wait(
    async () => (await invoke("dictation_snapshot")).model === "ready",
    "Verified dictation model did not become ready",
    { timeout: 30000 },
  );
  (
    await wait(
      () => select(".view-chooser .new-conversation"),
      "New chat missing",
    )
  ).click();
  const draft = await wait(
    () => select(".chat-pane textarea"),
    "Draft missing",
  );
  draft.value = "Before after";
  draft.dispatchEvent(new Event("input", { bubbles: true }));
  draft.focus();
  draft.setSelectionRange(7, 7);
  draft.dispatchEvent(new Event("select", { bubbles: true }));
  const record = await wait(
    () => select('button[aria-label="Dictate text"]:not(:disabled)'),
    "Dictation control not ready",
  );
  const phase = await invoke("smoke_phase");
  record.click();
  if (phase.dictationDenied) {
    await assertInterrupted("Microphone access is off.", "privacy settings");
    return;
  }
  const stop = await wait(
    () => select('button[aria-label="Stop recording and transcribe"]'),
    "Recording did not start",
  ).catch(async (error) => {
    const { model, owner } = await invoke("dictation_snapshot");
    throw new Error(
      `${error.message}: ${model}/${owner?.phase ?? "idle"} ${select(".chat-pane dialog[open]")?.textContent ?? ""}`,
    );
  });
  if (phase.dictationFocusSwitch) {
    await wait(() => document.hasFocus(), "Dictation window was not focused");
    await invoke("smoke_progress", {
      stage: "dictation-awaiting-focus-switch",
    });
    await wait(
      () => !document.hasFocus(),
      "Dictation window did not lose focus",
    );
    await window.nativeSmokeWait.wait(
      async () =>
        (await invoke("dictation_snapshot")).owner?.phase === "recording",
      "Dictation did not stay active after switching focus",
    );
  }
  if (phase.dictationLock) {
    await invoke("smoke_progress", { stage: "dictation-awaiting-lock" });
    await assertInterrupted(
      "Dictation was interrupted.",
      "recording was discarded",
    );
    return;
  }
  stop.click();
  await wait(
    async () => !(await invoke("dictation_snapshot")).busy,
    "Native transcription did not finish",
    { timeout: 45000 },
  );
  await wait(
    () => /notebook/i.test(draft.value),
    "Synthetic speech did not reach the original draft",
    { timeout: 3000 },
  ).catch((error) => {
    throw new Error(
      `${error.message}: ${JSON.stringify(draft.value)} ${select(".chat-pane dialog[open]")?.textContent ?? ""}`,
    );
  });
  if (
    draft.readOnly ||
    !draft.value.startsWith("Before ") ||
    !draft.value.endsWith("after") ||
    select(".chat-pane main")
  ) {
    throw new Error("Dictation did not preserve the editable, unsent draft");
  }
  await invoke("smoke_progress", { stage: "dictation-draft-inserted" });

  async function assertInterrupted(title, detail) {
    await wait(() => {
      const text = select(".chat-pane dialog[open]")?.textContent ?? "";
      return text.includes(title) && text.includes(detail);
    }, `Missing dictation notice: ${title}`);
    if (
      draft.value !== "Before after" ||
      draft.readOnly ||
      (await invoke("dictation_snapshot")).busy
    ) {
      throw new Error(
        "Interrupted dictation did not preserve the editable draft",
      );
    }
  }
};
