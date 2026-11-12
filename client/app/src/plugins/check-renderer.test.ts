import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { startCheckRenderer } from "./check-renderer";
import type { PreviewRequest } from "./check-renderer-client";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  link: vi.fn(),
  imported: vi.fn(),
  validate: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./module-source", () => ({ createPluginModule: mocks.link }));
vi.mock("./module", () => ({
  importPluginModule: mocks.imported,
  loadHostModules: async () => ({ vue: {}, ui: {} }),
}));
vi.mock("./contributions", () => ({ validateUiContributions: mocks.validate }));
vi.mock("@situate/localization", () => ({ t: (key: string) => key }));
let sequence = 0;
const source = {
  manifest: { id: "example", schemaVersion: 2 },
  serviceEntry: "throw 1",
  uiEntry: "ui",
  modules: {},
  skills: [],
};
const identity = { generation: 7, invocationId: "invocation" };
async function send(
  operation: PreviewRequest["operation"],
  args: object = {},
  overrides = {},
) {
  const request = {
    ...identity,
    requestId: `request-${++sequence}`,
    operation,
    args,
    ...overrides,
  } as PreviewRequest;
  window.__situatePreviewRequest!(request);
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith(
      "plugin_preview_ack",
      expect.objectContaining({ requestId: request.requestId }),
    ),
  );
  return mocks.invoke.mock.calls.find(
    ([command, value]) =>
      command === "plugin_preview_ack" && value.requestId === request.requestId,
  )![1];
}
beforeEach(async () => {
  vi.resetAllMocks();
  delete window.__situatePreviewRequest;
  delete window.__situatePreviewCaptureFinished;
  mocks.invoke.mockResolvedValue(undefined);
  mocks.link.mockReturnValue({ url: "blob:ui", dispose: mocks.dispose });
  mocks.validate.mockImplementation((value) => value);
  mocks.imported.mockResolvedValue({
    default: async () => ({
      views: [
        {
          id: "example.view",
          component: {
            render: () =>
              h("div", [
                h("input"),
                h(
                  "button",
                  {
                    onClick: () =>
                      (document.querySelector("input")!.value = "clicked"),
                  },
                  "Go",
                ),
              ]),
          },
        },
      ],
    }),
  });
  startCheckRenderer(mocks.invoke);
});
afterEach(async () => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "elementFromPoint");
  window.__situatePreviewCaptureFinished?.(identity);
  await send("previewClose");
  delete window.__situatePreviewRequest;
  delete window.__situatePreviewCaptureFinished;
});

it("imports only the captured UI graph and acknowledges mounted interactions", async () => {
  expect(
    await send("previewOpen", { source, viewId: "example.view" }),
  ).toMatchObject({ ...identity, value: true });
  expect(mocks.link).toHaveBeenCalledWith(source, "ui");
  expect(await send("previewStep", { action: "read" })).toMatchObject({
    value: "Go",
  });
  await send("previewStep", {
    action: "fill",
    selector: "input",
    value: "typed",
  });
  expect(document.querySelector("input")!.value).toBe("typed");
  await send("previewStep", { action: "click", selector: "button" });
  expect(document.querySelector("input")!.value).toBe("clicked");
  await send("previewClose");
  expect(mocks.dispose).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-plugin-preview]")).toBeNull();
});

it("acknowledges only a bounded rendered region for native capture", async () => {
  await send("previewOpen", { source, viewId: "example.view" });
  const root = document.querySelector("[data-plugin-preview] section")!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  } as DOMRect);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => root,
  });
  expect(await send("previewStep", { action: "capture" })).toMatchObject({
    value: { rect: { x: 0, y: 0, width: 100, height: 100 } },
  });
  expect(
    mocks.invoke.mock.calls.every(
      ([command]) => command === "plugin_preview_ack",
    ),
  ).toBe(true);
  window.__situatePreviewCaptureFinished!(identity);
  await send("previewClose");
  expect(root.isConnected).toBe(false);
  vi.restoreAllMocks();
});

