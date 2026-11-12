import { selectOption } from "./select";
import { selectScenario } from "./scenarios";
import { expect, test, type Page } from "./test";

async function openPreview(controls: Page): Promise<Page> {
  const opened = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await opened;
  await expect(
    controls.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  return preview;
}

async function choose(controls: Page, scenario: string): Promise<void> {
  await selectScenario(controls, scenario);
}

async function chooseEmptySelection(controls: Page): Promise<void> {
  await choose(controls, "workspaces");
  await selectOption(controls.getByLabel("Workspace examples"), "empty");
}

test("direct scenarios render workspace views without workshop controls in the preview", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=remove");
  const preview = await openPreview(page);
  await expect(preview.getByRole("dialog")).toBeVisible();
  await expect(
    preview.getByRole("heading", { name: "Remove from your list?" }),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Keep in list" }).click();
  await expect(
    page.getByText("Current screen: Workspace selection"),
  ).toBeVisible();
  await expect(
    preview.getByRole("heading", { name: "Design workshop" }),
  ).toHaveCount(0);
  await chooseEmptySelection(page);
  await expect(
    preview.getByRole("heading", { name: "Welcome to Situate." }),
  ).toBeVisible();
  await choose(page, "restore-error");
  await preview.getByText("Review", { exact: true }).click();
  await expect(
    preview.getByText("The workspace folder could not be found."),
  ).toBeVisible();
  await choose(page, "startup-error");
  await expect(preview.getByRole("alert")).toContainText(
    "Workspaces could not be opened.",
  );
  await preview.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(preview.locator(".workspace-entry")).toBeVisible();
});

test("workspace action cards retain contrast and list rows retain their compact shape", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=workspaces");
  const preview = await openPreview(page);
  const create = preview.getByRole("button", { name: /Create a workspace/ });
  await expect(create).toHaveCSS("background-color", "rgb(48, 32, 62)");
  await expect(create).toHaveCSS("color", "rgb(255, 254, 250)");
  await expect(create).toHaveCSS("border-radius", "16px");
  await expect(create).toHaveCSS("padding", "16px 20px");

  const row = preview.locator(".workspace-select").first();
  await expect(row).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(row).toHaveCSS("border-radius", "12px");
  await expect(row).toHaveCSS("border-top-width", "0px");
  await expect(row).toHaveCSS("padding", "12px");
  const actions = preview.locator(".row-actions").first();
  await expect(actions).toHaveCSS("width", "44px");
  await expect(actions).toHaveCSS("padding", "0px");
  await expect(actions).toHaveCSS("border-top-width", "0px");

  await create.hover();
  await expect(create).toHaveCSS("background-color", "rgb(98, 50, 188)");
  await expect(create).toHaveCSS("color", "rgb(255, 254, 250)");
});

