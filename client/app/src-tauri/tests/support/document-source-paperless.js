import {
  assertRequest,
  assertResult,
  assertToolResult,
} from "./document-source-contract.js";

export default () => {
  // eslint-disable-next-line no-undef
  const base = __DOCUMENT_SOURCE_PAPERLESS_URL__;
  const source = {
    pluginId: "document-source-paperless",
    instanceId: "fixture-archive",
  };
  const descriptor = {
    version: 1,
    source,
    label: "Synthetic Paperless archive",
    scope: {
      id: "tag-7",
      included: ["tag:7"],
      excluded: ["all other tags"],
      constraints: ["Existing source OCR only", "No binary download"],
    },
    capabilities: {
      list: {},
      search: { coverage: ["native"], querySyntax: "Paperless source query" },
      metadata: {},
      content: {},
    },
    limits: { maxItems: 1, maxTextChars: 64 },
  };
  const ref = (id) => ({ source, id: String(id), identity: "stable" });
  const result = (operation, fields) => ({
    version: 1,
    source,
    scopeId: descriptor.scope.id,
    operation,
    ...fields,
  });
  const failure = (operation, code, outcome = "not-started") =>
    result(operation, { status: "error", error: { code, outcome } });
  async function request(operation, path, host) {
    host.signal.throwIfAborted();
    let token;
    try {
      token = await host.credentials.get("token");
    } catch {
      return {
        error: failure(
          operation,
          host.signal.aborted ? "cancelled" : "authentication",
          host.signal.aborted ? "unknown" : "not-started",
        ),
      };
    }
    if (host.signal.aborted)
      return { error: failure(operation, "cancelled", "unknown") };
    if (!token) return { error: failure(operation, "authentication") };
    let response;
    try {
      response = await host.network.request({
        url: `${base}${path}`,
        headers: { Authorization: `Token ${token}` },
      });
    } catch {
      return {
        error: failure(
          operation,
          host.signal.aborted ? "cancelled" : "unavailable",
          "unknown",
        ),
      };
    }
    if (host.signal.aborted)
      return { error: failure(operation, "cancelled", "unknown") };
    if (response.status !== 200)
      return {
        error: failure(
          operation,
          response.status === 401
            ? "authentication"
            : response.status === 403
              ? "permission"
              : response.status === 404
                ? "not-found"
                : "unavailable",
          "unknown",
        ),
      };
    try {
      return { value: JSON.parse(response.body) };
    } catch {
      return { error: failure(operation, "unavailable", "unknown") };
    }
  }
  async function page(operation, args, host) {
    assertRequest(descriptor, operation, args);
    const query = operation === "search" ? args.query : null;
    let page = 1;
    if (args.continuation !== undefined) {
      const token = args.continuation.token;
      page = Number(token);
      if (
        !Number.isInteger(page) ||
        page < 2 ||
        page > 100 ||
        String(page) !== token
      )
        return failure(operation, "permission");
    }
    const path = `/api/documents/?tags__id__all=7&page_size=1&page=${page}${operation === "search" ? `&query=${encodeURIComponent(query)}` : ""}`;
    const response = await request(operation, path, host);
    if (response.error) return response.error;
    const body = response.value;
    if (
      !body ||
      typeof body !== "object" ||
      !Array.isArray(body.results) ||
      body.results.length > 1 ||
      !Number.isSafeInteger(body.count) ||
      body.count < body.results.length ||
      (body.next !== null && typeof body.next !== "string") ||
      body.results.some(
        (doc) =>
          !doc ||
          typeof doc !== "object" ||
          !Number.isSafeInteger(doc.id) ||
          doc.id < 1 ||
          !Array.isArray(doc.tags) ||
          !doc.tags.includes(7) ||
          typeof doc.title !== "string",
      )
    )
      return failure(operation, "unavailable", "unknown");
    const more = body.next !== null;
    return result(operation, {
      status: more ? "partial" : "ok",
      items: body.results.map((doc) => ({
        ref: ref(doc.id),
        title: doc.title.slice(0, 128),
      })),
      total: body.count,
      truncated: more,
      ...(more
        ? {
            reason: "limit",
            next: {
              source,
              scopeId: descriptor.scope.id,
              operation,
              query,
              token: String(page + 1),
            },
          }
        : {}),
    });
  }
  async function document(operation, args, host) {
    assertRequest(descriptor, operation, args);
    if (args.continuation !== undefined)
      return failure(operation, "permission");
    const id = args.ref?.id;
    if (
      args.ref?.source?.pluginId !== source.pluginId ||
      args.ref?.source?.instanceId !== source.instanceId ||
      typeof id !== "string" ||
      !/^[1-9][0-9]{0,8}$/.test(id)
    )
      return failure(operation, "permission");
    const response = await request(operation, `/api/documents/${id}/`, host);
    if (response.error) return response.error;
    const doc = response.value;
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.tags))
      return failure(operation, "unavailable", "unknown");
    if (!doc.tags.includes(7))
      return failure(operation, "permission", "unknown");
    if (doc.id !== Number(id) || typeof doc.title !== "string")
      return failure(operation, "unavailable", "unknown");
    if (operation === "metadata")
      return result(operation, {
        status: "ok",
        document: { ref: ref(id), title: doc.title.slice(0, 128) },
      });
    if (typeof doc.content !== "string")
      return failure(operation, "unsupported");
    const truncated = doc.content.length > args.maxChars;
    return result(operation, {
      status: truncated ? "partial" : "ok",
      text: doc.content.slice(0, args.maxChars),
      provenance: { ref: ref(id), kind: "source-ocr" },
      truncated,
      ...(truncated ? { reason: "limit" } : {}),
    });
  }
  const exports = {
    configureFixture: async (args, host) => {
      await host.credentials.set(
        "token",
        args.invalid ? "invalid-synthetic-token" : "source-fixture-token",
      );
      return { configured: true };
    },
    documentSourceDescribe: async () => descriptor,
    documentSourceList: (args, host) => page("list", args, host),
    documentSourceSearch: (args, host) => page("search", args, host),
    documentSourceMetadata: (args, host) => document("metadata", args, host),
    documentSourceContent: (args, host) => document("content", args, host),
  };
  for (const operation of ["list", "search", "metadata", "content"]) {
    const name = `documentSource${operation[0].toUpperCase()}${operation.slice(1)}`;
    const invoke = exports[name];
    exports[name] = async (args, host) =>
      assertResult(descriptor, operation, args, await invoke(args, host));
  }
  const tools = ["list", "search", "metadata", "content", "original"].map(
    (operation) => ({
      name: operation,
      description: `Read synthetic Paperless ${operation}; tag 7 only, bounded pages and existing OCR text.`,
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          continuation: { type: "object" },
          limit: { type: "integer" },
          maxChars: { type: "integer" },
          ref: { type: "object" },
        },
        additionalProperties: false,
      },
      execute: async (args, host) => {
        assertRequest(descriptor, operation, args);
        const structuredContent =
          operation === "original"
            ? failure("original", "unsupported")
            : await exports[
                `documentSource${operation[0].toUpperCase()}${operation.slice(1)}`
              ](args, host);
        const tool = {
          content: [{ type: "text", text: JSON.stringify(structuredContent) }],
          structuredContent,
          isError: structuredContent.status === "error",
        };
        assertToolResult(descriptor, operation, args, tool);
        return tool;
      },
    }),
  );
  return { exports, tools };
};
