import type { ExecutorCommand, ExecutorEvent } from "./executor-protocol";

interface ExecutorWorker {
  postMessage(command: ExecutorCommand): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<ExecutorEvent>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export function startExecutorSupervisor(
  bridge: {
    send(payload: ExecutorEvent): void;
    receive?: (command: ExecutorCommand) => void;
  },
  createWorker: () => ExecutorWorker,
): void {
  const workers = new Map<number, ExecutorWorker>();
  const retired = new Set<number>();
  const invocations = new Map<number, Set<string>>();
  const seen = new Map<number, Set<string>>();
  bridge.receive = (command) => {
    if (command.type === "terminate") {
      retired.add(command.generation);
      const worker = workers.get(command.generation);
      workers.delete(command.generation);
      invocations.delete(command.generation);
      seen.delete(command.generation);
      worker?.terminate();
      bridge.send({ type: "terminated", generation: command.generation });
      return;
    }
    if (retired.has(command.generation)) return;
    if (command.type === "load") {
      if (workers.has(command.generation)) return;
      try {
        const worker = createWorker();
        workers.set(command.generation, worker);
        invocations.set(command.generation, new Set());
        seen.set(command.generation, new Set());
        worker.onmessage = ({ data }) => {
          if (
            !data ||
            !["ready", "result", "error", "host", "progress"].includes(
              data.type,
            )
          )
            return;
          if (
            workers.get(command.generation) !== worker ||
            data.generation !== command.generation
          )
            return;
          const active = invocations.get(command.generation)!;
          if ("invocationId" in data && data.invocationId !== undefined) {
            if (!active.has(data.invocationId)) return;
            if (data.type === "result" || data.type === "error")
              active.delete(data.invocationId);
          }
          bridge.send(data);
        };
        worker.onerror = () => {
          if (workers.get(command.generation) !== worker) return;
          workers.delete(command.generation);
          invocations.delete(command.generation);
          retired.add(command.generation);
          worker.terminate();
          bridge.send({
            type: "error",
            generation: command.generation,
            error: "native.plugins.unavailable",
          });
        };
        worker.postMessage(command);
      } catch {
        retired.add(command.generation);
        bridge.send({
          type: "error",
          generation: command.generation,
          error: "native.plugins.unavailable",
        });
      }
      return;
    }
    const worker = workers.get(command.generation);
    if (!worker) return;
    if (command.type === "invoke") {
      const active = invocations.get(command.generation)!;
      const admitted = seen.get(command.generation)!;
      if (admitted.has(command.invocationId)) return;
      admitted.add(command.invocationId);
      active.add(command.invocationId);
    }
    worker.postMessage(command);
  };
}