it("retains the preview and graph through close until native snapshot completion", async () => {
  const disposeContributions = vi.fn();
  const factory = (await mocks.imported()).default;
  mocks.imported.mockResolvedValue({
    default: async () => ({
      ...(await factory()),
      dispose: disposeContributions,
    }),
  });
  await send("previewOpen", { source, viewId: "example.view" });
  const container = document.querySelector("[data-plugin-preview]")!;
  const root = container.querySelector("section")!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  } as DOMRect);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => root,
  });
  await send("previewStep", { action: "capture" });
  await send("previewClose");
  expect(container.isConnected).toBe(true);
  expect(disposeContributions).not.toHaveBeenCalled();
  expect(mocks.dispose).not.toHaveBeenCalled();
  window.__situatePreviewCaptureFinished!({ ...identity, generation: 8 });
  await send("previewClose");
  expect(container.isConnected).toBe(true);
  window.__situatePreviewCaptureFinished!({
    ...identity,
    invocationId: "other",
  });
  await send("previewClose");
  expect(container.isConnected).toBe(true);
  window.__situatePreviewCaptureFinished!(identity);
  await send("previewClose");
  expect(container.isConnected).toBe(false);
  expect(disposeContributions).toHaveBeenCalledOnce();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it("keeps the opaque preview on uncertain acknowledgement failure until native finishes", async () => {
  await send("previewOpen", { source, viewId: "example.view" });
  const root = document.querySelector("[data-plugin-preview] section")!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  } as DOMRect);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: () => root,
  });
  mocks.invoke.mockRejectedValueOnce(new Error("acknowledgement lost"));
  await send("previewStep", { action: "capture" });
  await send("previewClose");
  expect(root.isConnected).toBe(true);
  expect(mocks.dispose).not.toHaveBeenCalled();
  window.__situatePreviewCaptureFinished!(identity);
  await send("previewClose");
  expect(root.isConnected).toBe(false);
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it("closes immediately when capture bounds were rejected before acknowledgement", async () => {
  await send("previewOpen", { source, viewId: "example.view" });
  expect(await send("previewStep", { action: "capture" })).toMatchObject({
    error: "plugins.previewUnavailable",
  });
  await send("previewClose");
  expect(document.querySelector("[data-plugin-preview]")).toBeNull();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it("disposes invalid UI contributions before releasing graph URLs", async () => {
  const dispose = vi.fn();
  mocks.imported.mockResolvedValue({
    default: async () => ({ dispose, tools: [] }),
  });
  mocks.validate.mockImplementation(() => {
    throw new Error("invalid");
  });
  expect(
    await send("previewOpen", { source, viewId: "example.view" }),
  ).toMatchObject({ error: "plugins.previewUnavailable" });
  expect(dispose).toHaveBeenCalledOnce();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it("awaits the UI factory before acknowledging an open", async () => {
  let finish!: (value: unknown) => void;
  mocks.imported.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  window.__situatePreviewRequest!({
    ...identity,
    requestId: "waiting",
    operation: "previewOpen",
    args: { source: source as never, viewId: "example.view" },
  });
  await vi.waitFor(() => expect(mocks.imported).toHaveBeenCalled());
  expect(mocks.invoke).not.toHaveBeenCalled();
  finish({
    default: async () => ({
      views: [
        { id: "example.view", component: { render: () => h("p", "Ready") } },
      ],
    }),
  });
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith(
      "plugin_preview_ack",
      expect.objectContaining({ requestId: "waiting", value: true }),
    ),
  );
});

it("binds UI service requests to the original native invocation", async () => {
  mocks.imported.mockResolvedValue({
    default: async (host: {
      service: { invoke: (name: string, args: unknown) => Promise<unknown> };
    }) => {
      await host.service.invoke("read", { key: "value" });
      return {
        views: [
          { id: "example.view", component: { render: () => h("p", "Ready") } },
        ],
      };
    },
  });
  await send("previewOpen", { source, viewId: "example.view" });
  expect(mocks.invoke).toHaveBeenCalledWith("plugin_preview_service", {
    ...identity,
    pluginId: "example",
    dependency: undefined,
    name: "read",
    args: { key: "value" },
  });
});

it("rejects steps for another generation instead of touching an existing preview", async () => {
  await send("previewOpen", { source, viewId: "example.view" });
  expect(
    await send(
      "previewStep",
      { action: "click", selector: "button" },
      { generation: 8 },
    ),
  ).toMatchObject({ error: "plugins.previewUnavailable" });
  expect(document.querySelector("input")!.value).toBe("");
});

it("does not repeat an interaction for a duplicate request", async () => {
  await send("previewOpen", { source, viewId: "example.view" });
  await send(
    "previewStep",
    { action: "click", selector: "button" },
    { requestId: "duplicate" },
  );
  document.querySelector("input")!.value = "unchanged";
  window.__situatePreviewRequest!({
    ...identity,
    requestId: "duplicate",
    operation: "previewStep",
    args: { action: "click", selector: "button" },
  });
  await send("previewStep", { action: "read" });
  expect(document.querySelector("input")!.value).toBe("unchanged");
});

it("cleans captured graph URLs and returns no private factory exception", async () => {
  mocks.imported.mockRejectedValue(new Error("private source sentinel"));
  expect(
    await send("previewOpen", { source, viewId: "example.view" }),
  ).toMatchObject({ error: "plugins.previewUnavailable" });
  expect(mocks.dispose).toHaveBeenCalledOnce();
  expect(JSON.stringify(mocks.invoke.mock.calls)).not.toContain(
    "private source sentinel",
  );
});
