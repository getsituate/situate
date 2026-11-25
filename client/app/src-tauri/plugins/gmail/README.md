# Gmail connection

Declare `"dependencies": ["situate-gmail"]` in your plugin manifest. Use the existing Gmail installation; a consumer does not run its own Google sign-in.

In your settings contribution, use `host.dependencies.invoke("situate-gmail", name, args)` to list connected accounts (`listAccounts`, `{}`), read the current selection (`selectedAccount`, `{}`), and save the user’s choice (`selectAccount`, `{ accountId }`, or `{ accountId: null }` to clear it). The selection belongs to the consumer plugin in this workspace. `authorize`, `cancelSignIn`, and `disconnect` are reserved for Gmail settings.

Use `context.dependencies.invoke` in a service, or `host.dependencies.invoke` from a view, to call Gmail operations. `selectedAccount` returns `null` or `{ id, email, permissions, missing, partial, reconnect }`. Each mail operation requires the selected account ID:

```js
const gmail = (name, args = {}) =>
  context.dependencies.invoke("situate-gmail", name, args);
const account = await gmail("selectedAccount");
if (!account) return null;
return gmail("listMetadata", { accountId: account.id });
```

Mail operations take `{ accountId, input? }` and return Gmail v1 resources. `listMessages` accepts `input: { query?, pageToken?, maxResults? }`. `maxResults` is an integer from 1 to 50 and defaults to 50. To continue a search, pass `nextPageToken` as `pageToken` and keep the same query and page size.

`getMessage` takes `input: { id, format? }` and requires read permission. Use `format: "metadata"` for headers without the body. Omit `format` or pass `"full"` to read the message body. With metadata permission alone, use `getMetadata` with `input: { id }`; that permission does not allow search or access to message bodies. `sendMessage` takes `input: { raw }` (base64url MIME). `plugin.json` lists all export names. Plugins can call `deleteMessage` from views and chat tools. Permanent deletion requires the account’s deletion permission and native confirmation. If Situate reports that Gmail may have completed an action, check Gmail before repeating it.

## Checking a consumer

Checks never use connected accounts. In the consumer's `checks` item, supply `responses` entries keyed by `POST https://gmail.situate.invalid/<exportName>` for each Gmail export the script exercises. These addresses are fixture keys, not network endpoints. Checks validate arguments just as live calls do. Invalid arguments and missing fixtures fail the operation.

```json
{
  "POST https://gmail.situate.invalid/selectedAccount": {
    "status": 200,
    "body": "{\"id\":\"a0000000-0000-4000-8000-000000000001\",\"email\":\"demo@example.test\",\"permissions\":[\"metadata\"],\"missing\":[],\"partial\":false,\"reconnect\":false}"
  },
  "POST https://gmail.situate.invalid/listMetadata": {
    "status": 200,
    "body": "{\"messages\":[{\"id\":\"synthetic-message\"}]}"
  }
}
```
