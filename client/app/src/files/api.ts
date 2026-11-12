import { localizeError } from "@situate/localization";
import { invoke } from "@tauri-apps/api/core";
import { diagnosticsFor, type Context } from "../diagnostics";
import {
  validReference,
  type ContentReference,
} from "../ai/content-references";

export interface TextVersion {
  text: string;
  revision: string;
}
export interface FileEntry {
  path: string;
  isDirectory: boolean;
}
export interface Draft {
  path: string;
  base: TextVersion | null;
  text: string;
}
export interface MetadataIssue {
  line: number;
  message: string;
}
export interface TaskEntry {
  id: string;
  text: string;
  completed: boolean;
  checkboxOffset: number;
}
export interface FileDocument {
  path: string;
  version: TextVersion;
  html: string;
  issues: MetadataIssue[];
}
export interface HistoryEntry {
  revision: string;
  message: string;
  timestamp: number;
  path?: string | null;
  deleted?: boolean;
}
export interface DeletedEntry {
  path: string;
  revision: string;
  isDirectory: boolean;
}
export interface FilesSnapshot {
  writable: boolean;
  canExport?: boolean;
  reason: string | null;
  entries: FileEntry[];
  drafts: Draft[];
  deleted?: DeletedEntry[];
}
type UnionKeys<T> = T extends unknown ? keyof T : never;
type StrictUnion<T, All = T> = T extends unknown
  ? T & Partial<Record<Exclude<UnionKeys<All>, keyof T>, never>>
  : never;
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type RequestBody = StrictUnion<
  | { operation: "snapshot"; includeDeleted?: boolean }
  | { operation: "detach"; force?: boolean }
  | { operation: "quitReady" | "cancelQuit"; token: string }
  | { operation: "read"; path: string; text?: string }
  | { operation: "inspectTasks"; path: string }
  | { operation: "captureReference"; path: string; expectedRevision?: string }
  | {
      operation: "resolveReference";
      reference: ContentReference;
      render?: boolean;
    }
  | { operation: "stage"; path: string; text: string; base?: TextVersion }
  | {
      operation: "save";
      path: string;
      text: string;
      base: TextVersion;
      confirmIdChange?: boolean;
    }
  | {
      operation: "resolve";
      path: string;
      token: string;
      choice: "editor" | "external";
    }
  | { operation: "discard" | "mkdir" | "delete" | "resource"; path: string }
  | { operation: "create"; path: string; text?: string; destination?: string }
  | { operation: "rename" | "copy"; path: string; destination: string }
  | { operation: "history"; path?: string; exactPath?: false }
  | { operation: "history"; path: string; exactPath: true; revision: string }
  | {
      operation: "revision";
      path: string;
      revision: string;
      exactPath?: boolean;
    }
  | {
      operation: "restore";
      path: string;
      revision: string;
      destination?: string;
    }
  | { operation: "restore"; path: string; base: TextVersion; text: string }
  | {
      operation: "historicalCopy";
      path: string;
      revision: string;
      destination: string;
      exactPath?: boolean;
    }
  | { operation: "revert"; path: string; revision: string }
  | { operation: "openExternal"; path: string }
  | { operation: "openExternal"; href: string; destination: string }
  | { operation: "export"; path: string; text: string }
>;
export type FilesRequest = RequestBody & {
  workspaceId: string;
  pluginId?: string;
};
export type FilesOperation = FilesRequest["operation"];
type Success = { status: "ok" } & StrictUnion<
  | { snapshot: FilesSnapshot }
  | { document: FileDocument }
  | { document: FileDocument; tasks: TaskEntry[] }
  | { reference: ContentReference }
  | { reference: ContentReference; document: FileDocument }
  | { history: HistoryEntry[] }
  | { dataUrl: string }
  | { message?: string }
>;
export type FilesReply = StrictUnion<
  | Success
  | {
      status: "saved";
      document: FileDocument;
      submittedRevision?: string | null;
      message?: string | null;
    }
  | {
      status: "savedHistoryFailed";
      document: FileDocument;
      message: string;
      submittedRevision?: string | null;
    }
  | {
      status: "savedDraftCleanupFailed";
      document: FileDocument;
      message: string;
      submittedRevision?: string | null;
    }
  | {
      status: "conflict";
      editor: string;
      external: TextVersion;
      base: TextVersion;
      token: string;
      message?: string;
    }
  | { status: "deleted" }
  | { status: "binary" }
  | { status: "identityConfirmation" }
  | { status: "cancelled" }
  | { status: "changed"; base?: TextVersion }
  | {
      status: "partialFailure";
      changedPaths: string[];
      recoveryRevision: string | null;
      message: string;
    }
>;

type ReplyStatus<S extends FilesReply["status"]> = Extract<
  FilesReply,
  { status: S }
