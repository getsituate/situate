import { Buffer } from "node:buffer";
import { expect, it, vi } from "vitest";
import { createInvocationContext } from "./host";
import type { PluginServiceContributions } from "./types";

const { default: createService } = import.meta.glob<{
  default: () => PluginServiceContributions;
}>("./examples/gmail-status-report/service.js", { eager: true })[
  "./examples/gmail-status-report/service.js"
];

it.each(["Café", "Café...", "Café......"])(
  "sends a UTF-8 status report as unpadded base64url (%s)",
  async (body) => {
    const request = vi.fn().mockResolvedValueOnce({ id: "account-1" });
    const context = createInvocationContext(
      "invocation-1",
      new AbortController().signal,
      request,
      vi.fn(),
    );
    const tool = createService().tools!.find(
      ({ name }) => name === "sendStatusReport",
    )!;

    await tool.execute({ recipient: "reader@example.invalid", body }, context);

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
          exportName: "selectedAccount",
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
