import {
  createApp,
  defineComponent,
  h,
  nextTick,
  onErrorCaptured,
  shallowRef,
  type App,
} from "vue";
import { t } from "@situate/localization";
import { colors } from "../../../../design/brand/tokens.json";
import type { PluginUiContributions, PluginUiHost } from "./types";
import type { ViewDefinition } from "../layout/registry";
import type { PresentationValue, ViewTarget } from "../layout/navigation";

export interface PreviewImage {
  captured: true;
  mimeType: "image/png";
}
export interface PreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createPluginPreview(options: {
  requireCurrent: () => void;
  capture: (rect: PreviewRect) => Promise<PreviewImage>;
}) {
  const id = `plugin-check:${crypto.randomUUID()}`;
  const selected = shallowRef<ViewDefinition>();
  const target = shallowRef<ViewTarget>();
  const presentation = shallowRef<PresentationValue>();
  let root: HTMLElement | null = null;
  let app: App | undefined;
  let container: HTMLElement | undefined;
  let failed = false;
  const views = new Map<string, ViewDefinition>();
  function requireCurrent() {
    options.requireCurrent();
    if (failed) throw new Error("plugins.previewRenderFailed");
  }
  const component = defineComponent({
    setup() {
      onErrorCaptured(() => {
        failed = true;
        return false;
      });
      return () =>
        h(
          "section",
          {
            ref: (element) => {
              root = element as HTMLElement | null;
            },
            style: { width: "100%", height: "100%", overflow: "auto" },
          },
          selected.value
            ? [
                h(selected.value.component, {
                  key: selected.value.id,
                  workspaceId: id,
                  workspaceName: t("plugins.checkPreview"),
                  embedded: true,
                  target:
                    target.value?.kind === "view"
                      ? {
                          contentId: target.value.contentId,
                          revision: target.value.revision,
                        }
                      : {},
                  presentation: presentation.value,
                  onPresentation: (value: PresentationValue) => {
                    requireCurrent();
                    presentation.value = value;
                  },
                  onNavigate: (
                    value: ViewTarget,
                    state?: PresentationValue,
                  ) => {
                    void open(value, undefined, undefined, state).catch(() => {
                      failed = true;
                    });
                  },
                }),
              ]
            : [],
        );
    },
  });
  const open: PluginUiHost["navigation"]["open"] = async (
    value,
    _ticket,
    _guard,
    state,
  ) => {
    requireCurrent();
    if (value.kind !== "view") throw new Error("plugins.previewUnavailable");
    if (!views.has(value.viewId))
      throw new Error("plugins.previewViewNotFound");
    selected.value = views.get(value.viewId);
    target.value = value;
    presentation.value = state;
    if (!app) {
      container = document.createElement("div");
      container.dataset.pluginPreview = "";
      container.style.cssText = `position:fixed!important;inset:0!important;z-index:2147483647!important;isolation:isolate!important;opacity:1!important;mix-blend-mode:normal!important;filter:none!important;transform:none!important;background-image:none!important;background-color:${colors.paper}!important;contain:paint!important;width:100%!important;height:100dvh!important;min-width:0!important;margin:0!important;padding:0!important;border:0!important;box-sizing:border-box!important;overflow:hidden!important`;
      document.body.append(container);
      app = createApp(component);
      app.config.errorHandler = () => {
        failed = true;
      };
      app.mount(container);
    }
    await nextTick();
    requireCurrent();
    return true;
  };
  const reveal: PluginUiHost["navigation"]["reveal"] = async (
    viewId,
    contentId,
    revision,
  ) => {
    requireCurrent();
    const view = views.get(viewId);
    if (!view) throw new Error("plugins.previewViewNotFound");
    const state = await view.reveal?.(contentId, revision);
    requireCurrent();
    return open(
      { kind: "view", viewId, contentId, ...(revision ? { revision } : {}) },
      undefined,
      undefined,
      state,
    );
  };
  function element(selector?: string): HTMLElement {
    requireCurrent();
    if (
      selector !== undefined &&
      (typeof selector !== "string" || !selector || selector.length > 1024)
    )
      throw new Error("plugins.previewInvalidArguments");
    if (!root?.isConnected) throw new Error("plugins.previewUnavailable");
    if (selector === undefined) return root;
    let found: Element | null;
    try {
      found = root.querySelector(selector);
    } catch {
      throw new Error("plugins.previewInvalidArguments");
    }
    if (!(found instanceof HTMLElement) || !root.contains(found))
      throw new Error("plugins.previewElementNotFound");
    return found;
  }
  async function captureRect(): Promise<PreviewRect> {
    await nextTick();
    const node = element();
    const { x, y, width, height } = node.getBoundingClientRect();
    if (
      width <= 0 ||
      height <= 0 ||
      width > 2048 ||
      height > 2048 ||
      Math.ceil(width) * Math.ceil(height) > 4_000_000 ||
      x < 0 ||
      y < 0 ||
      x + width > innerWidth ||
      y + height > innerHeight
    )
      throw new Error("plugins.previewUnavailable");
    for (const [px, py] of [
      [x + 1, y + 1],
      [x + width - 1, y + 1],
      [x + 1, y + height - 1],
      [x + width - 1, y + height - 1],
      [x + width / 2, y + height / 2],
    ]) {
      const top = document.elementFromPoint(px, py);
      if (top !== node && !node.contains(top))
        throw new Error("plugins.previewUnavailable");
    }
    return { x, y, width, height };
  }
  return {
    navigation: { open, reveal },
    captureRect,
    check: requireCurrent,
    setContributions(contributions: PluginUiContributions) {
      requireCurrent();
      for (const view of [
        ...(contributions.views ?? []),
        ...(contributions.settings ? [contributions.settings] : []),
      ])
        views.set(view.id, view);
    },
    async open(viewId: string) {
      if (typeof viewId !== "string" || !viewId.trim())
        throw new Error("plugins.previewInvalidArguments");
      return open({ kind: "view", viewId });
    },
    read(selector?: string) {
      return (element(selector).textContent ?? "").slice(0, 65536);
    },
    async click(selector: string) {
      if (typeof selector !== "string")
        throw new Error("plugins.previewInvalidArguments");
      element(selector).click();
      await nextTick();
      requireCurrent();
    },
    async fill(selector: string, value: string) {
      if (typeof value !== "string")
        throw new Error("plugins.previewInvalidArguments");
      const input = element(selector);
      if (
        !(
          input instanceof HTMLInputElement ||
          input instanceof HTMLTextAreaElement ||
          input instanceof HTMLSelectElement
        ) ||
        value.length > 65536
      )
        throw new Error("plugins.previewInvalidArguments");
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await nextTick();
      requireCurrent();
    },
    async capture() {
      const image = await options.capture(await captureRect());
      requireCurrent();
      if (image.mimeType !== "image/png" || image.captured !== true)
        throw new Error("plugins.previewUnavailable");
      return image;
    },
    dispose() {
      app?.unmount();
      app = undefined;
      container?.remove();
      container = undefined;
      selected.value = undefined;
      root = null;
      views.clear();
    },
  };
}
