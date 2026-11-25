import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "./AppShell.vue";
import { retainWorkspaceUi, workspaceUi } from "../layout/runtime";
import type { LayoutDocument, LayoutRecord } from "../layout/storage";
import { currentEntry, type PresentationValue } from "../layout/navigation";
import { defineComponent, nextTick } from "vue";
import { closeChats, workspaceChat, workspaceConversations } from "../ai/chat";
import { retainedWorkspaces, releaseWorkspace } from "../files/sessions";
import type { FilesRequest } from "../files/api";
import { SituateIconButton, SituateTooltip } from "@situate/ui";
import AppSidebar from "./AppSidebar.vue";
import ChatPane from "./ChatPane.vue";
import { updates } from "../updates/runtime";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
enableAutoUnmount(afterEach);
async function settleViews(): Promise<void> {
  await flushPromises();
  await vi.dynamicImportSettled();
  await flushPromises();
}
afterEach(() => {
  retainWorkspaceUi([]);
  closeChats([]);
  retainedWorkspaces().forEach(releaseWorkspace);
});

const managementStub = defineComponent({
  props: ["scope", "selectedPlugin", "onDevelop"],
  setup(_, { expose }) {
    expose({ back: () => false });
  },
  template: '<section class="management-stub" />',
});

function hostButton(wrapper: VueWrapper, label: string) {
  const button = wrapper
    .findAll("button")
    .find(
      (item) =>
        item.attributes("aria-label") === label || item.text() === label,
    );
  expect(button, label).toBeDefined();
  return button!;
}
function savedFileLayout(): LayoutDocument {
  return {
    version: 1,
    pinnedViews: ["files"],
    layout: {
      activeTabId: "garden-tab",
      closedTabs: [],
      tabs: [
        {
          id: "garden-tab",
          name: "Planting",
          activePaneId: "reader",
          maximizedPaneId: null,
          conversationIds: [],
          layout: { kind: "pane", id: "reader" },
          panes: [
            {
              id: "reader",
              navigation: {
                cursor: 0,
                entries: [
                  {
                    id: "garden-entry",
                    target: {
                      kind: "view",
                      viewId: "files",
                      contentId: "Notes/Garden.md",
                    },
                    presentation: {
                      mode: "source",
                      selectionStart: 3,
                      selectionEnd: 6,
                      scrollTop: 25,
                      readScrollTop: 0,
                      treeOpen: false,
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}
describe("workspace view host", () => {
  const garden = { id: "garden", name: "Garden", display: "/Notes/Garden" };
  const notes = { id: "notes", name: "Notes", display: "/Notes/Other" };
  const stored = new Map<string, LayoutRecord>();
  let revision = 0;
  let text = "# Garden\nA planting plan.";
  const scrolling = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );
  beforeEach(() => {
    retainWorkspaceUi([]);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal("CSS", {
      escape: (value: string) => value.replaceAll('"', '\\"'),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    stored.clear();
    stored.set("garden", { revision: "initial", data: savedFileLayout() });
    revision = 0;
    text = "# Garden\nA planting plan.";
    vi.mocked(invoke)
      .mockReset()
      .mockImplementation(async (command, args) => {
        const input = args as {
          workspaceId: string;
          expectedRevision: string | null;
          data: LayoutDocument;
          request: FilesRequest;
        };
        if (command === "layout_load")
          return structuredClone(
            stored.get(input.workspaceId) ?? { revision: null, data: null },
          );
        if (command === "layout_save") {
          expect(input.expectedRevision).toBe(
            stored.get(input.workspaceId)?.revision ?? null,
          );
          const record = {
            revision: `saved-${++revision}`,
            data: structuredClone(input.data),
          };
          stored.set(input.workspaceId, record);
          return structuredClone(record);
        }
        if (command === "keyboard_shortcuts_snapshot")
          return { revision: null, bindings: {} };
        if (command === "keyboard_shortcuts_plugins") return;
        if (command === "ai_status")
          return {
            config: null,
            available: false,
            reason: null,
            selectedModel: null,
            modelError: null,
          };
        if (command === "ai_conversations")
          return [{ id: "legacy", title: "Garden chat", revision: 0 }];
        if (command === "ai_conversation_read")
          return {
            version: 1,
            id: "legacy",
            title: "Garden chat",
            revision: 0,
            messages: [],
            draft: "",
          };
        if (command === "files_request") {
          const request = input.request;
          if (request.operation === "snapshot")
            return {
              status: "ok",
              snapshot: {
                writable: true,
                reason: null,
                drafts: [],
                entries: [
                  { path: "Notes", isDirectory: true },
                  { path: "Notes/Garden.md", isDirectory: false },
                ],
              },
            };
          if (request.operation === "read")
            return {
              status: "ok",
              document: {
                path: request.path,
                version: { text: request.text ?? text, revision: "base" },
                html: "<h1>Garden</h1>",
                issues: [],
              },
            };
          if (request.operation === "save") {
            text = request.text;
            return {
              status: "saved",
              document: {
                path: request.path,
                version: { text, revision: "saved" },
                html: "<h1>Garden</h1>",
                issues: [],
              },
            };
          }
          if (request.operation === "stage") return { status: "ok" };
        }
        throw new Error(`Unexpected command ${command}`);
      });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (scrolling)
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrolling);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    document.body.replaceChildren();
  });
  async function mountHost() {
    const wrapper = mount(AppShell, {
      global: { stubs: { PluginManagement: managementStub } },
      attachTo: document.body,
      props: {
        workspaceName: garden.name,
        currentWorkspaceId: garden.id,
        openWorkspaces: [garden, notes],
        mobile: false,
      },
    });
    await settleViews();
    return wrapper;
  }
  async function openNavigation(wrapper: VueWrapper) {
    await wrapper.get(".open-navigation").trigger("click");
    await settleViews();
  }
  async function openManagement(wrapper: VueWrapper) {
    await openNavigation(wrapper);
    await wrapper.get(".settings-action").trigger("click");
    await settleViews();
    await wrapper.get('[data-action="manage-plugins"]').trigger("click");
    await settleViews();
    return wrapper.getComponent(managementStub);
  }
  it("handles side buttons only when another control is not handling the input", async () => {
    const wrapper = await mountHost();
    await openNavigation(wrapper);
    await wrapper.get(".settings-action").trigger("click");
    await settleViews();
    const shell = wrapper.get(".app-shell").element;
    async function release(button: number, prevented = false) {
      const event = new MouseEvent("mouseup", {
        button,
        bubbles: true,
        cancelable: true,
      });
      if (prevented) event.preventDefault();
      shell.dispatchEvent(event);
      await settleViews();
      return event.defaultPrevented;
    }
    const inSettings = () => wrapper.find(".settings-view").exists();
    expect(inSettings()).toBe(true);
    expect(await release(1)).toBe(false);
    await release(3, true);
    expect(inSettings()).toBe(true);

    await openNavigation(wrapper);
    expect(await release(3)).toBe(true);
    expect(inSettings()).toBe(true);
    expect(
      wrapper.get<HTMLDialogElement>(".navigation-drawer").element.open,
    ).toBe(true);
    await wrapper.get(".navigation-drawer").trigger("cancel");
    await release(3);
    expect(wrapper.get(".document-location h3").text()).toBe("Garden.md");
    await release(4);
    expect(inSettings()).toBe(true);
  });

  it.each([true, false])(
    "middle-click selects the new conversation tab and gives it focus (wide: %s)",
    async (wide) => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn(() => ({
          matches: wide,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
      const wrapper = await mountHost();
      if (!wide) await openNavigation(wrapper);
      const conversation = wrapper.get(".conversation-destination");
      expect(conversation.text()).toContain("Garden chat");
      await conversation.trigger("mousedown", { button: 1 });
      await settleViews();
      const tabs = wrapper.findAll('[role="tab"]');
      expect(tabs).toHaveLength(2);
      expect(tabs[0]!.attributes("aria-selected")).toBe("false");
      expect(tabs[1]!.attributes("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(tabs[1]!.element);
      expect(wrapper.getComponent(ChatPane).props("conversationId")).toBe(
        "legacy",
      );
      if (!wide)
        expect(
          wrapper.get<HTMLDialogElement>(".navigation-drawer").element.open,
        ).toBe(false);
    },
  );

  it("dispatches desktop shortcuts once and keeps native form controls and modal dialogs in charge of their keys", async () => {
    const agent = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (Windows NT 10.0)");
    try {
      const wrapper = await mountHost();
      const session = workspaceUi("garden").session;
      const shell = wrapper.get(".app-shell").element;
      function press(target: Element, key: string, repeat = false) {
        const event = new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          repeat,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      }
      const select = document.createElement("select");
      const dialog = document.createElement("dialog");
      shell.append(select, dialog);
      dialog.showModal();
      expect(press(shell, "t")).toBe(false);
      dialog.close();
      expect(press(select, "t")).toBe(false);
      expect(press(shell, "y")).toBe(false);
      expect(press(shell, "Shift")).toBe(false);
      expect(press(shell, "t", true)).toBe(true);
      await settleViews();
      expect(session.state.document?.layout.tabs).toHaveLength(1);

      expect(press(shell, "t")).toBe(true);
      await settleViews();
      expect(session.state.document?.layout.tabs).toHaveLength(2);
      expect(press(shell, "n")).toBe(true);
      await settleViews();
      const field = wrapper.get<HTMLTextAreaElement>(".chat-composer textarea");
      expect(document.activeElement).toBe(field.element);
      expect(field.element.value).toBe("");

      await wrapper.setProps({ mobile: true });
      expect(press(shell, "t")).toBe(false);
      expect(session.state.document?.layout.tabs).toHaveLength(2);
    } finally {
      agent.mockRestore();
    }
  });

  it("dispatches an active plugin shortcut and reports a failed action", async () => {
    const agent = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (Macintosh)");
    try {
      const wrapper = await mountHost();
      const shortcuts = workspaceUi("garden").shortcuts;
      const run = vi
        .fn()
        .mockRejectedValue(new Error("native.shortcuts.unavailable"));
      const release = shortcuts.register([
        {
          id: "notebook:open",
          title: "Open note",
          plugin: "Notebook",
          defaults: { macos: "Meta+J" },
          available: () => true,
          run,
        },
      ]);
      function press() {
        const event = new KeyboardEvent("keydown", {
          key: "j",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        });
        wrapper.get(".app-shell").element.dispatchEvent(event);
        return event.defaultPrevented;
      }
      expect(press()).toBe(true);
      await settleViews();
      expect(run).toHaveBeenCalledOnce();
      expect(wrapper.get(".error-dialog").text()).toContain(
        "native.shortcuts.unavailable",
      );
      await wrapper.get(".error-dialog button").trigger("click");
      release();
      expect(press()).toBe(false);
      expect(run).toHaveBeenCalledOnce();
    } finally {
      agent.mockRestore();
    }
  });

  it("removes a conversation from open and closed tab histories only after deletion succeeds", async () => {
    const { session } = workspaceUi("garden");
    await session.load();
    const first = session.capture().address!;
    const target = { kind: "conversation", conversationId: "legacy" } as const;
    const files = currentEntry(
      session.state.document!.layout.tabs[0]!.panes[0]!.navigation,
    );
    session.open(target);
    session.open({ kind: "empty" });
    session.dispatch({ type: "new-tab" });
    session.open(target);
    session.dispatch({
      type: "close-tab",
      tabId: session.capture().address!.tabId,
    });
    session.dispatch({ type: "history", delta: -1, ...first });
    await nextTick();
    const before = session.state.document;
    const native = vi.mocked(invoke).getMockImplementation()!;
    let deleted = false;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "ai_conversation_delete") {
        if (!deleted) throw new Error("Storage unavailable");
        return;
      }
      return native(command, args);
    });

    await expect(
      workspaceChat("garden", "legacy").deleteConversation(),
    ).rejects.toThrow("Storage unavailable");
    expect(session.state.document).toBe(before);
    deleted = true;
    await workspaceChat("garden", "legacy").deleteConversation();
    await session.flush();
    retainWorkspaceUi([]);
    closeChats([]);
    const reopened = workspaceUi("garden").session;
    await reopened.load();

    const { tabs, closedTabs } = reopened.state.document!.layout;
    expect(tabs[0]!.conversationIds).toEqual([]);
    const navigation = tabs[0]!.panes[0]!.navigation;
    expect(currentEntry(navigation)).toEqual(files);
    expect(navigation.entries.map(({ target }) => target.kind)).toEqual([
      "view",
      "empty",
    ]);
    expect(closedTabs[0]!.tab.conversationIds).toEqual([]);
    expect(
      closedTabs[0]!.tab.panes[0]!.navigation.entries.map(
        ({ target }) => target,
      ),
    ).toEqual([{ kind: "empty" }]);
  });
  it("opens Plugins from Settings in the active pane and restores each previous view", async () => {
    const wrapper = await mountHost();
    const management = await openManagement(wrapper);
    expect(management.props("scope")).toBe("garden");
    expect(wrapper.find(".settings-view").exists()).toBe(false);
    expect(wrapper.find(".topic-window").exists()).toBe(true);
    expect(wrapper.getComponent(AppSidebar).props()).toMatchObject({
      pluginsActive: true,
      settingsActive: false,
      filesActive: false,
      activeView: "plugins",
    });
    expect(wrapper.vm.back()).toBe(true);
    await settleViews();
    expect(wrapper.find(".management-stub").exists()).toBe(false);
    expect(wrapper.find(".settings-view").exists()).toBe(true);
    expect(wrapper.vm.back()).toBe(true);
    await settleViews();
    expect(wrapper.find(".source-text").exists()).toBe(true);
    expect(
      workspaceUi("garden").session.state.document!.layout.tabs,
    ).toHaveLength(1);
  });
  it("opens the Updates category in the current pane and returns to the file", async () => {
    const wrapper = await mountHost();
    const supported = updates.supported;
    updates.supported = true;
    try {
      expect(await wrapper.vm.showUpdates()).toBe(true);
      await settleViews();
      expect(wrapper.get(".settings-page-heading").text()).toBe(
        "⟦updates.title⟧",
      );
      expect(wrapper.vm.back()).toBe(true);
      await settleViews();
      expect(wrapper.find(".source-text").exists()).toBe(true);
    } finally {
      updates.supported = supported;
    }
  });
  it("lets the application open Updates separately when the workspace layout cannot be loaded", async () => {
    const invokeNormally = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "layout_load")
        throw new Error("native.layout.storage.failed");
      return invokeNormally(command, args);
    });
    const wrapper = await mountHost();
    expect(await wrapper.vm.showUpdates()).toBe(false);
    expect(wrapper.find(".situate-error-screen").exists()).toBe(true);
  });
  it("supports direct selected entry and reopening without entering Settings", async () => {
    const wrapper = await mountHost();
    await wrapper.vm.showPlugins("sample");
    await settleViews();
    expect(wrapper.find(".management-stub").exists()).toBe(true);
    expect(wrapper.getComponent(managementStub).props("selectedPlugin")).toBe(
      "sample",
    );
    expect(wrapper.find(".settings-view").exists()).toBe(false);
    expect(wrapper.find(".open-navigation").exists()).toBe(true);
    await openNavigation(wrapper);
    expect(wrapper.get(".plugins-action").attributes("aria-current")).toBe(
      "page",
    );
    expect(
      wrapper.get(".settings-action").attributes("aria-current"),
    ).toBeUndefined();
    await wrapper.get(".settings-action").trigger("click");
    await settleViews();
    expect(wrapper.find(".management-stub").exists()).toBe(false);
    expect(wrapper.find(".settings-view").exists()).toBe(true);
    await wrapper.vm.showPlugins();
    await settleViews();
    expect(wrapper.find(".settings-view").exists()).toBe(false);
    expect(wrapper.getComponent(AppSidebar).props("pluginsActive")).toBe(true);
  });
  it("keeps an unpublished chat draft during a detour into settings", async () => {
    const wrapper = await mountHost();
    await openNavigation(wrapper);
    await hostButton(wrapper, "⟦navigation.newChat⟧").trigger("click");
    await settleViews();
    const document = workspaceUi("garden").session.state.document!;
    const target = currentEntry(
      document.layout.tabs[0]!.panes[0]!.navigation,
    ).target;
    if (target.kind !== "new-conversation") throw new Error("Missing draft");
    const chat = workspaceChat("garden", target.conversationId);
    chat.state.draft = "A draft before checking settings";
    await chat.saveDraft();
    await openManagement(wrapper);
    expect(wrapper.vm.back()).toBe(true);
    await settleViews();
    expect(wrapper.vm.back()).toBe(true);
    await settleViews();
    expect(wrapper.getComponent(ChatPane).props("conversationId")).toBe(
      target.conversationId,
    );
    expect(workspaceChat("garden", target.conversationId).state.draft).toBe(
      "A draft before checking settings",
    );
  });
  it("restores plugin inspection only in the workspace where it was opened", async () => {
    const wrapper = await mountHost();
    await wrapper.vm.showPlugins("sample");
    await settleViews();
    await wrapper.setProps({ currentWorkspaceId: "notes" });
    await settleViews();
    expect(wrapper.find(".management-stub").exists()).toBe(false);
    await wrapper.setProps({ currentWorkspaceId: "garden" });
    await settleViews();
    expect(wrapper.getComponent(managementStub).props("selectedPlugin")).toBe(
      "sample",
    );
  });
  it.each([
    [undefined, false],
    ["sample", false],
    [undefined, true],
    ["sample", true],
  ] as const)(
    "opens %s development as an unpublished draft and discards it (close: %s)",
    async (pluginId, close) => {
      const wrapper = await mountHost();
      const management = await openManagement(wrapper);
      await management.props("onDevelop")(pluginId);
      await settleViews();
      const ui = workspaceUi("garden");
      const pane = ui.session.state.document!.layout.tabs[0]!.panes[0]!;
      const entry = currentEntry(pane.navigation);
      expect(entry.target.kind).toBe("new-conversation");
      if (entry.target.kind !== "new-conversation")
        throw new Error("Missing draft");
      const id = entry.target.conversationId;
      const chat = workspaceChat("garden", id);
      expect(chat.state.development).toEqual({
        version: 2,
        ...(pluginId ? { pluginId } : {}),
      });
      expect(chat.state.ephemeral).toBe(true);
      expect(wrapper.find(".settings-view").exists()).toBe(false);
      const ids = () =>
        workspaceConversations("garden").state.conversations.map(
          (item) => item.id,
        );
      expect(ids()).not.toContain(id);
      chat.state.draft = "An unsent plugin idea";
      await chat.saveDraft();
      expect(ids()).not.toContain(id);
      if (close)
        ui.session.dispatch({
          type: "close-tab",
          tabId: ui.session.capture().address!.tabId,
        });
      else await ui.coordinator.open({ kind: "empty" });
      await settleViews();
      expect(ids()).not.toContain(id);
      expect(workspaceChat("garden", id).state.draft).toBe("");
      expect(
        vi
          .mocked(invoke)
          .mock.calls.some(([command]) =>
            [
              "plugin_development_create",
              "ai_create_conversation",
              "ai_run_start",
            ].includes(command),
          ),
      ).toBe(false);
    },
  );
  it("retains file presentation and shared drafts through settings and workspace switches", async () => {
    const wrapper = await mountHost();
    const ui = workspaceUi("garden");
    const source = wrapper.get<HTMLTextAreaElement>(".source-text");
    await source.setValue("# An unsaved planting plan");
    source.element.setSelectionRange(5, 9);
    source.element.scrollTop = 48;
    await source.trigger("select");
    await openNavigation(wrapper);
    await wrapper.get(".settings-action").trigger("click");
    await settleViews();
    expect(wrapper.get(".settings-view").isVisible()).toBe(true);
    expect(wrapper.vm.back()).toBe(true);
    await settleViews();
    const retained = ui.session.state.document;
    expect(wrapper.find(".settings-view").exists()).toBe(false);
    expect(wrapper.get<HTMLTextAreaElement>(".source-text").element.value).toBe(
      "# An unsaved planting plan",
    );
    await wrapper.setProps({
      currentWorkspaceId: "notes",
      workspaceName: "Notes",
    });
    await settleViews();
    expect(
      workspaceUi("notes").session.state.document?.layout.tabs,
    ).toHaveLength(1);
    await wrapper.setProps({
      currentWorkspaceId: "garden",
      workspaceName: "Garden",
    });
    await settleViews();
    expect(workspaceUi("garden")).toBe(ui);
    expect(ui.session.state.document).toEqual(retained);
    const restored = wrapper.get<HTMLTextAreaElement>(".source-text").element;
    expect(restored.value).toBe("# An unsaved planting plan");
    expect(restored.selectionStart).toBe(5);
    expect(restored.selectionEnd).toBe(9);
    expect(restored.scrollTop).toBe(48);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(
          ([command, args]) =>
            command === "layout_load" &&
            (args as { workspaceId: string }).workspaceId === "garden",
        ),
    ).toHaveLength(1);
  });
  it.each([
    { data: { version: 99 }, error: "layoutHost.unsupportedStoredLayout" },
    { data: { version: 1 }, error: "layoutHost.invalidStoredLayout" },
    { data: null, error: "native.layout.storage.failed" },
  ])(
    "keeps a blocking layout failure on the error screen with retry and workspace exits ($error)",
    async ({ data, error }) => {
      const invokeNormally = vi.mocked(invoke).getMockImplementation()!;
      let blocked = true;
      vi.mocked(invoke).mockImplementation(async (command, args) => {
        if (command === "layout_load" && blocked) {
          if (data === null) throw new Error(error);
          return { revision: "unreadable", data: structuredClone(data) };
        }
        return invokeNormally(command, args);
      });
      const wrapper = await mountHost();
      const screen = wrapper.get(".situate-error-screen");
      expect(screen.text()).toContain(`⟦${error}⟧`);
      expect(screen.get("h2").element).toBe(document.activeElement);
      expect(wrapper.find("dialog.error-dialog[open]").exists()).toBe(false);
      expect(wrapper.find(".layout-notice").exists()).toBe(false);
      expect(wrapper.find(".topic-window").exists()).toBe(false);
      await screen.trigger("keydown", { key: "Escape" });
      expect(wrapper.find(".situate-error-screen").exists()).toBe(true);
      await hostButton(wrapper, "⟦layoutHost.retry⟧").trigger("click");
      await settleViews();
      expect(wrapper.get(".situate-error-screen").text()).toContain(
        `⟦${error}⟧`,
      );
      await hostButton(wrapper, "⟦errorRecovery.workspaces⟧").trigger("click");
      expect(wrapper.emitted("workspaces")).toHaveLength(1);
      expect(wrapper.vm.back()).toBe(true);
      expect(wrapper.emitted("workspaces")).toHaveLength(2);
      expect(workspaceUi("garden").session.state.document).toBeNull();
      expect(
        vi
          .mocked(invoke)
          .mock.calls.filter(([command]) => command === "layout_save"),
      ).toHaveLength(0);

      blocked = false;
      await hostButton(wrapper, "⟦layoutHost.retry⟧").trigger("click");
      await settleViews();
      expect(wrapper.find(".situate-error-screen").exists()).toBe(false);
      expect(wrapper.find(".topic-window").exists()).toBe(true);
    },
  );

  it("presents an oversized layout save in a dismissible error dialog and retains pending state for retry", async () => {
    const wrapper = await mountHost();
    const ui = workspaceUi("garden");
    const saved = structuredClone(stored.get("garden")!);
    const invokeNormally = vi.mocked(invoke).getMockImplementation()!;
    let blocked = true;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "layout_save" && blocked)
        throw new Error("native.layout.storage.tooLarge");
      return invokeNormally(command, args);
    });
    await wrapper.get(".new-tab").trigger("click");
    const pending = ui.session.state.document;
    await expect(ui.session.flush()).rejects.toThrow(
      "native.layout.storage.tooLarge",
    );
    await settleViews();
    expect(wrapper.get("dialog.error-dialog[open]").text()).toContain(
      "⟦native.layout.storage.tooLarge⟧",
    );
    expect(wrapper.get(".layout-notice").text()).toBe("⟦errorRecovery.review⟧");
    await hostButton(wrapper, "⟦errorRecovery.dismiss⟧").trigger("click");
    expect(wrapper.find("dialog.error-dialog[open]").exists()).toBe(false);
    expect(ui.session.state.document).toBe(pending);
    expect(ui.session.state.dirty).toBe(true);
    expect(stored.get("garden")).toEqual(saved);

    await hostButton(wrapper, "⟦errorRecovery.review⟧").trigger("click");
    await wrapper.get("dialog.error-dialog[open]").trigger("cancel");
    expect(wrapper.find("dialog.error-dialog[open]").exists()).toBe(false);
    await hostButton(wrapper, "⟦errorRecovery.review⟧").trigger("click");
    expect(wrapper.vm.back()).toBe(true);
    await nextTick();
    expect(wrapper.find("dialog.error-dialog[open]").exists()).toBe(false);

    await hostButton(wrapper, "⟦errorRecovery.review⟧").trigger("click");
    await hostButton(wrapper, "⟦layoutHost.retry⟧").trigger("click");
    await settleViews();
    expect(wrapper.get("dialog.error-dialog[open]").text()).toContain(
      "⟦native.layout.storage.tooLarge⟧",
    );
    expect(ui.session.state.document).toBe(pending);
    blocked = false;
    await hostButton(wrapper, "⟦layoutHost.retry⟧").trigger("click");
    await settleViews();
    expect(wrapper.find("dialog.error-dialog[open]").exists()).toBe(false);
    expect(wrapper.find(".layout-notice").exists()).toBe(false);
    expect(ui.session.state.dirty).toBe(false);
    expect(stored.get("garden")?.data?.layout.tabs).toHaveLength(
      saved.data!.layout.tabs.length + 1,
    );
  });

  it("flushes layout state and restores it after the workspace UI is released and reopened", async () => {
    const wrapper = await mountHost();
    const ui = workspaceUi("garden");
    const source = wrapper.get<HTMLTextAreaElement>(".source-text");
    source.element.setSelectionRange(4, 7);
    source.element.scrollTop = 36;
    await source.trigger("select");
    ui.session.dispatch({
      type: "rename-tab",
      tabId: "garden-tab",
      name: "Spring planting",
    });
    await ui.session.flush();
    const saved = structuredClone(stored.get("garden")!.data);
    wrapper.unmount();
    retainWorkspaceUi([]);
    const reopened = await mountHost();
    expect(workspaceUi("garden")).not.toBe(ui);
    expect(workspaceUi("garden").session.state.document).toEqual(saved);
    expect(reopened.get('[role="tab"][aria-selected="true"]').text()).toBe(
      "Spring planting",
    );
    const restored = reopened.get<HTMLTextAreaElement>(".source-text").element;
    expect(restored.selectionStart).toBe(4);
    expect(restored.selectionEnd).toBe(7);
    expect(restored.scrollTop).toBe(36);
    expect(
      vi.mocked(invoke).mock.calls.some(([command]) => command === "ai_begin"),
    ).toBe(false);
  });
  it("routes sidebar conversation navigation into the focused pane and restores file state with Back", async () => {
    const wrapper = await mountHost();
    const ui = workspaceUi("garden");
    await openNavigation(wrapper);
    await hostButton(wrapper, "Garden chat").trigger("click");
    await settleViews();
    expect(wrapper.find(".chat-pane").exists()).toBe(true);
    expect(
      currentEntry(
        ui.session.state.document!.layout.tabs[0]!.panes[0]!.navigation,
      ).target,
    ).toEqual({ kind: "conversation", conversationId: "legacy" });
    expect(document.activeElement).toBe(
      wrapper.get('[role="tab"][aria-selected="true"]').element,
    );
    expect(wrapper.vm.back()).toBe(true);
    await settleViews();
    expect(
      wrapper.get<HTMLTextAreaElement>(".source-text").element.selectionStart,
    ).toBe(3);
    expect(
      wrapper.get<HTMLTextAreaElement>(".source-text").element.selectionEnd,
    ).toBe(6);
    expect(wrapper.emitted("closeWorkspace")).toBeUndefined();
  });
  it("restores the same pane's file and folder state through the Files sidebar", async () => {
    const wrapper = await mountHost();
    const source = wrapper.get<HTMLTextAreaElement>(".source-text");
    source.element.setSelectionRange(4, 7);
    await source.trigger("select");
    await hostButton(wrapper, "⟦files.expandFileBrowser⟧").trigger("click");
    await hostButton(wrapper, "Notes").trigger("click");
    expect(hostButton(wrapper, "Notes").attributes("aria-expanded")).toBe(
      "true",
    );
    await openNavigation(wrapper);
    await hostButton(wrapper, "Garden chat").trigger("click");
    await settleViews();
    await openNavigation(wrapper);
    await hostButton(wrapper, "⟦navigation.files⟧").trigger("click");
    await settleViews();
    expect(wrapper.get(".document-location h3").text()).toBe("Garden.md");
    expect(
      wrapper.get<HTMLTextAreaElement>(".source-text").element.selectionStart,
    ).toBe(4);
    expect(hostButton(wrapper, "Notes").attributes("aria-expanded")).toBe(
      "true",
    );
    await workspaceUi("garden").session.flush();
    wrapper.unmount();
    retainWorkspaceUi([]);
    const reopened = await mountHost();
    expect(reopened.get(".document-location h3").text()).toBe("Garden.md");
    expect(hostButton(reopened, "Notes").attributes("aria-expanded")).toBe(
      "true",
    );
  });
  it("closing panes and tabs retains shared running chat state and never closes the workspace", async () => {
    stored.delete("garden");
    const wrapper = await mountHost();
    const ui = workspaceUi("garden");
    ui.session.dispatch({
      type: "open",
      target: { kind: "conversation", conversationId: "legacy" },
    });
    const tab = ui.session.state.document!.layout.tabs[0]!;
    ui.session.dispatch({
      type: "split",
      tabId: tab.id,
      paneId: tab.activePaneId,
      edge: "right",
    });
    await settleViews();
    const expanded = ui.session.state.document!.layout.tabs[0]!;
    const other = expanded.activePaneId;
    ui.session.dispatch({
      type: "open",
      target: { kind: "view", viewId: "files" },
      destination: { tabId: tab.id, paneId: tab.activePaneId },
    });
    ui.session.dispatch({
      type: "open",
      target: { kind: "conversation", conversationId: "legacy" },
      destination: { tabId: tab.id, paneId: other },
    });
    ui.session.dispatch({
      type: "history",
      tabId: tab.id,
      paneId: tab.activePaneId,
      delta: -1,
    });
    await settleViews();
    expect(wrapper.findAll(".chat-pane")).toHaveLength(2);
    const chat = workspaceChat("garden", "legacy");
    const shared = chat.state;
    shared.running = true;
    await settleViews();
    await wrapper.get(`[data-pane="${other}"] .pane-title`).trigger("click");
    await hostButton(wrapper, "⟦layoutUi.closePane⟧").trigger("click");
    await settleViews();
    expect(ui.session.state.document!.layout.tabs[0]!.panes).toHaveLength(1);
    expect(workspaceChat("garden", "legacy").state).toBe(shared);
    expect(shared.running).toBe(true);
    ui.session.dispatch({ type: "new-tab" });
    await settleViews();
    expect(ui.session.state.document!.layout.tabs).toHaveLength(2);
    await hostButton(wrapper, "⟦layoutUi.tabOptions⟧").trigger("click");
    await hostButton(wrapper, "⟦layoutUi.closeAllTabs⟧").trigger("click");
    await settleViews();
    expect(ui.session.state.document!.layout.tabs).toHaveLength(1);
    expect(wrapper.find(".view-chooser").exists()).toBe(true);
    expect(workspaceChat("garden", "legacy").state).toBe(shared);
    expect(shared.running).toBe(true);
    expect(wrapper.emitted("closeWorkspace")).toBeUndefined();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) =>
          ["ai_abort", "ai_end", "workspace_action"].includes(command),
        ),
    ).toBe(false);
    await hostButton(wrapper, "⟦layoutUi.tabOptions⟧").trigger("click");
    await hostButton(wrapper, "⟦layoutUi.reopenTab⟧").trigger("click");
    await settleViews();
    expect(wrapper.find(".chat-pane").exists()).toBe(true);
    expect(ui.session.state.document!.layout.tabs[0]!.id).toBe(tab.id);
    expect(shared.running).toBe(true);
    shared.running = false;
  });
});

describe("empty chat", () => {
  it("retains its greeting without replaying when the pane is restored", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const wrapper = mount(ChatPane);
    await nextTick();
    expect(wrapper.get("h2 .sr-only").text()).toBe("⟦chat.greetingSpace⟧");
    wrapper.unmount();
    const presentation = wrapper
      .emitted("presentation")!
      .at(-1)![0] as PresentationValue;
    random.mockReturnValue(0);
    const restored = mount(ChatPane, { props: { presentation } });
    await nextTick();
    expect(restored.get("h2 .sr-only").text()).toBe("⟦chat.greetingSpace⟧");
    expect(restored.get(".greeting").attributes("data-state")).toBe("done");
    restored.unmount();
    random.mockRestore();
  });
  it("labels the pane and read-only message field and disables product actions", () => {
    const wrapper = mount(ChatPane, {
      props: { navigationId: "workspace-navigation", navigationOpen: false },
    });
    const title = wrapper.get("h1");
    const input = wrapper.get("textarea");

    expect(title.text()).toBe("⟦navigation.newChat⟧");
    expect(wrapper.get("main").attributes("aria-labelledby")).toBe(
      title.attributes("id"),
    );
    expect(wrapper.get("h2 .sr-only").text()).toMatch(
      /^⟦(?:navigation.goodToSeeYou|chat.greeting\w+)⟧$/,
    );
    expect(input.element.readOnly).toBe(true);
    expect(wrapper.get("label").attributes("for")).toBe(input.attributes("id"));
    expect(input.attributes("aria-describedby")).toBeUndefined();
    expect(wrapper.text()).not.toContain("⟦navigation.messagingIsUnavailable⟧");
    for (const name of [
      "⟦navigation.sendMessage⟧",
      "⟦navigation.dictateText⟧",
      "⟦navigation.splitPane⟧",
      "⟦navigation.closePane⟧",
    ]) {
      expect(
        wrapper.get<HTMLButtonElement>(`button[aria-label="${name}"]`).element
          .disabled,
      ).toBe(true);
    }
    expect(
      wrapper.get<HTMLButtonElement>(".attach-action").element.disabled,
    ).toBe(true);
    expect(wrapper.get(".welcome-bend").attributes("aria-hidden")).toBe("true");
  });

  it("connects navigation to its dialog and emits the opening action", async () => {
    const wrapper = mount(ChatPane, {
      props: { navigationId: "workspace-navigation", navigationOpen: false },
    });
    const trigger = wrapper.get<HTMLButtonElement>(
      'button[aria-label="⟦navigation.openNavigation⟧"]',
    );
    expect(trigger.attributes("aria-controls")).toBe("workspace-navigation");
    expect(trigger.attributes("aria-haspopup")).toBe("dialog");
    expect(trigger.attributes("aria-expanded")).toBe("false");
    trigger.element.click();
    expect(wrapper.emitted("openNavigation")).toHaveLength(1);

    await wrapper.setProps({ navigationOpen: true });
    expect(trigger.attributes("aria-expanded")).toBe("true");
  });
});

