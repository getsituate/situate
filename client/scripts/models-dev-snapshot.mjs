import { writeFile } from "node:fs/promises";

const maxBytes = 16 * 1024 * 1024;
const providers = ["openai", "anthropic", "openrouter"];

export function projectModelsDev(value) {
  return Object.fromEntries(
    providers.map((provider) => {
      const entries = Object.entries(value?.[provider]?.models ?? {});
      if (!entries.length || entries.length > 4000)
        throw new Error(`Missing or oversized Models.dev catalog: ${provider}`);
      const models = Object.fromEntries(
        entries.flatMap(([id, model]) => {
          const { context, output } = model?.limit ?? {};
          if (
            id === "recommended" ||
            !id ||
            Buffer.byteLength(id) > 256 ||
            /[\s\p{Cc}]/u.test(id) ||
            model?.id !== id ||
            model.tool_call !== true ||
            !Array.isArray(model.modalities?.input) ||
            !model.modalities.input.includes("text") ||
            !Array.isArray(model.modalities?.output) ||
            model.modalities.output.length !== 1 ||
            model.modalities.output[0] !== "text" ||
            !Number.isSafeInteger(context) ||
            !Number.isSafeInteger(output) ||
            output <= 0 ||
            context < output ||
            context > 100_000_000
          )
            return [];
          const effort = Array.isArray(model.reasoning_options)
            ? model.reasoning_options.find(
                (option) => option?.type === "effort",
              )
            : undefined;
          return [
            [
              id,
              {
                id,
                ...(typeof model.name === "string" ? { name: model.name } : {}),
                tool_call: true,
                modalities: {
                  input: model.modalities.input.includes("image")
                    ? ["text", "image"]
                    : ["text"],
                  output: ["text"],
                },
                limit: { context, output },
                ...(Array.isArray(effort?.values)
                  ? {
                      reasoning_options: [
                        {
                          type: "effort",
                          values: effort.values.filter((value) =>
                            [
                              "none",
                              "minimal",
                              "low",
                              "medium",
                              "high",
                              "xhigh",
                              "max",
                            ].includes(value),
                          ),
                        },
                      ],
                    }
                  : {}),
              },
            ],
          ];
        }),
      );
      if (!Object.keys(models).length)
        throw new Error(`No compatible Models.dev entries: ${provider}`);
      return [provider, { models }];
    }),
  );
}

export async function writeModelsDevSnapshot(
  path,
  { signal, fetcher = fetch } = {},
) {
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetcher("https://models.dev/api.json", {
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (
    response.status !== 200 ||
    !response.body ||
    Number(response.headers.get("content-length")) > maxBytes
  )
    throw new Error(
      `Could not download the Models.dev snapshot (HTTP ${response.status}).`,
    );
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes)
      throw new Error("The Models.dev snapshot is too large.");
    chunks.push(chunk);
  }
  const snapshot = projectModelsDev(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: "wx",
  });
}
