import { afterEach, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, markRaw, onMounted, onUnmounted } from "vue";
import ViewHost from "./ViewHost.vue";
import type { WorkspaceUi } from "./runtime";
import type { Pane, TopicTab } from "./model";

const diagnostics = vi.hoisted(() => ({ emit: vi.fn(), resolve: vi.fn() }));
vi.mock("../diagnostics", () => ({
  diagnosticsFor: diagnostics.resolve,
}));
afterEach(() => vi.clearAllMocks());

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
