import { expect, it, vi } from "vitest";
import { startExecutorSupervisor } from "./executor-supervisor";
import type { ExecutorCommand, ExecutorEvent } from "./executor-protocol";

function supervisor() {
  const bridge = {
    send: vi.fn<(event: ExecutorEvent) => void>(),
    receive: undefined as ((command: ExecutorCommand) => void) | undefined,
  };
  const worker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as ((event: MessageEvent<ExecutorEvent>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
  };
  startExecutorSupervisor(bridge, () => worker);
  bridge.receive!({
    type: "load",
    generation: 7,
    pluginId: "sample",
    source: {
      manifest: {
        schemaVersion: 2,
        id: "sample",
        name: "Sample",
        description: "Fixture",
        skills: ["SKILL.md"],
      },
      serviceEntry: null,
      uiEntry: null,
      modules: {},
      skills: [{ path: "SKILL.md", text: "Fixture" }],
    },
  });
  return { bridge, worker };
}

it("does not accept Worker messages as termination acknowledgements", () => {
  const { bridge, worker } = supervisor();
  worker.onmessage!(
    new MessageEvent<ExecutorEvent>("message", {
      data: { type: "terminated", generation: 7 },
    }),
  );
  expect(bridge.send).not.toHaveBeenCalled();
  expect(worker.terminate).not.toHaveBeenCalled();
  bridge.receive!({ type: "terminate", generation: 7 });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(bridge.send).toHaveBeenCalledExactlyOnceWith({
    type: "terminated",
    generation: 7,
  });
});

it("rejects replies from retired Workers and duplicate invocation results", () => {
  const { bridge, worker } = supervisor();
  bridge.receive!({
    type: "invoke",
    generation: 7,
    invocationId: "invocation",
    kind: "export",
    name: "read",
    args: {},
  });
  const reply = {
    type: "result",
    generation: 7,
    invocationId: "invocation",
    result: 42,
  } as const;
  worker.onmessage!(
    new MessageEvent<ExecutorEvent>("message", { data: reply }),
  );
  worker.onmessage!(
    new MessageEvent<ExecutorEvent>("message", { data: reply }),
  );
  expect(bridge.send).toHaveBeenCalledExactlyOnceWith(reply);
  bridge.receive!({ type: "terminate", generation: 7 });
  bridge.send.mockClear();
  worker.onmessage!(
    new MessageEvent<ExecutorEvent>("message", {
      data: { type: "ready", generation: 7, tools: [], exports: [] },
    }),
  );
  expect(bridge.send).not.toHaveBeenCalled();
});
