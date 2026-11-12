import { selectOption, selectOptions } from "./select";
import { expect, test, type Page } from "./test";
import { scenarioCatalog } from "../../src/workshop/scenario-catalog";
import { selectScenario } from "./scenarios";
import { connectionFixtures } from "../../src/ai/scenarios";
import { createAiState } from "../../src/ai/model";

async function open(page: Page, state = "plugins-development") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?workshop=controls&scenario=${state}&profile=ios`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

test("search and topic filters preserve the preview until a scenario or starting state is selected", async ({
  page,
}) => {
  const preview = await open(page);
  await expect(
    page.getByRole("heading", { name: "Scenario", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Scene", exact: true }),
  ).toHaveCount(0);
  const request = preview.getByLabel("Your request", { exact: true });
  await request.fill("Keep this development draft");
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveAttribute("data-value", "plugins-create");
  await expect(
    page.getByLabel("Starting state", { exact: true }),
  ).toHaveAttribute("data-value", "plugins-development");
  await page.locator(".scenario-filters summary").click();
  await page
    .getByRole("group", { name: "Scenario topics" })
    .getByRole("button", { name: /^Plugins/ })
    .click();
  const pluginScenarios = await selectOptions(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  );
  expect(pluginScenarios).toHaveLength(4);
  expect(
    pluginScenarios.filter((option) => option.value === "plugins-source-error"),
  ).toHaveLength(0);
  await expect(
    (
      await selectOptions(page.getByLabel("Starting state", { exact: true }))
    ).filter((option) => option.value === "plugins-source-error"),
  ).toHaveLength(1);
  await page
    .getByLabel("Search scenarios", { exact: true })
    .fill("no matches here");
  await expect(
    page.getByText("No scenarios match these filters."),
  ).toBeVisible();
  await expect(request).toHaveValue("Keep this development draft");
  await expect(page).toHaveURL(/scenario=plugins-development/);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page
    .getByLabel("Search scenarios", { exact: true })
    .fill("plugins-empty");
  const list = page.getByRole("combobox", { name: "Scenario", exact: true });
  await expect(await selectOptions(list)).toHaveLength(1);
  await list.focus();
  await list.press("ArrowDown");
  await page.getByRole("listbox").press("Enter");
  await expect(page).toHaveURL(/scenario=plugins-list/);
  const states = page.getByLabel("Starting state", { exact: true });
  await states.focus();
  await selectOption(states, "plugins-empty");
  await expect(states).toBeFocused();
  await expect(page).toHaveURL(/scenario=plugins-empty/);
  await expect(preview.locator(".plugin-first-tool")).toBeVisible();
  await expect(list).toHaveAttribute("data-value", "plugins-list");
  await page.locator(".scenario-filters summary").click();
  await expect(page.locator(".scenario-filters summary")).toContainText(
    "filters active",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("each screen exposes its existing states without duplicating the main scenario list", async ({
  page,
}) => {
  await open(page, "workspaces");
  const list = page.getByRole("combobox", { name: "Scenario", exact: true });
  await expect(await selectOptions(list)).toHaveLength(scenarioCatalog.length);
  for (const scenario of scenarioCatalog) {
    await selectOption(list, scenario.id);
    const states = page.getByLabel("Starting state", { exact: true });
    if (scenario.states.length === 1) await expect(states).toHaveCount(0);
    else {
      const choices = await selectOptions(states);
      expect(choices).toHaveLength(scenario.states.length);
      expect(choices.map((option) => option.value)).toEqual(
        scenario.states.map((state) => state.id),
      );
    }
    await expect(await selectOptions(list)).toHaveLength(
      scenarioCatalog.length,
    );
  }
});

test("state changes and reset preserve the platform but replace pending work and drafts", async ({
  page,
}) => {
  const preview = await open(page, "documents-find");
  await preview.locator("#doc-query").fill("Unsubmitted wording");
  await selectOption(
    page.getByLabel("Next source or opening action", { exact: true }),
    "wait",
  );
  await preview.locator('[data-document="bike"]').click();
  await expect(
    page.getByRole("button", { name: "Complete document action", exact: true }),
  ).toBeVisible();
  await selectOption(
    page.getByLabel("Starting state", { exact: true }),
    "documents-error",
  );
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveAttribute("data-value", "documents-find");
  await expect(preview.getByRole("alert")).toContainText(
    "Search could not be completed",
  );
  await expect(
    page.getByRole("button", { name: "Complete document action", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Platform profile", { exact: true }),
  ).toHaveAttribute("data-value", "ios");
  await preview.locator("#doc-query").fill("Another draft");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(
    page.getByLabel("Starting state", { exact: true }),
  ).toHaveAttribute("data-value", "documents-error");
  await expect(preview.locator("#doc-query")).not.toHaveValue("Another draft");
  await expect(preview.getByRole("alert")).toContainText(
    "Search could not be completed",
  );
  await expect(page).toHaveURL(/scenario=documents-error/);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveAttribute("data-value", "documents-find");
  await expect(
    page.getByLabel("Starting state", { exact: true }),
  ).toHaveAttribute("data-value", "documents-error");
});

test("tab starting states share one scenario and reset drafts without resetting the environment", async ({
  page,
}) => {
  const preview = await open(page, "tabs-new-chat");
  const scenario = page.getByRole("combobox", {
    name: "Scenario",
    exact: true,
  });
  const states = page.getByRole("combobox", {
    name: "Starting state",
    exact: true,
  });
  await expect(scenario).toHaveAttribute("data-value", "tabs-overview");
  await expect(
    (await selectOptions(scenario)).filter((option) =>
      option.value.startsWith("tabs-"),
    ),
  ).toHaveLength(1);
  await expect(await selectOptions(states)).toHaveLength(13);
  expect((await selectOptions(states)).map((option) => option.value)).toEqual(
    scenarioCatalog
      .find((item) => item.id === "tabs-overview")!
      .states.map((state) => state.id),
  );
  await expect(states).toHaveAttribute("data-value", "tabs-new-chat");
  const draft = preview.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("Keep this pane draft");
  await page.getByLabel("Keyboard occlusion", { exact: true }).check();
  await expect(draft).toHaveValue("Keep this pane draft");
  await page.getByLabel("Keyboard occlusion", { exact: true }).uncheck();
  await selectOption(states, "tabs-loading");
  await expect(preview.locator(".loading-mark")).toBeVisible();
  await expect(scenario).toHaveAttribute("data-value", "tabs-overview");
  await expect(
    page.getByLabel("Platform profile", { exact: true }),
  ).toHaveAttribute("data-value", "ios");
  await selectOption(states, "tabs-new-chat");
  await expect(draft).toHaveValue("");
  await draft.fill("Reset this pane draft");
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(draft).toHaveValue("");
  await expect(states).toHaveAttribute("data-value", "tabs-new-chat");
  await expect(page).toHaveURL(/scenario=tabs-new-chat/);
  await page.reload();
  await expect(scenario).toHaveAttribute("data-value", "tabs-overview");
  await expect(states).toHaveAttribute("data-value", "tabs-new-chat");
  await expect(
    page.getByLabel("Platform profile", { exact: true }),
  ).toHaveAttribute("data-value", "ios");
});

test("document tasks have one starting state and changing layout preserves the draft", async ({
  page,
}) => {
  const preview = await open(page, "documents-find");
  const states = page.getByRole("combobox", {
    name: "Starting state",
    exact: true,
  });
  await expect(
    (await selectOptions(states))
      .filter((option) => option.value.startsWith("documents-find"))
      .map((option) => option.label),
  ).toEqual(["Find a document"]);
  await expect(
    (await selectOptions(states))
      .filter((option) => option.value.startsWith("documents-gather"))
      .map((option) => option.label),
  ).toEqual(["Gather tax documents"]);
  await expect(
    (await selectOptions(states)).filter((option) =>
      option.value.endsWith("-focused"),
    ),
  ).toHaveLength(0);
  const query = preview.locator("#doc-query");
  await query.fill("Keep this unfinished search");
  const approach = page.getByLabel("Navigation approach", { exact: true });
  await selectOption(approach, "focused");
  await expect(preview.locator(".documents-view")).toHaveClass(
    /documents-focused/,
  );
  await expect(query).toHaveValue("Keep this unfinished search");
  await expect(states).toHaveAttribute("data-value", "documents-find");
  await selectOption(approach, "library");
  await expect(preview.locator(".documents-view")).not.toHaveClass(
    /documents-focused/,
  );
  await expect(query).toHaveValue("Keep this unfinished search");
});

for (const task of ["find", "gather"]) {
  test(`old document ${task} layout links open without another starting-state option`, async ({
    page,
  }) => {
    const preview = await open(page, `documents-${task}-focused`);
    const states = page.getByRole("combobox", {
      name: "Starting state",
      exact: true,
    });
    await expect(states).toHaveAttribute("data-value", `documents-${task}`);
    await expect(
      (await selectOptions(states)).filter((option) =>
        option.value.endsWith("-focused"),
      ),
    ).toHaveLength(0);
    await expect(
      page.getByLabel("Navigation approach", { exact: true }),
    ).toHaveAttribute("data-value", "focused");
    await expect(preview.locator(".documents-view")).toHaveClass(
      /documents-focused/,
    );
    await expect(preview.locator(".doc-result")).toHaveCount(
      task === "find" ? 10 : 5,
    );
    await page.reload();
    await expect(states).toHaveAttribute("data-value", `documents-${task}`);
    await expect(
      page.getByLabel("Navigation approach", { exact: true }),
    ).toHaveAttribute("data-value", "focused");
  });
}

test("live controls still follow preview navigation rather than the chosen starting state", async ({
  page,
}) => {
  const preview = await open(page, "documents-find");
  await preview
    .getByRole("button", { name: "Document actions", exact: true })
    .click();
  await preview.getByRole("menuitem", { name: "Sources", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Card appearance", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Navigation approach", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Starting state", { exact: true }),
  ).toHaveAttribute("data-value", "documents-find");
  await selectScenario(page, "plugins-source-create");
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveAttribute("data-value", "plugins-create");
  await expect(preview.getByLabel("Your request", { exact: true })).toHaveValue(
    /document source/,
  );
});

for (const fixture of connectionFixtures.filter(
  (item) => item.state !== "missing",
)) {
  test(`${fixture.id} opens as an AI settings state and follows navigation and reset`, async ({
    page,
  }, info) => {
    const preview = await open(page, fixture.id);
    const scenario = page.getByRole("combobox", {
      name: "Scenario",
      exact: true,
    });
    const startingState = page.getByRole("combobox", {
      name: "Starting state",
      exact: true,
    });
    await expect(scenario).toHaveAttribute("data-value", "settings-ai");
    await expect(startingState).toHaveAttribute("data-value", fixture.id);
    await expect(
      (await selectOptions(scenario)).filter(
        (option) => option.value === `${fixture.id}`,
      ),
    ).toHaveLength(0);
    const connection = preview.locator(".settings-view .ai-view");
    await expect(connection).toBeVisible();
    await expect(connection).toHaveAttribute(
      "data-screen",
      createAiState(fixture.state).screen,
    );
    await expect(
      page.getByRole("region", { name: "AI controls", exact: true }),
    ).toBeVisible();
    await preview
      .getByRole("button", { name: "Back to AI & models", exact: true })
      .click();
    await expect(connection).toHaveCount(0);
    await expect(
      page.getByLabel("Provider state", { exact: true }),
    ).toBeVisible();
    await expect(startingState).toHaveAttribute("data-value", fixture.id);
    await expect(
      preview.getByRole("heading", { name: "AI & models", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(connection).toBeVisible();
    await expect(connection).toHaveAttribute(
      "data-screen",
      createAiState(fixture.state).screen,
    );
    await expect(
      page.getByLabel("Provider state", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Platform profile", { exact: true }),
    ).toHaveAttribute("data-value", "ios");
    await expect(page).toHaveURL(new RegExp(`scenario=${fixture.id}(?:&|$)`));
    await page.reload();
    await expect(
      page.getByText("Preview connected", { exact: true }),
    ).toBeVisible();
    await expect(scenario).toHaveAttribute("data-value", "settings-ai");
    await expect(startingState).toHaveAttribute("data-value", fixture.id);
    await expect(connection).toBeVisible();
    if (fixture.id === "ai-warning-changed") {
      await page.screenshot({
        path: info.outputPath("provider-state-controls.png"),
      });
      await preview.screenshot({
        path: info.outputPath("provider-state-preview.png"),
      });
    }
  });
}

test("rapid starting-state changes keep publishing preview state without exhausting browser history writes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?workshop=controls&scenario=ai-warning");
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await expect(preview.locator(".ai-view")).toBeVisible();
  test.setTimeout(90_000);
  const states = page.getByLabel("Starting state", { exact: true });
  for (let i = 0; i < 120; i++) {
    await selectOption(states, i % 2 ? "ai-providers" : "ai-warning");
  }
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/scenario=ai-providers/);
  expect(errors).toEqual([]);
});

test("local settings and scenario selection do not offer account synchronization", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=settings-ai");
  const options = await (
    await selectOptions(
      page.getByRole("combobox", { name: "Scenario", exact: true }),
    )
  ).map((option) => option.value);
  expect(options.some((id) => id.startsWith("sync-"))).toBe(false);
  await expect(
    page.getByRole("button", { name: /Sync and recovery/ }),
  ).toHaveCount(0);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await expect(
    preview.getByRole("heading", { name: "AI & models", exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Situate account", exact: true }),
  ).toHaveCount(0);
});
