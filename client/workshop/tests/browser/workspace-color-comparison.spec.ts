import { selectScenario } from "./scenarios";
import { selectOption } from "./select";
import { expect, test, type Page } from "./test";

async function openPreview(page: Page, scenario: string) {
  await page.goto(`/?workshop=controls&scenario=${scenario}&profile=mac`);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview", exact: true }).click();
  const preview = await popup;
  await preview.setViewportSize({ width: 1280, height: 800 });
  return preview;
}

test("file reference accents change color without changing the split or draft", async ({
  page,
}, testInfo) => {
  const preview = await openPreview(page, "files-chat-with-reply");
  const errors: string[] = [];
  preview.on("pageerror", (error) => errors.push(error.message));

  const accent = page.getByRole("combobox", { name: "File reference accent" });
  const file = preview.getByRole("button", {
    name: /^preparation\.md Keep it simple/,
  });
  const icon = file.locator(".file-preview-icon");
  const note = preview.getByRole("heading", {
    name: "Autumn workshop",
    exact: true,
  });
  const draft = preview.getByRole("textbox", { name: "Message", exact: true });
  const background = (element: typeof file) =>
    element.evaluate((node) => getComputedStyle(node).backgroundColor);

  await expect(note).toBeVisible();
  await expect(file).toBeVisible();
  await expect(preview.getByText("File reference accent")).toHaveCount(0);
  await expect(file).toHaveAttribute("data-appearance", "preview");
  await selectOption(accent, "neutral");
  await expect(file).toHaveAttribute("data-appearance", "neutral");
  const neutralBackground = await background(file);
  const neutralIcon = await background(icon);

  for (const appearance of ["neutral", "icon", "preview"]) {
    if (appearance !== "neutral") await selectOption(accent, appearance);
    await expect(file).toHaveAttribute("data-appearance", appearance);
    await expect(note).toBeVisible();
    await expect(draft).toBeVisible();
    const bounds = (await file.boundingBox())!;
    expect(bounds.x).toBeGreaterThan((await note.boundingBox())!.x);
    expect(bounds.y + bounds.height).toBeLessThan(800);
    await preview.screenshot({
      path: testInfo.outputPath(`${appearance}.png`),
    });
  }
  expect(await background(file)).not.toBe(neutralBackground);
  await draft.fill("Could you draft the invitation?");
  await selectOption(accent, "icon");
  await expect(file).toHaveAttribute("data-appearance", "icon");
  expect(await background(file)).toBe(neutralBackground);
  expect(await background(icon)).not.toBe(neutralIcon);
  await expect(draft).toHaveValue("Could you draft the invitation?");

  await preview.setViewportSize({ width: 1040, height: 700 });
  await expect(file).toBeVisible();
  await expect(draft).toBeInViewport();
  expect(
    await preview.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1040);
  await file.focus();
  await expect(file).toBeFocused();
  await file.press("Enter");
  await expect(
    preview.getByRole("heading", {
      name: "A few things to prepare",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Reset scenario" }).click();
  await expect(file).toHaveAttribute("data-appearance", "preview");
  await expect(note).toBeVisible();
  await expect(draft).toHaveValue("");
  expect(errors).toEqual([]);
});

test("the companion tint frames content without filling the surrounding view", async ({
  page,
}, testInfo) => {
  const preview = await openPreview(page, "documents-preview");
  const capture = (name: string) =>
    preview.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  const background = (selector: string) =>
    preview
      .locator(selector)
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);

  await expect(preview.locator(".doc-page-stage .doc-paper")).toBeVisible();
  await expect(preview.locator(".doc-page-stage")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await capture("document");

  await selectScenario(page, "chat-queue-mixed");
  await expect(
    preview.locator(".change-card .file-preview-header"),
  ).toBeVisible();
  await expect(preview.locator(".draft-attachments .attachment")).toBeVisible();
  await capture("queue");

  await selectScenario(page, "tabs-overview");
  const note = preview
    .getByRole("button", { name: "Weekend plan", exact: true })
    .and(preview.locator(".file-preview"));
  await expect(note).toBeVisible();
  await capture("tabs");

  await selectScenario(page, "plugins-list");
  await expect(preview.locator(".plugin-create-panel")).toBeVisible();
  expect(await background(".plugin-create-panel")).not.toBe(
    await background(".plugin-row"),
  );
  await capture("plugins");

  await selectScenario(page, "setup-conversation-support");
  await expect(preview.locator(".message-file").first()).toBeVisible();
  await capture("setup");
});

test("a warm workspace color gets a cool preview with readable excerpt text", async ({
  page,
}, testInfo) => {
  const preview = await openPreview(page, "files-chat-with-reply");
  const file = preview.locator(".reply-file");
  await expect(file).toBeVisible();
  await preview.getByRole("button", { name: "Settings", exact: true }).click();
  await preview.getByRole("button", { name: /^Appearance/ }).click();
  await preview.getByRole("radio", { name: "Peach", exact: true }).check();
  await preview.getByRole("button", { name: "Files", exact: true }).click();
  await expect(file).toBeVisible();
  await expect(preview.locator("[data-workspace-accent]")).toHaveAttribute(
    "data-workspace-accent",
    "peach",
  );

  const { background, ratio } = await file.evaluate((node) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    function rgb(color: string) {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    }
    function luminance(channels: number[]) {
      const [r, g, b] = channels.map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
    }
    const background = rgb(getComputedStyle(node).backgroundColor);
    const foreground = rgb(
      getComputedStyle(node.querySelector("small")!).color,
    );
    return {
      background,
      ratio: (luminance(background) + 0.05) / (luminance(foreground) + 0.05),
    };
  });
  expect(background[2]!).toBeGreaterThan(background[0]!);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  await preview.screenshot({
    path: testInfo.outputPath("peach-workspace.png"),
  });
});
