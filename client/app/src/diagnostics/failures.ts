import type { App } from "vue";
import { captureIncident } from "../errors/runtime";
import { diagnosticsFor } from "./index";
import type { Context } from "./contract";
import type { Producer } from "./producer";

type Boundary = "vue" | "view" | "script" | "resource" | "promise";

export function createFailureReporter(
  producerFor: (scope?: string) => Producer = diagnosticsFor,
) {
  const seen = new Set<object>();
  let clearing = false;
  let reporting = false;

  return (
    boundary: Boundary,
    failure: unknown,
    scope?: string,
    context?: Context,
  ): void => {
    if (reporting) return;
    reporting = true;
    try {
      // Identity is used only to coalesce overlapping callbacks in one turn.
      // Never inspect exception properties, rejection objects or their getters.
      if (
        (typeof failure === "object" && failure !== null) ||
        typeof failure === "function"
      ) {
        if (seen.has(failure)) return;
        if (seen.size < 64) seen.add(failure);
        if (!clearing) {
          clearing = true;
          queueMicrotask(() => {
            seen.clear();
            clearing = false;
          });
        }
      }
      producerFor(scope).emit(
        "runtime.failed",
        boundary === "vue" || boundary === "view" ? "ui" : "app",
        { boundary, error_code: "unknown" },
        context,
        "error",
      );
    } catch {
      // Error reporting must not recursively report its own failure.
    } finally {
      reporting = false;
    }
  };
}

const diagnosticFailure = createFailureReporter();
export const reportFailure: ReturnType<typeof createFailureReporter> = (
  boundary,
  failure,
  scope,
  context,
) => {
  diagnosticFailure(boundary, failure, scope, context);
  captureIncident(boundary, failure, scope, boundary !== "resource");
};

type Reporter = ReturnType<typeof createFailureReporter>;
const installed = new WeakMap<App, () => void>();

export function installWindowFailureHandlers(
  target: Window = window,
  report: Reporter = reportFailure,
): () => void {
  const onError = (event: Event) => {
    if (event instanceof ErrorEvent) report("script", event.error);
    else report("resource", event);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    report("promise", event.reason);
  };
  target.addEventListener("error", onError, true);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError, true);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

export function installFailureHandlers(
  app: App,
  target: Window = window,
  report: Reporter = reportFailure,
): () => void {
  const existing = installed.get(app);
  if (existing) return existing;
  const previous = app.config.errorHandler;
  const vueHandler: NonNullable<App["config"]["errorHandler"]> = (
    error,
    instance,
    info,
  ) => {
    report("vue", error);
    previous?.(error, instance, info);
  };
  app.config.errorHandler = vueHandler;
  const removeWindowHandlers = installWindowFailureHandlers(target, report);
  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    if (app.config.errorHandler === vueHandler)
      app.config.errorHandler = previous;
    removeWindowHandlers();
    installed.delete(app);
  };
  installed.set(app, cleanup);
  return cleanup;
}