>;
type EmptyReply = {
  status: "ok";
  message?: string;
  snapshot?: never;
  document?: never;
  history?: never;
  dataUrl?: never;
};
type DocumentReply = Extract<
  Success,
  { document: FileDocument; tasks?: never }
>;
type SaveReply = ReplyStatus<
  "saved" | "savedHistoryFailed" | "savedDraftCleanupFailed"
>;
type StructureReply = EmptyReply | ReplyStatus<"partialFailure">;
export type FilesReplyFor<O extends FilesOperation> = O extends "snapshot"
  ? Extract<Success, { snapshot: FilesSnapshot }>
  : O extends "captureReference"
    ? Extract<Success, { reference: ContentReference }>
    : O extends "inspectTasks"
      ? Extract<Success, { tasks: TaskEntry[] }> | ReplyStatus<"deleted">
      : O extends "resolveReference"
        ? | Extract<
              Success,
              { reference: ContentReference; document: FileDocument }
            >
          | ReplyStatus<"deleted">
        : O extends "read"
          ? DocumentReply | ReplyStatus<"deleted" | "binary">
          : O extends "revision"
            ? DocumentReply | ReplyStatus<"deleted">
            : O extends "history"
              ? Extract<Success, { history: HistoryEntry[] }>
              : O extends "resource"
                ? Extract<Success, { dataUrl: string }>
                : O extends "save"
                  ? | SaveReply
                    | ReplyStatus<
                        | "conflict"
                        | "changed"
                        | "deleted"
                        | "identityConfirmation"
                      >
                  : O extends "resolve"
                    ? | SaveReply
                      | ReplyStatus<"conflict" | "changed" | "deleted">
                    : O extends "create"
                      ? SaveReply
                      : O extends "restore" | "revert"
                        ? | StructureReply
                          | SaveReply
                          | ReplyStatus<"conflict" | "changed" | "deleted">
                        : O extends
                              | "mkdir"
                              | "rename"
                              | "copy"
                              | "delete"
                              | "historicalCopy"
                          ? StructureReply
                          : O extends "openExternal"
                            ? EmptyReply | DocumentReply
                            : O extends "export"
                              ? EmptyReply | ReplyStatus<"cancelled">
                              : EmptyReply;

type Validator = (value: unknown) => boolean;
const string: Validator = (value) => typeof value === "string";
const boolean: Validator = (value) => typeof value === "boolean";
const integer: Validator = (value) =>
  typeof value === "number" && Number.isSafeInteger(value);
const nullable =
  (validate: Validator): Validator =>
  (value) =>
    value === null || validate(value);
const array =
  (validate: Validator): Validator =>
  (value) =>
    Array.isArray(value) && value.every(validate);
function object(
  required: Record<string, Validator>,
  optional: Record<string, Validator> = {},
): Validator {
  return (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const data = value as Record<string, unknown>;
    return (
      Object.entries(required).every(
        ([key, validate]) => Object.hasOwn(data, key) && validate(data[key]),
      ) &&
      Object.keys(data).every(
        (key) =>
          Object.hasOwn(required, key) ||
          (Object.hasOwn(optional, key) && optional[key]!(data[key])),
      )
    );
  };
}
const version = object({ text: string, revision: string });
const document = object({
  path: string,
  version,
  html: string,
  issues: array(
    object({
      line: (value) => integer(value) && Number(value) >= 0,
      message: string,
    }),
  ),
});
const entry = object({ path: string, isDirectory: boolean });
const snapshot = object(
  {
    writable: boolean,
    reason: nullable(string),
    entries: array(entry),
    drafts: array(
      object({ path: string, base: nullable(version), text: string }),
    ),
  },
  {
    canExport: boolean,
    deleted: array(
      object({ path: string, revision: string, isDirectory: boolean }),
    ),
  },
);
const history = array(
  object(
    { revision: string, message: string, timestamp: integer },
    { path: nullable(string), deleted: boolean },
  ),
);
const oneOf =
  (...values: string[]): Validator =>
  (value) =>
    typeof value === "string" && values.includes(value);
const status = (
  name: string,
  required: Record<string, Validator> = {},
  optional: Record<string, Validator> = {},
): Validator => object({ status: oneOf(name), ...required }, optional);
const saveOperations: FilesOperation[] = [
  "save",
  "resolve",
  "create",
  "restore",
  "revert",
];
const conflictOperations: FilesOperation[] = [
  "save",
  "resolve",
  "restore",
  "revert",
];
const structureOperations: FilesOperation[] = [
  "mkdir",
  "rename",
  "copy",
  "delete",
  "historicalCopy",
  "restore",
  "revert",
];

