import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryError } from "../ai/document-sources/contract.js";
import type { PluginRuntime } from "../plugins/runtime";
import {
  documentThumbnails,
  readLibraryOriginal,
  reconcileThumbnails,
  type ThumbnailTarget,
} from "./document-thumbnails";
import { renderThumbnail } from "./thumbnail-render";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./thumbnail-render", () => ({ renderThumbnail: vi.fn() }));

const cache = vi.mocked(invoke);
const render = vi.mocked(renderThumbnail);
const scope = "workspace";
const source = { pluginId: "archive", instanceId: "account" };
const binding = { ...source, scopeId: "included", incarnation: "installed" };
const content = Uint8Array.of(42, 51, 60);
const jpeg = new Blob(["preview"], { type: "image/jpeg" });
const descriptor: ThumbnailTarget["descriptor"] = {
  version: 2,
  source,
  label: "Archive",
  scope: {
    id: "included",
    included: ["Invoices"],
    excluded: [],
    constraints: [],
  },
  searchCoverage: ["filename"],
  limits: { maxItems: 24 },
};
function target(
  id: string,
  revision?: string,
  mimeType = "image/png",
): ThumbnailTarget {
  return {
    key: id,
    source: binding,
    descriptor,
    item: {
      ref: { source, id, identity: "stable", ...(revision && { revision }) },
      title: id,
      mimeType,
    },
  };
}
function original(item: ThumbnailTarget["item"], error?: LibraryError) {
  const base = {
    version: 2,
    source,
    scopeId: "included",
    operation: "readOriginal",
  };
  return error
    ? { ...base, status: "error", error: { code: error } }
    : {
        ...base,
        status: "ok",
        document: item,
        original: { id: "00000000-0000-0000-0000-000000000001", size: 3 },
      };
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let report: (elements: [Element, boolean][]) => void;
let scheduler: ReturnType<typeof documentThumbnails>;
const invokeOriginal = vi.fn<PluginRuntime["invokeDocumentSource"]>();
const readBytes = vi.fn<PluginRuntime["readDocumentBytes"]>();
const view = {
  scope,
  invokeDocumentSource: invokeOriginal,
  readDocumentBytes: readBytes,
} as unknown as PluginRuntime;

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        callback: (
          entries: Pick<
            IntersectionObserverEntry,
            "target" | "isIntersecting"
          >[],
        ) => void,
      ) {
        report = (elements) =>
          callback(
            elements.map(([target, isIntersecting]) => ({
              target,
              isIntersecting,
            })),
          );
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  cache.mockReset().mockResolvedValue({ epoch: "3", jpeg: null });
  render.mockReset().mockResolvedValue(jpeg);
  invokeOriginal.mockReset();
  readBytes.mockReset().mockResolvedValue(content);
  scheduler = documentThumbnails(() => view);
});
afterEach(() => {
  scheduler.close();
  vi.unstubAllGlobals();
});

function observe(items: ThumbnailTarget[]) {
  scheduler.replace(items);
  return items.map(({ key }) => {
    const element = document.createElement("span");
    return { element, stop: scheduler.observe(element, key) };
  });
}

const visible = (...elements: Element[]) =>
  report(elements.map((element) => [element, true]));

function expectRequest(
  operation: string,
  fields: Record<string, unknown> = {},
) {
  expect(cache).toHaveBeenCalledWith("document_thumbnail", {
    scope,
    request: { operation, source: binding, ...fields },
  });
}

