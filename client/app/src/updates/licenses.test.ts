import { afterEach, expect, it, vi } from "vitest";
import { loadLicenses } from "./licenses";
afterEach(() => vi.unstubAllGlobals());
it("loads the local plain-text disclosure only on request and preserves source URLs", async () => {
  const text =
    "Situate licenses and notices\n\nSource: https://static.crates.io/crates/example/example-1.2.3.crate\nSHA-256: synthetic";
  const request = vi.fn(async () => ({ ok: true, text: async () => text }));
  vi.stubGlobal("fetch", request);
  const controller = new AbortController();
  expect(await loadLicenses(controller.signal)).toBe(text);
  expect(request).toHaveBeenCalledWith("/situate-licenses.txt", {
    signal: controller.signal,
  });
});
it.each([
  { ok: false, text: "not found" },
  { ok: true, text: "<!doctype html><html>app fallback</html>" },
  { ok: true, text: "Situate licenses and notices\n" },
])("rejects unavailable or invalid content: %j", async (result) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: result.ok, text: async () => result.text })),
  );
  await expect(loadLicenses()).rejects.toThrow();
});
