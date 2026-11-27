export function accountSettings(host) {
  const { h, ref, onMounted, useId } = host.vue;
  const { text, error: message } = host.localization;
  const invoke = (name, args = {}) =>
    host.dependencies.invoke("situate-gmail", name, args);
  return host.vue.defineComponent({
    setup() {
      const id = useId();
      const accounts = ref([]);
      const selected = ref(null);
      const pending = ref(true);
      const error = ref();
      const load = async () => {
        pending.value = true;
        try {
          const [list, account] = await Promise.all([
            invoke("listAccounts"),
            invoke("selectedAccount"),
          ]);
          accounts.value = list;
          selected.value = account?.id ?? null;
        } catch (failure) {
          error.value = failure;
        } finally {
          pending.value = false;
        }
      };
      onMounted(load);
      async function select(event) {
        const input = event.target;
        const accountId = input.value || null;
        input.value = selected.value ?? "";
        pending.value = true;
        try {
          selected.value = await invoke("selectAccount", { accountId });
        } catch (failure) {
          error.value = failure;
        } finally {
          pending.value = false;
        }
      }
      return () =>
        h(host.ui.SituatePanel, null, {
          default: () => [
            h("label", { for: id }, text("gmail.selectedAccount")),
            h(
              "select",
              {
                id,
                value: selected.value ?? "",
                disabled: pending.value,
                onChange: select,
              },
              [
                h("option", { value: "" }, text("gmail.allAccounts")),
                ...accounts.value.map((account) =>
                  h(
                    "option",
                    {
                      key: account.id,
                      value: account.id,
                      "data-localization-content": "identity",
                    },
                    account.email,
                  ),
                ),
              ],
            ),
            accounts.value.length ? null : h("p", text("gmail.noAccounts")),
            error.value
              ? h(host.ui.SituateErrorDialog, {
                  open: true,
                  message: message(error.value),
                  onDismiss: () => {
                    error.value = undefined;
                  },
                })
              : null,
          ],
        });
    },
  });
}
