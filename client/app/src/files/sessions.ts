import { reactive } from "vue";
import { diagnosticsFor, type Context } from "../diagnostics";
import {
  referenceKey,
  resolveReference,
  type ContentReference,
} from "../ai/content-references";
import {
  filesRequest,
  type DistributiveOmit,
  type FileDocument,
  type FilesReply,
  type FilesRequest,
  type FilesSnapshot,
  type TextVersion,
} from "./api";

export interface FileSession {
  path: string;
  reference?: ContentReference;
  text: string;
  base: TextVersion | null;
  document: FileDocument | null;
  dirty: boolean;
  generation: number;
  saving: boolean;
  recovery: "pending" | "persisted" | "memory";
  error: unknown;
  outcome: FilesReply | null;
}
export interface WorkspaceSession {
  id: string;
  pluginId?: string;
  snapshot: FilesSnapshot | null;
  files: Record<string, FileSession>;
  selected: string;
  error: unknown;
  loading: boolean;
  closing: boolean;
}
const workspaces = new Map<string, WorkspaceSession>();
const selections = new WeakMap<WorkspaceSession, number>();
const queues = new Map<string, Promise<unknown>>();
const loads = new Map<
  WorkspaceSession,
  { promise: Promise<void>; includeDeleted: boolean }
>();
const timers = new Map<
  FileSession,
  {
    debounce?: ReturnType<typeof setTimeout>;
    maximum?: ReturnType<typeof setTimeout>;
  }
>();

