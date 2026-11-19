const source = { pluginId: "upgrade-fixture", instanceId: "sample-archive" };
const ref = { source, id: "station-a", identity: "stable", revision: "1" };
const scopeId = "field-notes";

export default () => ({
  exports: {
    documentSourceDescribe: async () => ({
      version: 1,
      source,
      label: "Sample field archive",
      scope: {
        id: scopeId,
        included: ["Station A"],
        excluded: [],
        constraints: [],
      },
      capabilities: { list: {}, content: {} },
      limits: { maxItems: 1, maxTextChars: 128 },
    }),
    documentSourceList: async () => ({
      version: 1,
      source,
      scopeId,
      operation: "list",
      status: "ok",
      items: [{ ref, title: "Station A" }],
      truncated: false,
    }),
    documentSourceContent: async ({ ref: request, maxChars }) => {
      if (
        request?.id !== ref.id ||
        request?.source?.instanceId !== source.instanceId ||
        request?.source?.pluginId !== source.pluginId ||
        !Number.isInteger(maxChars) ||
        maxChars < 1 ||
        maxChars > 128
      ) {
        return {
          version: 1,
          source,
          scopeId,
          operation: "content",
          status: "error",
          error: { code: "permission", outcome: "not-started" },
        };
      }
      const text = "Station A: light rain.";
      const truncated = text.length > maxChars;
      return {
        version: 1,
        source,
        scopeId,
        operation: "content",
        status: truncated ? "partial" : "ok",
        text: text.slice(0, maxChars),
        provenance: { ref, kind: "source-text" },
        truncated,
        ...(truncated ? { reason: "limit" } : {}),
      };
    },
  },
});
