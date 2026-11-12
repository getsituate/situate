import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { dictateDraft, type DictationDraft } from "./draft";
import {
  confirmation,
  dictation,
  dictationLevel,
  refreshDictation,
  guardDictation,
  initializeDictation,
  startDictation,
  stopDictationListeners,
} from "./runtime";
const events = vi.hoisted(
  () => new Map<string, (event: { payload: unknown }) => void>(),
);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, listener) => {
    events.set(name, listener);
    return () => events.delete(name);
  }),
}));
function result(text?: string, notice?: string, id = dictation.owner?.id) {
  events.get("dictation-result")?.({ payload: { id, text, notice } });
}
function draft(): DictationDraft {
  return {
    draft: "Bring a book tomorrow.",
    draftSelection: { start: 6, end: 12, direction: "forward" },
    dictationNotice: null,
    dictationInserted: 0,
    unsaved: false,
  };
}
beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(dictation, {
    supported: true,
    model: "ready",
    progress: 100,
    busy: false,
    owner: null,
  });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "dictation_snapshot") return { ...dictation };
    if (command === "dictation_control") result();
  });
  await initializeDictation();
});
afterEach(() => {
  stopDictationListeners();
  events.clear();
});

test("microphone levels belong only to the active recording and never refresh snapshots", async () => {
  await startDictation("garden", "first", vi.fn());
  const owner = dictation.owner!;
  const level = (id: string, value: number) =>
    events.get("dictation-level")?.({ payload: { id, level: value } });
  level(owner.id, 0.8);
  expect(dictationLevel.value).toBe(0);
  dictation.owner = { ...owner, phase: "recording" };
  vi.mocked(invoke).mockClear();
  level(owner.id, 0.8);
  expect(dictationLevel.value).toBe(0.8);
  level("stale", 0.1);
  level(owner.id, NaN);
  expect(dictationLevel.value).toBe(0.8);
  level(owner.id, 2);
  expect(dictationLevel.value).toBe(1);
  expect(invoke).not.toHaveBeenCalled();
  dictation.owner = { ...owner, phase: "transcribing" };
  await refreshDictation();
  expect(dictationLevel.value).toBe(0);
  level(owner.id, 0.9);
  expect(dictationLevel.value).toBe(0);
});

test("recording completion and listener teardown clear microphone feedback", async () => {
  await startDictation("garden", "first", vi.fn());
  dictation.owner = { ...dictation.owner!, phase: "recording" };
  events.get("dictation-level")?.({
    payload: { id: dictation.owner.id, level: 0.7 },
  });
  result();
  expect(dictationLevel.value).toBe(0);
  dictationLevel.value = 0.5;
  stopDictationListeners();
  expect(dictationLevel.value).toBe(0);
  expect(events.has("dictation-level")).toBe(false);
});

test("unavailable native dictation does not fail application initialization or lock typed input", async () => {
  stopDictationListeners();
  vi.mocked(invoke).mockRejectedValue(new Error("unavailable"));
  await expect(initializeDictation()).resolves.toBeUndefined();
  expect(dictation).toMatchObject({
    model: "failed",
    busy: false,
    owner: null,
  });
});

test("reserves admission before permission and rejects competing starts", async () => {
  const complete = vi.fn();
  await Promise.all([
    startDictation("garden", "first", complete),
    startDictation("reading", "second", complete),
  ]);
  expect(
    vi.mocked(invoke).mock.calls.filter(([name]) => name === "dictation_start"),
  ).toHaveLength(1);
  expect(dictation.owner).toMatchObject({
    scope: "garden",
    conversation: "first",
    phase: "permission",
  });
});

test("inserts once into the originating draft's latest text and selection, and persists it", async () => {
  const first = draft(),
    other = draft();
  const save = vi.fn(async () => {});
  await dictateDraft("garden", "first", first, () => true, save);
  const id = dictation.owner!.id;
  first.draft = "Before: replace this. After.";
  first.draftSelection = { start: 8, end: 20, direction: "backward" };
  result("a notebook");
  expect(first.draft).toBe("Before: a notebook. After.");
  expect(first.draftSelection).toEqual({
    start: 18,
    end: 18,
    direction: "none",
  });
  expect(other.draft).toBe("Bring a book tomorrow.");
  expect(save).toHaveBeenCalledTimes(1);
  result("duplicate", undefined, id);
  expect(first.draft).toBe("Before: a notebook. After.");
  expect(save).toHaveBeenCalledTimes(1);
});

for (const notice of ["noSpeech", "failed", "denied", "interrupted"] as const) {
  test(`${notice} preserves edits and selection without saving`, async () => {
    const state = draft(),
      save = vi.fn(async () => {});
    await dictateDraft("garden", "first", state, () => true, save);
    state.draft = "Keep my edit";
    state.draftSelection = { start: 1, end: 5, direction: "forward" };
    result(undefined, notice);
    expect(state).toMatchObject({
      draft: "Keep my edit",
      draftSelection: { start: 1, end: 5 },
      dictationNotice: notice,
    });
    expect(save).not.toHaveBeenCalled();
    expect(dictation.busy).toBe(false);
  });
}

test("a disposed workspace cannot receive a late transcript", async () => {
  const state = draft(),
    save = vi.fn(async () => {});
  let live = true;
  await dictateDraft("garden", "first", state, () => live, save);
  live = false;
  result("late result");
  expect(state.draft).toBe("Bring a book tomorrow.");
  expect(save).not.toHaveBeenCalled();
});

test("navigation cancellation retains admission and confirmation discards before proceeding", async () => {
  await startDictation("garden", "first", vi.fn());
  const stay = guardDictation("garden");
  confirmation.value!.decide(false);
  expect(await stay).toBe(false);
  expect(dictation.busy).toBe(true);
  const leave = guardDictation("garden");
  confirmation.value!.decide(true);
  expect(await leave).toBe(true);
  expect(dictation.busy).toBe(false);
  expect(invoke).toHaveBeenCalledWith("dictation_control", {
    action: "discard",
    id: expect.any(String),
  });
});

test("transcription permits chat switches but closing asks, and completion does not auto-close", async () => {
  await startDictation("garden", "first", vi.fn());
  dictation.owner = { ...dictation.owner!, phase: "transcribing" };
  expect(await guardDictation("garden")).toBe(true);
  expect(confirmation.value).toBeNull();
  const close = guardDictation("garden", true);
  result("finished");
  expect(confirmation.value).not.toBeNull();
  confirmation.value!.decide(false);
  expect(await close).toBe(false);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === "dictation_control"),
  ).toHaveLength(0);
});
