import "../ui/popover-test-environment";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { SituateIconButton, SituateTooltip } from "../ui";
import AppSidebar from "./AppSidebar.vue";
import ChatPane from "./ChatPane.vue";

enableAutoUnmount(afterEach);

describe("empty chat", () => {
  it("labels the pane and read-only message field and disables product actions", () => {
    const wrapper = mount(ChatPane, {
      props: { navigationId: "workspace-navigation", navigationOpen: false },
    });
    const title = wrapper.get("h1");
    const input = wrapper.get("textarea");

    expect(title.text()).toBe("New chat");
    expect(wrapper.get("main").attributes("aria-labelledby")).toBe(
      title.attributes("id"),
    );
    expect(wrapper.get("h2").text()).toBe("Good to see you.");
    expect(input.element.readOnly).toBe(true);
    expect(wrapper.get("label").attributes("for")).toBe(input.attributes("id"));
    expect(input.attributes("aria-describedby")).toBeUndefined();
    expect(wrapper.text()).not.toContain("Messaging is unavailable.");
    for (const name of [
      "Send message",
      "Dictate text",
      "Split pane",
      "Close pane",
    ]) {
      expect(
        wrapper.get<HTMLButtonElement>(`button[aria-label="${name}"]`).element
          .disabled,
      ).toBe(true);
    }
    expect(
      wrapper.get<HTMLButtonElement>(".attach-action").element.disabled,
    ).toBe(true);
    expect(wrapper.get("img").attributes("alt")).toBe("");
  });

  it("connects navigation to its dialog and emits the opening action", async () => {
    const wrapper = mount(ChatPane, {
      props: { navigationId: "workspace-navigation", navigationOpen: false },
    });
    const trigger = wrapper.get<HTMLButtonElement>(
      'button[aria-label="Open navigation"]',
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
        "Workspace navigation",
      );
      expect(wrapper.get("img").attributes("alt")).toBe("Situate");
      expect(wrapper.text()).toContain("No conversations yet.");
      for (const name of [
        "Calendar",
        "Tasks",
        "Notes",
        "More views",
        "Archive",
        "Plugins",
        "Settings",
      ]) {
        const button = wrapper
          .findAll("button")
          .find((button) => button.text() === name);
        expect(button, name).toBeDefined();
        expect(button!.element.disabled, name).toBe(true);
        expect(button!.attributes("aria-description"), name).toBeTruthy();
      }

      const close = wrapper.find<HTMLButtonElement>(
        'button[aria-label="Close navigation"]',
      );
      expect(close.exists()).toBe(drawer);
      if (drawer) {
        close.element.click();
        expect(wrapper.emitted("close")).toHaveLength(1);
      } else {
        expect(
          wrapper.get<HTMLButtonElement>(
            'button[aria-label="Collapse sidebar"]',
          ).element.disabled,
        ).toBe(true);
      }
    },
  );
});

describe("shared icon button", () => {
  it("is a named non-submit action and hides its decorative icon", () => {
    const onClick = vi.fn();
    const wrapper = mount(SituateIconButton, {
      props: { icon: "close", label: "Close navigation" },
      attrs: { onClick },
    });
    const button = wrapper.get("button");
    expect(button.attributes("type")).toBe("button");
    expect(button.attributes("aria-label")).toBe("Close navigation");
    expect(button.attributes("title")).toBeUndefined();
    expect(wrapper.getComponent(SituateTooltip).props("text")).toBe(
      "Close navigation",
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
        label: "Send message",
        disabled: true,
        unavailableReason: "Messaging is unavailable.",
      },
      attrs: { onClick },
    });
    const button = wrapper.get("button");
    expect(button.element.disabled).toBe(true);
    expect(button.attributes("aria-description")).toBe(
      "Messaging is unavailable.",
    );
    expect(wrapper.getComponent(SituateTooltip).props("text")).toBe(
      "Messaging is unavailable.",
    );
    button.element.click();
    expect(onClick).not.toHaveBeenCalled();

    await wrapper.setProps({ disabled: false });
    expect(button.attributes("aria-description")).toBeUndefined();
    expect(wrapper.getComponent(SituateTooltip).props("text")).toBe(
      "Send message",
    );
    button.element.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
