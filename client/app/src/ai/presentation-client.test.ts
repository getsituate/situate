import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  listen: vi.fn(),
  workspaceCoordinator: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("@tauri-apps/api/event", () => mocks);
vi.mock("../layout/registry", () => mocks);
import { startNativePresentation } from "./presentation-client";

describe("native presentation", () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  let stop: ReturnType<typeof vi.fn>;
  let coordinator: {
    open: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    vi.resetAllMocks();
    listeners.clear();
    stop = vi.fn();
    coordinator = {
      open: vi.fn().mockResolvedValue(true),
      reveal: vi.fn().mockResolvedValue(true),
    };
    mocks.isTauri.mockReturnValue(true);
    mocks.workspaceCoordinator.mockReturnValue(coordinator);
    mocks.listen.mockImplementation(async (name, callback) => {
      listeners.set(name, callback);
      return stop;
    });
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "ai_presentation_take")
        return { type: "open_view", arguments: { viewId: "files" } };
    });
  });
  const request = () =>
    listeners.get("ai-presentation")!({
      payload: { id: "navigation", scope: "workspace" },
    });

  it("does not install a native bridge in a browser", async () => {
    mocks.isTauri.mockReturnValue(false);
    (await startNativePresentation())();
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("takes the native command before navigation and acknowledges its actual result", async () => {
    const dispose = await startNativePresentation();
    request();
    await flushPromises();
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "ai_presentation_take", {
      scope: "workspace",
      id: "navigation",
    });
    expect(coordinator.open).toHaveBeenCalledWith(
      { kind: "view", viewId: "files" },
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith("ai_presentation_ack", {
      scope: "workspace",
      id: "navigation",
      result: { ok: true, changed: true },
    });
    dispose();
  });

  it("never navigates when native admission rejects the request", async () => {
    mocks.invoke.mockRejectedValue(new Error("native.ai.turn.inactive"));
    const dispose = await startNativePresentation();
    request();
    await flushPromises();
    expect(coordinator.open).not.toHaveBeenCalled();
    dispose();
  });

  it("does not duplicate a pending command", async () => {
    let admit!: (value: unknown) => void;
    mocks.invoke.mockImplementation((command) =>
      command === "ai_presentation_take"
        ? new Promise((resolve) => {
            admit = resolve;
          })
        : Promise.resolve(),
    );
    const dispose = await startNativePresentation();
    request();
    request();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    admit({
      type: "open_conversation",
      arguments: { conversationId: "existing" },
    });
    await flushPromises();
    expect(coordinator.open).toHaveBeenCalledTimes(1);
    expect(coordinator.open).toHaveBeenCalledWith(
      { kind: "conversation", conversationId: "existing" },
      undefined,
      expect.any(Object),
    );
    dispose();
  });

  it("cancels a pending reveal without claiming successful navigation", async () => {
    mocks.invoke.mockImplementation(async (command) =>
      command === "ai_presentation_take"
        ? {
            type: "reveal_content",
            arguments: {
              viewId: "files",
              contentId: "Note.md",
              revision: "retained",
            },
          }
        : undefined,
    );
    let finish!: (changed: boolean) => void;
    const revealed = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    coordinator.reveal.mockReturnValue(revealed);
    const dispose = await startNativePresentation();
    request();
    await flushPromises();
    const guard = coordinator.reveal.mock.calls[0]![3] as {
      signal: AbortSignal;
    };
    listeners.get("ai-presentation-cancel")!({ payload: { id: "navigation" } });
    expect(guard.signal.aborted).toBe(true);
    finish(false);
    await flushPromises();
    expect(mocks.invoke).toHaveBeenLastCalledWith("ai_presentation_ack", {
      scope: "workspace",
      id: "navigation",
      result: { ok: false, changed: false },
    });
    dispose();
  });

  it("rejects unavailable or replaced workspace coordinators", async () => {
    mocks.workspaceCoordinator.mockReturnValue(undefined);
    const dispose = await startNativePresentation();
    request();
    await flushPromises();
    expect(coordinator.open).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenLastCalledWith("ai_presentation_ack", {
      scope: "workspace",
      id: "navigation",
      result: { ok: false, changed: false },
    });
    dispose();
  });

  it("unregisters both listeners when disposed", async () => {
    const dispose = await startNativePresentation();
    dispose();
    expect(stop).toHaveBeenCalledTimes(2);
    request();
    await flushPromises();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
