import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PluginCodeBrowser from "./PluginCodeBrowser.vue";
import { codeRows, createCodeBrowser } from "./code-browser";
import { filesFor } from "./fixtures";
import {
  createPluginState,
  currentDevelopment,
  openPluginFiles,
  startPluginDevelopment,
} from "./model";
import { createSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";

describe("plugin code browser", () => {
  it("shows root files including dotfiles and expands nested folders", () => {
    const state = createCodeBrowser();
    const files = filesFor("Weekly planning");
    const initial = codeRows(files, state);
    expect(initial.some((row) => row.path === ".gitignore")).toBe(true);
    expect(initial.some((row) => row.path === "skills/prepare/SKILL.md")).toBe(
      false,
    );
    state.expanded = ["skills", "skills/prepare"];
    expect(
      codeRows(files, state).find(
        (row) => row.path === "skills/prepare/SKILL.md",
      )?.depth,
    ).toBe(2);
    state.query = "SKILL.md";
    expect(codeRows(files, state).map((row) => row.path)).toEqual([
      "skills",
      "skills/prepare",
      "skills/prepare/SKILL.md",
    ]);
    state.query = "missing";
    expect(codeRows(files, state)).toEqual([]);
    expect(state.selected).toBe("AGENTS.md");
    state.query = "";
    const emptyFolder = codeRows([], state, ["docs"]);
    expect(emptyFolder).toEqual([
      { path: "docs", name: "docs", depth: 0, folder: true, expanded: false },
    ]);
  });
  it("keeps installed plugins and development browsers independent, including disabled plugins", () => {
    const state = createPluginState("plugins-disabled");
    const before = structuredClone(state.plugins);
    openPluginFiles(state, "weekly");
    state.fileBrowsers.weekly.query = "SKILL.md";
    openPluginFiles(state, "calendar");
    expect(state.fileBrowsers.calendar.query).toBe("");
    openPluginFiles(state, "weekly");
    expect(state.fileBrowsers.weekly.query).toBe("SKILL.md");
    expect(state.plugins).toEqual(before);
    startPluginDevelopment(state);
    const d = currentDevelopment(state)!;
    expect(d.codeBrowser.query).toBe("");
    expect(d.baseVersion).toBe(2);
    state.plugins.find((p) => p.id === "weekly")!.version = 3;
    expect(d.baseVersion).toBe(2);
    expect(createPluginState("plugins-files").fileBrowsers.weekly.query).toBe(
      "",
    );
  });
  it("does not open missing plugin folders", () => {
    const state = createPluginState();
    openPluginFiles(state, "missing");
    expect(state.screen).toBe("list");
    expect(state.fileBrowsers).toEqual({});
  });
  it.each([
    "plugins-files",
    "plugins-files-loading",
    "plugins-files-error",
    "plugins-files-empty",
  ])("registers %s with file-scoped controls", (scenario) => {
    const state = createSimulation(scenario);
    expect(state.plugins.screen).toBe("files");
    expect(screenControls(state).label).toBe("Plugin files");
    expect(screenControls(state).controls).toContain("plugins");
  });
  it("renders Markdown as read-only, exposes complete source and never executes markup", async () => {
    const state = createCodeBrowser();
    state.selected = "skills/prepare/SKILL.md";
    const files = filesFor("Weekly planning");
    const view = mount(PluginCodeBrowser, {
      props: {
        state,
        files,
      },
    });
    expect(view.get(".markdown").attributes("aria-description")).toBe(
      "Read only",
    );
    await view.get(".markdown").trigger("click");
    expect(view.find("textarea").exists()).toBe(false);
    await view.setProps({ state: { ...state, mode: "source" } });
    expect(view.get(".code-source").text()).toContain("name: prepare");
    expect(view.get(".code-source").text()).toContain(
      "Do not create external events without approval.",
    );
    await view.setProps({
      files: [
        {
          path: "index.html",
          kind: "text",
          text: "<script>window.executed = true</script>",
        },
      ],
      state: { ...state, selected: "index.html" },
    });
    expect(view.find("script").exists()).toBe(false);
    expect(view.get(".code-source").text()).toContain("<script>");
    view.unmount();
  });
});
