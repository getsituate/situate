import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PluginCard from "./PluginCard.vue";
import { pluginFixtures } from "./fixtures";

describe("plugin cards", () => {
  it.each([pluginFixtures[0], pluginFixtures[1]])(
    "keeps the same content and action order for $kind",
    (plugin) => {
      const card = mount(PluginCard, {
        props: { plugin, settingsLabel: "Settings" },
        slots: {
          artwork: '<svg aria-hidden="true" />',
          default: '<p class="connection-detail">Connected accounts</p>',
        },
      });
      expect(card.attributes("data-plugin-id")).toBe(plugin.id);
      expect(card.attributes("aria-labelledby")).toBe(
        card.get("h3").attributes("id"),
      );
      expect(card.get("h3").text()).toBe(plugin.name);
      expect(card.get(".plugin-card-top .plugin-availability").text()).toBe(
        "Enabled",
      );
      expect(card.find(".plugin-card-artwork").exists()).toBe(false);
      expect(card.findAll("h3")).toHaveLength(1);
      expect(card.get(".plugin-card-top h3").text()).toBe(plugin.name);
      expect(card.get(".plugin-row-content").text()).toContain(
        plugin.description,
      );
      expect(card.get(".plugin-row-content .connection-detail").text()).toBe(
        "Connected accounts",
      );
      expect(card.get(".plugin-meta").text()).toBe("1 running");
      expect(card.text()).not.toMatch(/Version \d+/);
      expect(card.findAll("button").map((button) => button.text())).toEqual([
        "Adapt plugin ↗",
        "Settings",
        "View files",
        "Disable",
        "",
      ]);
      expect(
        [...card.element.children].map((child) => child.className),
      ).toEqual([
        "plugin-card-top",
        "plugin-row-content",
        "plugin-card-actions",
      ]);
      card.unmount();
    },
  );
  it("switches appearance without changing content or actions", async () => {
    const card = mount(PluginCard, {
      props: { plugin: pluginFixtures[1], settingsLabel: "Settings" },
      slots: { artwork: '<svg aria-hidden="true" />' },
    });
    const content = card.get(".plugin-row-content").text();
    const actions = card.get(".plugin-card-actions").text();
    await card.setProps({ illustrated: true });
    expect(card.find(".plugin-card-artwork svg").exists()).toBe(true);
    expect(card.findAll("h3")).toHaveLength(1);
    expect(card.get(".plugin-row-content h3").text()).toBe(
      pluginFixtures[1].name,
    );
    expect(card.get(".plugin-card-actions").text()).toBe(actions);
    await card.setProps({ illustrated: false });
    expect(card.find(".plugin-card-artwork").exists()).toBe(false);
    expect(card.get(".plugin-row-content").text()).toBe(content);
    expect(card.get(".plugin-card-actions").text()).toBe(actions);
    card.unmount();
  });
  it("forwards actions and preserves disabled and blocked states", async () => {
    const card = mount(PluginCard, {
      props: { plugin: pluginFixtures[1], settingsLabel: "Settings" },
    });
    for (const button of card.findAll('button:not([data-action="more"])'))
      await button.trigger("click");
    expect(card.get('[data-action="more"]').attributes("aria-haspopup")).toBe(
      "menu",
    );
    expect(card.get('[data-action="more"]').attributes("aria-label")).toBe(
      "More actions for Weekly planning",
    );
    for (const event of ["develop", "settings", "inspect", "toggle"])
      expect(card.emitted(event)).toHaveLength(1);
    await card.setProps({
      plugin: {
        ...pluginFixtures[1],
        enabled: false,
        blocked: true,
        running: 0,
      },
      canEnable: false,
      unavailableHelp: "Enable its dependencies first.",
    });
    expect(card.get(".plugin-availability").text()).toBe("Dependency disabled");
    expect(card.find(".plugin-meta").exists()).toBe(false);
    expect(card.findAll("button")[1].attributes("disabled")).toBeDefined();
    expect(card.get(".plugin-toggle").attributes("disabled")).toBeDefined();
    expect(card.get(".plugin-action-help").text()).toBe(
      "Enable its dependencies first.",
    );
    expect(
      card.get('[data-action="view-files"]').attributes("disabled"),
    ).toBeUndefined();
    card.unmount();
  });
});
