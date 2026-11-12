import ExecutorWorker from "./executor-worker-entry?worker&inline";
import { startExecutorSupervisor } from "./executor-supervisor";
import type { ExecutorCommand, ExecutorEvent } from "./executor-protocol";

declare global {
  var __SITUATE_EXECUTOR__: {
    send(payload: ExecutorEvent): void;
    receive?: (payload: ExecutorCommand) => void;
  };
}

startExecutorSupervisor(
  globalThis.__SITUATE_EXECUTOR__,
  () => new ExecutorWorker(),
);
