import { en, de } from "@situate/localization";
import { expect, test, type Page } from "./test";
import { emptyLayout } from "../../src/layout/model";
import { shellState, workspaceFixture } from "./workspace-fixture";

const views = [
  { id: "garden-tools:calendar", title: "Calendar", icon: "calendar" },
  { id: "garden-tools:tasks", title: "Tasks", icon: "tasks" },
  { id: "garden-tools:notes", title: "Garden notes", icon: "notes" },
  { id: "garden-tools:reading", title: "Reading list", icon: "notes" },
  { id: "garden-tools:review", title: "Weekly review", icon: "tasks" },
];
const manifest = {
  schemaVersion: 2,
  id: "garden-tools",
  name: "Garden tools",
  description: "Views for a personal garden project.",
  uiEntry: "ui.js",
  skills: [],
  platforms: ["macos", "ios"] as ("macos" | "ios")[],
};
const entry = `export default host => ({
  views: ${JSON.stringify(views)}.map(view => ({
    ...view,
    title: () => view.title,
    component: host.vue.defineComponent({
      setup: () => () => host.vue.h('h1', {'data-localization-content': 'user'}, view.title),
    }),
  })),
});`;

async function storedPins(page: Page) {
  return page.evaluate(async () => {
    const data = (await window.__layoutTest.stored("garden")).data;
    return (data as { pinnedViews: string[] } | null)?.pinnedViews;
  });
}

