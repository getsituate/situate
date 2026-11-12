import { expect, it, vi } from "vitest";
import { createInvocationContext } from "./host";

it("keeps overlapping invocation authority in distinct immutable closures", async () => {
  const firstRequest = vi.fn(async () => "first");
  const secondRequest = vi.fn(async () => "second");
  const first = createInvocationContext(
    "first",
    new AbortController().signal,
    firstRequest,
    vi.fn(),
  );
  const second = createInvocationContext(
    "second",
    new AbortController().signal,
    secondRequest,
    vi.fn(),
  );
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.files)).toBe(true);
  expect(await second.credentials.get("token")).toBe("second");
  expect(await first.dependencies.invoke("other", "lookup", { id: 1 })).toBe(
    "first",
  );
  expect(firstRequest).toHaveBeenCalledExactlyOnceWith({
    operation: "dependenciesInvoke",
    pluginId: "other",
    exportName: "lookup",
    args: { id: 1 },
  });
  expect(secondRequest).toHaveBeenCalledExactlyOnceWith({
    operation: "credentialGet",
    name: "token",
  });
});

it("requires an observed preview acknowledgement and closes admission after abort", async () => {
  const controller = new AbortController();
  let acknowledge!: (value: unknown) => void;
  const request = vi.fn(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  );
  const context = createInvocationContext(
    "preview",
    controller.signal,
    request,
    vi.fn(),
  );
  let completed = false;
  const opening = context.preview.open({ viewId: "demo:main" }).then(() => {
    completed = true;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  acknowledge({ opened: true });
  await opening;
  expect(completed).toBe(true);
  controller.abort();
  expect(() => context.credentials.get("token")).toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});

it("routes HTTP writes through native admission", async () => {
  const request = vi.fn(async () => ({ status: 200, body: "ok" }));
  const context = createInvocationContext(
    "http",
    new AbortController().signal,
    request,
    vi.fn(),
  );
  await context.network.request({
    url: "https://example.invalid",
    method: "POST",
    body: "synthetic",
  });
  expect(request).toHaveBeenCalledExactlyOnceWith({
    operation: "http",
    url: "https://example.invalid",
    method: "POST",
    body: "synthetic",
  });
});
