import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ScenarioBrowser from "./ScenarioBrowser.vue";
import { tabScenarios } from "../tabs/model";
import { aiScenarios, connectionFixtures } from "../ai/scenarios";
import {
  canonicalScenario,
  createSimulation,
  isScenario,
  scenarios,
  scenarioAliases,
} from "./simulation";
import {
  matchingScenarios,
  scenarioCatalog,
  scenarioForState,
} from "./scenario-catalog";

describe("scenario catalog", () => {
  it("groups all starting states exactly once under their scenarios", () => {
    expect(scenarioCatalog).toHaveLength(35);
    const states = scenarioCatalog.flatMap((item) =>
      item.states.map((state) => state.id),
    );
    expect([...states].sort()).toEqual(scenarios.map((s) => s.id).sort());
    expect(new Set(states).size).toBe(states.length);
    for (const item of scenarioCatalog) {
      expect(item.id).toBe(item.states[0].id);
      expect(new Set(item.states.map((s) => s.label)).size).toBe(
        item.states.length,
      );
    }
  });
  it("keeps the celebration in the setup conversation and redirects removed onboarding links", () => {
    expect(scenarioForState("onboarding-finale").id).toBe(
      "setup-conversation-brief",
    );
    expect(
      scenarioCatalog.filter((item) => item.group === "Onboarding"),
    ).toHaveLength(5);
    for (const [id, target] of [
      ["onboarding-import", "setup-conversation-import"],
      ["onboarding-import-failed", "setup-conversation-blocked"],
      ["onboarding-provider", "first-entry-ai"],
      ["onboarding-arrival", "chat-empty"],
      ["onboarding-pending-empty", "chat-empty"],
      ["onboarding-empty", "chat-empty"],
      ["onboarding-manual", "chat-empty"],
      ["onboarding-hint", "chat-empty"],
    ] as const) {
      expect(scenarios.some((item) => String(item.id) === id)).toBe(false);
      expect(isScenario(id)).toBe(true);
      expect(canonicalScenario(id)).toBe(target);
      expect(createSimulation(id).scenario).toBe(target);
      expect(scenarioForState(id)).toBe(scenarioForState(target));
    }
  });
  it("redirects every retired onboarding state into the current sequence", () => {
    expect(
      scenarioCatalog
        .filter((entry) => entry.group === "Onboarding")
        .map((entry) => entry.label),
    ).toEqual([
      "01 · Welcome",
      "02 · Create a workspace",
      "03 · Connect AI",
      "04 · Verify a model",
      "05 · Set up your workspace",
    ]);
    for (const id of Object.keys(scenarioAliases) as Array<
      keyof typeof scenarioAliases
    >) {
      if (!id.startsWith("onboarding-") && id !== "first-entry-opus") continue;
      const target = canonicalScenario(id);
      expect(scenarios.some((state) => state.id === target)).toBe(true);
      expect(createSimulation(id).scenario).toBe(target);
      expect(scenarioForState(id)).toBe(scenarioForState(target));
    }
  });
  it.each(["settings-appearance", "settings-appearance-light"] as const)(
    "groups %s under workspace appearance and retains its direct link",
    (id) => {
      const owner = scenarioForState(id);
      expect(owner.id).toBe("settings-appearance");
      expect(owner.label).toBe("Workspace appearance");
      expect(owner.states.map((state) => state.id)).toEqual([
        "settings-appearance",
        "settings-appearance-light",
      ]);
      expect(isScenario(id)).toBe(true);
      expect(createSimulation(id).settings.page).toBe("appearance");
      const view = mount(ScenarioBrowser, { props: { selected: id } });
      expect(
        view.get<HTMLSelectElement>("#scenario + select").element.value,
      ).toBe(owner.id);
      expect(
        view.get<HTMLSelectElement>("#scenario-state + select").element.value,
      ).toBe(id);
      expect(
        view.findAll('#scenario + select option[value^="settings-appearance"]'),
      ).toHaveLength(1);
      view.unmount();
    },
  );
  it.each(tabScenarios)(
    "groups $id under the pane arrangement workflow and retains its direct link",
    ({ id }) => {
      const owner = scenarioForState(id);
      expect(owner.id).toBe("tabs-overview");
      expect(owner.label).toBe("Arrange tabs and panes");
      expect(owner.states).toHaveLength(tabScenarios.length);
      expect(isScenario(id)).toBe(true);
      expect(createSimulation(id).feature).toBe("tabs");
      const view = mount(ScenarioBrowser, { props: { selected: id } });
      expect(
        view.get<HTMLSelectElement>("#scenario + select").element.value,
      ).toBe(owner.id);
      expect(
        view.get<HTMLSelectElement>("#scenario-state + select").element.value,
      ).toBe(id);
      view.unmount();
    },
  );
  it.each([...aiScenarios, ...connectionFixtures])(
    "keeps $id selectable within its workflow",
    ({ id }) => {
      const owner = scenarioForState(id);
      expect(owner.id).toBe(
        connectionFixtures.some((fixture) => fixture.id === id)
          ? "settings-ai"
          : id.startsWith("ai-chat")
            ? "chat-work-history"
            : "ai-providers",
      );
      expect(isScenario(id)).toBe(true);
      const view = mount(ScenarioBrowser, { props: { selected: id } });
      expect(
        view.get<HTMLSelectElement>("#scenario + select").element.value,
      ).toBe(owner.id);
      expect(
        view.get<HTMLSelectElement>("#scenario-state + select").element.value,
      ).toBe(id);
      expect(view.findAll("#scenario + select option")).toHaveLength(
        scenarioCatalog.length,
      );
      view.unmount();
    },
  );
  it("offers each document task once and leaves layout choices out of the starting states", () => {
    const states = scenarioForState("documents-find").states;
    expect(states.filter((s) => s.id.startsWith("documents-find"))).toEqual([
      { id: "documents-find", label: "Find a document" },
    ]);
    expect(states.filter((s) => s.id.startsWith("documents-gather"))).toEqual([
      { id: "documents-gather", label: "Gather tax documents" },
    ]);
    expect(scenarios.some((s) => s.id.endsWith("-focused"))).toBe(false);
  });
  it.each(["documents-find-focused", "documents-gather-focused"] as const)(
    "keeps %s as a link alias without another catalog entry",
    (alias) => {
      expect(isScenario(alias)).toBe(true);
      const id = canonicalScenario(alias);
      const state = createSimulation(alias);
      expect(state.documents.layout).toBe("focused");
      expect({ ...state.documents, layout: "library" }).toEqual(
        createSimulation(id).documents,
      );
      const view = mount(ScenarioBrowser, { props: { selected: alias } });
      expect(
        view.get<HTMLSelectElement>("#scenario-state + select").element.value,
      ).toBe(id);
      expect(
        view
          .findAll("option")
          .some((option) => option.attributes("value") === alias),
      ).toBe(false);
      view.unmount();
    },
  );
  it("keeps different development outcomes and document entry points in the same workflow", () => {
    expect(scenarioForState("plugins-source-error")).toBe(
      scenarioForState("plugins-development"),
    );
    expect(scenarioForState("documents-connect")).toBe(
      scenarioForState("plugins-create"),
    );
    expect(scenarioForState("documents-sources")).toBe(
      scenarioForState("plugins-list"),
    );
    expect(scenarioForState("documents-error")).toBe(
      scenarioForState("documents-find"),
    );
    expect(scenarioForState("ai-chat-save-error")).toBe(
      scenarioForState("ai-chat-existing"),
    );
  });
  it("finds a scenario by its topic, name, state label or legacy ID", () => {
    expect(matchingScenarios("plugins-empty").map((s) => s.id)).toEqual([
      "plugins-list",
    ]);
    expect(matchingScenarios("plugin development").map((s) => s.id)).toEqual([
      "plugins-create",
    ]);
    expect(matchingScenarios("AI saving").map((s) => s.id)).toEqual([
      "setup-conversation-brief",
      "chat-work-history",
    ]);
    expect(
      matchingScenarios("saved search tag removed").map((s) => s.id),
    ).toEqual(["documents-find"]);
    expect(scenarioForState("documents-repair-view")).toBe(
      scenarioForState("documents-find"),
    );
    expect(scenarioForState("documents-missing-tag")).toBe(
      scenarioForState("documents-find"),
    );
    expect(scenarioCatalog.some((s) => /repair/i.test(s.label))).toBe(false);
    expect(matchingScenarios("no-such-scenario")).toEqual([]);
  });
});

