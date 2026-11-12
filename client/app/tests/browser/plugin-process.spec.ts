import { randomUUID } from "node:crypto";
import { expect, test } from "./test";
import { shellState, workspaceFixture } from "./workspace-fixture";
import { emptyLayout, reduceLayout } from "../../src/layout/model";

const manifest = {
  schemaVersion: 2,
  id: "reading-list",
  name: "Reading list",
  description: "Read the list from a local program.",
  uiEntry: "ui.js",
  serviceEntry: "service.js",
  exports: ["read"],
  skills: [],
  platforms: ["macos"] as "macos"[],
};
const entry = `export default (host) => ({
  views: [{
    id: 'reading-list:main', title: () => 'Reading list', icon: 'notes',
    component: host.vue.defineComponent({
      setup() {
        const result = host.vue.ref('No list loaded.');
        async function read() {
          try {
            result.value = await host.service.invoke('read',{});
          } catch { result.value = 'Read canceled.'; }
        }
        return () => host.vue.h('section', {'data-localization-content':'user'}, [
          host.vue.h(host.ui.SituateButton, {onClick:read}, () => 'Read local list'),
          host.vue.h('output', result.value),
        ]);
      }
    })
  }]
});`;

for (const locale of ["en-US", "de-DE"] as const) {
  test.describe(locale, () => {
    test.use({ locale, localizationMode: "real" });
    test(`a connection view routes local commands through native services (${locale}) @visual-desktop`, async ({
      page,
      visual,
    }) => {
      await page.setViewportSize({ width: 700, height: 900 });
      const layout = reduceLayout(
        emptyLayout(),
        { type: "open", target: { kind: "view", viewId: "reading-list:main" } },
        randomUUID,
      );
      await workspaceFixture(page, shellState, {
        localization: {
          language: locale === "de-DE" ? "de" : "en",
          formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
          writable: true,
        },
        installedPlugins: [
          {
            id: manifest.id,
            incarnation: "process-installation",
            enabled: true,
            error: null,
            manifest,
          },
        ],
        pluginSources: {
          [manifest.id]: {
            manifest,
            uiEntry: entry,
            serviceEntry: `export default () => ({exports:{read:async (_args,host)=>{const reply=await host.process.run({executable:"/usr/bin/printf",args:["A small reading list"]});return reply.commandResult.Ok.stdout.text;}}});`,
            skills: [],
          },
        },
        pluginExportResults: {
          [manifest.id]: { read: "A small reading list" },
        },
        layout: {
          records: {
            garden: {
              revision: "saved",
              pluginIncarnations: { [manifest.id]: "process-installation" },
              data: { version: 1, layout, pinnedViews: [] },
            },
          },
        },
      });
      await page.goto("/");
      const read = page.getByRole("button", {
        name: "Read local list",
        exact: true,
      });
      await expect(read).toBeVisible();
      const requests = () =>
        page.evaluate(() =>
          Reflect.get(window, "__ipcCalls").filter(
            (call: {
              command: string;
              args: { request?: { operation?: string } };
            }) =>
              call.command === "plugin_executor" &&
              call.args.request?.operation === "invoke",
          ),
        );
      await read.click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("output")).toHaveText("A small reading list");
      expect(await requests()).toHaveLength(1);
      expect(
        await page.evaluate(() =>
          (Reflect.get(window, "__ipcCalls") as { command: string }[]).filter(
            (call) => call.command === "plugin_host_request",
          ),
        ),
      ).toEqual([]);
      await page.mouse.move(0, 0);
      await visual.capture("plugins.process.result");
    });
  });
}
