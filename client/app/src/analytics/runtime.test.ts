import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { trackDailyActivity } from "./runtime";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

test("qualifies foreground interactions and reports a new UTC day without remounting", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-01T23:59:59Z"));
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const stop = vi.fn();
  vi.mocked(listen).mockResolvedValue(stop);
  vi.mocked(invoke).mockResolvedValueOnce(true).mockResolvedValue(undefined);
  let scope: string | null = "workspace-a";
  const view = mount(
    defineComponent({
      setup() {
        trackDailyActivity(() => scope);
        return () => h("div");
      },
    }),
  );
  try {
    await flushPromises();
    const activity = add.mock.calls.find(
      ([name]) => name === "click",
    )?.[1] as EventListener;
    const interact = (trusted = true) =>
      activity({ isTrusted: trusted } as Event);
    const change = vi.mocked(listen).mock.calls[0]![1];
    const deliveries = () =>
      vi
        .mocked(invoke)
        .mock.calls.filter(
          ([command]) => command === "analytics_daily_activity",
        );
    expect(deliveries()).toEqual([]);
    interact(false);
    focus.mockReturnValue(false);
    interact();
    expect(deliveries()).toEqual([]);
    focus.mockReturnValue(true);
    interact();
    interact();
    expect(deliveries()).toEqual([
      ["analytics_daily_activity", { scope: "workspace-a" }],
    ]);

    scope = null;
    vi.setSystemTime(new Date("2026-05-02T00:00:01Z"));
    expect(deliveries()).toHaveLength(1);
    interact();
    expect(deliveries()).toHaveLength(2);
    expect(deliveries()[1]).toEqual([
      "analytics_daily_activity",
      { scope: null },
    ]);

    change({ event: "analytics-preference-changed", id: 1, payload: false });
    vi.setSystemTime(new Date("2026-05-03T00:00:01Z"));
    interact();
    expect(deliveries()).toHaveLength(2);
    view.unmount();
    expect(stop).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("click", activity, true);
  } finally {
    if (!stop.mock.calls.length) view.unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
