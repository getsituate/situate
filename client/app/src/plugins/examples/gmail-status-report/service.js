const encode = (text) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));
export default () => ({
  tools: [
    {
      name: "sendStatusReport",
      description:
        "Email a status report only when the user has requested that report be sent. Use the recipient and content specified by the user.",
      parameters: {
        type: "object",
        required: ["recipient", "body"],
        additionalProperties: false,
        properties: {
          recipient: { type: "string" },
          body: { type: "string" },
        },
      },
      async execute({ recipient, body }, context) {
        if (
          !/^[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(recipient) ||
          typeof body !== "string" ||
          body.length > 4000
        ) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Provide one email address and a report of up to 4,000 characters.",
              },
            ],
          };
        }
        const account = await context.dependencies.invoke(
          "situate-gmail",
          "selectedAccount",
          {},
        );
        if (!account) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Select an account in the plugin settings.",
              },
            ],
          };
        }
        const mime = [
          `To: ${recipient}`,
          "Subject: Status report",
          "MIME-Version: 1.0",
          "Content-Type: text/plain; charset=UTF-8",
          "Content-Transfer-Encoding: base64",
          "",
          encode(body)
            .match(/.{1,76}/g)
            ?.join("\r\n") ?? "",
        ].join("\r\n");
        await context.dependencies.invoke("situate-gmail", "sendMessage", {
          accountId: account.id,
          input: {
            raw: encode(mime)
              .replaceAll("+", "-")
              .replaceAll("/", "_")
              .replace(/=+$/, ""),
          },
        });
        return {
          content: [{ type: "text", text: "The status report was sent." }],
        };
      },
    },
  ],
});