test("simulates folder validation and creation without native services", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=collision");
  const preview = await openPreview(page);
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));
  await expect(
    preview.getByText("This folder already exists.", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Create workspace", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("New workspace folder already exists").uncheck();
  await expect(
    preview.getByRole("button", { name: "Create workspace", exact: true }),
  ).toBeEnabled();
  await preview.getByLabel("Workspace name", { exact: true }).fill("Book list");
  await preview.getByRole("button", { name: "Choose…", exact: true }).click();
  await expect(preview.locator("output")).toHaveText(
    "/Example/Selected folder/Book list",
  );
  await page.getByLabel("New workspace folder already exists").check();
  await expect(
    preview.getByText("This folder already exists.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("New workspace folder already exists").uncheck();
  await expect(preview.locator("output")).toHaveText(
    "/Example/Selected folder/Book list",
  );
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  await expect(
    preview.locator('.setup-steps [aria-current="step"]'),
  ).toContainText("Connect AI");
  await expect(page.getByText("Current screen: Choose provider")).toBeVisible();
  expect(errors).toEqual([]);
});

test("holds, fails, retries and resets interactive actions", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=workspaces");
  await selectOption(page.getByLabel("Workspace examples"), "empty");
  const preview = await openPreview(page);
  await selectOption(page.getByLabel("Action result"), "wait");
  await preview.getByRole("button", { name: /Open a workspace/ }).click();
  await expect(preview.getByRole("status")).toHaveText("Working…");
  await expect(page.getByText("Waiting: pick", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fail action", exact: true }).click();
  await expect(preview.getByRole("alert")).toContainText(
    "The workspace could not be opened.",
  );
  await preview.getByRole("button", { name: /Open a workspace/ }).click();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(preview.locator(".app-shell")).toBeVisible();
  await page.getByRole("button", { name: "Reset scenario" }).click();
  await expect(
    preview.getByRole("heading", { name: "Where would you like to begin?" }),
  ).toBeVisible();
  await selectOption(page.getByLabel("Action result"), "wait");
  await preview.getByRole("button", { name: /Open a workspace/ }).click();
  await expect(
    page.getByRole("button", { name: "Complete", exact: true }),
  ).toBeEnabled();
  await choose(page, "create");
  await expect(
    preview.getByRole("heading", { name: "Make room for what matters." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete", exact: true }),
  ).toHaveCount(0);
});

test("reports actual viewport size and keeps platform independent", async ({
  page,
}) => {
  await page.goto("/?workshop=controls");
  const preview = await openPreview(page);
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Actual viewport")).toHaveText("390 × 844");
  await expect(page.getByLabel("Platform", { exact: true })).toHaveAttribute(
    "data-value",
    "desktop",
  );
  await selectOption(page.getByLabel("Platform", { exact: true }), "mobile");
  await expect(preview.locator(".mobile-entry")).toBeVisible();
  await selectOption(page.getByLabel("Workspace examples"), "long");
  await expect(preview.locator(".workspace-row").first()).toContainText(
    "community garden",
  );
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await preview.setViewportSize({ width: 800, height: 600 });
  await expect(page.getByLabel("Actual viewport")).toHaveText("800 × 600");
  await expect(page.getByLabel("Platform", { exact: true })).toHaveAttribute(
    "data-value",
    "mobile",
  );
});

test("reconnects after reload and recreates a closed preview with the current scenario", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=create");
  let preview = await openPreview(page);
  await preview
    .getByLabel("Workspace name", { exact: true })
    .fill("Garden plans");
  await preview.reload();
  await expect(
    preview.getByLabel("Workspace name", { exact: true }),
  ).toHaveValue("Garden plans");
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Choose a provider" }),
  ).toBeVisible();
  await choose(page, "access-error");
  await expect(preview.getByRole("alert")).toContainText(
    "Access to this workspace was denied.",
  );
  await preview.close();
  await expect(
    page.getByText("Preview disconnected", { exact: true }),
  ).toBeVisible({ timeout: 6000 });
  preview = await openPreview(page);
  await expect(preview.getByRole("alert")).toContainText(
    "Access to this workspace was denied.",
  );
  await preview.getByRole("button", { name: /Open a workspace/ }).click();
  await expect(preview.locator(".app-shell")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Preview connected", { exact: true }),
  ).toBeVisible();
  await chooseEmptySelection(page);
  await expect(
    preview.getByRole("heading", { name: "Welcome to Situate." }),
  ).toBeVisible();
});

test("isolates simultaneous browser workshops", async ({ page, context }) => {
  await page.goto("/?workshop=controls&scenario=workspaces");
  await selectOption(page.getByLabel("Workspace examples"), "empty");
  const first = await openPreview(page);
  const other = await context.newPage();
  await other.goto("/?workshop=controls&scenario=create");
  const second = await openPreview(other);
  await choose(other, "remove");
  await expect(second.getByRole("dialog")).toBeVisible();
  await expect(
    first.getByRole("heading", { name: "Welcome to Situate." }),
  ).toBeVisible();
});

test("keeps local typing and focus responsive while synchronizing form changes", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=workspaces");
  await selectOption(page.getByLabel("Workspace examples"), "empty");
  const preview = await openPreview(page);
  await preview.getByRole("button", { name: /Create a workspace/ }).click();
  await preview.getByRole("button", { name: /Skip/i }).click();
  await expect(
    preview.getByRole("heading", { name: "Make room for what matters." }),
  ).toBeFocused();
  const name = preview.getByLabel("Workspace name", { exact: true });
  await name.pressSequentially("Garden notes and reading lists", { delay: 1 });
  await expect(name).toHaveValue("Garden notes and reading lists");
  await expect(
    page.getByText("Current screen: Create workspace"),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    preview.getByRole("button", { name: /Create a workspace/ }),
  ).toBeFocused();
});

test("shows screen-specific controls as the preview navigates and opens dialogs", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=workspaces");
  const preview = await openPreview(page);
  const examples = page.getByLabel("Workspace examples");
  const folder = page.getByLabel("New workspace folder already exists");
  const error = page.getByLabel("Error message");
  await expect(examples).toBeVisible();
  await expect(folder).toHaveCount(0);
  await expect(error).toBeVisible();
  await preview.getByRole("button", { name: /Create a workspace/ }).click();
  await preview.getByRole("button", { name: /Skip/i }).click();
  await expect(folder).toBeVisible();
  await expect(examples).toHaveCount(0);
  await folder.check();
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toHaveAttribute("data-value", "workspaces");
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(folder).toHaveCount(0);
  await expect(examples).toBeVisible();
  await preview.getByRole("button", { name: /Create a workspace/ }).click();
  await preview.getByRole("button", { name: /Skip/i }).click();
  await expect(folder).toBeChecked();
  await folder.uncheck();
  await preview
    .getByLabel("Workspace name", { exact: true })
    .fill("Reading plans");
  await preview
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page.getByText("Current screen: Choose provider")).toBeVisible();
  await expect(examples).toHaveCount(0);
  await expect(folder).toHaveCount(0);

  await choose(page, "workspaces");
  await preview.locator(".row-actions").first().click();
  await preview
    .getByRole("menuitem", { name: "Remove from list", exact: true })
    .click();
  await expect(
    page.getByText("Current screen: Remove confirmation"),
  ).toBeVisible();
  await expect(examples).toHaveCount(0);
  await expect(folder).toHaveCount(0);
  await error.fill("This workspace could not be removed.");
  await expect(preview.getByRole("dialog").getByRole("alert")).toHaveText(
    "This workspace could not be removed.",
  );
  await expect(preview.getByRole("dialog").getByRole("alert")).toHaveCSS(
    "border-inline-start-width",
    "0px",
  );
  await preview.getByRole("button", { name: "Keep in list" }).click();
  await expect(examples).toBeVisible();
  await expect(folder).toHaveCount(0);
});

