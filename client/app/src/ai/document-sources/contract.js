export const CONTRACT_VERSION = 1;
export const SOURCE_EXPORTS = Object.freeze({
  describe: "documentSourceDescribe",
  list: "documentSourceList",
  search: "documentSourceSearch",
  metadata: "documentSourceMetadata",
  content: "documentSourceContent",
  original: "documentSourceOriginal",
});

function requireValid(condition) {
  if (!condition) throw new TypeError("Invalid document source contract");
}

function record(value, required, optional = []) {
  requireValid(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  const prototype = Object.getPrototypeOf(value);
  requireValid(prototype === Object.prototype || prototype === null);
  const fields = Object.getOwnPropertyDescriptors(value);
  requireValid(
    Reflect.ownKeys(fields).every(
      (key) =>
        typeof key === "string" &&
        (required.includes(key) || optional.includes(key)) &&
        Object.hasOwn(fields[key], "value"),
    ),
  );
  requireValid(required.every((key) => Object.hasOwn(fields, key)));
}

function string(value, max = 1024, allowEmpty = false) {
  requireValid(
    typeof value === "string" &&
      value.length <= max &&
      (allowEmpty || value.trim().length > 0),
  );
}

function integer(value, min, max = Number.MAX_SAFE_INTEGER) {
  requireValid(Number.isSafeInteger(value) && value >= min && value <= max);
}

function array(value, max, validate, min = 0) {
  requireValid(
    Array.isArray(value) && value.length >= min && value.length <= max,
  );
  for (let i = 0; i < value.length; i++) {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    requireValid(field && Object.hasOwn(field, "value"));
    validate(field.value);
  }
  requireValid(Reflect.ownKeys(value).length === value.length + 1);
}

function source(value, expected) {
  record(value, ["pluginId", "instanceId"]);
  string(value.pluginId);
  requireValid(
    value.pluginId.length <= 64 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value.pluginId),
  );
  string(value.instanceId);
  if (expected)
    requireValid(
      value.pluginId === expected.pluginId &&
        value.instanceId === expected.instanceId,
    );
}

function reference(value, expectedSource, expectedRef) {
  record(value, ["source", "id", "identity"], ["revision"]);
  source(value.source, expectedSource);
  string(value.id);
  requireValid(["stable", "path"].includes(value.identity));
  if (Object.hasOwn(value, "revision")) string(value.revision);
  if (expectedRef)
    requireValid(
      value.id === expectedRef.id &&
        value.identity === expectedRef.identity &&
        value.revision === expectedRef.revision,
    );
}

export function assertDescriptor(value, options = {}) {
  record(options, [], ["pluginId", "exports"]);
  record(value, [
    "version",
    "source",
    "label",
    "scope",
    "capabilities",
    "limits",
  ]);
  requireValid(value.version === CONTRACT_VERSION);
  source(value.source);
  if (Object.hasOwn(options, "pluginId"))
    requireValid(value.source.pluginId === options.pluginId);
  string(value.label, 2048);
  record(value.scope, ["id", "included", "excluded", "constraints"]);
  string(value.scope.id);
  for (const key of ["included", "excluded", "constraints"]) {
    array(
      value.scope[key],
      100,
      (entry) => string(entry, 2048),
      key === "included" ? 1 : 0,
    );
  }
  record(
    value.capabilities,
    [],
    Object.keys(SOURCE_EXPORTS).filter((key) => key !== "describe"),
  );
  requireValid(Object.keys(value.capabilities).length > 0);
  for (const operation of Object.keys(value.capabilities)) {
    const capability = value.capabilities[operation];
    if (operation === "search") {
      record(capability, ["coverage", "querySyntax"]);
      array(
        capability.coverage,
        4,
        (entry) =>
          requireValid(
            ["filename", "metadata", "text", "native"].includes(entry),
          ),
        1,
      );
      requireValid(
        new Set(capability.coverage).size === capability.coverage.length,
      );
      string(capability.querySyntax, 2048);
    } else record(capability, []);
  }
  record(value.limits, ["maxItems", "maxTextChars"]);
  integer(value.limits.maxItems, 1, 100);
  integer(value.limits.maxTextChars, 1, 32768);
  if (Object.hasOwn(options, "exports")) {
    array(options.exports, 1000, (name) => string(name));
    requireValid(new Set(options.exports).size === options.exports.length);
    requireValid(options.exports.includes(SOURCE_EXPORTS.describe));
    for (const operation of Object.keys(SOURCE_EXPORTS).filter(
      (key) => key !== "describe",
    )) {
      requireValid(
        options.exports.includes(SOURCE_EXPORTS[operation]) ===
          Object.hasOwn(value.capabilities, operation),
      );
    }
  }
  return value;
}

