import { Buffer } from "node:buffer";
import { expect, it, vi } from "vitest";
import { createInvocationContext, type PluginHostRequest } from "./host";
import type { PluginServiceContributions } from "./types";

const { default: createService } = import.meta.glob<{
  default: () => PluginServiceContributions;
}>("./examples/gmail-status-report/service.js", { eager: true })[
  "./examples/gmail-status-report/service.js"
];

const account = {
  id: "account-1",
  email: "first@example.test",
  permissions: ["send"],
  reconnect: false,
};
const second = { ...account, id: "account-2", email: "second@example.test" };
const tool = createService().tools!.find(
  ({ name }) => name === "sendStatusReport",
)!;
const contextFor = (request: PluginHostRequest) =>
  createInvocationContext(
    "invocation-1",
    new AbortController().signal,
    request,
    vi.fn(),
  );

it.each(["Café", "Café...", "Café......"])(
  "sends a UTF-8 status report as unpadded base64url (%s)",
  async (body) => {
    const request = vi.fn().mockResolvedValueOnce([account]);
    await tool.execute(
      { recipient: "reader@example.invalid", body },
      contextFor(request),
    );

    const mime = [
      "To: reader@example.invalid",
      "Subject: Status report",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body).toString("base64"),
    ].join("\r\n");
    expect(request.mock.calls).toEqual([
      [
        {
          operation: "dependenciesInvoke",
          pluginId: "situate-gmail",
          exportName: "listAccounts",
          args: {},
        },
      ],
      [
        {
          operation: "dependenciesInvoke",
          pluginId: "situate-gmail",
          exportName: "sendMessage",
          args: {
            accountId: "account-1",
            input: { raw: Buffer.from(mime).toString("base64url") },
          },
        },
      ],
    ]);
  },
);

it("sends from the requested address even when another account can send", async () => {
  const request = vi.fn().mockResolvedValueOnce([account, second]);
  await tool.execute(
    {
      recipient: "reader@example.invalid",
      body: "Done",
      sender: "SECOND@example.test",
    },
    contextFor(request),
  );
  expect(request).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      exportName: "sendMessage",
      args: expect.objectContaining({ accountId: "account-2" }),
    }),
  );
});

it.each([
  { sender: undefined, accounts: [account, second] },
  { sender: "unconnected@example.test", accounts: [account] },
  {
    sender: "second@example.test",
    accounts: [account, { ...second, reconnect: true }],
  },
])(
  "does not send if the sender cannot be resolved: $sender",
  async ({ sender, accounts }) => {
    const request = vi.fn().mockResolvedValueOnce(accounts);
    const result = await tool.execute(
      { recipient: "reader@example.invalid", body: "Done", sender },
      contextFor(request),
    );
    expect(result).toMatchObject({ isError: true });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ exportName: "listAccounts" }),
    );
  },
);
