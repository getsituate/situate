const permissionKeys = [
  ["gmail.group.reading", ["metadata", "read"]],
  ["gmail.group.writing", ["draft", "send"]],
  ["gmail.group.organizing", ["labels", "modify", "insert"]],
  ["gmail.group.filters", ["filtersRead", "filtersWrite"]],
  ["gmail.group.deletion", ["delete"]],
];

const row = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "var(--situate-space-2)",
};

export default ({ vue, ui, service, localization }) => {
  const { h, ref, onMounted, onBeforeUnmount } = vue;
  const {
    SituateButton: Button,
    SituateCheckbox: Checkbox,
    SituateDialog: Dialog,
    SituateErrorDialog: ErrorDialog,
    SituatePanel: Panel,
  } = ui;
  const { text, error: message } = localization;
  const label = (key) => text(`gmail.${key}`);
  return {
    settings: {
      id: "situate-gmail:accounts",
      title: () => label("name"),
      icon: "settings",
      component: vue.defineComponent({
        props: { target: Object },
        setup(props) {
          const accounts = ref();
          const editing = ref();
          const permissions = ref([]);
          const busy = ref(false);
          const attempt = ref();
          const disconnect = ref();
          const failure = ref();
          const invalid = ref(false);
          const headings = new Map();
          const call = (name, args = {}) => service.invoke(name, args);
          const cancel = () =>
            attempt.value
              ? call("cancelSignIn", { id: attempt.value })
              : Promise.resolve();
          const report = (error) => {
            if (
              error !== "native.gmail.cancelled" &&
              error?.message !== "native.gmail.cancelled"
            )
              failure.value = error;
          };
          const load = async () => {
            try {
              accounts.value = await call("listAccounts");
              if (props.target?.contentId)
                await vue.nextTick(() =>
                  headings.get(props.target.contentId)?.focus(),
                );
            } catch (error) {
              report(error);
            }
          };
          onMounted(load);
          onBeforeUnmount(() => {
            void cancel().catch(() => undefined);
          });
          const edit = (account) => {
            editing.value = account;
            permissions.value =
              account?.permissions.filter((id) => id !== "delete") ?? [];
            invalid.value = false;
          };
          const authorize = async (event) => {
            event.preventDefault();
            if (!permissions.value.length) {
              invalid.value = true;
              return;
            }
            busy.value = true;
            attempt.value = crypto.randomUUID();
            try {
              await call("authorize", {
                id: attempt.value,
                accountId: editing.value?.id,
                permissions: permissions.value,
              });
              editing.value = undefined;
              await load();
            } catch (error) {
              report(error);
            } finally {
              attempt.value = undefined;
              busy.value = false;
            }
          };
          const remove = async () => {
            const account = disconnect.value;
            disconnect.value = undefined;
            busy.value = true;
            try {
              await call("disconnect", { accountId: account.id });
            } catch (error) {
              report(error);
            } finally {
              await load();
              busy.value = false;
            }
          };
          const button = (key, click, attrs = {}) =>
            h(Button, { onClick: click, ...attrs }, () => label(key));
          const title = (value) => h("h2", value);
          const dialog = (heading, body, actions, close) =>
            h(
              Dialog,
              {
                open: true,
                "aria-label": heading,
                onCancel: (event) => {
                  event.preventDefault();
                  close();
                },
              },
              {
                header: () => title(heading),
                default: () => h("p", body),
                actions: () => actions,
              },
            );
          const describe = (account) =>
            account.permissions
              .map((permission) => label(`permission.${permission}`))
              .join(", ") || label("noPermissions");
          const accountList = () => [
            h("div", { style: row }, [
              title(label("accounts")),
              button("connect", () => edit(null), { disabled: busy.value }),
            ]),
            accounts.value.length === 0 ? h("p", label("noAccounts")) : null,
            ...accounts.value.map((account) =>
              h(
                "article",
                {
                  key: account.id,
                  style: {
                    ...row,
                    borderTop: "1px solid var(--situate-line)",
                    marginTop: "var(--situate-space-4)",
                  },
                },
                [
                  h("div", [
                    h(
                      "h3",
                      {
                        ref: (node) => {
                          if (node) headings.set(account.id, node);
                          else headings.delete(account.id);
                        },
                        tabindex: -1,
                        "data-localization-content": "identity",
                      },
                      account.email,
                    ),
                    h("p", describe(account)),
                    account.missing.length
                      ? h(
                          "p",
                          text("gmail.missingPermissions", {
                            permissions: account.missing
                              .map((id) => label(`permission.${id}`))
                              .join(", "),
                          }),
                        )
                      : null,
                    account.reconnect
                      ? h("p", { role: "status" }, label("reconnectRequired"))
                      : account.partial
                        ? h("p", { role: "status" }, label("partial"))
                        : null,
                  ]),
                  h("div", { style: row }, [
                    button(
                      account.reconnect ? "reconnect" : "edit",
                      () => edit(account),
                      {
                        variant: "secondary",
                        size: "small",
                        disabled: busy.value,
                      },
                    ),
                    button(
                      "disconnect",
                      () => {
                        disconnect.value = account;
                      },
                      { variant: "ghost", size: "small", disabled: busy.value },
                    ),
                  ]),
                ],
              ),
            ),
          ];
          const permissionForm = () => [
            busy.value
              ? null
              : button(
                  "back",
                  () => {
                    editing.value = undefined;
                  },
                  { variant: "ghost" },
                ),
            title(
              label(
                busy.value ? "waiting" : editing.value ? "edit" : "connect",
              ),
            ),
            editing.value
              ? h(
                  "p",
                  { "data-localization-content": "identity" },
                  editing.value.email,
                )
              : null,
            busy.value
              ? [
                  h("p", { role: "status" }, label("browserHelp")),
                  button("cancelSignIn", () => void cancel().catch(report), {
                    variant: "secondary",
                  }),
                ]
              : h(
                  "form",
                  {
                    style: {
                      display: "grid",
                      gap: "var(--situate-space-3)",
                      justifyItems: "start",
                    },
                    onSubmit: authorize,
                  },
                  [
                    h("p", label("choosePermissions")),
                    invalid.value
                      ? h(
                          "p",
                          { role: "alert" },
                          text("native.gmail.permissionsRequired"),
                        )
                      : null,
                    ...permissionKeys.map(([group, options]) =>
                      h("fieldset", [
                        h("legend", text(group)),
                        ...options.map((id) =>
                          h(
                            "label",
                            {
                              style: {
                                display: "flex",
                                gap: "var(--situate-space-2)",
                                alignItems: "start",
                                marginBlock: "var(--situate-space-2)",
                              },
                            },
                            [
                              h(Checkbox, {
                                modelValue: permissions.value.includes(id),
                                "onUpdate:modelValue": (value) => {
                                  invalid.value = false;
                                  permissions.value = value
                                    ? [...permissions.value, id]
                                    : permissions.value.filter(
                                        (current) => current !== id,
                                      );
                                },
                              }),
                              h("span", [
                                label(`permission.${id}`),
                                id === "delete"
                                  ? h(
                                      "small",
                                      { style: { display: "block" } },
                                      label("deleteHelp"),
                                    )
                                  : null,
                              ]),
                            ],
                          ),
                        ),
                      ]),
                    ),
                    editing.value?.permissions.some(
                      (permission) => !permissions.value.includes(permission),
                    )
                      ? h("p", label("reductionNotice"))
                      : null,
                    h(Button, { type: "submit" }, () => label("continue")),
                  ],
                ),
          ];
          return () =>
            h(Panel, null, {
              default: () => [
                ...(editing.value !== undefined
                  ? permissionForm()
                  : accounts.value
                    ? accountList()
                    : [
                        title(label("accounts")),
                        failure.value
                          ? h(
                              Button,
                              {
                                onClick: () => {
                                  failure.value = undefined;
                                  void load();
                                },
                              },
                              () => text("navigation.retry"),
                            )
                          : h(
                              "p",
                              { role: "status" },
                              text("pluginManagement.loading"),
                            ),
                      ]),
                disconnect.value
                  ? dialog(
                      label("disconnectTitle"),
                      text("gmail.disconnectHelp", {
                        email: disconnect.value.email,
                      }),
                      [
                        h(
                          Button,
                          {
                            variant: "secondary",
                            autofocus: true,
                            onClick: () => {
                              disconnect.value = undefined;
                            },
                          },
                          () => text("settings.experimental.cancel"),
                        ),
                        button("disconnect", remove),
                      ],
                      () => {
                        disconnect.value = undefined;
                      },
                    )
                  : null,
                failure.value
                  ? h(ErrorDialog, {
                      open: true,
                      message: message(failure.value),
                      onDismiss: () => {
                        failure.value = undefined;
                      },
                    })
                  : null,
              ],
            });
        },
      }),
    },
  };
};