describe("scenario browser", () => {
  it("shows screens in the main list and their starting states separately", () => {
    const view = mount(ScenarioBrowser, {
      props: { selected: "plugins-development" },
    });
    expect(view.findAll("#scenario + select option")).toHaveLength(
      scenarioCatalog.length,
    );
    expect(
      view.get<HTMLSelectElement>("#scenario + select").element.value,
    ).toBe("plugins-create");
    expect(
      view.get<HTMLSelectElement>("#scenario-state + select").element.value,
    ).toBe("plugins-development");
    expect(view.findAll("#scenario-state + select option")).toHaveLength(
      scenarioForState("plugins-development").states.length,
    );
    expect(view.get(".selected-scenario").text()).toContain("Develop a plugin");
    expect(view.get<HTMLDetailsElement>("details").element.open).toBe(false);
    expect(view.get("#scenario-state-help").text()).toContain(
      "clears current interactions",
    );
    view.unmount();
  });
  it("filters by topic and search without resetting the preview or its starting state", async () => {
    const view = mount(ScenarioBrowser, {
      props: { selected: "plugins-development" },
    });
    await view.get("input").setValue("PLUGIN development");
    expect(view.findAll("#scenario + select option")).toHaveLength(1);
    expect(view.emitted("select")).toBeUndefined();
    await view.get("#scenario + select").setValue("plugins-create");
    expect(view.emitted("select")).toEqual([["plugins-create"]]);
    await view.get(".clear-filters").trigger("click");
    const button = view
      .findAll(".scenario-groups button")
      .find((item) => item.text().startsWith("Plugins"))!;
    await button.trigger("click");
    expect(button.attributes("aria-pressed")).toBe("true");
    expect(view.findAll("#scenario + select option")).toHaveLength(4);
    expect(
      view.get<HTMLSelectElement>("#scenario-state + select").element.value,
    ).toBe("plugins-development");
    view.unmount();
  });
  it("switches starting state without adding another scenario to the main list", async () => {
    const view = mount(ScenarioBrowser, {
      props: { selected: "documents-find" },
    });
    const before = view
      .findAll("#scenario + select option")
      .map((o) => o.attributes("value"));
    await view.get("#scenario-state + select").setValue("documents-error");
    expect(view.emitted("select")).toEqual([["documents-error"]]);
    await view.setProps({ selected: "documents-error" });
    expect(
      view.get<HTMLSelectElement>("#scenario + select").element.value,
    ).toBe("documents-find");
    expect(
      view
        .findAll("#scenario + select option")
        .map((o) => o.attributes("value")),
    ).toEqual(before);
    await view.setProps({ selected: "plugins-source-error" });
    expect(
      view.get<HTMLSelectElement>("#scenario + select").element.value,
    ).toBe("plugins-create");
    expect(
      view
        .findAll("#scenario-state + select option")
        .some((o) => o.attributes("value") === "documents-error"),
    ).toBe(false);
    view.unmount();
  });
  it("recovers from no results without changing the current scenario or state", async () => {
    const view = mount(ScenarioBrowser, {
      props: { selected: "documents-error" },
    });
    await view.get("input").setValue("no-such-scenario");
    expect(view.find("#scenario + select").exists()).toBe(false);
    expect(view.get(".scenario-empty").text()).toContain("No scenarios");
    expect(view.get(".selected-scenario").text()).toContain(
      "Document collection",
    );
    expect(
      view.get<HTMLSelectElement>("#scenario-state + select").element.value,
    ).toBe("documents-error");
    await view.get(".clear-filters").trigger("click");
    expect(view.findAll("#scenario + select option")).toHaveLength(
      scenarioCatalog.length,
    );
    expect(view.emitted("select")).toBeUndefined();
    view.unmount();
  });
  it("omits a redundant state selector for single-state screens", async () => {
    const view = mount(ScenarioBrowser, {
      props: { selected: "settings-formats" },
    });
    expect(view.find("#scenario-state + select").exists()).toBe(false);
    await view.setProps({ selected: "settings-error" });
    expect(view.find("#scenario-state + select").exists()).toBe(true);
    view.unmount();
  });
});
