import { flushPromises, mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import { loadHostModules } from "./module";
import type { PluginUiContributions, PluginUiHost } from "./types";

type InboxHost = Pick<PluginUiHost, "vue" | "ui" | "localization"> & {
  dependencies: Pick<PluginUiHost["dependencies"], "invoke">;
};
const { default: createInbox } = import.meta.glob<{
  default: (host: InboxHost) => PluginUiContributions;
}>("./examples/gmail-inbox/ui.js", { eager: true })[
  "./examples/gmail-inbox/ui.js"
];

const personal = {
  id: "personal",
  email: "personal@example.test",
  permissions: ["metadata"],
  reconnect: false,
};
const work = { ...personal, id: "work", email: "work@example.test" };

it.each([
  {
    preference: null,
    subjects: [
      "personal@example.test: Personal mail",
      "work@example.test: Work mail",
    ],
  },
  { preference: work, subjects: ["work@example.test: Work mail"] },
])(
  "loads readable accounts with preference $preference",
  async ({ preference, subjects }) => {
    const contributions = createInbox({
      ...(await loadHostModules()),
      dependencies: {
        async invoke(pluginId, name, args) {
          expect(pluginId).toBe("situate-gmail");
          if (name === "listAccounts")
            return [
              personal,
              work,
              { ...work, id: "expired", reconnect: true },
            ];
          if (name === "selectedAccount") return preference;
          const { accountId } = args as { accountId: string };
          expect([personal.id, work.id]).toContain(accountId);
          if (name === "listMetadata") return { messages: [{ id: "message" }] };
          expect(name).toBe("getMetadata");
          expect(args).toEqual({ accountId, input: { id: "message" } });
          return {
            payload: {
              headers: [
                {
                  name: "Subject",
                  value: accountId === work.id ? "Work mail" : "Personal mail",
                },
              ],
            },
          };
        },
      },
    });
    const wrapper = mount(contributions.views![0].component);
    try {
      await wrapper.get("button").trigger("click");
      await flushPromises();
      expect(wrapper.findAll("li").map((item) => item.text())).toEqual(
        subjects,
      );
    } finally {
      wrapper.unmount();
    }
  },
);
