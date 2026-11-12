import { expect, test, type Page } from "./test";

async function open(page: Page, scenario = "plugins-connections") {
  await page.goto(`/?workshop=controls&scenario=${scenario}`);
  const pending = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await pending;
  await preview.setViewportSize({ width: 1440, height: 1000 });
  await expect(preview.locator(".plugin-row")).toHaveCount(7);
  return preview;
}

async function contents(preview: Page) {
  return preview.locator(".plugin-row").evaluateAll((cards) =>
    cards.map((card) => ({
      name: card.querySelector("h3")?.textContent,
      description: card.querySelector(".plugin-row-content > p")?.textContent,
      status: card.querySelector(".plugin-availability")?.textContent,
      actions: [...card.querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
    })),
  );
}

test("icon-free cards keep content and actions while comparison stays in controls", async ({
  page,
}) => {
  const preview = await open(page);
  const controls = page.getByRole("group", {
    name: "Card appearance",
    exact: true,
  });
  const plain = controls.getByRole("button", {
    name: "Without icons",
    exact: true,
  });
  const illustrated = controls.getByRole("button", {
    name: "With illustrations",
    exact: true,
  });
  const cards = preview.locator(".plugin-row");
  await expect(plain).toHaveAttribute("aria-pressed", "true");
  await expect(
    cards.locator(
      ".plugin-card-artwork, .plugin-card-top svg, .plugin-row-content svg",
    ),
  ).toHaveCount(0);
  await expect(
    cards.getByRole("button", { name: /^More actions for / }),
  ).toHaveCount(7);
  await expect(preview.locator(".plugin-create-panel img")).toBeVisible();
  await expect(
    preview.getByRole("group", { name: "Card appearance", exact: true }),
  ).toHaveCount(0);
  const before = await contents(preview);
  const height = (await cards.first().boundingBox())!.height;
  const settings = cards
    .first()
    .getByRole("button", { name: "Settings", exact: true });
  await settings.focus();
  await illustrated.click();
  await expect(cards.locator(".plugin-card-artwork")).toHaveCount(7);
  await expect(settings).toBeFocused();
  expect((await cards.first().boundingBox())!.height).toBeGreaterThan(
    height + 60,
  );
  expect(await contents(preview)).toEqual(before);
  await plain.click();
  await expect(
    cards.locator(
      ".plugin-card-artwork, .plugin-card-top svg, .plugin-row-content svg",
    ),
  ).toHaveCount(0);
  expect(await contents(preview)).toEqual(before);
  for (const width of [768, 375, 320]) {
    await preview.setViewportSize({ width, height: 900 });
    const header = cards.first().locator(".plugin-card-top");
    const name = (await header.getByRole("heading").boundingBox())!;
    const status = (await header
      .locator(".plugin-availability")
      .boundingBox())!;
    expect(status.x).toBeGreaterThan(name.x + name.width - 1);
    expect(status.y).toBeLessThan(name.y + name.height);
    expect(
      await preview
        .locator(".plugin-view")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBe(false);
  }
  await preview
    .getByRole("article", { name: "Gmail", exact: true })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(controls).toHaveCount(0);
  await expect(
    preview.getByRole("heading", { name: "Connected accounts", exact: true }),
  ).toBeVisible();
  await preview
    .getByRole("button", { name: "Back to plugins", exact: false })
    .click();
  await expect(plain).toHaveAttribute("aria-pressed", "true");
  await illustrated.click();
  await page
    .getByRole("button", { name: "Reset scenario", exact: true })
    .click();
  await expect(plain).toHaveAttribute("aria-pressed", "true");
  await expect(cards.locator(".plugin-card-artwork")).toHaveCount(0);
});

for (const scenario of [
  "plugins-list-illustrated",
  "plugins-connections-illustrated",
]) {
  test(`${scenario} opens the comparison directly and resets its appearance`, async ({
    page,
  }) => {
    const preview = await open(page, scenario);
    await expect(preview.locator(".plugin-card-artwork")).toHaveCount(7);
    await page
      .getByRole("button", { name: "Without icons", exact: true })
      .click();
    await expect(preview.locator(".plugin-card-artwork")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Reset scenario", exact: true })
      .click();
    await expect(preview.locator(".plugin-card-artwork")).toHaveCount(7);
  });
}
