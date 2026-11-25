import { accountSettings } from "./account-settings.js";

export default (host) => ({
  settings: {
    id: "gmail-inbox:settings",
    title: () => "Gmail inbox settings",
    icon: "notes",
    component: accountSettings(host),
  },
  views: [
    {
      id: "gmail-inbox:messages",
      title: () => "Gmail inbox",
      icon: "notes",
      component: host.vue.defineComponent({
        setup() {
          const messages = host.vue.ref([]);
          const error = host.vue.ref("");
          const busy = host.vue.ref(false);
          const invoke = (name, args) =>
            host.dependencies.invoke("situate-gmail", name, args);
          async function load() {
            busy.value = true;
            error.value = "";
            try {
              const account = await invoke("selectedAccount", {});
              if (!account) {
                error.value = "Select a Gmail account in the plugin settings.";
                return;
              }
              const { messages: found = [] } = await invoke("listMetadata", {
                accountId: account.id,
              });
              messages.value = await Promise.all(
                found.slice(0, 5).map(async ({ id }) => {
                  const detail = await invoke("getMetadata", {
                    accountId: account.id,
                    input: { id },
                  });
                  return (
                    detail.payload?.headers?.find(
                      (header) => header.name.toLowerCase() === "subject",
                    )?.value || "(No subject)"
                  );
                }),
              );
            } catch {
              error.value =
                "Messages could not be opened. Check the Gmail permissions in the plugin settings.";
            } finally {
              busy.value = false;
            }
          }
          return () =>
            host.vue.h("section", { "data-localization-content": "user" }, [
              host.vue.h("h2", "Recent messages"),
              host.vue.h(
                "button",
                { onClick: load, disabled: busy.value },
                "Load messages",
              ),
              error.value
                ? host.vue.h("p", { role: "alert" }, error.value)
                : null,
              host.vue.h(
                "ul",
                messages.value.map((subject) => host.vue.h("li", subject)),
              ),
            ]);
        },
      }),
    },
  ],
});
