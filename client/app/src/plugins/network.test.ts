import { expect, it, vi } from "vitest";
import { createInvocationContext } from "./host";

it("forwards HTTP writes directly through native admission and strips extra operations", async () => {
  const request = vi.fn(async () => ({ status: 202, body: "accepted" }));
  const context = createInvocationContext(
    "admitted",
    new AbortController().signal,
    request,
    vi.fn(),
  );
  await expect(
    context.network.request({
      url: "https://example.invalid/items",
      method: "POST",
      body: "synthetic",
      operation: "credentialGet",
    } as Parameters<typeof context.network.request>[0]),
  ).resolves.toEqual({ status: 202, body: "accepted" });
  expect(request).toHaveBeenCalledExactlyOnceWith({
    operation: "http",
    url: "https://example.invalid/items",
    method: "POST",
    body: "synthetic",
  });
});

it("propagates native invocation rejection without retry or synthetic success", async () => {
  const request = vi.fn(async () => {
    throw new Error("native.plugins.unavailable");
  });
  const context = createInvocationContext(
    "admitted",
    new AbortController().signal,
    request,
    vi.fn(),
  );
  await expect(
    context.network.request({
      url: "https://example.invalid/items",
      method: "DELETE",
    }),
  ).rejects.toThrow("native.plugins.unavailable");
  expect(request).toHaveBeenCalledOnce();
});
