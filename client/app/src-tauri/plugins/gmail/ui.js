const groups = [
  ["reading", ["metadata", "read"]],
  ["writing", ["draft", "send"]],
  ["organizing", ["labels", "modify", "insert"]],
  ["filters", ["filtersRead", "filtersWrite"]],
  ["deletion", ["delete"]],
];
const help = {
  metadata: "metadataHelp",
  read: "readHelp",
  modify: "modifyHelp",
  delete: "deleteHelp",
};
const space = (size) => `var(--situate-space-${size})`;
const divider = "1px solid var(--situate-line)";
const muted = { color: "var(--situate-muted)" };
const small = { fontSize: "var(--situate-text-small)" };
const stack = (gap) => ({ display: "grid", gap: space(gap) });
const row = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: space(3),
};
const inset = {
  ...stack(4),
  justifyItems: "start",
  background: "var(--situate-paper)",
  padding: space(6),
  borderRadius: space(4),
};
const titleStyle = { margin: 0, inlineSize: "fit-content" };
const groupTitle = {
  margin: 0,
  fontSize: "var(--situate-text-body)",
  fontWeight: 650,
  lineHeight: 1.4,
};

export default ({ vue, ui, service, localization }) => {
  const { h, ref, nextTick, onMounted, onBeforeUnmount, useId } = vue;
  const {
    SituateButton: Button,
    SituateCheckbox: Checkbox,
    SituateDialog: Dialog,
    SituateErrorDialog: ErrorDialog,
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
          const id = useId();
          const accounts = ref();
          const editing = ref();
          const permissions = ref([]);
          const busy = ref(false);
          const attempt = ref();
          const disconnect = ref();
          const failure = ref();
          const loadFailed = ref(false);
          const invalid = ref(false);
          const title = ref();
          const headings = new Map();
          let opener;
          let disconnectOpener;
          const call = (name, args = {}) => service.invoke(name, args);
          const focus = (target) =>
            nextTick(() =>
              (document.getElementById(target) ?? title.value)?.focus(),
            );
          const editId = (account) => `${id}-edit-${account?.id ?? "new"}`;
          const cancel = () =>
            attempt.value
              ? call("cancelSignIn", { id: attempt.value })
              : Promise.resolve();
          const report = (error) => {
            if ((error?.message ?? error) === "native.gmail.cancelled")
              return false;
            failure.value = error;
            return true;
          };
          const load = async () => {
            try {
              accounts.value = await call("listAccounts");
              loadFailed.value = false;
              if (props.target?.contentId)
                await nextTick(() =>
                  headings.get(props.target.contentId)?.focus(),
                );
            } catch (error) {
              loadFailed.value = true;
              report(error);
            }
          };
          onMounted(load);
          onBeforeUnmount(() => {
            void cancel().catch(() => undefined);
          });
          const edit = async (account) => {
            opener = editId(account);
            editing.value = account;
            permissions.value =
              account?.permissions.filter(
                (permission) => permission !== "delete",
              ) ?? [];
            invalid.value = false;
            await nextTick(() => title.value?.focus());
          };
          const leaveForm = async () => {
            editing.value = undefined;
            await focus(opener);
          };
          const authorize = async (event) => {
            event.preventDefault();
            if (!permissions.value.length) {
              invalid.value = true;
              await focus(`${id}-metadata`);
              return;
            }
            busy.value = true;
            attempt.value = crypto.randomUUID();
            await nextTick(() => title.value?.focus());
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
              if (!failure.value)
                await focus(
                  editing.value !== undefined ? `${id}-authorize` : opener,
                );
            }
          };
          const dismissDisconnect = async () => {
            disconnect.value = undefined;
            await focus(disconnectOpener);
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
              if (!failure.value) await focus(disconnectOpener);
            }
          };
          const dismissError = async () => {
            failure.value = undefined;
            await focus(
              editing.value !== undefined
                ? `${id}-authorize`
                : loadFailed.value
                  ? `${id}-retry`
                  : disconnectOpener,
            );
          };
          const button = (key, click, attrs = {}) =>
            h(Button, { onClick: click, ...attrs }, () => label(key));
          const heading = (value) =>
            h("h1", { ref: title, tabindex: -1, style: titleStyle }, value);
          const p = (content, style = {}, attrs = {}) =>
            h("p", { style: { margin: 0, ...style }, ...attrs }, content);
          const describe = (ids) =>
            ids
              .map((permission) => label(`permission.${permission}`))
              .join(" · ");
          const accountRow = (account, index) =>
            h(
              "article",
              {
                key: account.id,
                style: {
                  ...row,
                  padding: space(4),
                  borderBlockStart: index ? divider : undefined,
                },
              },
              [
                h(
                  "div",
                  {
                    style: { ...stack(1), flex: "1 1 18rem", minInlineSize: 0 },
                  },
                  [
                    h(
                      "h3",
                      {
                        style: groupTitle,
                        ref: (node) => {
                          if (node) headings.set(account.id, node);
                          else headings.delete(account.id);
                        },
                        tabindex: -1,
                        "data-localization-content": "identity",
                      },
                      account.email,
                    ),
                    p(describe(account.permissions) || label("noPermissions"), {
                      ...muted,
                      ...small,
                    }),
                    account.missing.length
                      ? p(
                          text("gmail.missingPermissions", {
                            permissions: describe(account.missing),
                          }),
                          { ...muted, ...small },
                        )
                      : null,
                    account.reconnect || account.partial
                      ? p(
                          label(
                            account.reconnect ? "reconnectRequired" : "partial",
                          ),
                          { ...small, fontWeight: 650 },
                          { role: "status" },
                        )
                      : null,
                  ],
                ),
                h("div", { style: row }, [
                  button(
                    account.reconnect ? "reconnect" : "edit",
                    () => edit(account),
                    {
                      id: editId(account),
                      variant: "secondary",
                      size: "small",
                      disabled: busy.value,
                      "aria-label": `${label(account.reconnect ? "reconnect" : "edit")}: ${account.email}`,
                    },
                  ),
                  button(
                    "disconnect",
                    (event) => {
                      disconnectOpener = event.currentTarget.id;
                      disconnect.value = account;
                    },
                    {
                      id: `${id}-disconnect-${account.id}`,
                      variant: "ghost",
                      size: "small",
                      disabled: busy.value,
                      "aria-label": `${label("disconnect")}: ${account.email}`,
                    },
                  ),
                ]),
              ],
            );
          const connect = () =>
            button("connect", () => edit(null), {
              id: editId(null),
              disabled: busy.value,
            });
          const accountList = () => {
            const hasAccounts = !!accounts.value?.length;
            return [
              heading(label("name")),
              h(
                "section",
                { style: stack(4), "aria-labelledby": `${id}-accounts` },
                [
                  h("div", { style: row }, [
                    h(
                      "h2",
                      { id: `${id}-accounts`, style: groupTitle },
                      label("accounts"),
                    ),
                    hasAccounts ? connect() : null,
                  ]),
                  !accounts.value
                    ? loadFailed.value
                      ? h(
                          Button,
                          {
                            id: `${id}-retry`,
                            variant: "secondary",
                            onClick: load,
                          },
                          () => text("navigation.retry"),
                        )
                      : p(text("pluginManagement.loading"), muted, {
                          role: "status",
                        })
                    : hasAccounts
                      ? h(
                          "div",
                          {
                            style: { border: divider, borderRadius: space(4) },
                          },
                          accounts.value.map(accountRow),
                        )
                      : h("div", { style: inset }, [
                          p(label("noAccounts")),
                          connect(),
                        ]),
                ],
              ),
            ];
          };
          const permissionGroup = ([group, options]) =>
            h(
              "fieldset",
              {
                key: group,
                style: {
                  border: 0,
                  borderBlockStart: divider,
                  padding: `${space(2)} 0 0`,
                  margin: 0,
                  minInlineSize: 0,
                  gridColumn: group === "deletion" ? "1 / -1" : undefined,
                },
              },
              [
                h(
                  "legend",
                  { style: { ...groupTitle, paddingInline: `0 ${space(2)}` } },
                  label(`group.${group}`),
                ),
                ...options.map((permission) => {
                  const error = invalid.value && permission === "metadata";
                  const detail = help[permission];
                  return h(
                    "label",
                    {
                      key: permission,
                      for: `${id}-${permission}`,
                      style: {
                        display: "flex",
                        gap: space(3),
                        alignItems: "start",
                        minBlockSize: "44px",
                        paddingBlock: space(2),
                        boxSizing: "border-box",
                        cursor: "pointer",
                      },
                    },
                    [
                      h(Checkbox, {
                        id: `${id}-${permission}`,
                        style: { flexShrink: 0, margin: ".15em 0 0" },
                        modelValue: permissions.value.includes(permission),
                        "aria-labelledby": `${id}-${permission}-label`,
                        "aria-invalid": error || undefined,
                        "aria-describedby":
                          [
                            detail && `${id}-${permission}-help`,
                            error && `${id}-validation`,
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined,
                        "onUpdate:modelValue": (value) => {
                          invalid.value = false;
                          permissions.value = value
                            ? [...permissions.value, permission]
                            : permissions.value.filter(
                                (current) => current !== permission,
                              );
                        },
                      }),
                      h("span", [
                        h(
                          "span",
                          { id: `${id}-${permission}-label` },
                          label(`permission.${permission}`),
                        ),
                        detail
                          ? h(
                              "small",
                              {
                                id: `${id}-${permission}-help`,
                                style: {
                                  ...muted,
                                  ...small,
                                  display: "block",
                                  marginBlockStart: space(1),
                                },
                              },
                              label(detail),
                            )
                          : null,
                      ]),
                    ],
                  );
                }),
              ],
            );
          const permissionForm = () => [
            h("div", { style: { ...row, justifyContent: "flex-start" } }, [
              busy.value
                ? null
                : button("back", leaveForm, {
                    variant: "ghost",
                    size: "small",
                  }),
            ]),
            h("div", { style: stack(1) }, [
              heading(
                label(
                  busy.value ? "waiting" : editing.value ? "edit" : "connect",
                ),
              ),
              editing.value
                ? p(
                    editing.value.email,
                    { ...muted, ...small },
                    { "data-localization-content": "identity" },
                  )
                : null,
            ]),
            busy.value
              ? h("div", { style: inset }, [
                  p(label("browserHelp"), {}, { role: "status" }),
                  button("cancelSignIn", () => void cancel().catch(report), {
                    variant: "secondary",
                  }),
                ])
              : h("form", { style: stack(6), onSubmit: authorize }, [
                  p(label("choosePermissions"), muted),
                  invalid.value
                    ? p(
                        text("native.gmail.permissionsRequired"),
                        { fontWeight: 650 },
                        { id: `${id}-validation`, role: "alert" },
                      )
                    : null,
                  h(
                    "div",
                    {
                      style: {
                        ...stack(6),
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(min(100%, max(16rem, 40%)), 1fr))",
                      },
                    },
                    groups.map(permissionGroup),
                  ),
                  h(
                    "div",
                    {
                      style: {
                        ...row,
                        justifyContent: "flex-end",
                        borderBlockStart: divider,
                        paddingBlockStart: space(4),
                      },
                    },
                    [
                      editing.value?.permissions.some(
                        (permission) => !permissions.value.includes(permission),
                      )
                        ? p(label("reductionNotice"), {
                            ...small,
                            flex: "1 1 14rem",
                          })
                        : null,
                      h(Button, { id: `${id}-authorize`, type: "submit" }, () =>
                        label("continue"),
                      ),
                    ],
                  ),
                ]),
          ];
          return () =>
            h(
              "section",
              {
                style: {
                  ...stack(6),
                  maxInlineSize: "52rem",
                  marginInline: "auto",
                  padding: `clamp(${space(4)}, 3vw, ${space(6)})`,
                  minInlineSize: 0,
                  overflowWrap: "anywhere",
                },
              },
              [
                ...(editing.value !== undefined
                  ? permissionForm()
                  : accountList()),
                disconnect.value
                  ? h(
                      Dialog,
                      {
                        open: true,
                        "aria-labelledby": `${id}-disconnect-title`,
                        "aria-describedby": `${id}-disconnect-message`,
                        onCancel: (event) => {
                          event.preventDefault();
                          void dismissDisconnect();
                        },
                      },
                      {
                        header: () =>
                          h(
                            "h2",
                            { id: `${id}-disconnect-title` },
                            label("disconnectTitle"),
                          ),
                        default: () =>
                          p(
                            text("gmail.disconnectHelp", {
                              email: disconnect.value.email,
                            }),
                            {},
                            { id: `${id}-disconnect-message` },
                          ),
                        actions: () => [
                          h(
                            Button,
                            {
                              variant: "secondary",
                              autofocus: true,
                              onClick: dismissDisconnect,
                            },
                            () => text("settings.experimental.cancel"),
                          ),
                          button("disconnect", remove, { variant: "danger" }),
                        ],
                      },
                    )
                  : null,
                failure.value
                  ? h(ErrorDialog, {
                      open: true,
                      message: message(failure.value),
                      onDismiss: dismissError,
                    })
                  : null,
              ],
            );
        },
      }),
    },
  };
};