describe("sidebar", () => {
  it.each([false, true])(
    "shows unavailable destinations and an empty history (drawer: %s)",
    (drawer) => {
      const wrapper = mount(AppSidebar, { props: { drawer } });
      expect(wrapper.get("nav").attributes("aria-label")).toBe(
        "⟦navigation.workspaceNavigation⟧",
      );
      expect(wrapper.get("img").attributes("alt")).toBe("⟦navigation.situate⟧");
      expect(wrapper.text()).toContain("⟦navigation.noConversationsYet⟧");
      expect(wrapper.find(".more-views").exists()).toBe(false);
      for (const name of [
        "⟦navigation.myDay⟧",
        "⟦navigation.calendar⟧",
        "⟦navigation.tasks⟧",
        "⟦navigation.notes⟧",
        "⟦navigation.plugins⟧",
        "⟦navigation.settings⟧",
      ]) {
        const button = wrapper
          .findAll("button")
          .find((button) => button.text() === name);
        expect(button, name).toBeDefined();
        expect(button!.element.disabled, name).toBe(true);
        expect(button!.attributes("aria-description"), name).toBeTruthy();
      }

      const close = wrapper.find<HTMLButtonElement>(
        'button[aria-label="⟦navigation.closeNavigation⟧"]',
      );
      expect(close.exists()).toBe(drawer);
      if (drawer) {
        close.element.click();
        expect(wrapper.emitted("close")).toHaveLength(1);
      } else {
        const collapse = wrapper.get<HTMLButtonElement>(
          'button[aria-label="⟦navigation.collapseSidebar⟧"]',
        );
        expect(collapse.element.disabled).toBe(false);
        collapse.element.click();
        expect(wrapper.emitted("collapse")).toHaveLength(1);
      }
    },
  );
});

