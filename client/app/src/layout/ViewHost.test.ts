import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, markRaw, onMounted, onUnmounted } from "vue";
import ViewHost from "./ViewHost.vue";
import { closeChats, saveChatDrafts, workspaceConversations } from "../ai/chat";
import type { WorkspaceUi } from "./runtime";
import type { Pane, TopicTab } from "./model";

const diagnostics = vi.hoisted(() => ({ emit: vi.fn(), resolve: vi.fn() }));
vi.mock("../diagnostics", () => ({
  diagnosticsFor: diagnostics.resolve,
}));
afterEach(() => {
  vi.clearAllMocks();
  closeChats([]);
});

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
        ["conversation", { id: "conversation", component }],
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
        ["conversation", { id: "conversation", component }],
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
    expect(wrapper.get('[role="status"]').text()).toContain(
      "⟦chat.unavailableTitle⟧",
    );
    expect(mounted).not.toHaveBeenCalled();
    await expect(saveChatDrafts("workspace")).resolves.toBeUndefined();
  } finally {
    wrapper.unmount();
  }
});
it("keeps a deleted conversation target in history and unmounts its view", async () => {
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
  const open = vi.fn(async () => {});
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
        ["conversation", { id: "conversation", component }],
      ]),
    },
    coordinator: { open },
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
    expect(wrapper.get('[role="status"]').text()).toContain(
      "⟦chat.unavailableTitle⟧",
    );
    expect(pane.navigation.entries[0]!.target).toEqual({
      kind: "conversation",
      conversationId: "garden",
    });
    await wrapper.get("button").trigger("click");
    expect(open).toHaveBeenCalledWith(
      { kind: "empty" },
      expect.anything(),
      undefined,
      undefined,
    );
  } finally {
    wrapper.unmount();
  }
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