function continuation(descriptor, operation, args, value) {
  record(
    value,
    ["source", "scopeId", "operation", "query", "token"],
    operation === "content" ? ["ref"] : [],
  );
  source(value.source, descriptor.source);
  requireValid(
    value.scopeId === descriptor.scope.id && value.operation === operation,
  );
  requireValid(value.query === (operation === "search" ? args.query : null));
  string(value.token);
  if (operation === "content")
    reference(value.ref, descriptor.source, args.ref);
}

export function assertRequest(descriptor, operation, args) {
  assertDescriptor(descriptor);
  requireValid(
    Object.hasOwn(SOURCE_EXPORTS, operation) && operation !== "describe",
  );
  if (operation === "list" || operation === "search") {
    record(args, operation === "search" ? ["limit", "query"] : ["limit"], [
      "continuation",
    ]);
    integer(args.limit, 1, descriptor.limits.maxItems);
    if (operation === "search") string(args.query, 4096);
  } else {
    record(
      args,
      operation === "content" ? ["ref", "maxChars"] : ["ref"],
      operation === "content" ? ["continuation"] : [],
    );
    reference(args.ref, descriptor.source);
    if (operation === "content")
      integer(args.maxChars, 1, descriptor.limits.maxTextChars);
  }
  if (Object.hasOwn(args, "continuation"))
    continuation(descriptor, operation, args, args.continuation);
  return args;
}

function document(value, descriptor, expectedRef) {
  record(value, ["ref"], ["title", "path"]);
  reference(value.ref, descriptor.source, expectedRef);
  for (const key of ["title", "path"])
    if (Object.hasOwn(value, key)) string(value[key], 2048);
}

function boundedResult(descriptor, operation, args, value) {
  requireValid(typeof value.truncated === "boolean");
  if (value.status === "ok") {
    requireValid(
      value.truncated === false &&
        !Object.hasOwn(value, "next") &&
        !Object.hasOwn(value, "reason"),
    );
  } else {
    requireValid(
      value.status === "partial" &&
        value.truncated === true &&
        ["limit", "source-partial"].includes(value.reason),
    );
    if (Object.hasOwn(value, "next")) {
      continuation(descriptor, operation, args, value.next);
      requireValid(
        !args.continuation || value.next.token !== args.continuation.token,
      );
    }
  }
}

