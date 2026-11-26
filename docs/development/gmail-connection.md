# Gmail connection for plugins

The Gmail experiment uses a Google Desktop app OAuth client on macOS and Windows. It has no built-in inbox. Plugins that declare a dependency on the installed `situate-gmail` connection can use a Gmail account the user selects in that plugin’s settings. An account connected in one workspace is not available in another, and its credentials do not sync.

## Test access

Use a separate Google Cloud project with the Gmail API enabled. Set its consent screen to Testing, add the synthetic Google accounts as test users, and create a **Desktop app** OAuth client.

Provide `SITUATE_GMAIL_TEST_CLIENT_ID` and `SITUATE_GMAIL_TEST_CLIENT_SECRET` **only when building the desktop app**. The running app does not read them from the environment.

- **Local build:** Put both values in the Git-ignored repository-root `.env` (permissions `0600`), or set them in the environment of the build command. Explicit environment values take precedence, including empty values.
- **GitHub Actions:** In each of the `macos-release` and `windows-release` environments, set `SITUATE_GMAIL_TEST_CLIENT_ID` as a variable and `SITUATE_GMAIL_TEST_CLIENT_SECRET` as a secret. Only the release build steps receive them. Both Windows installer architectures and the GitHub macOS release build require both values.

The values are embedded in the native executable. Testers do not need a `.env` or any environment variables. A local build with both values absent or empty cannot connect to Gmail; supplying only one value fails the build. Rebuild the app to change the credentials. A desktop OAuth client secret can be extracted from the executable, so use only the dedicated desktop client for the test project. Never supply server credentials or OAuth tokens. There is no production Gmail client configuration.

Open **Settings → Experimental features** and enable Gmail. Choose **Install Gmail in this workspace** for each workspace where you want to use it. Then open **Plugins → Connections → Gmail → Settings** to connect an account and choose permissions. If a synced workspace already contains the bundled connection, **Install Gmail in this workspace** enables its use on the current device without replacing the shared package. Connect the account separately on each device. Use a synthetic mailbox for tests. Google test access expires after seven days. Reducing permissions revokes the previous Google grant before the next authorization; revocation can also affect the same Google account connected in other workspaces. Check access in the Google Account if Google does not confirm revocation.

If **Update Gmail settings** appears under **Settings → Experimental features**, it updates the installed connection’s settings without changing its accounts or account selections. It does not overwrite local source edits.

## Verify the Windows installer

On a native Windows desktop, install the release candidate with a fresh Situate profile and open a disposable workspace. Enable and install Gmail, then connect a test account from the Google Cloud consent screen's test-user list. Confirm that the default browser opens, the sign-in returns to Situate, and the account appears in Gmail settings. Use the `gmail-inbox` example below to select the account and read subjects from the synthetic mailbox. Reopen Situate and repeat the read to check that the connection survives a restart. Record the installer version, architecture, and Windows version with the result. The automated installer launch check does not exercise Google sign-in.

## Use the connection

In a Plugin Development Chat, ask for the Gmail workflow you want. The chat can inspect the installed connection and read its `README.md` without being given the package ID. It does not need a second connection or Google sign-in.

Add `"dependencies": ["situate-gmail"]` to the consumer manifest. In the consumer’s settings, use `host.dependencies.invoke` to call `listAccounts` and save the user’s selection with `selectAccount({ accountId })`. In a service, use `context.dependencies.invoke`. The [package guide](../../client/app/src-tauri/plugins/gmail/README.md) includes synthetic fixtures for consumer checks.

```js
const gmail = (name, args) =>
  context.dependencies.invoke("situate-gmail", name, args);
const account = await gmail("selectedAccount", {});
if (account) {
  const page = await gmail("listMetadata", { accountId: account.id });
  // Use page.messages and page.nextPageToken. No message bodies are available here.
}
```

`selectedAccount` returns `null` or `{ id, email, permissions, missing, partial, reconnect }`. Gmail operations take `{ accountId, input? }`, require the selected account, and fail if the user’s selection or Google’s grant does not allow the operation. `input` is an object; omit it for operations that take no fields. List operations that read mail or drafts accept `pageToken?`, and only `listMessages` and `listThreads` accept `query?`. `listMessages` also accepts `maxResults` (1–50, default 50). Use the same query and page size with the next page token. Successful operations return the corresponding Gmail v1 resource or list; deletes with no response body return `null`.

| Permission     | Exports and input fields                                                                                  | Google scope family        |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| `labels`       | `listLabels`, `createLabel(name)`, `renameLabel(id, name)`, `deleteLabel(id)`                             | `gmail.labels`             |
| `metadata`     | `listMetadata`, `getMetadata(id)`, `listThreadMetadata`, `getThreadMetadata(id)`; no search or body       | `gmail.metadata`           |
| `read`         | `listMessages`, `getMessage(id, format?)`, `listThreads`, `getThread(id)`, `getAttachment(messageId, id)` | `gmail.readonly`           |
| `send`         | `sendMessage(raw)`                                                                                        | `gmail.send`               |
| `draft`        | `listDrafts`, `getDraft(id)`, `createDraft(raw)`, `updateDraft(id, raw)`, `deleteDraft(id)`               | `gmail.compose`            |
| `insert`       | `insertMessage(raw)`                                                                                      | `gmail.insert`             |
| `modify`       | `modifyMessage(id, addLabelIds, removeLabelIds)`, `trashMessage(id)`, `restoreMessage(id)`                | `gmail.modify`             |
| `filtersRead`  | `listFilters`, `getFilter(id)`                                                                            | `gmail.settings.basic`     |
| `filtersWrite` | `createFilter(criteria, action)`, `deleteFilter(id)`                                                      | `gmail.settings.basic`     |
| `delete`       | `deleteMessage(id)`; requires native confirmation                                                         | `https://mail.google.com/` |

`raw` is a base64url-encoded MIME message. Filter criteria accept `from`, `to`, `subject`, `query`, and `hasAttachment`; a filter action takes `addLabelIds` and `removeLabelIds`. Send, insert, and message status changes return only message IDs and labels. If Situate reports that Gmail may have completed an action, check Gmail before repeating it. The error identifies whether the failure occurred while refreshing access or calling the Gmail API, and includes the HTTP status and a recognized Google error code when available. Neither the connection nor plugin checks repeat a Gmail write automatically. Plugin checks do not call connected Gmail accounts.

Google may cover several selected operations with one [scope](https://developers.google.com/workspace/gmail/api/auth/scopes). Situate still checks each permission separately. Desktop authorization does not use Google Workspace add-on scopes or `gmail.settings.sharing`.

## Example plugins

Copy the corresponding [example directory](../../client/app/src/plugins/examples/) into a plugin draft:

- `gmail-inbox`: enable **Read message details** and load subjects from the synthetic mailbox.
- `gmail-status-report`: enable **Send email** and ask a chat to send an explicitly addressed report to another synthetic inbox. Check the sender’s Sent folder and the recipient’s inbox before repeating a timed-out action.

These examples are not installed automatically. Do not use real mailbox data for qualification. No scope is approved for production use in this experiment. Before publicly enabling an OAuth client, review the proposed workflows, plugin reuse, and each transfer of Gmail data against the [Google Workspace user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), including data sent to AI providers or retained in synchronized chat history. Review the [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) requirements separately.
