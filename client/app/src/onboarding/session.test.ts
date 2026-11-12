import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { newOnboardingRecord } from "./types";
const api = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("./api", () => ({
  loadOnboarding: api.load,
  saveOnboarding: api.save,
}));
import { onboardingSession, retainOnboarding } from "./session";
const initialRevision = "a".repeat(40);
const savedRevision = "b".repeat(40);
beforeEach(() => {
  vi.useFakeTimers();
  api.load.mockReset().mockResolvedValue({
    record: newOnboardingRecord(),
    revision: initialRevision,
    writable: true,
  });
  api.invoke.mockReset().mockImplementation(async (_command, { expected }) => ({
    record: { ...expected, step: "complete", paused: false },
    revision: savedRevision,
    writable: true,
  }));
  api.save.mockReset().mockImplementation(async (_scope, record) => ({
    record,
    revision: savedRevision,
    writable: true,
  }));
});
afterEach(() => {
  retainOnboarding([]);
  vi.useRealTimers();
});
it.each(["sources", "review", "support", "proposal"] as const)(
  "closes previously entered %s guidance without changing retained work",
  async (step) => {
    const before = {
      ...newOnboardingRecord(),
      step,
      entered: true,
      paused: true,
      instructionRevision: initialRevision,
      conversationId: "retained-import",
      proposal: "# Retained proposal",
      sourceDescription: "More notes remain in the source",
    };
    api.load.mockResolvedValue({
      record: before,
      revision: initialRevision,
      writable: true,
    });
    const session = onboardingSession("notes");
    await session.load();
    expect(api.invoke).toHaveBeenCalledExactlyOnceWith("onboarding_action", {
      scope: "notes",
      action: "enter",
      expected: before,
    });
    expect(api.save).not.toHaveBeenCalled();
    expect(session.state.record).toEqual({
      ...before,
      step: "complete",
      paused: false,
    });
    await session.load();
    expect(api.invoke).toHaveBeenCalledTimes(1);
  },
);
it("retains failed native guidance migration until explicit recovery", async () => {
  api.load.mockResolvedValue({
    record: {
      ...newOnboardingRecord(),
      entered: true,
      step: "sources",
      instructionRevision: initialRevision,
    },
    revision: initialRevision,
    writable: true,
  });
  api.invoke.mockRejectedValueOnce(new Error("storage unavailable"));
  const session = onboardingSession("notes");
  await expect(session.load()).rejects.toThrow("storage unavailable");
  expect(session.state.record?.step).toBe("sources");
  expect(session.state.error).toBeInstanceOf(Error);
  expect(api.invoke).toHaveBeenCalledOnce();
  expect(api.save).not.toHaveBeenCalled();
  await session.retry();
  expect(session.state.record).toMatchObject({
    entered: true,
    step: "complete",
  });
  expect(session.state.dirty).toBe(false);
});
it("evaluates an update against the state after pending saves settle", async () => {
  const session = onboardingSession("notes");
  await session.load();
  await session.update({ step: "complete" });
  await session.update((record) => ({
    sourceDescription: record.step,
  }));
  expect(session.state.record).toMatchObject({
    step: "complete",
    sourceDescription: "complete",
  });
});
it("coalesces draft edits and saves against the last known revision", async () => {
  const session = onboardingSession("notes");
  await session.load();
  session.patch({ description: "First draft" });
  session.patch({ description: "My actual working method" });
  await session.flush();
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.save).toHaveBeenCalledWith(
    "notes",
    expect.objectContaining({ description: "My actual working method" }),
    initialRevision,
  );
  expect(session.state.dirty).toBe(false);
  expect(session.state.revision).toBe(savedRevision);
});
it("retains edits made while a write is pending and saves them with the new revision", async () => {
  const session = onboardingSession("notes");
  await session.load();
  let complete!: (value: unknown) => void;
  api.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  session.patch({ description: "Submitted" });
  const flushing = session.flush();
  session.patch({ description: "Newer input" });
  complete({
    record: { ...newOnboardingRecord(), description: "Submitted" },
    revision: savedRevision,
    writable: true,
  });
  await flushing;
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1]).toEqual([
    "notes",
    expect.objectContaining({ description: "Newer input" }),
    savedRevision,
  ]);
  expect(session.state.record?.description).toBe("Newer input");
});
it("retains known replacement after a durability failure but requires acknowledged recovery", async () => {
  const session = onboardingSession("notes");
  await session.load();
  session.patch({ description: "Retained" });
  api.save.mockRejectedValueOnce(
    new Error("native.onboarding.storage.durability"),
  );
  api.load.mockResolvedValue({
    record: { ...newOnboardingRecord(), description: "Retained" },
    revision: savedRevision,
    writable: true,
  });
  await expect(session.flush()).rejects.toThrow("durability");
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(session.state.dirty).toBe(true);
  expect(session.state.revision).toBe(savedRevision);
  expect(session.state.error).toBeInstanceOf(Error);
  await session.retry();
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(api.save.mock.calls[1]?.[2]).toBe(savedRevision);
  expect(session.state.dirty).toBe(false);
  expect(session.state.error).toBeUndefined();
});
it("preserves the local draft and refuses to overwrite a newer saved record", async () => {
  const session = onboardingSession("notes");
  await session.load();
  session.patch({ description: "Unsent personal draft" });
  api.save.mockRejectedValueOnce(
    new Error("native.onboarding.storage.conflict"),
  );
  api.load.mockResolvedValue({
    record: {
      ...newOnboardingRecord(),
      description: "Changed on another device",
    },
    revision: savedRevision,
    writable: true,
  });
  await expect(session.flush()).rejects.toThrow("conflict");
  await expect(session.retry()).rejects.toThrow("conflict");
  expect(session.state.record?.description).toBe("Unsent personal draft");
  expect(session.state.dirty).toBe(true);
  expect(api.save).toHaveBeenCalledTimes(1);
});
it("does not apply cancelled decisions after a pending draft save", async () => {
  const session = onboardingSession("notes");
  await session.load();
  let complete!: (value: unknown) => void;
  api.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  session.patch({ description: "Retain this draft" });
  const flushing = session.flush();
  const abort = new AbortController();
  const updating = session.update(
    { proposal: "Do not adopt this proposal", step: "proposal" },
    abort.signal,
  );
  const rejected = expect(updating).rejects.toThrow();
  abort.abort();
  complete({
    record: { ...newOnboardingRecord(), description: "Retain this draft" },
    revision: savedRevision,
    writable: true,
  });
  await flushing;
  await rejected;
  expect(session.state.record).toMatchObject({
    description: "Retain this draft",
    proposal: "",
    step: "access",
  });
  expect(api.save).toHaveBeenCalledTimes(1);
});
it("never applies a late load to a closed workspace owner", async () => {
  let complete!: (value: unknown) => void;
  api.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const session = onboardingSession("notes");
  const loading = session.load();
  retainOnboarding([]);
  complete({
    record: newOnboardingRecord(),
    revision: initialRevision,
    writable: true,
  });
  await loading;
  expect(session.state.record).toBeNull();
  expect(onboardingSession("notes")).not.toBe(session);
});
