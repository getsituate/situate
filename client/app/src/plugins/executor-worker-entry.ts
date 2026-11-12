import { startExecutorWorker } from "./executor-worker";
import type { ExecutorCommand } from "./executor-protocol";

startExecutorWorker({
  send: (event) => globalThis.postMessage(event),
  receive: (handler) => {
    globalThis.onmessage = (event: MessageEvent<ExecutorCommand>) =>
      handler(event.data);
  },
});
