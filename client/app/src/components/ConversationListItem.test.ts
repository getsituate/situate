import "../ui/popover-test-environment";
import { afterEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import AppSidebar from "./AppSidebar.vue";
import ConversationListItem from "./ConversationListItem.vue";
import { dictation } from "../dictation/runtime";
const { renameTitle, deleteConversation, setArchived } = vi.hoisted(() => ({
  renameTitle: vi.fn(async () => {}),
  deleteConversation: vi.fn(async () => {}),
  setArchived: vi.fn<(id: string, archived: boolean) => Promise<void>>(),
}));
vi.mock("../ai/chat", () => ({
  workspaceChat: vi.fn(() => ({ renameTitle, deleteConversation })),
  workspaceConversations: vi.fn(() => ({ setArchived })),
}));
enableAutoUnmount(afterEach);
afterEach(() => {
  vi.restoreAllMocks();
  renameTitle.mockReset().mockResolvedValue(undefined);
  deleteConversation.mockReset().mockResolvedValue(undefined);
  setArchived.mockReset();
  dictation.owner = null;
  document.body.replaceChildren();
});
function render() {
  return mount(ConversationListItem, {
    attachTo: document.body,
    props: {
      item: {
        id: "garden",
        title: "Garden plan with a quiet reading corner and herbs",
        revision: 1,
      },
      scope: "workspace",
      selected: true,
      running: true,
    },
  });
}
test("archives and restores a conversation without closing the other entries", async () => {
  const conversations = reactive([
    { id: "garden", title: "Garden", revision: 1, archived: false },
    { id: "notes", title: "Notes", revision: 2, archived: false },
  ]);
  setArchived.mockImplementation(async (id, archived) => {
    conversations.find((item) => item.id === id)!.archived = archived;
  });
  const wrapper = mount(AppSidebar, {
    attachTo: document.body,
    props: {
      currentWorkspaceId: "workspace",
      conversations,
      selectedConversation: "garden",
      conversationRunning: (id: string) => id === "garden",
    },
  });
  const archive = wrapper.get<HTMLDetailsElement>(".conversation-archive");
  const summary = archive.get("summary");
  expect(summary.text()).toBe("⟦navigation.conversationArchive⟧");
  expect(archive.element.open).toBe(false);
  await wrapper.get(".quick-archive").trigger("click");
  await flushPromises();
  expect(setArchived).toHaveBeenCalledExactlyOnceWith("garden", true);
  expect(wrapper.get('[role="status"].sr-only').text()).toBe(
    "⟦chat.conversationArchived⟧",
  );
  expect(wrapper.get(".conversation-actions").element).toBe(
    document.activeElement,
  );
  expect(
    archive.get('.conversation-destination[aria-current="page"]').text(),
  ).toBe("Garden");
  expect(archive.find(".quick-archive").exists()).toBe(false);
  archive.element.open = true;
  await archive.get(".conversation-actions").trigger("click");
  await flushPromises();
  const restore = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((item) => item.textContent?.trim() === "⟦chat.restoreConversation⟧");
  expect(restore).toBeDefined();
  restore!.click();
  await flushPromises();
  expect(setArchived).toHaveBeenLastCalledWith("garden", false);
  expect(wrapper.get('[role="status"].sr-only').text()).toBe(
    "⟦chat.conversationRestored⟧",
  );
  expect(archive.text()).toContain("⟦navigation.noArchivedConversations⟧");
  expect(summary.element).toBe(document.activeElement);
  expect(
    wrapper.get('.conversation-destination[aria-current="page"]').text(),
  ).toBe("Garden");
});

test("keeps the row in place on archive failure and allows retry", async () => {
  let reject!: (error: Error) => void;
  setArchived.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const wrapper = render();
  const announceArchiveChange = vi.fn();
  await wrapper.setProps({ announceArchiveChange });
  const shortcut = wrapper.get(".quick-archive");
  await shortcut.trigger("click");
  await shortcut.trigger("click");
  expect(setArchived).toHaveBeenCalledTimes(1);
  expect(announceArchiveChange).not.toHaveBeenCalled();
  reject(new Error("Storage unavailable"));
  await flushPromises();
  const error = wrapper.get(".error-dialog");
  expect(error.text()).toContain("⟦chat.archiveChangeFailed⟧");
  await error.trigger("cancel");
  expect(wrapper.find(".error-dialog").exists()).toBe(false);
  expect(wrapper.get(".conversation-actions").element).toBe(
    document.activeElement,
  );
  setArchived.mockResolvedValueOnce();
  await shortcut.trigger("click");
  await flushPromises();
  expect(announceArchiveChange).toHaveBeenCalledExactlyOnceWith(
    "workspace",
    true,
  );
});

async function edit(wrapper: ReturnType<typeof render>) {
  await wrapper.get(".conversation-actions").trigger("click");
  await flushPromises();
  const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu.textContent).not.toContain(wrapper.props("item").title);
  menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
  await flushPromises();
}
async function confirmDeletion(wrapper: ReturnType<typeof render>) {
  await wrapper.get(".conversation-actions").trigger("click");
  await flushPromises();
  const items =
    document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
  const remove = [...items].find((item) =>
    item.textContent?.includes("⟦chat.deleteConversation⟧"),
  );
  expect(remove).toBeDefined();
  remove!.click();
  await flushPromises();
  return wrapper.get("dialog");
}
test("confirms deletion with standard dialog actions and updates the running-work warning", async () => {
  const wrapper = render();
  await wrapper.setProps({ running: false });
  const dialog = await confirmDeletion(wrapper);
  expect(dialog.element.open).toBe(true);
  expect(dialog.text()).toContain(wrapper.props("item").title);
  expect(dialog.text()).toContain("⟦chat.deleteConfirmation⟧");
  expect(dialog.element.contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.textContent).toContain("⟦navigation.cancel⟧");
  expect(deleteConversation).not.toHaveBeenCalled();
  await wrapper.setProps({ running: true });
  expect(dialog.text()).toContain("⟦chat.deleteRunningConfirmation⟧");
  await dialog.get(".situate-button--danger").trigger("click");
  await flushPromises();
  expect(deleteConversation).toHaveBeenCalledOnce();
  expect(dialog.element.open).toBe(false);
});
test("warns about owned recording without stopping it when deletion is cancelled", async () => {
  dictation.owner = {
    id: "recording",
    scope: "workspace",
    conversation: "garden",
    phase: "recording",
  };
  const wrapper = render();
  await wrapper.setProps({ running: false });
  const dialog = await confirmDeletion(wrapper);
  expect(dialog.text()).toContain("⟦chat.deleteRunningConfirmation⟧");
  await dialog.trigger("cancel");
  expect(dictation.owner?.id).toBe("recording");
  expect(deleteConversation).not.toHaveBeenCalled();
});
test("cancels deletion with Escape or the safe action and restores focus", async () => {
  const wrapper = render();
  let dialog = await confirmDeletion(wrapper);
  await dialog.trigger("cancel");
  await flushPromises();
  expect(dialog.element.open).toBe(false);
  expect(document.activeElement).toBe(
    wrapper.get(".conversation-actions").element,
  );
  dialog = await confirmDeletion(wrapper);
  await dialog.get(".situate-button--secondary").trigger("click");
  await flushPromises();
  expect(dialog.element.open).toBe(false);
  expect(deleteConversation).not.toHaveBeenCalled();
});
test("prevents duplicate deletion and dismissal until persistence settles", async () => {
  let complete!: () => void;
  deleteConversation.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const wrapper = render();
  const dialog = await confirmDeletion(wrapper);
  await dialog.get(".situate-button--danger").trigger("click");
  expect(dialog.attributes("aria-busy")).toBe("true");
  await dialog.get(".situate-button--danger").trigger("click");
  await dialog.trigger("cancel");
  expect(dialog.element.open).toBe(true);
  expect(deleteConversation).toHaveBeenCalledOnce();
  complete();
  await flushPromises();
  expect(dialog.element.open).toBe(false);
});
test("keeps deletion failures in the dialog and allows retry", async () => {
  deleteConversation.mockRejectedValueOnce(new Error("Storage unavailable"));
  const wrapper = render();
  const dialog = await confirmDeletion(wrapper);
  await dialog.get(".situate-button--danger").trigger("click");
  await flushPromises();
  expect(dialog.element.open).toBe(true);
  expect(dialog.get('[role="alert"]').text()).toBe("⟦chat.deleteFailed⟧");
  await dialog.get(".situate-button--danger").trigger("click");
  await flushPromises();
  expect(deleteConversation).toHaveBeenCalledTimes(2);
  expect(dialog.element.open).toBe(false);
});
test("keeps the complete accessible title and a separate working indicator", async () => {
  const wrapper = render();
  expect(wrapper.get(".conversation-title").text()).toBe(
    wrapper.props("item").title,
  );
  expect(
    wrapper.get(".conversation-destination").attributes("aria-current"),
  ).toBe("page");
  expect(wrapper.get('[role="img"]').attributes("aria-label")).toBe(
    "⟦navigation.responding⟧",
  );
  await wrapper.get(".conversation-destination").trigger("click");
  expect(wrapper.emitted("open")).toHaveLength(1);
});
test("edits one line with no visible label and saves with Enter", async () => {
  const wrapper = render();
  await edit(wrapper);
  const input = wrapper.get("input");
  expect(input.attributes("type")).toBe("text");
  expect(input.attributes("maxlength")).toBe("256");
  expect(wrapper.find("label").exists()).toBe(false);
  expect(document.activeElement).toBe(input.element);
  expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([
    0,
    wrapper.props("item").title.length,
  ]);
  expect(wrapper.get('[role="img"]').attributes("aria-label")).toBe(
    "⟦navigation.responding⟧",
  );
  await input.setValue("  Garden with herbs  ");
  await input.trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(renameTitle).toHaveBeenCalledExactlyOnceWith("  Garden with herbs  ");
  expect(wrapper.find("form").exists()).toBe(false);
  expect(document.activeElement).toBe(
    wrapper.get(".conversation-actions").element,
  );
});
test("Escape cancels without saving and empty titles cannot be submitted", async () => {
  const wrapper = render();
  await edit(wrapper);
  await wrapper.get("input").setValue("   ");
  expect(wrapper.get(".save-title").attributes("disabled")).toBeDefined();
  await wrapper.get("form").trigger("submit");
  expect(renameTitle).not.toHaveBeenCalled();
  await wrapper.get("input").trigger("keydown", { key: "Escape" });
  await flushPromises();
  expect(renameTitle).not.toHaveBeenCalled();
  expect(wrapper.find("form").exists()).toBe(false);
  expect(document.activeElement).toBe(
    wrapper.get(".conversation-actions").element,
  );
});
test("composition keys neither save nor cancel a name", async () => {
  const wrapper = render();
  await edit(wrapper);
  await wrapper.get("input").setValue("Garden with herbs");
  for (const key of ["Enter", "Escape"])
    await wrapper.get("input").trigger("keydown", { key, isComposing: true });
  expect(renameTitle).not.toHaveBeenCalled();
  expect(wrapper.find("input").exists()).toBe(true);
});
test("pastes line breaks as spaces, preserving selection and the length limit", async () => {
  const wrapper = render();
  await edit(wrapper);
  const input = wrapper.get("input");
  await input.setValue("Before after");
  input.element.setSelectionRange(6, 7);
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { getData: () => "\nGarden\r\nplan\u2028" },
  });
  input.element.dispatchEvent(paste);
  expect(input.element.value).toBe("Before Garden plan after");
  await input.setValue("A".repeat(255));
  input.element.setSelectionRange(255, 255);
  const longPaste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(longPaste, "clipboardData", {
    value: { getData: () => "BC" },
  });
  input.element.dispatchEvent(longPaste);
  expect(input.element.value).toBe("A".repeat(255) + "B");
  await wrapper.get(".save-title").trigger("click");
  await flushPromises();
  expect(renameTitle).toHaveBeenCalledWith("A".repeat(255) + "B");
});
test("blocks duplicate saves and cancellation while persistence is pending", async () => {
  let complete!: () => void;
  renameTitle.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const wrapper = render();
  await edit(wrapper);
  await wrapper.get("input").setValue("Garden with herbs");
  await wrapper.get(".save-title").trigger("click");
  expect(wrapper.get("input").attributes("disabled")).toBeDefined();
  expect(wrapper.get("form").attributes("aria-busy")).toBe("true");
  await wrapper.get("form").trigger("submit");
  await wrapper.get("form").trigger("keydown", { key: "Escape" });
  expect(renameTitle).toHaveBeenCalledTimes(1);
  expect(wrapper.find("form").exists()).toBe(true);
  complete();
  await flushPromises();
  expect(wrapper.find("form").exists()).toBe(false);
});
test("retains the edited title, focuses it and offers retry after a save failure", async () => {
  renameTitle.mockRejectedValueOnce(new Error("Storage unavailable"));
  const wrapper = render();
  await edit(wrapper);
  await wrapper.get("input").setValue("Garden with herbs");
  await wrapper.get(".save-title").trigger("click");
  await flushPromises();
  expect(wrapper.get("input").element.value).toBe("Garden with herbs");
  expect(wrapper.get("input").attributes("aria-invalid")).toBe("true");
  expect(wrapper.get("input").attributes("aria-describedby")).toContain(
    wrapper.get('[role="alert"]').attributes("id"),
  );
  expect(document.activeElement).toBe(wrapper.get("input").element);
  await wrapper.get("input").trigger("keydown", { key: "Enter" });
  await flushPromises();
  expect(wrapper.find("form").exists()).toBe(false);
});
