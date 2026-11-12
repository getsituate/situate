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
                entries: [{ path: "Notes/Garden.md", isDirectory: false }],
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
  it("opens Plugins independently from Settings and returns to the retained workspace", async () => {
    const wrapper = await mountHost();
    const layout = structuredClone(
      workspaceUi("garden").session.state.document,
    );
    const management = await openManagement(wrapper);
    expect(management.props("scope")).toBe("garden");
    expect(wrapper.find(".settings-view").exists()).toBe(false);
    expect(wrapper.find(".topic-window").exists()).toBe(false);
    expect(wrapper.getComponent(AppSidebar).props()).toMatchObject({
      pluginsActive: true,
      settingsActive: false,
      filesActive: false,
      activeView: undefined,
    });
    expect(workspaceUi("garden").session.state.document).toEqual(layout);
    expect(wrapper.vm.back()).toBe(true);
    await settleViews();
    expect(wrapper.find(".management-stub").exists()).toBe(false);
    expect(wrapper.find(".settings-view").exists()).toBe(false);
    expect(wrapper.find(".source-text").exists()).toBe(true);
    expect(workspaceUi("garden").session.state.document).toEqual(layout);
    expect(document.activeElement).toBe(
      wrapper.get(".open-navigation").element,
    );
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
  it("closes plugin inspection when switching workspaces without restoring it implicitly", async () => {
    const wrapper = await mountHost();
    await openManagement(wrapper);
    await wrapper.setProps({ currentWorkspaceId: "notes" });
    await settleViews();
    await wrapper.setProps({ currentWorkspaceId: "garden" });
    await settleViews();
    expect(wrapper.find(".management-stub").exists()).toBe(false);
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
    const retained = ui.session.state.document;
    await openNavigation(wrapper);
    await wrapper.get(".settings-action").trigger("click");
    await settleViews();
    expect(wrapper.get(".settings-view").isVisible()).toBe(true);
    expect(ui.session.state.document).toEqual(retained);
    expect(wrapper.vm.back()).toBe(true);
    await settleViews();
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
