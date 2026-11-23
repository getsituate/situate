import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import {
  defineComponent,
  h,
  markRaw,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  type Component,
} from "vue";
import ViewHost from "./ViewHost.vue";
import { closeChats, saveChatDrafts, workspaceConversations } from "../ai/chat";
import { workspaceUi, retainWorkspaceUi, type WorkspaceUi } from "./runtime";
import type { Pane, TopicTab } from "./model";
import { acceptRecoveryState } from "../recovery";

const diagnostics = vi.hoisted(() => ({ emit: vi.fn(), resolve: vi.fn() }));
vi.mock("../diagnostics", () => ({
  diagnosticsFor: diagnostics.resolve,
}));
afterEach(() => {
  vi.clearAllMocks();
  retainWorkspaceUi([]);
  closeChats([]);
});
function conversationDefinition(component: Component) {
  return {
    ...workspaceUi("workspace").registry.definitions.get("conversation")!,
    component,
  };
}

it.each([
  ["⟦recovery.manage⟧", undefined],
  ["⟦pluginManagement.inspect⟧", "reading"],
] as const)(
  "opens %s from a suspended plugin in the same pane",
  async (label, contentId) => {
    const pane: Pane = {
      id: "pane",
      navigation: {
        cursor: 0,
        entries: [
          {
            id: "entry",
            target: { kind: "view", viewId: "reading:list" },
            presentation: null,
          },
        ],
      },
    };
    const tab = { id: "tab" } as TopicTab;
    const open = vi.fn(async () => true);
    acceptRecoveryState({ revision: 0, recovery: true, resumed: [] });
    const wrapper = mount(ViewHost, {
      props: {
        ui: {
          session: {
            workspaceId: "workspace",
            capture: (address: unknown) => ({ address }),
            state: { document: null },
          },
          registry: { definitions: new Map(), browsableViews: [] },
          coordinator: { open },
          plugins: Promise.resolve({
            state: { plugins: [{ id: "reading", enabled: true }] },
          }),
        } as unknown as WorkspaceUi,
        pane,
        tab,
        workspaceName: "Workspace",
      },
    });
    try {
      await flushPromises();
      const action = wrapper
        .findAll("button")
        .find((button) => button.text() === label);
      expect(action).toBeDefined();
      await action!.trigger("click");
      expect(open).toHaveBeenCalledWith(
        {
          kind: "view",
          viewId: "plugins",
          ...(contentId ? { contentId } : {}),
        },
        expect.objectContaining({
          address: { tabId: tab.id, paneId: pane.id },
        }),
        undefined,
        undefined,
      );
    } finally {
      wrapper.unmount();
      acceptRecoveryState({ revision: 0, recovery: false, resumed: [] });
    }
  },
);

it("renders temporary chats with conversation props and preserves the mounted pane on promotion", async () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const component = markRaw(
    defineComponent({
      props: [
        "workspaceScope",
        "conversationId",
        "presentation",
        "navigationId",
        "navigationOpen",
      ],
      setup(props) {
        onMounted(mounted);
        onUnmounted(unmounted);
        return () => h("div", props.conversationId);
      },
    }),
  );
  const pane: Pane = {
    id: "pane",
    navigation: {
      cursor: 0,
      entries: [
        {
          id: "entry",
          target: { kind: "new-conversation", conversationId: "same-id" },
          presentation: { scrollTop: 24 },
        },
      ],
    },
  };
  const ui = {
    session: {
      workspaceId: "workspace",
      capture: () => ({}),
      state: { document: null },
    },
    registry: {
      definitions: new Map([
        ["conversation", conversationDefinition(component)],
      ]),
    },
  } as unknown as WorkspaceUi;
  const wrapper = mount(ViewHost, {
    props: {
      ui,
      pane,
      tab: { id: "tab" } as TopicTab,
      workspaceName: "Workspace",
    },
  });
  try {
    await flushPromises();
    expect(wrapper.findComponent(component).props()).toEqual({
      workspaceScope: "workspace",
      conversationId: "same-id",
      presentation: { scrollTop: 24 },
      navigationId: "",
      navigationOpen: false,
    });
    workspaceConversations("workspace").state.conversations = [
      { id: "same-id", title: "Garden", revision: 1 },
    ];
    await wrapper.setProps({
      pane: {
        ...pane,
        navigation: {
          ...pane.navigation,
          entries: [
            {
              ...pane.navigation.entries[0]!,
              target: { kind: "conversation", conversationId: "same-id" },
            },
          ],
        },
      },
    });
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    expect(wrapper.findComponent(component).props("conversationId")).toBe(
      "same-id",
    );
  } finally {
    wrapper.unmount();
  }
});