for (const locale of ["en", "de"] as const) {
  test.describe(locale, () => {
    test.use({
      locale: locale === "de" ? "de-DE" : "en-US",
      localizationMode: "real",
    });
    const copy = locale === "de" ? de : en;
    const pinLabel = (title: string, pinned = false) =>
      copy[pinned ? "layoutHost.unpin" : "layoutHost.pin"].replace(
        "{title}",
        title,
      );
    async function navigation(page: Page) {
      const sidebar = page.getByRole("navigation", {
        name: copy["navigation.workspaceNavigation"],
        exact: true,
      });
      const open = page.getByRole("button", {
        name: copy["navigation.openNavigation"],
        exact: true,
      });
      await expect
        .poll(
          async () => (await sidebar.isVisible()) || (await open.isVisible()),
        )
        .toBe(true);
      if (!(await sidebar.isVisible())) await open.click();
      await expect(sidebar).toBeVisible();
      return sidebar;
    }
    async function setup(page: Page, mobile = false) {
      await workspaceFixture(
        page,
        { ...shellState, mobile },
        {
          localization: {
            language: locale,
            formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
            writable: true,
          },
          installedPlugins: [
            { id: manifest.id, enabled: true, error: null, manifest },
          ],
          pluginSources: {
            [manifest.id]: {
              manifest,
              serviceEntry: null,
              uiEntry: entry,
              skills: [],
            },
          },
          layout: {
            records: {
              garden: {
                revision: "saved",
                data: {
                  version: 1,
                  layout: emptyLayout(),
                  pinnedViews: ["files"],
                },
              },
            },
          },
        },
      );
      await page.goto("/");
      const sidebar = await navigation(page);
      await expect(
        sidebar.getByRole("button", {
          name: copy["navigation.more"],
          exact: true,
        }),
      ).toBeVisible();
      return sidebar;
    }

    for (const viewport of [
      { width: 1440, height: 920 },
      { width: 390, height: 844 },
    ]) {
      test(
        `view navigation groups and persists pins at ${viewport.width}px`,
        { tag: viewport.width < 600 ? "@visual-mobile" : "@visual-desktop" },
        async ({ page, visual }, info) => {
          await page.setViewportSize(viewport);
          let sidebar = await setup(page, viewport.width < 600);
          let more = sidebar.getByRole("button", {
            name: copy["navigation.more"],
            exact: true,
          });
          const group = sidebar.getByRole("group", {
            name: copy["navigation.moreViews"],
            exact: true,
          });
          await expect(more).toHaveText(copy["navigation.more"]);
          await expect(more).toHaveAttribute("aria-expanded", "false");
          await expect(group).not.toBeVisible();
          await expect(
            sidebar.getByRole("button", {
              name: pinLabel(copy["navigation.files"], true),
              exact: true,
            }),
          ).toHaveAttribute("aria-pressed", "true");
          const pin = sidebar.locator('[data-view-pin="files"] svg');
          expect(
            await pin.evaluate((node) => getComputedStyle(node).fill),
          ).not.toBe("none");
          await visual.capture("navigation.views.collapsed");
          await more.focus();
          await more.press("Enter");
          await expect(more).toBeFocused();
          await expect(more).toHaveAttribute("aria-expanded", "true");
          await expect(group.locator(".nav-destination")).toHaveText(
            views.map((view) => view.title),
          );
          await expect(
            group.getByRole("button", {
              name: pinLabel("Calendar"),
              exact: true,
            }),
          ).toHaveAttribute("aria-pressed", "false");
          await expect(group.locator("svg").last()).toHaveCSS("fill", "none");
          await visual.capture("navigation.views.expanded");
          await page.screenshot({
            path: info.outputPath("views-expanded.png"),
          });
          await more.press("Space");
          await expect(group).not.toBeVisible();
          await more.click();
          await group
            .getByRole("button", { name: pinLabel("Calendar"), exact: true })
            .click();
          await expect(
            sidebar.getByRole("button", {
              name: pinLabel("Calendar", true),
              exact: true,
            }),
          ).toBeFocused();
          await expect
            .poll(() => storedPins(page))
            .toEqual(["files", "garden-tools:calendar"]);
          await page.reload();
          sidebar = await navigation(page);
          await expect(
            sidebar.getByRole("button", {
              name: pinLabel("Calendar", true),
              exact: true,
            }),
          ).toBeVisible();
          more = sidebar.getByRole("button", {
            name: copy["navigation.more"],
            exact: true,
          });
          await expect(more).toHaveAttribute("aria-expanded", "false");
          await more.click();
          for (const view of views.slice(1)) {
            await sidebar
              .getByRole("button", { name: pinLabel(view.title), exact: true })
              .click();
          }
          await expect(more).toHaveCount(0);
          await expect(sidebar.locator(".nav-destination")).toHaveCount(6);
          await expect(
            sidebar.getByRole("button", {
              name: pinLabel("Weekly review", true),
              exact: true,
            }),
          ).toBeFocused();
          await visual.capture("navigation.views.all-pinned");
          await sidebar
            .getByRole("button", {
              name: pinLabel("Calendar", true),
              exact: true,
            })
            .click();
          await expect(more).toHaveAttribute("aria-expanded", "true");
          await expect(
            sidebar.getByRole("button", {
              name: pinLabel("Calendar"),
              exact: true,
            }),
          ).toBeFocused();
          for (const title of [
            copy["navigation.files"],
            ...views.slice(1).map((view) => view.title),
          ]) {
            await sidebar
              .getByRole("button", { name: pinLabel(title, true), exact: true })
              .click();
          }
          await expect(more).toHaveCount(0);
          await expect(sidebar.locator(".nav-destination")).toHaveCount(6);
          await expect(
            sidebar.locator(".view-pin[aria-pressed=true]"),
          ).toHaveCount(0);
          await expect.poll(() => storedPins(page)).toEqual([]);
          await visual.capture("navigation.views.no-pins");
          await sidebar
            .getByRole("button", { name: "Calendar", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: "Calendar", exact: true }),
          ).toBeVisible();
          if (viewport.width < 600) await expect(sidebar).not.toBeVisible();
        },
      );
    }

    test("navigation icons stay aligned when additional views make the sidebar scroll", async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 1440, height: 540 });
      const sidebar = await setup(page);
      const scroller = sidebar.locator(".sidebar-content");
      const overflows = () =>
        scroller.evaluate((node) => node.scrollHeight > node.clientHeight);
      expect(await overflows()).toBe(false);
      const controls = [
        sidebar.locator('[data-view-pin="files"]'),
        sidebar.locator(".conversations .section-heading").getByRole("button", {
          name: copy["navigation.newChat"],
          exact: true,
        }),
        sidebar.locator(".more-views"),
      ];
      const positions = await Promise.all(
        controls.map(async (control) => (await control.boundingBox())!.x),
      );
      await sidebar.locator(".more-views").click();
      expect(await overflows()).toBe(true);
      for (const [index, control] of controls.entries())
        expect((await control.boundingBox())!.x).toBeCloseTo(
          positions[index]!,
          1,
        );
      await page.screenshot({ path: info.outputPath("views-scrollbar.png") });
      await sidebar.locator(".more-views").click();
      expect(await overflows()).toBe(false);
      for (const [index, control] of controls.entries())
        expect((await control.boundingBox())!.x).toBeCloseTo(
          positions[index]!,
          1,
        );
    });
  });
}
