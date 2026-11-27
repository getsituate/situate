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
          sender: {
            type: "string",
            description:
              "A connected Gmail address. Required when more than one account can send.",
          },
        },
      },
      async execute({ recipient, body, sender }, context) {
        if (
          !/^[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(recipient) ||
          typeof body !== "string" ||
          body.length > 4000 ||
          (sender !== undefined && typeof sender !== "string")
        ) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Provide a recipient email address, a report of up to 4,000 characters, and optionally a sender email address.",
              },
            ],
          };
        }
        const accounts = await context.dependencies.invoke(
          "situate-gmail",
          "listAccounts",
          {},
        );
        const eligible = accounts.filter(
          ({ permissions, reconnect }) =>
            !reconnect && permissions.includes("send"),
        );
        const matches =
          sender === undefined
            ? eligible
            : eligible.filter(
                ({ email }) => email.toLowerCase() === sender.toLowerCase(),
              );
        if (matches.length !== 1) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  matches.length > 1
                    ? "Ask the user which connected Gmail address should send the report."
                    : "No matching Gmail account can send email. Check the sender and the account’s permissions.",
              },
            ],
          };
        }
        const [account] = matches;
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
              .split("=", 1)[0]
              .replaceAll("+", "-")
              .replaceAll("/", "_"),
          },
        });
        return {
          content: [{ type: "text", text: "The status report was sent." }],
        };
      },
    },
  ],
});
