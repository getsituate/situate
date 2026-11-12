import { invoke } from "@tauri-apps/api/core";
import {
  createDiagnostics,
  noopProducer as noop,
  type Producer,
  type Transport,
} from "./producer";
export type { Context } from "./contract";
export type { Operation, Producer } from "./producer";

let running = false;
let runtime: ReturnType<typeof createDiagnostics> | undefined;
let app: Producer = noop;
const workspaces = new Map<string, Producer>();

export function startDiagnostics(transport: Transport = invoke): void {
  if (runtime) return;
  runtime = createDiagnostics(transport);
  running = true;
  app = runtime.producer();
  app.emit("app.started", "app");
}
export function diagnosticsFor(scope?: string): Producer {
  return scope === undefined ? app : (workspaces.get(scope) ?? noop);
}
export function retainDiagnostics(scopes: readonly string[]): void {
  if (!runtime || !running) return;
  const retained = new Set(scopes);
  for (const [scope, producer] of workspaces) {
    if (!retained.has(scope)) {
      producer.emit("workspace.closed", "workspace");
      producer.close();
      workspaces.delete(scope);
    }
  }
  for (const scope of scopes) {
    if (workspaces.has(scope) || workspaces.size >= 15) continue;
    const producer = runtime.producer(scope);
    workspaces.set(scope, producer);
    producer.emit("workspace.opened", "workspace");
  }
}
export function stopDiagnostics(): void {
  if (!runtime || !running) return;
  running = false;
  app.emit("app.stopping", "app");
  runtime.shutdown();
  workspaces.clear();
  app = noop;
}
export function flushDiagnostics(): void {
  runtime?.flush();
}
