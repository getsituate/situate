import { afterEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
const files = vi.hoisted(() => vi.fn());
vi.mock("../../files/api", () => ({ filesRequest: files }));
import ChatBatchChanges from "./ChatBatchChanges.vue";

enableAutoUnmount(afterEach);
const revision = "a".repeat(40);
const batch = {
  files: Array.from({ length: 108 }, (_, index) => ({
    path: `Imported/note-${index}.md`,
    revision,
  })),
  history: revision,
};
const saved = (text = "# Imported note") => ({
  status: "ok",
  document: { version: { revision, text } },
});

test("reveals ten more names at a time without reading contents and stops at the end", async () => {
  files.mockReset();
  const wrapper = mount(ChatBatchChanges, {
    props: { scope: "workspace", batch },
  });
  expect(wrapper.findAll(".batch-file")).toHaveLength(10);
  for (let index = 0; index < 10; index++)
    await wrapper.get(".batch-more").trigger("click");
  expect(wrapper.findAll(".batch-file")).toHaveLength(108);
  expect(wrapper.find(".batch-more").exists()).toBe(false);
  expect(files).not.toHaveBeenCalled();
});

test("closing a pending file preview ignores its late response and another file loads independently", async () => {
  let finish!: (value: unknown) => void;
  files
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(saved("# Second note"));
  const wrapper = mount(ChatBatchChanges, {
    props: { scope: "workspace", batch },
  });
  await wrapper.get(".batch-file").trigger("click");
  expect(wrapper.get('[role="status"]').text()).toBe("⟦files.loadingDocument⟧");
  await wrapper.get("dialog").trigger("cancel");
  expect(wrapper.find("dialog").exists()).toBe(false);
  await wrapper.findAll(".batch-file")[1]!.trigger("click");
  await flushPromises();
  finish(saved("# Late first note"));
  await flushPromises();
  expect(wrapper.get(".change-added pre").text()).toBe("# Second note");
  expect(files).toHaveBeenCalledTimes(2);
});

test("a failed preview offers a read-only retry without repeating the import", async () => {
  files
    .mockReset()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(saved());
  const wrapper = mount(ChatBatchChanges, {
    props: { scope: "workspace", batch, isError: true },
  });
  await wrapper.get(".batch-file").trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toBe(
    "⟦chat.importChangeUnavailable⟧",
  );
  await wrapper.get(".dialog-layout button").trigger("click");
  await flushPromises();
  expect(wrapper.get(".change-added pre").text()).toBe("# Imported note");
  expect(wrapper.get(".change-saved").text()).toBe("⟦chat.written⟧");
  expect(files).toHaveBeenCalledTimes(2);
  expect(
    files.mock.calls.every(([request]) => request.operation === "revision"),
  ).toBe(true);
});

test.each(["scope", "batch"] as const)(
  "changing %s dismisses the preview, resets the list and ignores stale content",
  async (property) => {
    let finish!: (value: unknown) => void;
    files.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mount(ChatBatchChanges, {
      props: { scope: "workspace", batch },
    });
    await wrapper.get(".batch-more").trigger("click");
    await wrapper.get(".batch-file").trigger("click");
    await wrapper.setProps(
      property === "scope"
        ? { scope: "other" }
        : { batch: { ...batch, history: "b".repeat(40) } },
    );
    expect(wrapper.find("dialog").exists()).toBe(false);
    expect(wrapper.findAll(".batch-file")).toHaveLength(10);
    finish(saved());
    await flushPromises();
    expect(wrapper.find(".change-added").exists()).toBe(false);
    expect(files).toHaveBeenCalledTimes(1);
  },
);
