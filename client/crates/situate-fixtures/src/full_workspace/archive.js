export default function defineService() {
  const source = { pluginId: "garden-archive", instanceId: "sample-archive" };
  const scopeId = "public-guides";
  return {
    exports: {
      documentSourceDescribe: () => ({
        version: 1,
        source,
        label: "Garden archive",
        scope: {
          id: scopeId,
          included: ["Public guides"],
          excluded: [],
          constraints: [],
        },
        capabilities: { list: {} },
        limits: { maxItems: 10, maxTextChars: 1000 },
      }),
      documentSourceList: ({ limit, continuation }) => {
        const base = { version: 1, source, scopeId, operation: "list" };
        if (!Number.isInteger(limit) || limit < 1 || limit > 10 || continuation)
          return {
            ...base,
            status: "error",
            error: { code: "unsupported", outcome: "not-started" },
          };
        return {
          ...base,
          status: "ok",
          truncated: false,
          total: 1,
          items: [
            {
              ref: { source, id: "welcome-pack", identity: "stable" },
              title: "Volunteer welcome pack",
              path: "Public guides/Volunteer welcome pack.pdf",
            },
          ],
        };
      },
    },
  };
}