describe("active file navigation", () => {
  it("marks Files after Notes and does not duplicate desktop workspace information", async () => {
    const wrapper = mount(AppSidebar, {
      props: { filesActive: true, workspaceName: "Garden notes" },
    });
    expect(
      wrapper.findAll(".nav-destination").map((button) => button.text()),
    ).toEqual([
      "⟦navigation.myDay⟧",
      "⟦navigation.calendar⟧",
      "⟦navigation.tasks⟧",
      "⟦navigation.notes⟧",
      "⟦navigation.files⟧",
    ]);
    const files = wrapper.get('.nav-destination[aria-current="page"]');
    expect(files.text()).toBe("⟦navigation.files⟧");
    expect(wrapper.find(".workspace-name").exists()).toBe(false);
    await files.trigger("click");
    expect(wrapper.emitted("files")).toHaveLength(1);
    await wrapper.setProps({ filesActive: false });
    expect(wrapper.find('[aria-current="page"]').exists()).toBe(false);
    await wrapper.setProps({ drawer: true });
    expect(wrapper.get(".workspace-name").text()).toBe("Garden notes");
  });
});

describe("shared icon button", () => {
  it("is a named non-submit action and hides its decorative icon", () => {
    const onClick = vi.fn();
    const wrapper = mount(SituateIconButton, {
      props: { icon: "close", label: "⟦navigation.closeNavigation⟧" },
      attrs: { onClick },
    });
    const button = wrapper.get("button");
    expect(button.attributes("type")).toBe("button");
    expect(button.attributes("aria-label")).toBe(
      "⟦navigation.closeNavigation⟧",
    );
    expect(button.attributes("title")).toBeUndefined();
    expect(wrapper.getComponent(SituateTooltip).props("text")).toBe(
      "⟦navigation.closeNavigation⟧",
    );
    expect(wrapper.get("svg").attributes("aria-hidden")).toBe("true");

    button.element.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("blocks disabled actions and removes the unavailable description when enabled", async () => {
    const onClick = vi.fn();
    const wrapper = mount(SituateIconButton, {
      props: {
        icon: "arrow",
        label: "⟦navigation.sendMessage⟧",
        disabled: true,
        unavailableReason: "⟦navigation.messagingIsUnavailable⟧",
      },
      attrs: { onClick },
    });
    const button = wrapper.get("button");
    expect(button.element.disabled).toBe(true);
    expect(button.attributes("aria-description")).toBe(
      "⟦navigation.messagingIsUnavailable⟧",
    );
    expect(wrapper.getComponent(SituateTooltip).props("text")).toBe(
      "⟦navigation.messagingIsUnavailable⟧",
    );
    button.element.click();
    expect(onClick).not.toHaveBeenCalled();

    await wrapper.setProps({ disabled: false });
    expect(button.attributes("aria-description")).toBeUndefined();
    expect(wrapper.getComponent(SituateTooltip).props("text")).toBe(
      "⟦navigation.sendMessage⟧",
    );
    button.element.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
