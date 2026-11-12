import { webcrypto } from "node:crypto";
import { defineComponent, h, ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPluginPreview } from "./preview";

let preview: ReturnType<typeof createPluginPreview>;
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  preview?.dispose();
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  vi.unstubAllGlobals();
});
function setup() {
  let current = true;
  const capture = vi.fn(async () => ({
    captured: true as const,
    mimeType: "image/png" as const,
  }));
  preview = createPluginPreview({
    capture,
    requireCurrent: () => {
      if (!current) throw new Error("cancelled");
    },
  });
  preview.setContributions({
    views: [
      {
        id: "demo:main",
        title: () => "Synthetic",
        icon: "folder",
        component: defineComponent({
          setup() {
            const value = ref("initial");
            return () =>
              h("div", [
                h("input", {
                  value: value.value,
                  onInput: (event: Event) => {
                    value.value = (event.target as HTMLInputElement).value;
                  },
                }),
                h(
                  "button",
                  {
                    onClick: () => {
                      value.value += "!";
                    },
                  },
                  value.value,
                ),
              ]);
          },
        }),
      },
    ],
  });
  return {
    capture,
    cancel: () => {
      current = false;
      preview.dispose();
    },
  };
}
it("mounts without host navigation or focus changes and confines interactions", async () => {
  const { cancel } = setup();
  const outside = document.createElement("button");
  outside.id = "outside";
  outside.onclick = vi.fn();
  document.body.append(outside);
  outside.focus();
  const url = window.location.href;
  const historyLength = window.history.length;
  await preview.open("demo:main");
  expect(document.activeElement).toBe(outside);
  expect(window.location.href).toBe(url);
  expect(window.history.length).toBe(historyLength);
  await preview.fill("input", "synthetic");
  await preview.click("button");
  expect(preview.read("button")).toBe("synthetic!");
  await expect(preview.click("#outside")).rejects.toThrow(
    "plugins.previewElementNotFound",
  );
  await expect(
    preview.navigation.open({ kind: "conversation", conversationId: "other" }),
  ).rejects.toThrow("plugins.previewUnavailable");
  expect(outside.onclick).not.toHaveBeenCalled();
  cancel();
  expect(document.querySelector("[data-plugin-preview]")).toBeNull();
  expect(outside.isConnected).toBe(true);
  await expect(preview.open("demo:main")).rejects.toThrow("cancelled");
});
it("covers an occupied workspace with an opaque viewport-isolated preview", async () => {
  document.body.innerHTML =
    '<style>[data-plugin-preview] { background-color:transparent !important; opacity:0.1 !important; filter:opacity(0) !important; position:static !important; }</style><main id="app" style="transform:translateY(200px);opacity:0.2"><p>Private workspace</p></main>';
  document.body.style.setProperty("--situate-paper", "transparent");
  setup();
  await preview.open("demo:main");
  const container = document.querySelector<HTMLElement>(
    "[data-plugin-preview]",
  )!;
  expect(container.parentElement).toBe(document.body);
  expect(container.style.position).toBe("fixed");
  expect(container.style.inset).toBe("0px");
  expect(container.style.width).toBe("100%");
  expect(container.style.height).toBe("100dvh");
  expect(container.style.backgroundColor).toBe("rgb(246, 243, 238)");
  expect(container.style.backgroundImage).toBe("none");
  expect(container.style.opacity).toBe("1");
  expect(container.style.mixBlendMode).toBe("normal");
  expect(container.style.filter).toBe("none");
  expect(container.style.contain).toBe("paint");
  for (const property of [
    "position",
    "inset",
    "z-index",
    "overflow",
    "isolation",
    "opacity",
    "mix-blend-mode",
    "filter",
    "transform",
    "background-image",
    "background-color",
    "contain",
    "width",
    "height",
  ]) {
    expect(container.style.getPropertyPriority(property)).toBe("important");
  }
  expect(container.style.isolation).toBe("isolate");
  expect(container.style.zIndex).toBe("2147483647");
  expect(document.getElementById("app")!.contains(container)).toBe(false);
});

it("distinguishes invalid API arguments, missing views and missing elements", async () => {
  setup();
  await expect(
    preview.open({ viewId: "demo:main" } as unknown as string),
  ).rejects.toThrow("plugins.previewInvalidArguments");
  await expect(preview.open("demo:missing")).rejects.toThrow(
    "plugins.previewViewNotFound",
  );
  await preview.open("demo:main");
  expect(() => preview.read(true as unknown as string)).toThrow(
    "plugins.previewInvalidArguments",
  );
  expect(() => preview.read("[")).toThrow("plugins.previewInvalidArguments");
  expect(() => preview.read(".missing")).toThrow(
    "plugins.previewElementNotFound",
  );
  await expect(preview.click(undefined as unknown as string)).rejects.toThrow(
    "plugins.previewInvalidArguments",
  );
  await expect(preview.fill("button", "text")).rejects.toThrow(
    "plugins.previewInvalidArguments",
  );
  await expect(preview.fill("input", 3 as unknown as string)).rejects.toThrow(
    "plugins.previewInvalidArguments",
  );
});
it("returns a render failure without exposing the plugin exception", async () => {
  setup();
  preview.setContributions({
    views: [
      {
        id: "demo:broken",
        title: () => "Broken",
        icon: "folder",
        component: defineComponent({
          setup() {
            throw new Error("private plugin response");
          },
        }),
      },
    ],
  });
  await expect(preview.open("demo:broken")).rejects.toThrow(
    "plugins.previewRenderFailed",
  );
});
it("acknowledges captured preview bounds and rejects overlays and missing receipts", async () => {
  const { capture } = setup();
  await preview.open("demo:main");
  const root = document.querySelector("[data-plugin-preview] section")!;
  root.getBoundingClientRect = () =>
    ({ x: 20, y: 30, width: 200, height: 150 }) as DOMRect;
  document.elementFromPoint = vi.fn(() => root);
  await expect(preview.capture()).resolves.toEqual({
    captured: true,
    mimeType: "image/png",
  });
  expect(capture).toHaveBeenCalledWith({
    x: 20,
    y: 30,
    width: 200,
    height: 150,
  });
  document.elementFromPoint = vi.fn(() => document.body);
  await expect(preview.capture()).rejects.toThrow("plugins.previewUnavailable");
  expect(capture).toHaveBeenCalledTimes(1);
  document.elementFromPoint = vi.fn(() => root);
  capture.mockResolvedValue({
    captured: false as never,
    mimeType: "image/png",
  });
  await expect(preview.capture()).rejects.toThrow("plugins.previewUnavailable");
});
