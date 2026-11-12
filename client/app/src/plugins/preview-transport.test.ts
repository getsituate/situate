import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startPreviewRenderer } from "./preview-transport";
import { startCheckRenderer } from "./check-renderer";
import type { PreviewRequest } from "./check-renderer-client";

vi.mock("./check-renderer", () => ({ startCheckRenderer: vi.fn() }));
const identity = { generation: 4, invocationId: "check" };
let bridge: Parameters<typeof startPreviewRenderer>[0];
beforeEach(() => {
  vi.clearAllMocks();
  bridge = { send: vi.fn() };
  startPreviewRenderer(bridge);
});
afterEach(() => {
  delete window.__situatePreviewRequest;
  delete window.__situatePreviewCaptureFinished;
});
const invoke = () => vi.mocked(startCheckRenderer).mock.calls[0][0];

it("delivers preview requests and capture completion only inside its renderer", () => {
  window.__situatePreviewRequest = vi.fn();
  window.__situatePreviewCaptureFinished = vi.fn();
  const request: PreviewRequest = {
    ...identity,
    requestId: "open",
    operation: "previewOpen",
    args: { viewId: "counter:main" },
  };
  bridge.receive!({ type: "request", request });
  bridge.receive!({ type: "captureFinished", ...identity });
  expect(window.__situatePreviewRequest).toHaveBeenCalledExactlyOnceWith(
    request,
  );
  expect(
    window.__situatePreviewCaptureFinished,
  ).toHaveBeenCalledExactlyOnceWith({ type: "captureFinished", ...identity });
});

it("returns renderer acknowledgements with their invocation identity", async () => {
  await invoke()("plugin_preview_ack", {
    ...identity,
    requestId: "open",
    value: true,
  });
  expect(bridge.send).toHaveBeenCalledExactlyOnceWith({
    type: "reply",
    ...identity,
    requestId: "open",
    value: true,
  });
});

it("correlates service replies without replaying unknown or duplicate results", async () => {
  const result = invoke()("plugin_preview_service", {
    ...identity,
    pluginId: "counter",
    name: "increment",
    args: {},
  });
  const message = vi.mocked(bridge.send).mock.calls[0][0] as {
    requestId: string;
  };
  expect(message).toMatchObject({
    type: "service",
    ...identity,
    pluginId: "counter",
    name: "increment",
    args: {},
  });
  bridge.receive!({ type: "serviceResult", requestId: "unknown", value: 99 });
  bridge.receive!({
    type: "serviceResult",
    requestId: message.requestId,
    value: 1,
  });
  bridge.receive!({
    type: "serviceResult",
    requestId: message.requestId,
    value: 2,
  });
  await expect(result).resolves.toBe(1);
  expect(bridge.send).toHaveBeenCalledOnce();
});

it("propagates a failed native service result instead of reporting success", async () => {
  const result = invoke()("plugin_preview_service", {
    ...identity,
    pluginId: "counter",
    name: "increment",
    args: {},
  });
  const message = vi.mocked(bridge.send).mock.calls[0][0] as {
    requestId: string;
  };
  bridge.receive!({
    type: "serviceResult",
    requestId: message.requestId,
    error: "native.plugins.captureUnavailable",
  });
  await expect(result).rejects.toThrow("native.plugins.captureUnavailable");
});