it("waits for inventory before mounting a retained target and leaves no missing session to flush", async () => {
  const mounted = vi.fn();
  const component = markRaw(
    defineComponent({
      setup() {
        onMounted(mounted);
        return () => h("div", "Conversation");
      },
    }),
  );
  const pane: Pane = {
    id: "pane",
    navigation: {
      cursor: 0,
      entries: [
        {
          id: "entry",
          target: { kind: "conversation", conversationId: "deleted" },
          presentation: null,
        },
      ],
    },
  };
  const ui = {
    session: {
      workspaceId: "workspace",
      capture: () => ({}),
      state: { document: null },
    },
    registry: {
      definitions: new Map([
        ["conversation", conversationDefinition(component)],
      ]),
    },
  } as unknown as WorkspaceUi;
  const wrapper = mount(ViewHost, {
    props: {
      ui,
      pane,
      tab: { id: "tab" } as TopicTab,
      workspaceName: "Workspace",
    },
  });
  try {
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain(
      "⟦layoutHost.loading⟧",
    );
    expect(mounted).not.toHaveBeenCalled();
    const inventory = workspaceConversations("workspace").state;
    inventory.error = "ai.aiAccessOrConversationHistoryCouldNotBeRead";
    await flushPromises();
    expect(wrapper.get("button").text()).toBe("⟦layoutHost.retry⟧");
    inventory.error = "";
    inventory.loaded = true;
    await flushPromises();
    expect(wrapper.get(".view-chooser").text()).toContain(
      "⟦layoutHost.chooserTitle⟧",
    );
    expect(mounted).not.toHaveBeenCalled();
    await expect(saveChatDrafts("workspace")).resolves.toBeUndefined();
  } finally {
    wrapper.unmount();
  }
});
it("shows the new-tab chooser for an unavailable conversation target", async () => {
  const component = markRaw(
    defineComponent({ render: () => h("div", "Conversation content") }),
  );
  const pane: Pane = {
    id: "pane",
    navigation: {
      cursor: 0,
      entries: [
        {
          id: "entry",
          target: { kind: "conversation", conversationId: "garden" },
          presentation: null,
        },
      ],
    },
  };
  const inventory = workspaceConversations("workspace").state;
  inventory.conversations = [{ id: "garden", title: "Garden", revision: 1 }];
  inventory.loaded = true;
  const ui = {
    session: {
      workspaceId: "workspace",
      capture: () => ({}),
      state: { document: null },
    },
    registry: {
      definitions: new Map([
        ["conversation", conversationDefinition(component)],
      ]),
    },
  } as unknown as WorkspaceUi;
  const wrapper = mount(ViewHost, {
    props: {
      ui,
      pane,
      tab: { id: "tab" } as TopicTab,
      workspaceName: "Workspace",
    },
  });
  try {
    await flushPromises();
    expect(wrapper.findComponent(component).exists()).toBe(true);
    inventory.conversations = [];
    await flushPromises();
    expect(wrapper.findComponent(component).exists()).toBe(false);
    expect(wrapper.get(".view-chooser").text()).toContain(
      "⟦layoutHost.chooserTitle⟧",
    );
    await wrapper.get(".new-conversation").trigger("click");
    expect(wrapper.emitted("newConversation")).toHaveLength(1);
    const chooser = wrapper.get(".view-chooser").html();
    await wrapper.setProps({
      pane: {
        ...pane,
        navigation: {
          cursor: 0,
          entries: [
            { id: "empty", target: { kind: "empty" }, presentation: null },
          ],
        },
      },
    });
    expect(wrapper.get(".view-chooser").html()).toBe(chooser);
  } finally {
    wrapper.unmount();
  }
});
it("retains an unmounting view's presentation on its own history entry", async () => {
  const dispatch = vi.fn();
  const component = markRaw(
    defineComponent({
      emits: ["presentation"],
      setup(_, { emit }) {
        onBeforeUnmount(() => emit("presentation", { scrollTop: 25 }));
        return () => h("div", "File");
      },
    }),
  );
  const pane: Pane = {
    id: "pane",
    navigation: {
      cursor: 0,
      entries: [
        {
          id: "first",
          target: { kind: "view", viewId: "files", contentId: "first.md" },
          presentation: null,
        },
        {
          id: "second",
          target: { kind: "view", viewId: "files", contentId: "second.md" },
          presentation: null,
        },
      ],
    },
  };
  const ui = {
    session: {
      workspaceId: "workspace",
      capture: () => ({}),
      current: () => true,
      dispatch,
      state: { document: null },
    },
    registry: { definitions: new Map([["files", { id: "files", component }]]) },
  } as unknown as WorkspaceUi;
  const wrapper = mount(ViewHost, {
    props: {
      ui,
      pane,
      tab: { id: "tab" } as TopicTab,
      workspaceName: "Workspace",
    },
  });
  await flushPromises();
  await wrapper.setProps({
    pane: { ...pane, navigation: { ...pane.navigation, cursor: 1 } },
  });
  await flushPromises();
  expect(dispatch).toHaveBeenCalledWith({
    type: "retain-presentation",
    tabId: "tab",
    paneId: "pane",
    entryId: "first",
    presentation: { scrollTop: 25 },
  });
  wrapper.unmount();
});