function original(value, descriptor, expectedRef) {
  record(value, ["kind", "ref"], ["reason", "url"]);
  reference(value.ref, descriptor.source, expectedRef);
  if (value.kind === "unavailable") {
    record(value, ["kind", "ref", "reason"]);
    requireValid(["device", "binary-unsupported"].includes(value.reason));
  } else {
    record(value, ["kind", "ref", "url"]);
    requireValid(value.kind === "locator");
    string(value.url, 2048);
    requireValid(/^https:\/\/[^\s%@?#\\]+$/i.test(value.url));
    let url;
    try {
      url = new URL(value.url);
    } catch {
      requireValid(false);
    }
    requireValid(
      url.protocol === "https:" &&
        url.hostname.length > 0 &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash,
    );
  }
}

export function assertResult(descriptor, operation, args, value) {
  assertRequest(descriptor, operation, args);
  const base = ["version", "source", "scopeId", "operation", "status"];
  // Inspect status only after rejecting accessors, before choosing the payload schema.
  record(value, base, [
    "error",
    "items",
    "truncated",
    "total",
    "next",
    "reason",
    "document",
    "text",
    "provenance",
    "original",
  ]);
  requireValid(
    value.version === CONTRACT_VERSION &&
      value.operation === operation &&
      value.scopeId === descriptor.scope.id,
  );
  source(value.source, descriptor.source);
  const supported = Object.hasOwn(descriptor.capabilities, operation);
  if (value.status === "error") {
    record(value, [...base, "error"]);
    record(value.error, ["code", "outcome"]);
    requireValid(
      [
        "unsupported",
        "permission",
        "authentication",
        "not-found",
        "unavailable",
        "cancelled",
      ].includes(value.error.code),
    );
    requireValid(["not-started", "unknown"].includes(value.error.outcome));
    requireValid(supported || value.error.code === "unsupported");
    return value;
  }
  requireValid(supported && ["ok", "partial"].includes(value.status));
  if (operation === "list" || operation === "search") {
    record(value, [...base, "items", "truncated"], ["total", "next", "reason"]);
    array(value.items, args.limit, (entry) => document(entry, descriptor));
    requireValid(
      new Set(value.items.map((entry) => entry.ref.id)).size ===
        value.items.length,
    );
    if (Object.hasOwn(value, "total")) integer(value.total, value.items.length);
    boundedResult(descriptor, operation, args, value);
  } else if (operation === "content") {
    record(
      value,
      [...base, "text", "provenance", "truncated"],
      ["next", "reason"],
    );
    string(value.text, args.maxChars, true);
    record(value.provenance, ["ref", "kind"], ["page", "section"]);
    reference(value.provenance.ref, descriptor.source, args.ref);
    requireValid(["source-text", "source-ocr"].includes(value.provenance.kind));
    if (Object.hasOwn(value.provenance, "page"))
      integer(value.provenance.page, 1);
    if (Object.hasOwn(value.provenance, "section"))
      string(value.provenance.section, 2048);
    boundedResult(descriptor, operation, args, value);
  } else {
    requireValid(value.status === "ok");
    if (operation === "metadata") {
      record(value, [...base, "document"]);
      document(value.document, descriptor, args.ref);
    } else {
      record(value, [...base, "original"]);
      original(value.original, descriptor, args.ref);
    }
  }
  return value;
}

export function assertToolResult(descriptor, operation, args, value) {
  record(value, ["content", "structuredContent"], ["isError"]);
  const result = assertResult(
    descriptor,
    operation,
    args,
    value.structuredContent,
  );
  array(
    value.content,
    1,
    (entry) => {
      record(entry, ["type", "text"]);
      requireValid(entry.type === "text");
      string(entry.text, 65536);
    },
    1,
  );
  const serialized = JSON.stringify(result);
  requireValid(
    serialized.length <= 65536 && value.content[0].text === serialized,
  );
  requireValid(
    result.status === "error"
      ? value.isError === true
      : !Object.hasOwn(value, "isError") || value.isError === false,
  );
  return result;
}

export function toToolResult(descriptor, operation, args, envelope) {
  assertResult(descriptor, operation, args, envelope);
  const serialized = JSON.stringify(envelope);
  requireValid(serialized.length <= 65536);
  const content = [{ type: "text", text: serialized }];
  return {
    content,
    structuredContent: envelope,
    isError: envelope.status === "error",
  };
}

export function throwIfCancelled(signal) {
  if (signal.aborted) {
    const error = new Error("Document source invocation cancelled");
    error.name = "AbortError";
    throw error;
  }
}
