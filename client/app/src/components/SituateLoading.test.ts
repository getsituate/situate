import { afterEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { SituateLoading } from "@situate/ui";

afterEach(() => vi.useRealTimers());

it("skips fast operations and clears a visible wait immediately", async () => {
  vi.useFakeTimers();
  const wrapper = mount(SituateLoading, {
    props: { pending: true, label: "Opening conversation…" },
  });
  const status = wrapper.get('[role="status"]');
  try {
    await vi.advanceTimersByTimeAsync(199);
    expect(status.text()).toBe("");
    await wrapper.setProps({ pending: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(status.text()).toBe("");

    await wrapper.setProps({ pending: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(status.text()).toBe("Opening conversation…");
    expect(status.get("svg").attributes("aria-hidden")).toBe("true");
    await wrapper.setProps({ pending: false });
    expect(status.text()).toBe("");
  } finally {
    wrapper.unmount();
  }
});
