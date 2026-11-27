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
          const error = host.vue.ref();
          const busy = host.vue.ref(false);
          const invoke = (name, args) =>
            host.dependencies.invoke("situate-gmail", name, args);
          async function load() {
            busy.value = true;
            error.value = undefined;
            try {
              const [accounts, preference] = await Promise.all([
                invoke("listAccounts", {}),
                invoke("selectedAccount", {}),
              ]);
              const readable = accounts.filter(
                ({ id, permissions, reconnect }) =>
                  (!preference || preference.id === id) &&
                  !reconnect &&
                  permissions.includes("metadata"),
              );
              if (!readable.length) {
                messages.value = [];
                error.value = host.localization.text(
                  accounts.length
                    ? "gmail.noReadableAccounts"
                    : "gmail.noAccounts",
                );
                return;
              }
              const mailboxes = await Promise.all(
                readable.map(async ({ id: accountId, email }) => {
                  const { messages: found = [] } = await invoke(
                    "listMetadata",
                    { accountId },
                  );
                  return Promise.all(
                    found.slice(0, 5).map(async ({ id }) => {
                      const detail = await invoke("getMetadata", {
                        accountId,
                        input: { id },
                      });
                      const subject =
                        detail.payload?.headers?.find(
                          (header) => header.name.toLowerCase() === "subject",
                        )?.value || "(No subject)";
                      return `${email}: ${subject}`;
                    }),
                  );
                }),
              );
              messages.value = mailboxes.flat();
            } catch (failure) {
              error.value = host.localization.error(failure);
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
                ? host.vue.h(host.ui.SituateErrorDialog, {
                    open: true,
                    message: error.value,
                    onDismiss: () => {
                      error.value = undefined;
                    },
                  })
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
