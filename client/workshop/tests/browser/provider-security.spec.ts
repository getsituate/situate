import { selectOption } from "./select";
import { expect, test, type Page } from "./test";

async function open(controls: Page, scenario: string) {
  await controls.goto(`/?workshop=controls&scenario=${scenario}`);
  const popup = controls.waitForEvent("popup");
  await controls
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  const preview = await popup;
  await expect(
    preview.locator(".ai-view, .settings-view").first(),
  ).toBeVisible();
  return preview;
}

for (const size of [
  { width: 1200, height: 850 },
  { width: 390, height: 480 },
  { width: 320, height: 568 },
  { width: 1440, height: 900 },
]) {
  test(`provider warning and storage recovery are explicit at ${size.width}px`, async ({
    page,
  }, info) => {
    const preview = await open(page, "ai-warning");
    await preview.setViewportSize(size);
    const external: string[] = [];
    preview.on("request", (request) => {
      if (!request.url().startsWith(new URL(preview.url()).origin))
        external.push(request.url());
    });
    const acknowledge = preview.getByRole("button", {
      name: "Continue",
    });
    await expect(acknowledge).toBeDisabled();
    await expect(preview.locator(".guidance-address")).toHaveAttribute(
      "href",
      "https://orbit.example.invalid/account-access",
    );
    await preview.screenshot({
      path: info.outputPath(`provider-warning-${size.width}.png`),
    });
    await preview.locator(".guidance-address").click();
    await expect(
      page.getByText(
        "Provider guidance requested: https://orbit.example.invalid/account-access",
      ),
    ).toBeVisible();
    await preview.getByRole("checkbox").focus();
    await preview.keyboard.press("Space");
    await expect(acknowledge).toBeEnabled();
    await acknowledge.click();
    await preview
      .getByRole("button", { name: "Open sign-in in browser" })
      .click();
    await page.locator('[data-outcome="success"]').click();
    await page.locator('[data-outcome="store-save-denied"]').click();
    await expect(
      preview.getByRole("heading", {
        name: "Allow Situate to save your sign-in",
      }),
    ).toBeVisible();
    await preview.getByRole("button", { name: "Try again" }).click();
    await page.locator('[data-outcome="store-ready"]').click();
    await page.locator('[data-outcome="success"]').click();
    await expect(
      preview.getByRole("heading", { name: "AI access connected" }),
    ).toBeVisible();
    expect(
      await preview.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(external).toEqual([]);
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(preview.getByRole("checkbox")).not.toBeChecked();
    await expect(acknowledge).toBeDisabled();
  });
}

test("known prohibition has no acknowledgement bypass and leaves API-key access separate", async ({
  page,
}) => {
  const preview = await open(page, "ai-blocked-subscription");
  await expect(
    preview.getByRole("heading", {
      name: "This subscription can’t connect",
    }),
  ).toBeVisible();
  await expect(preview.getByRole("checkbox")).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Open sign-in in browser" }),
  ).toHaveCount(0);
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await preview.locator('[data-method="key"]').click();
  await expect(preview.locator("#credential")).toBeVisible();
});

test("changed warnings remain blocked after returning to settings until acknowledged", async ({
  page,
}) => {
  const preview = await open(page, "settings-error");
  await selectOption(
    page.getByLabel("Provider state", { exact: true }),
    "restriction",
  );
  await preview
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const external: string[] = [];
  preview.on("request", (request) => {
    if (!request.url().startsWith(new URL(preview.url()).origin))
      external.push(request.url());
  });
  await expect(
    preview.getByText(/now also bans requests sent while you’re away/),
  ).toBeVisible();
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    preview.getByRole("button", { name: "Review changes" }),
  ).toBeVisible();
  const orbit = preview
    .locator(".provider-row")
    .filter({ hasText: "Orbit Example" });
  await expect(orbit).toContainText("Review changes");
  await preview
    .getByRole("button", { name: "Manage Orbit Example", exact: true })
    .click();
  await preview.getByRole("button", { name: "Review changes" }).click();
  await expect(preview.getByRole("checkbox")).not.toBeChecked();
  await preview.getByRole("checkbox").check();
  await preview.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    preview.getByRole("button", { name: "Review changes" }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Manage Orbit Example", exact: true }),
  ).toBeFocused();
  await expect(orbit).toContainText("Connected");
  await expect(
    preview.getByRole("button", { name: "Manage OpenAI", exact: true }),
  ).toBeVisible();
  expect(external).toEqual([]);
});