it("logs a consumed view failure in its workspace and retains the fallback", async () => {
  diagnostics.resolve.mockReturnValue({ emit: diagnostics.emit });
  const pane: Pane = {
    id: "pane",
    navigation: {
      cursor: 0,
      entries: [
        {
          id: "entry",
          target: { kind: "view", viewId: "broken" },
          presentation: null,
        },
      ],
    },
  };
  const ui = {
    session: {
      workspaceId: "PRIVATE_SCOPE",
      capture: () => ({}),
      state: { document: null },
    },
    registry: {
      definitions: new Map([
        [
          "broken",
          {
            id: "broken",
            component: defineComponent({
              setup() {
                const fail = (): never => {
                  throw new Error("PRIVATE_SENTINEL");
                };
                return () => fail();
              },
            }),
          },
        ],
      ]),
    },
  } as unknown as WorkspaceUi;
  const globalHandler = vi.fn();
  const wrapper = mount(ViewHost, {
    props: {
      ui,
      pane,
      tab: { id: "tab" } as TopicTab,
      workspaceName: "PRIVATE_SENTINEL",
    },
    global: { config: { errorHandler: globalHandler } },
  });
  try {
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("layoutHost.viewFailed");
    expect(globalHandler).not.toHaveBeenCalled();
    expect(diagnostics.resolve).toHaveBeenCalledWith("PRIVATE_SCOPE");
    expect(diagnostics.emit).toHaveBeenCalledExactlyOnceWith(
      "runtime.failed",
      "ui",
      { boundary: "view", error_code: "unknown" },
      undefined,
      "error",
    );
    expect(JSON.stringify(diagnostics.emit.mock.calls)).not.toContain(
      "PRIVATE_SENTINEL",
    );
  } finally {
    wrapper.unmount();
  }
});