function sessionKey(id: string, pluginId?: string): string {
  return JSON.stringify([id, pluginId ?? null]);
}
function current(session: WorkspaceSession): boolean {
  return workspaces.get(sessionKey(session.id, session.pluginId)) === session;
}
export function workspaceSession(
  id: string,
  pluginId?: string,
): WorkspaceSession {
  const key = sessionKey(id, pluginId);
  let session = workspaces.get(key);
  if (!session) {
    session = reactive({
      id,
      ...(pluginId ? { pluginId } : {}),
      snapshot: null,
      files: {},
      selected: "",
      error: "",
      loading: false,
      closing: false,
    });
    workspaces.set(key, session);
  }
  return session;
}
export function retainedWorkspaces(): WorkspaceSession[] {
  return [...workspaces.values()];
}
function sendRequest(
  session: WorkspaceSession,
  input: DistributiveOmit<FilesRequest, "workspaceId" | "pluginId">,
  diagnostic?: Context,
): Promise<FilesReply> {
  if (
    session.pluginId &&
    !["snapshot", "read", "openExternal"].includes(input.operation)
  )
    return Promise.reject(new Error("native.files.provider.readOnly"));
  const payload = {
    ...input,
    workspaceId: session.id,
    ...(session.pluginId ? { pluginId: session.pluginId } : {}),
  };
  return diagnostic ? filesRequest(payload, diagnostic) : filesRequest(payload);
}
export function request(
  session: WorkspaceSession,
  input: DistributiveOmit<FilesRequest, "workspaceId" | "pluginId">,
  isCurrent?: () => boolean,
): Promise<FilesReply> {
  const key = sessionKey(session.id, session.pluginId);
  const pending = queues.get(key) ?? Promise.resolve();
  const next = pending
    .catch(() => undefined)
    .then(async () => {
      const affected =
        input.operation === "rename" || input.operation === "delete"
          ? Object.values(session.files).filter(
              (file) =>
                file.path === input.path ||
                file.path.startsWith(`${input.path}/`),
            )
          : [];
      if (affected.some((file) => file.dirty))
        throw new Error("files.someEditsInThisItemCouldNotBeSaved");
      if (!current(session) || isCurrent?.() === false)
        throw new Error("native.files.editor.closed");
      const reply = await sendRequest(session, input);
      if (
        reply.status === "ok" &&
        (input.operation === "rename" || input.operation === "delete")
      ) {
        for (const file of affected) {
          const previous = file.path;
          if (input.operation === "rename") {
            delete session.files[previous];
            file.path = input.destination + previous.slice(input.path.length);
            if (file.document) file.document.path = file.path;
            session.files[file.path] = file;
            if (session.selected === previous) session.selected = file.path;
          } else {
            stopTimers(file);
            file.outcome = { status: "deleted" };
            file.error = "files.theFileWasDeletedYourTextIsRetained";
            if (session.selected === previous) session.selected = "";
          }
        }
      }
      return reply;
    });
  queues.set(key, next);
  return next;
}
function serialize<T>(
  session: WorkspaceSession,
  task: () => Promise<T>,
): Promise<T> {
  const key = sessionKey(session.id, session.pluginId);
  const next = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(task);
  queues.set(key, next);
  return next;
}
function createFile(
  path: string,
  text: string,
  base: TextVersion | null,
  document: FileDocument | null,
  dirty = false,
): FileSession {
  return reactive({
    path,
    text,
    base,
    document,
    dirty,
    generation: 0,
    saving: false,
    recovery: dirty ? "persisted" : "pending",
    error: "",
    outcome: null,
  });
}
export async function loadWorkspace(
  session: WorkspaceSession,
  includeDeleted = false,
): Promise<void> {
  const pending = loads.get(session);
  if (pending) {
    await pending.promise;
    if (includeDeleted && !pending.includeDeleted && current(session))
      return loadWorkspace(session, true);
    return;
  }
  const loading = {
    promise: refreshWorkspace(session, includeDeleted),
    includeDeleted,
  };
  loads.set(session, loading);
  try {
    await loading.promise;
  } finally {
    if (loads.get(session) === loading) loads.delete(session);
  }
}
async function refreshWorkspace(
  session: WorkspaceSession,
  includeDeleted: boolean,
): Promise<void> {
  session.loading = true;
  try {
    const reply = await request(session, {
      operation: "snapshot",
      ...(includeDeleted ? { includeDeleted: true } : {}),
    });
    if (!current(session)) return;
    if (!reply.snapshot)
      throw new Error(
        reply.message ?? "files.theWorkspaceDidNotReturnAFileList",
      );
    session.snapshot = {
      ...reply.snapshot,
      deleted: reply.snapshot.deleted ?? session.snapshot?.deleted,
    };
    for (const draft of reply.snapshot.drafts) {
      if (!session.files[draft.path]) {
        const recovered = createFile(
          draft.path,
          draft.text,
          draft.base,
          null,
          true,
        );
        if (
          !reply.snapshot.entries.some((entry) => entry.path === draft.path)
        ) {
          recovered.outcome = { status: "deleted" };
          recovered.error = "files.theFileIsMissingYourRecoveryDraftIsRetained";
        }
        session.files[draft.path] = recovered;
      }
    }
    session.error = "";
  } catch (error) {
    session.error = error;
  } finally {
    session.loading = false;
  }
}
class BinaryFile extends Error {
  constructor() {
    super("files.fileIsBinary");
  }
}
async function readDocument(
  session: WorkspaceSession,
  path: string,
  reference?: ContentReference,
): Promise<FileDocument> {
  if (reference) return resolveReference(session.id, reference, true);
  const reply = await sendRequest(session, { operation: "read", path });
  if (reply.status === "binary") throw new BinaryFile();
  if (reply.status === "deleted")
    throw new Error("files.thisFileWasDeletedOutsideSituate");
  if (!reply.document || reply.document.path !== path)
    throw new Error(reply.message ?? "files.theFileCouldNotBeRead");
  return reply.document;
}
function locateDocument(
  session: WorkspaceSession,
  file: FileSession,
  path: string,
): void {
  if (path === file.path) return;
  if (file.dirty || (session.files[path] && session.files[path] !== file))
    throw new Error("native.content.reference.changed");
  const previous = file.path;
  if (session.files[previous] === file) delete session.files[previous];
  file.path = path;
  session.files[path] = file;
  if (session.selected === previous) session.selected = path;
}
export async function openFile(
  session: WorkspaceSession,
  path: string,
  select = true,
  reference?: ContentReference,
  options: { openBinary?: boolean; isCurrent?: () => boolean } = {},
): Promise<FileSession | undefined> {
  const attempt = select ? (selections.get(session) ?? 0) + 1 : 0;
  if (select) selections.set(session, attempt);
  const isCurrent = () =>
    current(session) &&
    options.isCurrent?.() !== false &&
    (!select || selections.get(session) === attempt);
  session.error = "";
  try {
    const result = await serialize(session, async () => {
      if (!isCurrent()) return;
      const retained =
        (reference &&
          Object.values(session.files).find(
            (file) =>
              file.reference &&
              referenceKey(file.reference) === referenceKey(reference),
          )) ||
        session.files[path];
      if (
        !reference &&
        (retained?.dirty || retained?.outcome?.status === "deleted")
      )
        return retained;
      if (
        reference &&
        retained?.reference &&
        referenceKey(reference) !== referenceKey(retained.reference)
      )
        throw new Error("native.content.reference.changed");
      const generation = retained?.generation;
      const identity = reference ?? retained?.reference;
      const document = await readDocument(session, path, identity);
      if (!isCurrent()) return;
      const file = retained ?? session.files[document.path];
      if (file) {
        if (
          file.reference &&
          identity &&
          referenceKey(file.reference) !== referenceKey(identity)
        )
          throw new Error("native.content.reference.changed");
        if (
          identity &&
          !file.reference &&
          (file.document || file.dirty) &&
          file.base?.revision !== document.version.revision
        )
          throw new Error("native.content.reference.changed");
        locateDocument(session, file, document.path);
        if (identity) file.reference = identity;
        if (
          !file.dirty &&
          (generation === undefined || file.generation === generation)
        ) {
          file.document = document;
          file.base = document.version;
          file.text = document.version.text;
          file.error = "";
        }
        return file;
      }
      const opened = createFile(
        document.path,
        document.version.text,
        document.version,
        document,
      );
      if (identity) opened.reference = identity;
      session.files[document.path] = opened;
      return opened;
    });
    if (result && select && isCurrent()) session.selected = result.path;
    return isCurrent() ? result : undefined;
  } catch (error) {
    if (!isCurrent()) return;
    if (
      error instanceof BinaryFile &&
      !reference &&
      options.openBinary !== false
    ) {
      try {
        const reply = await request(
          session,
          {
            operation: "openExternal",
            path,
          },
          isCurrent,
        );
        if (reply.status !== "ok")
          throw new Error(reply.message ?? "files.theFileCouldNotBeOpened", {
            cause: error,
          });
      } catch (reason) {
        if (isCurrent()) session.error = reason;
      }
    } else session.error = error;
    return undefined;
  }
}
function stopTimers(file: FileSession): void {
  const timer = timers.get(file);
  if (timer) {
    clearTimeout(timer.debounce);
    clearTimeout(timer.maximum);
    timers.delete(file);
  }
}
export function editFile(
  session: WorkspaceSession,
  file: FileSession,
  text: string,
): void {
  if (!session.snapshot?.writable || session.closing) return;
  file.text = text;
  file.generation++;
  file.dirty = true;
  file.recovery = "pending";
  file.error = "";
  // A candidate token describes the old editor text, so further typing requires a new assessment.
  file.outcome = null;
  void stage(session, file);
  const timer = timers.get(file) ?? {};
  clearTimeout(timer.debounce);
  timer.debounce = setTimeout(() => {
    void saveFile(session, file);
  }, 650);
  timer.maximum ??= setTimeout(() => {
    void saveFile(session, file);
  }, 3000);
  timers.set(file, timer);
}
export async function stage(
  session: WorkspaceSession,
  file: FileSession,
): Promise<void> {
  if (!session.snapshot?.writable) return;
  const generation = file.generation;
  const text = file.text;
  await serialize(session, async () => {
    if (!file.dirty || generation !== file.generation) return;
    try {
      const reply = await sendRequest(session, {
        operation: "stage",
        path: file.path,
        text,
        ...(file.base ? { base: file.base } : {}),
      });
      if (reply.status !== "ok")
        throw new Error(reply.message ?? "files.recoveryDraftCouldNotBeStored");
      if (generation === file.generation) file.recovery = "persisted";
    } catch (error) {
      if (generation === file.generation) {
        file.recovery = "memory";
        file.error = ["files.memoryOnly", error];
      }
    }
  });
}
export async function saveFile(
  session: WorkspaceSession,
  file: FileSession,
  options: {
    confirmIdChange?: boolean;
    choice?: "editor" | "external";
    diagnostic?: Context;
  } = {},
): Promise<boolean> {
  stopTimers(file);
  if (!session.snapshot?.writable) return !file.dirty;
  return serialize(session, async () => {
    if (!file.dirty) return !file.error;
    if (file.outcome && !options.choice && !options.confirmIdChange)
      return false;
    const generation = file.generation;
    const text = file.text;
    const base = file.base;
    let submittedText =
      options.choice === "external"
        ? (file.outcome?.external?.text ?? text)
        : text;
    const logger = diagnosticsFor(session.id);
    const operation = logger.operation(
      "storage",
      "save",
      "editor",
      options.diagnostic,
      "background",
    );
    let outcome: "success" | "failure" | "rejected" = "failure";
    let errorCode: string | undefined = "unknown";
    file.saving = true;
    try {
      if (!base) throw new Error("native.files.editor.baseMissing");
      const token = file.outcome?.token;
      if (options.choice && !token)
        throw new Error(
          "Review the current conflict before choosing a version.",
        );
      let reply = await sendRequest(
        session,
        options.choice && token
          ? {
              operation: "resolve",
              path: file.path,
              token,
              choice: options.choice,
            }
          : {
              operation: "save",
              path: file.path,
              text,
              base,
              confirmIdChange: options.confirmIdChange,
            },
        operation.context,
      );
      if (reply.status === "changed" && generation === file.generation) {
        submittedText = text;
        logger.emit(
          "operation.retry",
          "storage",
          { action: "save", component: "editor", attempt: 1 },
          operation.context,
          "warn",
        );
        reply = await sendRequest(
          session,
          {
            operation: "save",
            path: file.path,
            text,
            base,
          },
          operation.context,
        );
        if (reply.status === "conflict")
          reply.message =
            "files.theFileChangedAgainReviewBothUpdatedVersionsBefore";
      }
      if (
        ["saved", "savedHistoryFailed", "savedDraftCleanupFailed"].includes(
          reply.status,
        ) &&
        reply.document
      ) {
        outcome = reply.status === "saved" ? "success" : "failure";
        errorCode = reply.status === "saved" ? undefined : "io";
        file.document = reply.document;
        if (file.generation === generation) {
          file.text = reply.document.version.text;
          file.base = reply.document.version;
          file.dirty = reply.status !== "saved";
          file.outcome = null;
          file.error =
            reply.status === "saved"
              ? ""
              : (reply.message ??
                "files.theFileWasWrittenButHistoryOrRecoveryCleanup");
        } else if (reply.submittedRevision) {
          file.base = {
            text: submittedText,
            revision: reply.submittedRevision,
          };
        } else if (reply.document.version.text === submittedText) {
          file.base = reply.document.version;
        } else {
          file.error = "files.newerEditsAreRetainedButTheirMergeBaseWas";
        }
        return !file.dirty;
      }
      outcome = "rejected";
      errorCode = reply.status === "deleted" ? "not_found" : "conflict";
      if (generation === file.generation) {
        file.outcome = reply;
        file.error =
          reply.message ??
          (reply.status === "deleted"
            ? "files.theFileWasDeletedYourTextIsRetained"
            : reply.status === "identityConfirmation"
              ? "files.changingAnIDMayBreakExistingReferences"
              : "files.chooseWhichCompleteVersionToKeep");
      }
      return false;
    } catch (error) {
      file.error = error;
      return false;
    } finally {
      operation.finish(outcome, errorCode);
      file.saving = false;
    }
  });
}
export function retainConflict(
  session: WorkspaceSession,
  path: string,
  reply: FilesReply,
  select = true,
): void {
  if (reply.editor === undefined || !reply.external || !reply.base)
    throw new Error(
      "files.theConflictCandidatesOrTheirOriginalBaseAreUnavailable",
    );
  const file =
    session.files[path] ??
    createFile(path, reply.editor, reply.base, null, true);
  file.text = reply.editor;
  file.base = reply.base;
  file.dirty = true;
  file.generation++;
  file.outcome = reply;
  file.error = reply.message ?? "files.chooseWhichCompleteVersionToKeep";
  session.files[path] = file;
  if (select) session.selected = path;
  void stage(session, file);
}
export async function retryFile(
  session: WorkspaceSession,
  file: FileSession,
  diagnostic?: Context,
): Promise<boolean> {
  if (file.reference && !file.dirty && !file.outcome) {
    const opened = await openFile(session, file.path, false, file.reference);
    if (opened) return true;
    file.error = session.error || "references.unavailable";
    return false;
  }
  if (
    !["conflict", "changed", "deleted", "identityConfirmation"].includes(
      file.outcome?.status ?? "",
    )
  )
    file.outcome = null;
  await stage(session, file);
  return saveFile(session, file, { diagnostic });
}
export async function discardFile(
  session: WorkspaceSession,
  file: FileSession,
): Promise<void> {
  stopTimers(file);
  const reply = await request(session, {
    operation: "discard",
    path: file.path,
  });
  if (reply.status !== "ok")
    throw new Error(
      reply.message ?? "files.theRecoveryDraftCouldNotBeDiscarded",
    );
  const generation = ++file.generation;
  file.dirty = false;
  file.outcome = null;
  file.error = "";
  try {
    const document = await serialize(session, () =>
      readDocument(session, file.path, file.reference),
    );
    if (generation !== file.generation || file.dirty) return;
    locateDocument(session, file, document.path);
    file.document = document;
    file.base = document.version;
    file.text = document.version.text;
    return;
  } catch (error) {
    if (generation !== file.generation || file.dirty) return;
    session.error = ["files.theDraftWasDiscardedButTheCurrentFileCould", error];
  }
  delete session.files[file.path];
  if (session.selected === file.path) session.selected = "";
}
export async function flushWorkspace(
  session: WorkspaceSession,
): Promise<boolean> {
  const files = Object.values(session.files).filter((file) => file.dirty);
  const outcomes = await Promise.all(
    files.map((file) => saveFile(session, file)),
  );
  return outcomes.every(Boolean);
}
const viewers = new Map<WorkspaceSession, Set<() => string>>();
const pollers = new Map<WorkspaceSession, ReturnType<typeof setInterval>>();
const polling = new Set<WorkspaceSession>();
export function observeFiles(
  session: WorkspaceSession,
  path: () => string,
): () => void {
  const paths = viewers.get(session) ?? new Set<() => string>();
  paths.add(path);
  viewers.set(session, paths);
  if (!pollers.has(session))
    pollers.set(
      session,
      setInterval(() => {
        if (!document.hidden) void pollWorkspace(session);
      }, 2500),
    );
  return () => {
    paths.delete(path);
    if (!paths.size) {
      clearInterval(pollers.get(session));
      pollers.delete(session);
      viewers.delete(session);
      if (session.pluginId) releaseWorkspace(session);
    }
  };
}
export async function pollWorkspace(session: WorkspaceSession): Promise<void> {
  if (session.closing || session.loading || polling.has(session)) return;
  polling.add(session);
  try {
    await loadWorkspace(session);
    const observed = viewers.get(session);
    const paths = new Set(
      observed ? [...observed].map((path) => path()) : [session.selected],
    );
    for (const path of paths)
      await serialize(session, async () => {
        const file = session.files[path];
        if (
          session.closing ||
          !file ||
          file.dirty ||
          file.saving ||
          file.outcome?.status === "deleted"
        )
          return;
        const generation = file.generation;
        try {
          const document = await readDocument(
            session,
            file.path,
            file.reference,
          );
          if (file.dirty || file.generation !== generation || !current(session))
            return;
          locateDocument(session, file, document.path);
          file.document = document;
          file.base = document.version;
          file.text = document.version.text;
        } catch (error) {
          if (!file.dirty) file.error = error;
        }
      });
  } finally {
    polling.delete(session);
  }
}
export function releaseWorkspace(session: WorkspaceSession): void {
  clearInterval(pollers.get(session));
  pollers.delete(session);
  viewers.delete(session);
  Object.values(session.files).forEach(stopTimers);
  workspaces.delete(sessionKey(session.id, session.pluginId));
}