test("copied credentials, OS-store locks and forgetting local access have separate recovery", async ({
  page,
}) => {
  const preview = await open(page, "settings-error");
  await selectOption(
    page.getByLabel("Provider state", { exact: true }),
    "missing",
  );
  await expect(
    preview.locator(".provider-row").filter({ hasText: "OpenAI" }),
  ).toContainText("Connect on this device");
  await expect(preview.getByRole("button", { name: "Try again" })).toHaveCount(
    0,
  );
  await selectOption(
    page.getByLabel("Provider state", { exact: true }),
    "locked",
  );
  await preview.getByRole("button", { name: "Try again" }).click();
  await page.locator('[data-outcome="store-ready"]').click();
  await expect(
    preview.locator(".provider-row").filter({ hasText: "OpenAI" }),
  ).toContainText("Connected");
  await expect(preview.locator(".ai-view")).toHaveCount(0);
  await preview
    .getByRole("button", { name: "Manage OpenAI", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Connected", exact: true }),
  ).toBeVisible();
  await preview.getByText("Manage connection", { exact: true }).click();
  await preview
    .getByRole("button", { name: "Forget sign-in", exact: true })
    .click();
  await expect(
    preview.getByText(/Other devices and workspaces are not affected/),
  ).toBeVisible();
  await preview
    .getByRole("dialog")
    .getByRole("button", { name: "Forget sign-in", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", { name: "Connect on this device" }),
  ).toBeVisible();
  await expect(preview.locator(".summary").first()).toContainText("OpenAI");
  await expect(
    preview.getByText("Manage connection", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.getByText(
      /Situate cannot check whether the provider has stopped access/,
    ),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await expect(
    preview.getByText(/Other devices and workspaces keep their connections/),
  ).toBeVisible();
  await preview
    .getByRole("dialog")
    .getByRole("button", { name: "Remove connection", exact: true })
    .click();
  await expect(
    preview.getByRole("heading", {
      name: "Set up AI on this device",
      exact: true,
    }),
  ).toBeVisible();
});

test("connection details stay secondary while recovery and removal remain reachable", async ({
  page,
}, info) => {
  const preview = await open(page, "settings-error");
  await selectOption(
    page.getByLabel("Provider state", { exact: true }),
    "locked",
  );
  await preview
    .getByRole("button", { name: "Manage OpenAI", exact: true })
    .click();
  await preview.setViewportSize({ width: 390, height: 844 });
  await expect(
    preview.getByRole("heading", { name: "Your sign-in details are locked" }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Try again" }),
  ).toBeVisible();
  await expect(
    preview.getByText("Protected by this device", { exact: true }),
  ).toBeHidden();
  await preview.screenshot({
    path: info.outputPath("provider-locked-phone.png"),
  });
  const details = preview.getByText("About this connection", { exact: true });
  await details.focus();
  await preview.keyboard.press("Enter");
  await expect(
    preview.getByText("Protected by this device", { exact: true }),
  ).toBeVisible();
  await preview.keyboard.press("Enter");
  await expect(
    preview.getByText("Protected by this device", { exact: true }),
  ).toBeHidden();
  await preview.getByText("Manage connection", { exact: true }).click();
  await preview
    .getByRole("button", { name: "Forget sign-in", exact: true })
    .click();
  await expect(
    preview.getByRole("dialog", { name: "Forget sign-in on this device?" }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Keep sign-in" }),
  ).toBeFocused();
  await preview.screenshot({
    path: info.outputPath("provider-forget-phone.png"),
  });
  await preview.keyboard.press("Escape");
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Forget sign-in", exact: true }),
  ).toBeFocused();
  await preview
    .getByRole("button", { name: "Forget sign-in", exact: true })
    .click();
  await preview.getByRole("button", { name: "Keep sign-in" }).click();
  await expect(
    preview.getByRole("button", { name: "Forget sign-in", exact: true }),
  ).toBeFocused();
  await expect(
    preview.getByRole("heading", { name: "Your sign-in details are locked" }),
  ).toBeVisible();
});

test("warning acknowledgement and cancel remain reachable with enlarged text", async ({
  page,
}, info) => {
  const preview = await open(page, "ai-warning");
  await preview.setViewportSize({ width: 320, height: 568 });
  await preview.locator(".ai-view").evaluate((node) => {
    (node as HTMLElement).style.fontSize = "200%";
  });
  const acknowledge = preview.getByRole("checkbox");
  await acknowledge.focus();
  await expect(acknowledge).toBeInViewport();
  await preview.keyboard.press("Space");
  const continueButton = preview.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  await expect(continueButton).toBeEnabled();
  await continueButton.focus();
  await expect(continueButton).toBeInViewport();
  expect(
    await preview.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await preview.screenshot({
    path: info.outputPath("provider-warning-enlarged.png"),
  });
  await preview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    preview.getByRole("heading", { name: "Connect Orbit Example" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(preview.getByRole("checkbox")).not.toBeChecked();
});
