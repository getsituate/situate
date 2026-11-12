window.runReferenceSmoke = async (restart) => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const sameReference = (actual, expected) =>
    actual &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.keys(expected).every((key) => actual[key] === expected[key]);
  const localReference = (reference) =>
    Object.fromEntries(
      Object.entries(reference).filter(([key]) => key !== "workspaceId"),
    );
  const workspaceId = (await invoke("workspace_snapshot")).current.id;
  const request = (operation, extra = {}) =>
    invoke("files_request", {
      request: { workspaceId, operation, ...extra },
    });
  const fixture = (action) =>
    invoke("smoke_reference_fixture", { workspaceId, action });
  const conversation = "native-references";
  const load = () =>
    invoke("ai_conversation_snapshot", { scope: workspaceId, conversation });
  const source = "native-reference.txt";
  const moved = "native-reference-moved.txt";
  const copy = "native-reference-copy.txt";
  const copyMoved = "native-reference-copy-moved.txt";
  const text = "Original reference text\n";
  const files = await request("snapshot");
  assert(
    files.snapshot?.writable,
    "The native reference workspace is not writable",
  );
  let capturedReferences;
  if (!restart) {
    const expectedRevision = await fixture("prepare");
    const captured = await request("captureReference", {
      path: source,
      expectedRevision,
    });
    const original = captured.reference;
    assert(
      captured.status === "ok" &&
        /^[0-9a-f]{40}$/.test(original.anchorRevision) &&
        original.anchorRevision !== expectedRevision &&
        original.path === source,
      "The native reference did not capture a Git commit anchor",
    );
    assert(
      (await request("rename", { path: source, destination: moved })).status ===
        "ok",
      "The native referenced file did not move",
    );
    const resolved = await request("resolveReference", { reference: original });
    assert(
      resolved.status === "ok" &&
        resolved.document.path === moved &&
        resolved.document.version.text === text &&
        sameReference(resolved.reference, original),
      "Native move resolution changed the stored anchor or selected the wrong file",
    );
    assert(
      (await request("copy", { path: moved, destination: copy })).status ===
        "ok",
      "The native referenced file did not copy",
    );
    const copied = await request("captureReference", { path: copy });
    capturedReferences = [
      original,
      copied.reference,
      {
        kind: "historical",
        workspaceId,
        path: source,
        revision: original.anchorRevision,
      },
    ];
    await invoke("smoke_conversation_fixture", {
      scope: workspaceId,
      fixture: "references",
      references: capturedReferences,
    });
    const snapshot = await load();
    await invoke("ai_conversation_action", {
      scope: workspaceId,
      conversation,
      generation: snapshot.generation,
      actionId: crypto.randomUUID(),
      action: {
        version: 1,
        type: "draft",
        expected: {
          text: snapshot.record.draft,
          attachments: snapshot.record.runtime?.draftAttachments ?? [],
          references: snapshot.record.runtime?.draftReferences ?? [],
        },
        input: {
          text: "Unsent reference prompt",
          attachments: [],
          references: capturedReferences,
        },
      },
    });
    for (const [operation, extra] of [
      ["rename", { path: copy, destination: copyMoved }],
      ["delete", { path: moved }],
      ["copy", { path: copyMoved, destination: moved }],
    ]) {
      assert(
        (await request(operation, extra)).status === "ok",
        "The native reference lineage operation failed",
      );
    }
  }
  const before = await fixture("inspect");
  const snapshot = await load();
  const record = snapshot.record;
  const references = record.runtime?.draftReferences;
  assert(
    record.version === 2 &&
      record.revision >= 2 &&
      record.draft === "Unsent reference prompt" &&
      references?.length === 3 &&
      references.every((reference) => reference.workspaceId === workspaceId) &&
      record.runtime.pending[0].state === "pending" &&
      record.runtime.runs[0].state === "completed",
    "Native conversation loading lost its references or changed settled state",
  );
  if (capturedReferences) {
    assert(
      references.every((reference, index) =>
        sameReference(reference, capturedReferences[index]),
      ),
      "Native conversation storage changed the captured references",
    );
  }
  for (const [stored, bound] of [
    [before.record.runtime.draftReferences, references],
    [
      before.record.runtime.pending[0].references,
      record.runtime.pending[0].references,
    ],
    [
      before.record.runtime.runs[0].references,
      record.runtime.runs[0].references,
    ],
  ]) {
    assert(
      stored.length === bound.length &&
        bound.every(
          (reference, index) =>
            reference.workspaceId === workspaceId &&
            sameReference(stored[index], localReference(reference)),
        ),
      "Native conversation references retained a runtime scope on disk or changed identity",
    );
  }
  const expected = {
    text: record.draft,
    attachments: record.runtime?.draftAttachments ?? [],
    references,
  };
  const foreign = JSON.parse(JSON.stringify(expected));
  foreign.references[0].workspaceId = "foreign-workspace";
  let rejected;
  try {
    await invoke("ai_conversation_action", {
      scope: workspaceId,
      conversation,
      generation: snapshot.generation,
      actionId: crypto.randomUUID(),
      action: { version: 1, type: "draft", expected, input: foreign },
    });
  } catch (error) {
    rejected = String(error);
  }
  assert(
    rejected === "native.ai.conversation.versionInvalid",
    "Native conversation storage accepted a foreign runtime reference",
  );
  assert(
    (await fixture("inspect")).digest === before.digest,
    "Reference binding or a rejected save rewrote the stored conversation",
  );
  const denied = await load();
  assert(
    !denied.taskActive &&
      denied.phase !== "persistenceFailed" &&
      denied.record.revision === record.revision,
    "A rejected foreign reference stranded the native conversation owner",
  );
  const nextInput = { ...expected, text: "Edited reference prompt" };
  const next = await invoke("ai_conversation_action", {
    scope: workspaceId,
    conversation,
    generation: denied.generation,
    actionId: crypto.randomUUID(),
    action: { version: 1, type: "draft", expected, input: nextInput },
  });
  assert(
    !next.taskActive &&
      next.phase !== "persistenceFailed" &&
      next.record.draft === nextInput.text &&
      next.position > denied.position &&
      next.record.revision === record.revision,
    "A valid draft could not be edited after foreign reference rejection",
  );
  const restored = await invoke("ai_conversation_action", {
    scope: workspaceId,
    conversation,
    generation: denied.generation,
    actionId: crypto.randomUUID(),
    action: { version: 1, type: "draft", expected: nextInput, input: expected },
  });
  assert(
    restored.record.draft === expected.text,
    "The reference prompt could not be restored",
  );
  assert(
    (await request("resolveReference", { reference: references[0] })).status ===
      "deleted",
    "Reusing a native path revived a deleted reference",
  );
  const copied = await request("resolveReference", {
    reference: references[1],
  });
  assert(
    copied.status === "ok" &&
      copied.document.path === copyMoved &&
      copied.document.version.text === text &&
      sameReference(copied.reference, references[1]),
    "The stored native reference did not follow its own copy's move",
  );
  const historical = await request("resolveReference", {
    reference: references[2],
  });
  assert(
    historical.status === "ok" &&
      sameReference(historical.reference, references[2]) &&
      historical.reference.path === source &&
      historical.reference.revision === references[0].anchorRevision &&
      historical.document.path === source &&
      historical.document.version.revision === references[0].anchorRevision &&
      historical.document.version.text === text,
    "The native reference's retained source history is unavailable",
  );
  await invoke("smoke_progress", { stage: "references-verified" });
};
