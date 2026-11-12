import {
  assertRequest,
  assertResult,
  assertToolResult,
  throwIfCancelled,
} from "./document-source-contract.js";

export default () => {
  // eslint-disable-next-line no-undef
  const root = __DOCUMENT_SOURCE_ROOT__;
  const names = ["alpha ' & ?.txt", "scan.pdf", "second.txt"];
  const source = {
    pluginId: "document-source-local",
    instanceId: "selected-folder",
  };
  const descriptor = {
    version: 1,
    source,
    label: "Synthetic selected folder",
    scope: {
      id: "selected-files",
      included: names,
      excluded: ["symlinks", "other files"],
      constraints: [
        "macOS process access",
        "Path identity changes on rename",
        "No OCR or content search",
      ],
    },
    capabilities: { list: {}, content: {} },
    limits: { maxItems: 1, maxTextChars: 64 },
  };
  const ref = (id) => ({ source, id, identity: "path" });
  const result = (operation, fields) => ({
    version: 1,
    source,
    scopeId: descriptor.scope.id,
    operation,
    ...fields,
  });
  const failure = (operation, code, outcome = "not-started") =>
    result(operation, { status: "error", error: { code, outcome } });
  async function run(host, args) {
    throwIfCancelled(host.signal);
    const capability = await host.process.capability();
    throwIfCancelled(host.signal);
    if (!capability.available) return null;
    const reply = await host.process.run({
      executable: "/bin/sh",
      args,
      timeoutMs: 5000,
    });
    throwIfCancelled(host.signal);
    const command = reply.commandResult?.Ok;
    if (
      reply.isError ||
      command?.outcome !== "exited" ||
      command.exitCode !== 0 ||
      command.stdout.truncated ||
      command.stdout.incomplete
    )
      return null;
    return command.stdout.text;
  }
  async function list(args, host) {
    assertRequest(descriptor, "list", args);
    const token = args.continuation?.token;
    const offset = token === undefined ? 0 : Number(token);
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset >= names.length ||
      (token !== undefined && String(offset) !== token)
    )
      return failure("list", "permission");
    const text = await run(host, [
      "-c",
      'for path in "$1"/*; do [ -f "$path" ] && [ ! -L "$path" ] && printf "%s\\0" "${path##*/}"; done; :',
      "document-source-list",
      root,
    ]);
    if (text === null) return failure("list", "unavailable", "unknown");
    const found = text
      .split("\0")
      .filter((name) => names.includes(name))
      .sort();
    const items = found
      .slice(offset, offset + 1)
      .map((id) => ({ ref: ref(id), title: id, path: id }));
    return result("list", {
      status: offset + 1 < found.length ? "partial" : "ok",
      items,
      total: found.length,
      truncated: offset + 1 < found.length,
      ...(offset + 1 < found.length
        ? {
            reason: "limit",
            next: {
              source,
              scopeId: descriptor.scope.id,
              operation: "list",
              query: null,
              token: String(offset + 1),
            },
          }
        : {}),
    });
  }
  async function content(args, host) {
    assertRequest(descriptor, "content", args);
    if (args.continuation !== undefined)
      return failure("content", "permission");
    const id = args.ref?.id;
    if (
      args.ref?.source?.pluginId !== source.pluginId ||
      args.ref?.source?.instanceId !== source.instanceId ||
      !names.includes(id)
    )
      return failure("content", "permission");
    if (!id.endsWith(".txt")) return failure("content", "unsupported");
    const text = await run(host, [
      "-c",
      '[ ! -L "$1" ] && /usr/bin/head -c 65 < "$1"',
      "document-source-read",
      `${root}/${id}`,
    ]);
    if (text === null) return failure("content", "unavailable", "unknown");
    return result("content", {
      status: text.length > args.maxChars ? "partial" : "ok",
      text: text.slice(0, args.maxChars),
      provenance: { ref: ref(id), kind: "source-text" },
      truncated: text.length > args.maxChars,
      ...(text.length > args.maxChars ? { reason: "limit" } : {}),
    });
  }
  const exports = {
    documentSourceDescribe: async () => descriptor,
    documentSourceList: async (args, host) =>
      assertResult(descriptor, "list", args, await list(args, host)),
    documentSourceContent: async (args, host) =>
      assertResult(descriptor, "content", args, await content(args, host)),
  };
  return {
    exports,
    tools: [
      {
        name: "list",
        description:
          "List one selected synthetic folder document per page; no OCR or search.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "integer" },
            continuation: { type: "object" },
          },
          required: ["limit"],
          additionalProperties: false,
        },
        execute: async (args, host) => {
          const structuredContent = await list(args, host);
          const tool = {
            content: [
              { type: "text", text: JSON.stringify(structuredContent) },
            ],
            structuredContent,
            isError: structuredContent.status === "error",
          };
          assertToolResult(descriptor, "list", args, tool);
          return tool;
        },
      },
      {
        name: "content",
        description:
          "Read at most 64 characters from a selected synthetic text file; binary files are unsupported.",
        parameters: {
          type: "object",
          properties: {
            ref: { type: "object" },
            maxChars: { type: "integer" },
          },
          required: ["ref", "maxChars"],
          additionalProperties: false,
        },
        execute: async (args, host) => {
          const structuredContent = await content(args, host);
          const tool = {
            content: [
              { type: "text", text: JSON.stringify(structuredContent) },
            ],
            structuredContent,
            isError: structuredContent.status === "error",
          };
          assertToolResult(descriptor, "content", args, tool);
          return tool;
        },
      },
    ],
  };
};