test("keeps global settings while exposing only available startup actions", async ({
  page,
}) => {
  await page.goto("/?workshop=controls&scenario=startup");
  const preview = await openPreview(page);
  await expect(page.getByLabel("Workspace examples")).toHaveCount(0);
  await expect(
    page.getByLabel("New workspace folder already exists"),
  ).toHaveCount(0);
  await expect(page.getByLabel("Error message")).toHaveCount(0);
  await expect(page.getByLabel("Action result")).toHaveCount(0);
  await expect(page.getByLabel("Platform", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Width", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Scenario", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fail action", exact: true }).click();
  await expect(
    preview.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Action result")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Complete", exact: true }),
  ).toHaveCount(0);
  await selectOption(page.getByLabel("Action result"), "wait");
  await preview.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByLabel("Action result")).toHaveCount(0);
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.getByLabel("Workspace examples")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fail action", exact: true }),
  ).toHaveCount(0);
});

test("rejects commands originating before a scenario reset", async ({
  page,
}) => {
  await page.goto("/?workshop=controls");
  const preview = await openPreview(page);
  const previous = await page.evaluate(async () => {
    const session = new URL(location.href).searchParams.get("session");
    const channel = new BroadcastChannel(`situate-design-${session}`);
    const state = await new Promise<{ host: string; state: { epoch: number } }>(
      (resolve) => {
        channel.onmessage = (event) => {
          if (event.data.message.type === "state") resolve(event.data.message);
        };
        channel.postMessage({
          role: "preview",
          message: {
            type: "hello",
            viewport: { width: 1280, height: 800, scale: 1 },
          },
        });
      },
    );
    channel.close();
    return { session, host: state.host, epoch: state.state.epoch };
  });
  await chooseEmptySelection(page);
  await expect(
    preview.getByRole("heading", { name: "Welcome to Situate." }),
  ).toBeVisible();
  await page.evaluate(async (previous) => {
    const channel = new BroadcastChannel(`situate-design-${previous.session}`);
    const response = new Promise<void>((resolve) => {
      channel.onmessage = (event) => {
        if (event.data.message.type === "state") resolve();
      };
    });
    channel.postMessage({
      role: "preview",
      message: {
        type: "command",
        host: previous.host,
        epoch: previous.epoch,
        sequence: 100,
        command: {
          type: "action",
          operation: { request: "stale", action: "pick" },
        },
      },
    });
    await response;
    channel.close();
  }, previous);
  await expect(
    preview.getByRole("heading", { name: "Welcome to Situate." }),
  ).toBeVisible();
  await expect(
    page.getByText("Current screen: Workspace selection"),
  ).toBeVisible();
});
