export default () => {
  const write = async ({ text, expectedRevision }, host) => {
    const outcome = await host.files.write(
      "repository-brief.md",
      text,
      expectedRevision,
    );
    if (outcome?.isError !== false || !outcome.historyRevision)
      throw new Error("workspace-brief-save-unconfirmed");
    return { content: [], details: { saved: true, outcome } };
  };
  return {
    exports: {
      read: async (_args, host) =>
        (await host.files.read("repository-brief.md")).text,
      write,
    },
    tools: [
      {
        name: "write",
        description: "Save the workspace brief with an explicit file revision.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string" },
            expectedRevision: { type: ["string", "null"] },
          },
          required: ["text", "expectedRevision"],
        },
        execute: write,
      },
    ],
  };
};
