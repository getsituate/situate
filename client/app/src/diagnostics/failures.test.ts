import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { createFailureReporter, installFailureHandlers } from "./failures";
import { createDiagnostics, noopProducer } from "./producer";
import type { EventInput } from "./contract";

const cleanups: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function recording() {
  const events: EventInput[] = [];
  const runtime = createDiagnostics(async (command, args) => {
    if (command === "diagnostics_register")
      return { producer_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    if (command === "diagnostics_emit") {
      const batch = JSON.parse(new TextDecoder().decode(args as Uint8Array));
      events.push(...batch.events);
      return { accepted: batch.events.length, dropped: 0 };
    }
  });
  const producer = runtime.producer();
  const report = createFailureReporter(() => producer);
  cleanups.push(() => runtime.shutdown());
  return { events, report };
}

it("records an actual Vue render failure without exception or component content", async () => {
  const { events, report } = recording();
  const app = createApp(
    defineComponent({
      setup() {
        const fail = (): never => {
          throw new Error("PRIVATE_SENTINEL /private/workspace token=secret");
        };
        return () => fail();
      },
    }),
  );
  const previous = vi.fn();
  app.config.errorHandler = previous;
  const cleanup = installFailureHandlers(app, window, report);
  cleanups.push(cleanup);
  expect(installFailureHandlers(app, window, report)).toBe(cleanup);
  const container = document.createElement("div");
  app.mount(container);
  cleanups.push(() => app.unmount());
  await vi.advanceTimersByTimeAsync(1000);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    event: "runtime.failed",
    level: "error",
    category: "ui",
    attributes: { boundary: "vue", error_code: "unknown" },
  });
  expect(previous).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_SENTINEL");
  cleanup();
  expect(app.config.errorHandler).toBe(previous);
});

it("captures script, resource and rejection events without suppressing defaults", async () => {
  const { events, report } = recording();
  const frame = document.createElement("iframe");
  document.body.append(frame);
  cleanups.push(() => frame.remove());
  const target = frame.contentWindow!;
  const app = createApp({ render: () => h("div") });
  const cleanup = installFailureHandlers(app, target, report);
  cleanups.push(cleanup);
  const error = new ErrorEvent("error", {
    error: new Error("PRIVATE_SENTINEL"),
    message: "PRIVATE_SENTINEL",
    filename: "/private/workspace/file.ts",
    cancelable: true,
  });
  target.dispatchEvent(error);
  const resource = target.document.createElement("img");
  resource.src = "https://example.invalid/PRIVATE_SENTINEL";
  target.document.body.append(resource);
  cleanups.push(() => resource.remove());
  const resourceError = new Event("error", { cancelable: true });
  resource.dispatchEvent(resourceError);
  // jsdom does not implement PromiseRejectionEvent.
  const rejected = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(rejected, "reason", { value: "PRIVATE_SENTINEL" });
  target.dispatchEvent(rejected);
  await vi.advanceTimersByTimeAsync(1000);
  expect(events.map((event) => event.attributes.boundary)).toEqual([
    "script",
    "resource",
    "promise",
  ]);
  expect(events.every((event) => event.level === "error")).toBe(true);
  expect(error.defaultPrevented).toBe(false);
  expect(resourceError.defaultPrevented).toBe(false);
  expect(rejected.defaultPrevented).toBe(false);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_SENTINEL");
  cleanup();
  target.dispatchEvent(new Event("error"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(events).toHaveLength(3);
});

it("never inspects hostile rejection objects and only coalesces overlapping object callbacks", async () => {
  const { events, report } = recording();
  const inspect = vi.fn(() => {
    throw new Error("PRIVATE_SENTINEL");
  });
  const hostile = new Proxy({}, { get: inspect, ownKeys: inspect });
  report("vue", hostile);
  report("script", hostile);
  report("promise", "PRIVATE_SENTINEL");
  report("promise", null);
  await vi.advanceTimersByTimeAsync(1000);
  expect(inspect).not.toHaveBeenCalled();
  expect(events).toHaveLength(3);
  report("vue", hostile);
  await vi.advanceTimersByTimeAsync(1000);
  expect(events).toHaveLength(4);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_SENTINEL");
});

it("preserves explicit context and does not invent workspace context for global failures", () => {
  const producer = { ...noopProducer, emit: vi.fn() };
  const resolve = vi.fn(() => producer);
  const report = createFailureReporter(resolve);
  const context = {
    trace_id: "11111111-1111-4111-8111-111111111111",
    span_id: "22222222-2222-4222-8222-222222222222",
    initiator: "background" as const,
  };
  report("view", {}, "PRIVATE_SCOPE", context);
  expect(resolve).toHaveBeenLastCalledWith("PRIVATE_SCOPE");
  expect(producer.emit).toHaveBeenLastCalledWith(
    "runtime.failed",
    "ui",
    { boundary: "view", error_code: "unknown" },
    context,
    "error",
  );
  report("script", {});
  expect(resolve).toHaveBeenLastCalledWith(undefined);
});

it("does not recurse or throw when diagnostic admission fails", () => {
  const resolve = vi.fn(() => {
    report("script", {});
    throw new Error("PRIVATE_SENTINEL");
  });
  const report = createFailureReporter(resolve);
  expect(() => report("script", {})).not.toThrow();
  expect(resolve).toHaveBeenCalledTimes(1);
});

it("allows cleanup and reinstallation without removing a replacement Vue handler", async () => {
  const { events, report } = recording();
  const app = createApp({ render: () => null });
  const cleanup = installFailureHandlers(app, window, report);
  const replacement = vi.fn();
  app.config.errorHandler = replacement;
  cleanup();
  cleanup();
  expect(app.config.errorHandler).toBe(replacement);
  cleanups.push(installFailureHandlers(app, window, report));
  window.dispatchEvent(new ErrorEvent("error", { error: new Error() }));
  await nextTick();
  await vi.advanceTimersByTimeAsync(1000);
  expect(events).toHaveLength(1);
});
