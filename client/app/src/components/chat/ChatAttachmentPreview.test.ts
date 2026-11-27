import { afterEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import ChatAttachmentPreview from "./ChatAttachmentPreview.vue";
import type { AttachmentPreviewTarget } from "../../ai/attachment-runtime";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
enableAutoUnmount(afterEach);
afterEach(() => invoke.mockReset());

const target: AttachmentPreviewTarget = {
  kind: "reference",
  reference: {
    kind: "live",
    workspaceId: "garden",
    path: "Images/map.png",
    anchorRevision: "a".repeat(40),
  },
};
const thumbnail = "data:image/png;base64,YQ==";

test("an unavailable preview leaves the filename visible", async () => {
  invoke.mockRejectedValueOnce("chat.attachmentUnavailable");
  const wrapper = mount(ChatAttachmentPreview, {
    props: { target, name: "map.png", enabled: true },
    slots: { default: "map.png" },
  });
  expect(invoke).not.toHaveBeenCalled();
  await wrapper.setProps({ scope: "garden" });
  await flushPromises();
  expect(invoke).toHaveBeenCalledExactlyOnceWith("ai_attachment_preview", {
    scope: "garden",
    target,
  });
  expect(wrapper.find("img").exists()).toBe(false);
  expect(wrapper.text()).toBe("map.png");
});

test("a replaced thumbnail ignores the old response and falls back if decoding fails", async () => {
  let finishOld!: (src: string) => void;
  invoke
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValueOnce(thumbnail);
  const wrapper = mount(ChatAttachmentPreview, {
    props: { target, name: "map.png", enabled: true, scope: "garden" },
    slots: { default: "File preview unavailable" },
  });
  await wrapper.setProps({
    target: { kind: "attachment", id: "external-image" },
    name: "photo.png",
  });
  await flushPromises();
  finishOld("data:image/png;base64,Yg==");
  await flushPromises();
  expect(wrapper.get("img").attributes()).toMatchObject({
    src: thumbnail,
    alt: "photo.png",
  });
  await wrapper.get("img").trigger("error");
  expect(wrapper.find("img").exists()).toBe(false);
  expect(wrapper.text()).toBe("File preview unavailable");
});