describe("document thumbnails", () => {
  it("uses a cached revision without reopening its original and stores a new revision with the lookup epoch", async () => {
    const first = target("receipt", "r1");
    const second = target("scan", "r2");
    const ready = pending<void>();
    first.ready = ready.promise;
    cache.mockResolvedValueOnce({ epoch: "5", jpeg: "cHJldmlldw==" });
    const [a, b] = observe([first, second]);
    visible(a!.element);
    expect(cache).not.toHaveBeenCalled();
    ready.resolve();
    await vi.waitFor(() =>
      expect(scheduler.images.get("receipt")?.size).toBe(7),
    );
    expect(invokeOriginal).not.toHaveBeenCalled();
    expectRequest("lookup", { id: "receipt", revision: "stable:r1" });

    invokeOriginal.mockResolvedValueOnce(original(second.item));
    visible(b!.element);
    await vi.waitFor(() => expect(scheduler.images.get("scan")).toBe(jpeg));
    expect(render).toHaveBeenCalledWith(
      content,
      "image/png",
      expect.any(AbortSignal),
    );
    expectRequest("store", {
      id: "scan",
      revision: "stable:r2",
      epoch: "3",
      jpeg: "cHJldmlldw==",
    });
  });

  it("drops replaced results, cancels hidden reads, and releases room for a waiting document", async () => {
    const first = target("first");
    const second = target("second");
    const third = target("third");
    const unfinished = pending<unknown>();
    invokeOriginal
      .mockReturnValueOnce(unfinished.promise)
      .mockResolvedValueOnce(original(second.item))
      .mockResolvedValueOnce(original(third.item));
    const [a, b, c] = observe([first, second, third]);
    visible(a!.element, b!.element, c!.element);
    await vi.waitFor(() =>
      expect(invokeOriginal.mock.calls.map((call) => call[2])).toContainEqual({
        ref: second.item.ref,
      }),
    );
    expect(invokeOriginal.mock.calls[0]?.[4]).toBe(true);
    a!.stop();
    expect(invokeOriginal.mock.calls[0]?.[3]?.aborted).toBe(true);
    unfinished.resolve(original(first.item));
    await vi.waitFor(() => expect(scheduler.images.get("third")).toBe(jpeg));
    expect([...scheduler.images.keys()].sort()).toEqual(["second", "third"]);
    expect(cache).not.toHaveBeenCalled();
    scheduler.replace([third]);
    expect(scheduler.images.has("second")).toBe(false);
    expect(scheduler.images.get("third")).toBe(jpeg);
  });

  it.each(["application/pdf", "image/png"])(
    "reuses the reader's %s bytes while automatic reads pause",
    async (mimeType) => {
      const opened = target("opened", "r1", mimeType);
      const { element } = observe([opened])[0]!;
      scheduler.pause(true);
      visible(element);
      scheduler.prepare("opened")?.(content);
      expect(render).not.toHaveBeenCalled();
      scheduler.pause(false);
      await vi.waitFor(() => expect(scheduler.images.get("opened")).toBe(jpeg));
      expect(render).toHaveBeenCalledWith(
        content,
        mimeType,
        expect.any(AbortSignal),
      );
      const input = render.mock.calls[0]?.[0];
      expect(input === content).toBe(mimeType === "image/png");
      expect(invokeOriginal).not.toHaveBeenCalled();
      expect(scheduler.prepare("opened")).toBeUndefined();
    },
  );

  it.each(["not-found", "permission", "unavailable", "too-large"] as const)(
    "only forgets a disk copy for a confirmed %s outcome",
    async (code) => {
      const item = target("receipt", "r4");
      invokeOriginal.mockResolvedValueOnce(original(item.item, code));
      const [node] = observe([item]);
      visible(node!.element);
      await vi.waitFor(() =>
        expect(invokeOriginal.mock.calls[0]?.[3]?.aborted).toBe(true),
      );
      if (code === "not-found" || code === "permission")
        expectRequest("forget", { id: "receipt" });
      else expect(cache).toHaveBeenCalledTimes(1);
      expect(scheduler.images.has(item.key)).toBe(false);
      expect(render).not.toHaveBeenCalled();
    },
  );

  it("fences a late result from an invalidated source but leaves other bindings alone", async () => {
    const item = target("receipt", "r4");
    const inProgress = pending<Blob>();
    invokeOriginal.mockResolvedValueOnce(original(item.item));
    render.mockReturnValueOnce(inProgress.promise);
    const [node] = observe([item]);
    visible(node!.element);
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    const signal = render.mock.calls[0]?.[2];
    scheduler.forget("unrelated");
    scheduler.forget("archive", "different-doc");
    for (const other of [
      { instanceId: "other" },
      { scopeId: "other" },
      { incarnation: "other" },
    ]) {
      scheduler.forget("archive", "receipt", { ...binding, ...other });
      expect(signal?.aborted).toBe(false);
    }
    scheduler.forget("archive", "receipt", binding);
    expect(signal?.aborted).toBe(true);
    inProgress.resolve(jpeg);
    await inProgress.promise;
    expect(cache).toHaveBeenCalledTimes(1);
    expect(scheduler.images.has("receipt")).toBe(false);
  });

  it("never treats a changed format as the requested original and keeps cache failures optional", async () => {
    const wrong = target("wrong", "r1");
    const memoryOnly = target("scan", "r2");
    const large = new Blob([new Uint8Array(260 * 1024)], {
      type: "image/jpeg",
    });
    cache.mockRejectedValueOnce(new Error("Cache unavailable"));
    await expect(reconcileThumbnails(scope, binding)).resolves.toBeUndefined();
    invokeOriginal
      .mockResolvedValueOnce(
        original({ ...wrong.item, mimeType: "image/jpeg" }),
      )
      .mockResolvedValueOnce(original(memoryOnly.item));
    render.mockResolvedValueOnce(large);
    const [a, b] = observe([wrong, memoryOnly]);
    visible(a!.element, b!.element);
    await vi.waitFor(() => expect(scheduler.images.get("scan")).toBe(large));
    expect(readBytes).toHaveBeenCalledTimes(1);
    expect([...scheduler.images.keys()]).toEqual(["scan"]);
    expect(cache).toHaveBeenCalledTimes(3);
  });

  it("does not persist results after the view closes", async () => {
    const item = target("closing", "r1");
    const waiting = pending<unknown>();
    invokeOriginal.mockReturnValueOnce(waiting.promise);
    const [node] = observe([item]);
    visible(node!.element);
    await vi.waitFor(() => expect(invokeOriginal).toHaveBeenCalled());
    scheduler.close();
    expect(invokeOriginal.mock.calls[0]?.[3]?.aborted).toBe(true);
    waiting.resolve(original(item.item));
    await waiting.promise;
    expect(render).not.toHaveBeenCalled();
  });

  it("opens originals without the automatic limit when requested directly", async () => {
    const item = target("selected", "r1").item;
    invokeOriginal.mockResolvedValue(original(item));
    const signal = new AbortController().signal;
    await expect(
      readLibraryOriginal(view, descriptor, item.ref, signal),
    ).resolves.toMatchObject({ status: "ok", document: item });
    expect(invokeOriginal).toHaveBeenCalledWith(
      "archive",
      "documentLibraryReadOriginal",
      { ref: item.ref },
      signal,
      false,
    );
  });
});
