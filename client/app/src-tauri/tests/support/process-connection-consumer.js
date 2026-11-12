export default () => {
  const operations = Object.fromEntries(
    ["read", "hold"].map((name) => [
      name,
      async (args, host) => ({
        content: [],
        details: await host.dependencies.invoke(
          "process-connection",
          name,
          args,
        ),
      }),
    ]),
  );
  return {
    exports: operations,
    tools: ["read", "hold"].map((name) => ({
      name,
      description:
        name === "hold"
          ? "Write a start marker and wait for cancellation."
          : "Read deterministic data from the offline process connection.",
      parameters: { type: "object", properties: {} },
      execute: operations[name],
    })),
  };
};
