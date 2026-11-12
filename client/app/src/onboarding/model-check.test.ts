import { beforeEach, expect, it, vi } from "vitest";
import { checkModelAccess } from "./model-check";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
beforeEach(() => {
  vi.resetAllMocks();
  mock.invoke.mockResolvedValue(undefined);
});
it("checks selected native access without creating or saving a conversation", async () => {
  await checkModelAccess("workspace");
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith("ai_model_check", {
    scope: "workspace",
    requestId: expect.any(String),
  });
});
it.each(["onboarding.responseFailed", "native.ai.request.failed"])(
  "native validation failures are not retried or reported as usable access (%s)",
  async (error) => {
    mock.invoke.mockRejectedValueOnce(new Error(error));
    await expect(checkModelAccess("workspace")).rejects.toThrow(error);
    expect(mock.invoke).toHaveBeenCalledOnce();
  },
);
it("pre-cancellation starts no native operation", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    checkModelAccess("workspace", controller.signal),
  ).rejects.toThrow();
  expect(mock.invoke).not.toHaveBeenCalled();
});
it("cancels only this request and waits for native cleanup before settling", async () => {
  let finish!: () => void;
  mock.invoke.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  let settled = false;
  const pending = checkModelAccess("workspace", controller.signal).finally(
    () => {
      settled = true;
    },
  );
  const rejected = expect(pending).rejects.toThrow();
  const requestId = mock.invoke.mock.calls[0][1].requestId;
  controller.abort();
  await Promise.resolve();
  expect(mock.invoke).toHaveBeenCalledWith("ai_model_check_cancel", {
    scope: "workspace",
    requestId,
  });
  expect(settled).toBe(false);
  finish();
  await rejected;
  await checkModelAccess("workspace");
  expect(mock.invoke.mock.calls[2][1].requestId).not.toBe(requestId);
});
