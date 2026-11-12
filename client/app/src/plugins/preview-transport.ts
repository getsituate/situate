import { startCheckRenderer } from "./check-renderer";
import type { PreviewRequest } from "./check-renderer-client";

type PreviewMessage =
  | { type: "request"; request: PreviewRequest }
  | {
      type: "captureFinished";
      generation: number;
      invocationId: string;
    }
  | {
      type: "serviceResult";
      requestId: string;
      value?: unknown;
      error?: string;
    };

export interface PreviewBridge {
  send(payload: unknown): void;
  receive?: (message: PreviewMessage) => void;
}

export function startPreviewRenderer(bridge: PreviewBridge): void {
  const pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  startCheckRenderer(async (command, args) => {
    if (command === "plugin_preview_ack") {
      bridge.send({ type: "reply", ...args });
      return;
    }
    const requestId = crypto.randomUUID();
    const result = new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
    });
    bridge.send({ type: "service", requestId, ...args });
    return result;
  });
  bridge.receive = (message) => {
    switch (message.type) {
      case "request":
        window.__situatePreviewRequest?.(message.request);
        break;
      case "captureFinished":
        window.__situatePreviewCaptureFinished?.(message);
        break;
      case "serviceResult": {
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.value);
        break;
      }
    }
  };
}
