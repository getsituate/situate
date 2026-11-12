export default () => {
  const read = async (_args, host) => {
    const sources = JSON.parse((await host.config.read("selection.json")).text);
    if (!Array.isArray(sources) || !sources.length)
      throw new Error("selection-required");
    const repositories = await host.dependencies.invoke(
      "public-repositories",
      "read",
      { sources },
    );
    const note = await host.dependencies.invoke("workspace-brief", "read", {});
    return { content: [], details: { repositories, note } };
  };
  const select = async ({ sources, expectedRevision }, host) => {
    if (
      !Array.isArray(sources) ||
      !sources.length ||
      sources.some((id) => typeof id !== "string")
    )
      throw new Error("selection-required");
    const outcome = await host.config
      .write("selection.json", JSON.stringify(sources), expectedRevision)
      .catch(() => {
        throw new Error("configuration-save-unconfirmed");
      });
    if (!outcome?.Saved) throw new Error("configuration-save-unconfirmed");
    return { content: [], details: { sources, outcome } };
  };
  return {
    exports: { read, select },
    tools: [
      {
        name: "select",
        description: "Save this consumer's explicit repository selection.",
        parameters: {
          type: "object",
          properties: {
            sources: { type: "array", items: { type: "string" } },
            expectedRevision: { type: ["string", "null"] },
          },
          required: ["sources", "expectedRevision"],
        },
        execute: select,
      },
      {
        name: "read",
        description: "Read selected public metadata and the workspace brief.",
        parameters: { type: "object", properties: {} },
        execute: read,
      },
    ],
  };
};
