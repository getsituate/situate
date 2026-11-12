import { beforeEach, expect, it, vi } from "vitest";
import {
  abortClose,
  hasRunningProcesses,
  prepareClose,
} from "./process-lifecycle";

const { invoke, abortWorkspaceChats } = vi.hoisted(() => ({
  invoke: vi.fn(),
  abortWorkspaceChats: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../ai/chat", () => ({ abortWorkspaceChats }));
beforeEach(() => {
  vi.clearAllMocks();
});

it("uses native activity rather than a living plugin view", async () => {
  invoke
    .mockResolvedValueOnce({ runningActions: 0 })
    .mockResolvedValueOnce({ runningActions: 2 });
  expect(await hasRunningProcesses([{ id: "one" }, { id: "two" }])).toBe(true);
  expect(invoke).toHaveBeenCalledWith("plugin_executor", {
    scope: "two",
    request: { operation: "activity" },
  });
});

it("prepares closure when native executor actions remain", async () => {
  invoke.mockImplementation(async (command) =>
    command === "ai_prepare_close"
      ? { processes: false }
      : { runningActions: 1 },
  );
  expect(await prepareClose("workspace")).toBe(true);
});

it("waits for native generation termination and operation drain", async () => {
  let finish!: () => void;
  invoke.mockImplementation((command) =>
    command === "plugin_executor"
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(),
  );
  let stopped = false;
  const pending = abortClose("workspace").then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  expect(invoke).toHaveBeenCalledWith("plugin_executor", {
    scope: "workspace",
    request: { operation: "stop" },
  });
  expect(abortWorkspaceChats).toHaveBeenCalledExactlyOnceWith("workspace");
  finish();
  await pending;
  expect(stopped).toBe(true);
});
