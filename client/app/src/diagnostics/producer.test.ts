import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BATCH_BYTES,
  MAX_PRODUCERS,
  PRODUCER_BYTES,
  createDiagnostics,
  type Transport,
} from "./producer";
import type { EventInput } from "./contract";

const producerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function decodeBatch(value: Record<string, unknown> | Uint8Array): {
  producer: string;
  events: EventInput[];
} {
  expect(ArrayBuffer.isView(value)).toBe(true);
  expect(Object.prototype.toString.call(value)).toBe("[object Uint8Array]");
  return JSON.parse(new TextDecoder().decode(value as Uint8Array));
}
function recording() {
  const events: EventInput[] = [];
  const transport = vi.fn<Transport>(async (command, args) => {
    if (command === "diagnostics_register") return { producer_id: producerId };
    if (command === "diagnostics_emit") {
      const batch = decodeBatch(args);
      events.push(...batch.events);
      return { accepted: batch.events.length, dropped: 0 };
    }
    return undefined;
  });
  return { events, transport, runtime: createDiagnostics(transport) };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("bounded diagnostic producer", () => {
  it("batches after 250ms and transmits no scope outside registration", async () => {
    const { runtime, events, transport } = recording();
    const producer = runtime.producer("PRIVATE_LOCAL_HANDLE");
    producer.emit("app.started", "app");
    expect(transport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249);
    expect(transport).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(251);
    expect(events.map((event) => event.event)).toEqual(["app.started"]);
    expect(transport.mock.calls[0]).toEqual([
      "diagnostics_register",
      { scope: "PRIVATE_LOCAL_HANDLE" },
    ]);
    expect(
      JSON.stringify(decodeBatch(transport.mock.calls[1]![1])),
    ).not.toContain("PRIVATE_LOCAL_HANDLE");
  });
  it("never starts replacement IPC while any registration, batch or release is unresolved", async () => {
    for (const stalled of [
      "diagnostics_register",
      "diagnostics_emit",
      "diagnostics_release",
    ]) {
      const transport = vi.fn<Transport>((command) =>
        command === stalled
          ? new Promise(() => {})
          : Promise.resolve({ producer_id: producerId }),
      );
      const runtime = createDiagnostics(transport);
      const producer = runtime.producer();
      producer.emit("app.started", "app");
      await vi.advanceTimersByTimeAsync(750);
      if (stalled === "diagnostics_release") {
        producer.close();
        await vi.advanceTimersByTimeAsync(1);
      }
      const count = transport.mock.calls.length;
      for (let i = 0; i < 10000; i++)
        producer.emit("ui.action", "ui", { action: "save", control: "button" });
      runtime.producer("another").emit("workspace.opened", "workspace");
      expect(runtime.stats().queuedBytes).toBeLessThanOrEqual(
        2 * PRODUCER_BYTES,
      );
      runtime.shutdown();
      await vi.advanceTimersByTimeAsync(10000);
      expect(transport).toHaveBeenCalledTimes(count);
      expect(runtime.stats().queuedBytes).toBe(0);
      expect(runtime.stats().inFlight).toBe(true);
    }
  });
  it("bounds producer count, aggregate bytes, event count and serialized batches", async () => {
    const { runtime, transport } = recording();
    for (let i = 0; i < 100; i++) {
      const producer = runtime.producer(String(i));
      for (let j = 0; j < 1600; j++)
        producer.emit("ui.action", "ui", { action: "save" });
    }
    expect(runtime.stats().producers).toBe(MAX_PRODUCERS);
    expect(runtime.stats().queuedBytes).toBeLessThanOrEqual(
      MAX_PRODUCERS * PRODUCER_BYTES,
    );
    await vi.advanceTimersByTimeAsync(10000);
    const batches = transport.mock.calls.filter(
      ([command]) => command === "diagnostics_emit",
    );
    expect(batches.length).toBeGreaterThan(0);
    for (const [, batch] of batches) {
      const decoded = decodeBatch(batch);
      expect((batch as Uint8Array).byteLength).toBeLessThanOrEqual(BATCH_BYTES);
      expect(decoded.events.length).toBeLessThanOrEqual(64);
      expect(decoded.producer).toBe(producerId);
    }
  });
  it("preserves higher priority events under pressure and reports bounded loss", async () => {
    const { runtime, events } = recording();
    const producer = runtime.producer();
    for (let i = 0; i < 3000; i++)
      producer.emit("ui.action", "ui", { action: "save" }, undefined, "trace");
    producer.emit(
      "operation.finished",
      "storage",
      { action: "save", outcome: "failure", error_code: "io" },
      undefined,
      "error",
    );
    await vi.advanceTimersByTimeAsync(15000);
    expect(events.some((event) => event.level === "error")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.event === "diagnostics.dropped" &&
          Number(event.attributes.count) > 0,
      ),
    ).toBe(true);
  });
  it("drops unsafe input synchronously and swallows throwing or rejecting transports", async () => {
    for (const transport of [
      () => {
        throw new Error("PRIVATE_SENTINEL");
      },
      () => Promise.reject(new Error("PRIVATE_SENTINEL")),
      async () => undefined,
    ]) {
      const runtime = createDiagnostics(transport);
      const producer = runtime.producer();
      expect(() =>
        producer.emit("app.started", "app", { action: "PRIVATE_SENTINEL" }),
      ).not.toThrow();
      expect(runtime.stats().queuedBytes).toBe(0);
      producer.emit("app.started", "app");
      await vi.advanceTimersByTimeAsync(1000);
      producer.emit("app.started", "app");
      expect(runtime.stats().queuedBytes).toBe(0);
      expect(producer.operation("app", "start", "app").context).toBeUndefined();
    }
  });
  it("never retries an uncertain rejected batch or logs its error text", async () => {
    const calls: unknown[] = [];
    const runtime = createDiagnostics(async (command, args) => {
      calls.push([command, args]);
      if (command === "diagnostics_register")
        return { producer_id: producerId };
      throw new Error("PRIVATE_SENTINEL");
    });
    runtime.producer().emit("app.started", "app");
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls)).not.toContain("PRIVATE_SENTINEL");
  });
  it("distinguishes ordinary rejection, degraded rejection and interrupted work", async () => {
    const { runtime, events } = recording();
    const producer = runtime.producer();
    producer.operation("workspace", "close", "workspace").finish("rejected");
    producer
      .operation("storage", "save", "files")
      .finish("rejected", "conflict");
    producer
      .operation("model", "request", "model")
      .finish("interrupted", "interrupted");
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      events
        .filter((event) => event.event === "operation.started")
        .map((event) => event.level),
    ).toEqual(["info", "info", "info"]);
    expect(
      events
        .filter((event) => event.event === "operation.finished")
        .map((event) => [event.attributes.outcome, event.level]),
    ).toEqual([
      ["rejected", "info"],
      ["rejected", "warn"],
      ["interrupted", "warn"],
    ]);
  });
  it("links concurrent child and retry spans explicitly and measures monotonic durations", async () => {
    const { runtime, events } = recording();
    const producer = runtime.producer();
    let now = 10;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const first = producer.operation("storage", "save", "files");
    const second = producer.operation("agent", "execute", "agent");
    const child = first.child("storage", "save", "files");
    const retry = child.retry(1);
    vi.setSystemTime(new Date(1000));
    now = 35;
    second.finish("cancelled", "cancelled");
    child.finish("rejected", "conflict");
    retry.finish();
    first.finish("failure", "PRIVATE_SENTINEL");
    first.finish();
    await vi.advanceTimersByTimeAsync(1000);
    const terminal = events.filter(
      (event) => event.event === "operation.finished",
    );
    expect(terminal).toHaveLength(4);
    expect(terminal.map((event) => event.level)).toEqual([
      "info",
      "warn",
      "info",
      "error",
    ]);
    expect(first.context?.trace_id).not.toBe(second.context?.trace_id);
    expect(child.context?.parent_span_id).toBe(first.context?.span_id);
    expect(retry.context?.parent_span_id).toBe(child.context?.span_id);
    expect(terminal.every((event) => event.attributes.duration_ms === 25)).toBe(
      true,
    );
    expect(terminal.at(-1)?.attributes.error_code).toBe("unknown");
    expect(JSON.stringify(events)).not.toContain("PRIVATE_SENTINEL");
  });
});
