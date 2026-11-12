import { expect, test } from "./test";
import { onboardingFixture } from "./onboarding-fixture";

test.use({ localizationMode: "real" });

test("keeps the creation frame visible while the connection screen loads", async ({
  page,
}) => {
  await onboardingFixture(page, { startAtEntry: true, connected: false });
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release!: () => void;
  let requested!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loading = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(
    /\/src\/onboarding\/OnboardingHost\.vue(?:\?|$)/,
    async (route) => {
      requested();
      await pending;
      await route.continue();
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: /^Create a workspace/ }).click();
  const name = page.getByRole("textbox", {
    name: "Workspace name",
    exact: true,
  });
  await name.fill("Field notes");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await loading;
  try {
    await expect(page.locator(".setup-frame")).toBeVisible();
    await expect(name).toHaveValue("Field notes");
  } finally {
    release();
  }
  await expect(
    page.getByRole("heading", { name: "Choose a provider", exact: true }),
  ).toBeVisible();
});

for (const [label, accent, background, foreground] of [
  ["Tangerine", "tangerine", "rgb(255, 135, 77)", "rgb(48, 32, 62)"],
  ["Violet", "violet", "rgb(98, 50, 188)", "rgb(255, 254, 250)"],
  ["Cobalt", "cobalt", "rgb(48, 92, 244)", "rgb(255, 254, 250)"],
  ["Sky", "sky", "rgb(72, 183, 255)", "rgb(48, 32, 62)"],
  ["Peach", "peach", "rgb(255, 195, 163)", "rgb(48, 32, 62)"],
  ["Lemon", "lemon", "rgb(244, 240, 109)", "rgb(48, 32, 62)"],
]) {
  test(`creation retains the document and ${label} contrast through required AI setup`, async ({
    page,
  }) => {
    await onboardingFixture(page, { startAtEntry: true, connected: false });
    await page.addInitScript(() => {
      const host = Reflect.get(window, "__TAURI_INTERNALS__");
      const original = host.invoke.bind(host);
      const appearance = new Promise<void>((resolve) => {
        Reflect.set(window, "releaseAppearance", resolve);
      });
      host.invoke = async (command: string, args: Record<string, unknown>) => {
        if (command === "appearance_snapshot") await appearance;
        return original(command, args);
      };
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1120, height: 820 });
    await page.goto("/");
    await page.getByRole("button", { name: /^Create a workspace/ }).click();
    await page
      .getByRole("textbox", { name: "Workspace name", exact: true })
      .fill("Field notes");
    await page
      .getByRole("radio", {
        name: accent === "violet" ? "Violet Default" : label,
        exact: true,
      })
      .check();
    await page.evaluate(() => Reflect.set(window, "handoffDocument", document));
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => navigations.push(frame.url()));
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Choose a provider", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => Reflect.get(window, "handoffDocument") === document,
      ),
    ).toBe(true);
    expect(navigations).toEqual([]);
    expect(page.viewportSize()).toEqual({ width: 1120, height: 820 });
    await expect(page.locator("html")).toHaveAttribute(
      "data-workspace-accent",
      accent,
    );
    const badge = page.locator(".setup-steps .active .badge-fill");
    await expect(badge).toHaveCSS("background-color", background);
    await page
      .getByRole("button", { name: "OpenAI-compatible server", exact: true })
      .click();
    const primary = page.getByRole("button", {
      name: "Save AI access",
      exact: true,
    });
    await expect(primary).toHaveCSS("background-color", background);
    await expect(primary).toHaveCSS("color", foreground);
    await page.evaluate(() => Reflect.get(window, "releaseAppearance")());
    await expect(page.locator("html")).toHaveAttribute(
      "data-workspace-accent",
      accent,
    );
    await expect(badge).toHaveCSS("background-color", background);
    await expect(primary).toHaveCSS("color", foreground);
    await expect(page.locator(".frame-identity")).not.toContainText(
      "Field notes",
    );
    for (const name of ["Finish later", "Open app", "Skip for now"])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0,
      );
    await expect(page.locator(".topic-window")).toHaveCount(0);
    const progress = await page.evaluate(() =>
      Reflect.get(window, "__onboardingFixture").progress(),
    );
    expect(progress).toMatchObject({ step: "access", entered: false });
  });
}