export function validateFilesReply(
  operation: FilesOperation,
  value: unknown,
): FilesReply {
  const validators: Validator[] = [];
  if (operation === "snapshot") validators.push(status("ok", { snapshot }));
  if (operation === "captureReference")
    validators.push(
      status("ok", {
        reference: (value) => validReference(value) && value.kind === "live",
      }),
    );
  if (operation === "resolveReference")
    validators.push(status("ok", { reference: validReference, document }));
  if (operation === "inspectTasks")
    validators.push(
      status("ok", {
        document,
        tasks: array(
          object({
            id: (value) =>
              string(value) &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
                String(value),
              ) &&
              value !== "00000000-0000-0000-0000-000000000000",
            text: string,
            completed: boolean,
            checkboxOffset: (value) => integer(value) && Number(value) >= 0,
          }),
        ),
      }),
    );
  if (["read", "revision", "openExternal"].includes(operation))
    validators.push(status("ok", { document }));
  if (operation === "read") validators.push(status("binary"));
  if (operation === "history") validators.push(status("ok", { history }));
  if (operation === "resource")
    validators.push(status("ok", { dataUrl: string }));
  if (
    [
      "stage",
      "discard",
      ...structureOperations,
      "openExternal",
      "export",
      "detach",
      "quitReady",
      "cancelQuit",
    ].includes(operation)
  )
    validators.push(status("ok", {}, { message: string }));
  if (saveOperations.includes(operation))
    validators.push(
      status(
        "saved",
        { document },
        { submittedRevision: nullable(string), message: nullable(string) },
      ),
      status(
        "savedHistoryFailed",
        { document, message: string },
        { submittedRevision: nullable(string) },
      ),
      status(
        "savedDraftCleanupFailed",
        { document, message: string },
        { submittedRevision: nullable(string) },
      ),
    );
  if (conflictOperations.includes(operation))
    validators.push(
      status(
        "conflict",
        { editor: string, external: version, base: version, token: string },
        { message: string },
      ),
      status("changed", {}, { base: version }),
    );
  if (
    [
      "read",
      "inspectTasks",
      "revision",
      "resolveReference",
      ...conflictOperations,
    ].includes(operation)
  )
    validators.push(status("deleted"));
  if (operation === "save") validators.push(status("identityConfirmation"));
  if (operation === "export") validators.push(status("cancelled"));
  if (structureOperations.includes(operation))
    validators.push(
      status("partialFailure", {
        changedPaths: array(string),
        recoveryRevision: nullable(string),
        message: string,
      }),
    );
  if (!validators.some((validate) => validate(value)))
    throw new Error("Invalid file response.");
  return value as FilesReply;
}
export function localizeFileError(error: unknown): string {
  return Array.isArray(error)
    ? error.map(localizeFileError).join(" ")
    : localizeError(error);
}

const diagnosticActions: Record<FilesOperation, string> = {
  snapshot: "read",
  detach: "close",
  quitReady: "stop",
  cancelQuit: "cancel",
  read: "read",
  inspectTasks: "read",
  captureReference: "read",
  resolveReference: "read",
  stage: "stage",
  save: "save",
  resolve: "save",
  discard: "cancel",
  mkdir: "create",
  delete: "delete",
  resource: "read",
  create: "create",
  rename: "rename",
  copy: "copy",
  history: "history",
  revision: "read",
  restore: "restore",
  historicalCopy: "copy",
  revert: "restore",
  openExternal: "open",
  export: "save",
};
export function filesRequest<R extends FilesRequest>(
  request: R,
  diagnostic?: Context,
): Promise<FilesReplyFor<R["operation"]>>;
export async function filesRequest(
  request: FilesRequest,
  diagnostic?: Context,
): Promise<FilesReply> {
  if (request.operation === "stage")
    return validateFilesReply(
      request.operation,
      await invoke<unknown>("files_request", { request }),
    );
  const operation = diagnosticsFor(request.workspaceId).operation(
    "storage",
    diagnosticActions[request.operation],
    "files",
    diagnostic,
    "background",
  );
  try {
    const reply = validateFilesReply(
      request.operation,
      await invoke<unknown>("files_request", {
        request,
        ...(operation.context ? { diagnostic: operation.context } : {}),
      }),
    );
    if (reply.status === "cancelled")
      operation.finish("cancelled", "cancelled");
    else if (
      ["conflict", "changed", "identityConfirmation"].includes(reply.status)
    )
      operation.finish("rejected", "conflict");
    else if (
      [
        "partialFailure",
        "savedHistoryFailed",
        "savedDraftCleanupFailed",
      ].includes(reply.status)
    )
      operation.finish("failure", "io");
    else operation.finish();
    return reply;
  } catch (error) {
    operation.finish("failure", "unknown");
    throw error;
  }
}
