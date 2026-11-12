import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  bindCoordinator,
  createUiCoordinator,
  createViewRegistry,
} from "../layout/registry";
import { createLayoutSession } from "../layout/session";
import { emptyLayout } from "../layout/model";
import { announcePluginActivation } from "./activation";
const mocks = vi.hoisted(() => ({
  plugins: vi.fn(),
  chat: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../layout/runtime", () => ({ workspacePlugins: mocks.plugins }));
vi.mock("../ai/chat", () => ({ workspaceChat: mocks.chat }));
let disposeNavigation: () => void;
beforeEach(async () => {
  vi.clearAllMocks();
  const session = createLayoutSession("workspace", {
    load: async () => ({
      revision: "1",
      data: { version: 1, layout: emptyLayout(), pinnedViews: [] },
    }),
    save: async (_workspace, _revision, data) => ({ revision: "2", data }),
  });
  await session.load();
  const registry = createViewRegistry("workspace");
  registry.register({
    id: "conversation",
    title: () => "Chat",
    icon: "chat",
    component: { render: () => null },
  });
  const coordinator = createUiCoordinator(session, registry);
  const unbind = bindCoordinator(coordinator);
  await coordinator.open({
    kind: "conversation",
    conversationId: "development",
  });
  const before = JSON.parse(JSON.stringify(session.state.document!.layout));
  const open = vi.spyOn(coordinator, "open");
  const reveal = vi.spyOn(coordinator, "reveal");
  disposeNavigation = () => {
    try {
      expect(open).not.toHaveBeenCalled();
      expect(reveal).not.toHaveBeenCalled();
      expect(session.state.document!.layout).toEqual(before);
    } finally {
      unbind();
      session.dispose();
    }
  };
  mocks.chat.mockReturnValue({ notifyPluginAvailable: mocks.notify });
  mocks.notify.mockResolvedValue(undefined);
});
afterEach(() => disposeNavigation());
function runtime(status = "loaded") {
  const value = {
    ready: Promise.resolve(),
    refresh: vi.fn().mockResolvedValue(undefined),
    state: {
      plugins: [{ id: "reading", status, manifest: { name: "Reading list" } }],
    },
  };
  mocks.plugins.mockResolvedValue(value);
  return value;
}
test("refreshes availability before notifying only the originating workspace conversation", async () => {
  const active = runtime();
  await announcePluginActivation(
    "workspace",
    "reading",
    "origin",
    "run",
    () => true,
  );
  expect(active.refresh).toHaveBeenCalledExactlyOnceWith("reading");
  expect(mocks.chat).toHaveBeenCalledExactlyOnceWith("workspace", "origin");
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(
    { pluginId: "reading", pluginName: "Reading list" },
    "run",
  );
});
test("direct development does not fabricate an originating conversation", async () => {
  runtime();
  await announcePluginActivation(
    "workspace",
    "reading",
    undefined,
    "run",
    () => true,
  );
  expect(mocks.chat).not.toHaveBeenCalled();
});
test.each(["failed", "disabled", "suppressed"])(
  "does not report %s code as available",
  async (status) => {
    runtime(status);
    await expect(
      announcePluginActivation(
        "workspace",
        "reading",
        "origin",
        "run",
        () => true,
      ),
    ).rejects.toThrow("plugins.activationLoadFailed");
    expect(mocks.notify).not.toHaveBeenCalled();
  },
);
test("a closed workspace cannot deliver a late availability notice", async () => {
  const active = runtime();
  let current = true;
  active.refresh.mockImplementation(async () => {
    current = false;
  });
  await expect(
    announcePluginActivation(
      "workspace",
      "reading",
      "origin",
      "run",
      () => current,
    ),
  ).rejects.toThrow("plugins.workspaceUnavailable");
  expect(mocks.chat).not.toHaveBeenCalled();
});
test("a notice storage failure remains observable after successful runtime refresh", async () => {
  runtime();
  mocks.notify.mockRejectedValue(new Error("storage failed"));
  await expect(
    announcePluginActivation(
      "workspace",
      "reading",
      "origin",
      "run",
      () => true,
    ),
  ).rejects.toThrow("storage failed");
  expect(mocks.notify).toHaveBeenCalledOnce();
});
