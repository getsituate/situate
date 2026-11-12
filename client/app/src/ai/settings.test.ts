import { beforeEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  defaultAiSettings,
  loadAiSettings,
  workspaceAiSettings,
} from "./settings";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.mocked(invoke).mockReset());
test("defaults enable comments and hide inline selection", () => {
  expect(defaultAiSettings()).toEqual({
    version: 1,
    chat: null,
    comment: null,
    generatedComments: true,
    showInlineModel: false,
  });
});
test("workspace scopes share their own controller but not settings", async () => {
  vi.mocked(invoke).mockResolvedValue(defaultAiSettings());
  const first = workspaceAiSettings("isolation-a");
  await first.refresh();
  expect(first).toBe(workspaceAiSettings("isolation-a"));
  expect(workspaceAiSettings("isolation-b").state.settings).toBeNull();
});
test("stale reads cannot overwrite later results", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ ...defaultAiSettings(), showInlineModel: true });
  const service = workspaceAiSettings("stale");
  const old = service.refresh();
  await service.refresh();
  finish(defaultAiSettings());
  await old;
  expect(service.state.settings?.showInlineModel).toBe(true);
});
test("uncertain save blocks subsequent writes until successful readback", async () => {
  const service = workspaceAiSettings("uncertain");
  vi.mocked(invoke)
    .mockResolvedValueOnce(defaultAiSettings())
    .mockRejectedValueOnce(new Error("uncertain"));
  await service.refresh();
  const next = { ...defaultAiSettings(), generatedComments: false };
  expect(await service.save(next)).toBe(false);
  expect(service.state.error).toBe(true);
  expect(await service.save(next)).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(2);
  await expect(loadAiSettings("uncertain")).rejects.toThrow(
    "ai.modelChoicesCouldNotBeRead",
  );
  expect(invoke).toHaveBeenCalledTimes(2);
  vi.mocked(invoke).mockResolvedValueOnce(next);
  await service.refresh();
  expect(service.state.error).toBe(false);
  expect(service.state.settings?.generatedComments).toBe(false);
});
test("admission rejects a pending save instead of returning the previous choice", async () => {
  const service = workspaceAiSettings("busy-admission");
  vi.mocked(invoke).mockResolvedValueOnce(defaultAiSettings());
  await service.refresh();
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saving = service.save({
    ...defaultAiSettings(),
    showInlineModel: true,
  });
  await expect(loadAiSettings("busy-admission")).rejects.toThrow(
    "ai.modelChoicesCouldNotBeRead",
  );
  expect(invoke).toHaveBeenCalledTimes(2);
  finish({ ...defaultAiSettings(), showInlineModel: true });
  expect(await saving).toBe(true);
});
test("admission snapshots are detached and failed reads reject", async () => {
  vi.mocked(invoke).mockResolvedValueOnce(defaultAiSettings());
  const snapshot = await loadAiSettings("snapshot");
  snapshot.showInlineModel = true;
  expect(workspaceAiSettings("snapshot").state.settings?.showInlineModel).toBe(
    false,
  );
  vi.mocked(invoke).mockRejectedValueOnce(new Error("private"));
  await expect(loadAiSettings("snapshot")).rejects.toThrow(
    "ai.modelChoicesCouldNotBeRead",
  );
});

test("connection controllers share only their exact workspace and connection identity", async () => {
  vi.mocked(invoke).mockResolvedValue(defaultAiSettings());
  const first = workspaceAiSettings("accounts", "personal");
  const second = workspaceAiSettings("accounts", "work");
  expect(first).toBe(workspaceAiSettings("accounts", "personal"));
  expect(first).not.toBe(second);
  expect(first).not.toBe(workspaceAiSettings("other-workspace", "personal"));
  await first.refresh();
  expect(invoke).toHaveBeenLastCalledWith("ai_settings_load", {
    scope: "accounts",
    connectionId: "personal",
  });
  expect(second.state.settings).toBeNull();
  const updated = { ...defaultAiSettings(), showInlineModel: true };
  vi.mocked(invoke).mockResolvedValue(updated);
  expect(await first.save(updated)).toBe(true);
  expect(invoke).toHaveBeenLastCalledWith("ai_settings_save", {
    scope: "accounts",
    connectionId: "personal",
    settings: updated,
  });
  expect(second.state.settings).toBeNull();
});
test("locked settings and uncertain writes on one account do not block another account's admission", async () => {
  const locked = workspaceAiSettings("account-failure", "locked");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("locked"));
  await locked.refresh();
  expect(locked.state.error).toBe(true);
  vi.mocked(invoke).mockResolvedValue(defaultAiSettings());
  await expect(loadAiSettings("account-failure", "healthy")).resolves.toEqual(
    defaultAiSettings(),
  );
  expect(invoke).toHaveBeenLastCalledWith("ai_settings_load", {
    scope: "account-failure",
    connectionId: "healthy",
  });
  await expect(loadAiSettings("account-failure", "locked")).rejects.toThrow(
    "ai.modelChoicesCouldNotBeRead",
  );
  const healthy = workspaceAiSettings("account-failure", "healthy");
  expect(healthy.state.error).toBe(false);
});
