import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";

test.use({ localizationMode: "real" });

test(
  "opening a workspace keeps navigation available while its layout loads",
  {
    tag: "@visual-desktop",
  },
  async ({ page, visual }) => {
    let releaseLayout!: () => void;
    const layoutReady = new Promise<void>((resolve) => {
      releaseLayout = resolve;
    });
    await workspaceFixture(page, shellState, {
      layout: { waitForLoad: layoutReady },
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const status = page
      .getByRole("status")
      .filter({ hasText: "Opening your workspace…" });
    await expect(status).toBeInViewport();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", {
        name: "Workspace navigation",
        exact: true,
      }),
    ).toBeVisible();
    await visual.capture("layout.workspace.opening");

    await page.setViewportSize({ width: 560, height: 480 });
    await expect(status).toBeInViewport();
    const eyes = page.locator(".workspace-loading .loading-symbol .rest");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(eyes).toHaveCSS("animation-duration", "2.4s");
    const openNavigation = page.getByRole("button", {
      name: "Open navigation",
      exact: true,
    });
    await openNavigation.click();
    await expect(eyes).toHaveCSS("animation-name", "none");
    await page.keyboard.press("Escape");
    await expect(openNavigation).toBeFocused();
    await expect(eyes).toHaveCSS("animation-duration", "2.4s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(eyes).toHaveCSS("animation-name", "none");

    releaseLayout();
    await expect(status).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "What would you like here?" }),
    ).toBeVisible();
    await expect(openNavigation).toBeFocused();
  },
);
