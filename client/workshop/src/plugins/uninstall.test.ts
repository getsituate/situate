import { describe, expect, it } from "vitest";
import {
  affectedPlugins,
  canUninstallPlugin,
  createPluginState,
  finishUninstallPlugin,
  openPluginFiles,
  startPluginDevelopment,
  startUninstallPlugin,
} from "./model";

describe("plugin uninstallation", () => {
  it.each(["plugins-uninstall", "plugins-uninstall-disabled"])(
    "removes only the selected installed plugin in %s",
    (scenario) => {
      const s = createPluginState(scenario);
      startPluginDevelopment(s, "Make a reading tool.");
      const conversations = JSON.stringify(s.developments);
      openPluginFiles(s, "morning");
      s.dialog = "uninstall";
      s.accountSelections.morning = ["calendar-personal"];
      const accounts = JSON.stringify(s.accounts);
      startUninstallPlugin(s);
      startUninstallPlugin(s);
      expect(s.uninstallStatus).toBe("pending");
      expect(s.plugins.some((p) => p.id === "morning")).toBe(true);
      finishUninstallPlugin(s, true);
      expect(s.plugins.some((p) => p.id === "morning")).toBe(false);
      expect(s.plugins.some((p) => p.id === "calendar")).toBe(true);
      expect(s.fileBrowsers.morning).toBeUndefined();
      expect(s.accountSelections.morning).toBeUndefined();
      expect(JSON.stringify(s.accounts)).toBe(accounts);
      expect(JSON.stringify(s.developments)).toBe(conversations);
      expect(s.dialog).toBeNull();
      expect(s.screen).toBe("list");
      expect(s.notice).toBe("Morning brief uninstalled.");
      finishUninstallPlugin(s, true);
      expect(s.plugins).toHaveLength(6);
    },
  );
  it("blocks direct and indirect dependents, including disabled ones", () => {
    const s = createPluginState("plugins-uninstall-dependencies");
    expect(affectedPlugins(s, "calendar").map((p) => p.id)).toEqual([
      "weekly",
      "morning",
    ]);
    for (const plugin of s.plugins) plugin.enabled = false;
    expect(canUninstallPlugin(s, "calendar")).toBe(false);
    startUninstallPlugin(s);
    finishUninstallPlugin(s, true);
    expect(s.uninstallStatus).toBe("idle");
    expect(s.plugins).toHaveLength(7);
  });
  it("does not abort running actions", () => {
    const s = createPluginState("plugins-uninstall-running");
    startUninstallPlugin(s);
    expect(s.uninstallStatus).toBe("idle");
    expect(s.plugins.find((p) => p.id === "morning")!.running).toBe(1);
  });
  it("keeps installed state on a failed attempt and permits retry", () => {
    const s = createPluginState("plugins-uninstall");
    const original = JSON.stringify(s.plugins);
    startUninstallPlugin(s);
    finishUninstallPlugin(s, false);
    expect(s.uninstallStatus).toBe("error");
    expect(JSON.stringify(s.plugins)).toBe(original);
    startUninstallPlugin(s);
    finishUninstallPlugin(s, true);
    expect(s.plugins.some((p) => p.id === "morning")).toBe(false);
  });
  it("rechecks dependencies at completion and resets pending work with the fixture", () => {
    const s = createPluginState("plugins-uninstall-pending");
    s.plugins.find((p) => p.id === "weekly")!.dependencies.push("morning");
    finishUninstallPlugin(s, true);
    expect(s.uninstallStatus).toBe("error");
    expect(s.plugins).toHaveLength(7);
    const reset = createPluginState("plugins-list");
    finishUninstallPlugin(reset, true);
    expect(reset.dialog).toBeNull();
    expect(reset.uninstallStatus).toBe("idle");
    expect(reset.plugins).toHaveLength(7);
  });
});
