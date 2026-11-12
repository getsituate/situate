import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { filesRequest, type FilesReply, type FilesRequest } from "./api";
import {
  discardFile,
  editFile,
  flushWorkspace,
  loadWorkspace,
  openFile,
  pollWorkspace,
  request,
  releaseWorkspace,
  retainConflict,
  retainedWorkspaces,
  saveFile,
  workspaceSession,
} from "./sessions";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  filesRequest: vi.fn(),
}));
const invoke = vi.mocked(filesRequest);
const document = (text = "# Original", revision = "base") => ({
  path: "Notes/One.md",
  version: { text, revision },
  html: `<h1>${text.slice(2)}</h1>`,
  issues: [],
});
let sequence = 0;
const calls = () => invoke.mock.calls.map(([request]) => request);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const now = Date.now.bind(Date);
async function waitFor(condition: () => boolean) {
  const deadline = now() + 1000;
  while (!condition()) {
    if (now() >= deadline)
      throw new Error("Timed out waiting for the file operation");
    await setImmediate();
  }
}
function blobHash(text: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0${text}`)
    .digest("hex");
}
function merge(editor: string, base: string, external: string): string {
  const directory = mkdtempSync(join(tmpdir(), "situate-editor-merge-"));
  try {
    const paths = ["editor", "base", "external"].map((name) =>
      join(directory, name),
    );
    [editor, base, external].forEach((text, index) =>
      writeFileSync(paths[index]!, text),
    );
    return execFileSync("git", ["merge-file", "-p", ...paths], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
async function setup(writable = true) {
  const session = workspaceSession(`workspace-${++sequence}`);
  invoke.mockImplementation(async (request) => {
    if (request.operation === "snapshot")
      return {
        status: "ok",
        snapshot: {
          writable,
          reason: writable ? null : "Provider access is read-only.",
          entries: [{ path: "Notes/One.md", isDirectory: false }],
          drafts: [],
        },
      };
    if (request.operation === "read")
      return { status: "ok", document: { ...document(), path: request.path } };
    if (request.operation === "stage") return { status: "ok" };
    if (request.operation === "save")
      return { status: "saved", document: document(request.text, "saved") };
    throw new Error(`Unexpected operation: ${request.operation}`);
  });
  await loadWorkspace(session);
  await openFile(session, "Notes/One.md");
  return { session, file: session.files["Notes/One.md"]! };
}
describe("shared file identity", () => {
  it.each(["rename", "delete"] as const)(
    "retains edits made while %s is outstanding",
    async (operation) => {
      const { session, file } = await setup();
      const pending = deferred<FilesReply>();
      const implementation = invoke.getMockImplementation()!;
      invoke.mockImplementation(async (input) =>
        input.operation === operation ? pending.promise : implementation(input),
      );
      const mutation = request(
        session,
        operation === "rename"
          ? { operation, path: "Notes", destination: "Archive" }
          : { operation, path: "Notes/One.md" },
      );
      await waitFor(() => calls().some((call) => call.operation === operation));
      editFile(session, file, "# Typed during operation");
      pending.resolve({ status: "ok" });
      await mutation;
      await waitFor(() => calls().some((call) => call.operation === "stage"));
      expect(file.text).toBe("# Typed during operation");
      expect(file.dirty).toBe(true);
      if (operation === "rename") {
        expect(session.files["Archive/One.md"]).toBe(file);
        expect(session.files["Notes/One.md"]).toBeUndefined();
        expect(calls().find((call) => call.operation === "stage")?.path).toBe(
          "Archive/One.md",
        );
      } else {
        expect(session.files["Notes/One.md"]).toBe(file);
        expect(file.outcome?.status).toBe("deleted");
        expect(await saveFile(session, file)).toBe(false);
        expect(calls().some((call) => call.operation === "save")).toBe(false);
      }
    },
  );
  it("rejects a queued destructive action if another pane has added unsaved edits", async () => {
    const { session, file } = await setup();
    editFile(session, file, "# Keep this draft");
    await expect(
      request(session, { operation: "delete", path: file.path }),
    ).rejects.toThrow("files.someEditsInThisItemCouldNotBeSaved");
    expect(calls().some((call) => call.operation === "delete")).toBe(false);
    expect(file.text).toBe("# Keep this draft");
  });
});
beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
});
afterEach(() => {
  retainedWorkspaces().forEach(releaseWorkspace);
  vi.useRealTimers();
});

describe("retained file sessions", () => {
  it("waits for an existing snapshot before requesting deleted-file recovery", async () => {
    const { session } = await setup();
    const pending = deferred<FilesReply>();
    const implementation = invoke.getMockImplementation()!;
    invoke.mockImplementation((input) =>
      input.operation === "snapshot" && !input.includeDeleted
        ? pending.promise
        : implementation(input),
    );
    const refresh = loadWorkspace(session);
    await waitFor(() => session.loading);
    let recovered = false;
    const recovery = loadWorkspace(session, true).then(() => {
      recovered = true;
    });
    await setImmediate();
    expect(recovered).toBe(false);
    expect(
      calls().some(
        (call) => call.operation === "snapshot" && call.includeDeleted,
      ),
    ).toBe(false);
    pending.resolve({
      status: "ok",
      snapshot: { writable: true, reason: null, entries: [], drafts: [] },
    });
    await Promise.all([refresh, recovery]);
    expect(calls().at(-1)).toEqual({
      workspaceId: session.id,
      operation: "snapshot",
      includeDeleted: true,
    });
  });

  it("keeps the latest selection while older uncached reads finish", async () => {
    const { session } = await setup();
    const pending = deferred<FilesReply>();
    const implementation = invoke.getMockImplementation()!;
    invoke.mockImplementation((input) =>
      input.operation === "read" && input.path === "Older.md"
        ? pending.promise
        : implementation(input),
    );
    const older = openFile(session, "Older.md");
    await waitFor(() => calls().some((call) => call.path === "Older.md"));
    const newer = openFile(session, "Newer.md");
    expect(session.selected).toBe("Notes/One.md");
    pending.resolve({
      status: "ok",
      document: { ...document("# Older"), path: "Older.md" },
    });
    await Promise.all([older, newer]);
    expect(session.selected).toBe("Newer.md");
    expect(session.files["Older.md"]).toBeUndefined();
  });

  it("stages immediately and saves after the short debounce without a manual action", async () => {
    const { session, file } = await setup();
    editFile(session, file, "# Edited");
    await waitFor(() => file.recovery === "persisted");
    expect(calls().filter((call) => call.operation === "stage")).toEqual([
      {
        workspaceId: session.id,
        operation: "stage",
        path: "Notes/One.md",
        text: "# Edited",
        base: { text: "# Original", revision: "base" },
      },
    ]);
    expect(calls().some((call) => call.operation === "save")).toBe(false);
    await vi.advanceTimersByTimeAsync(649);
    expect(calls().some((call) => call.operation === "save")).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(file.dirty).toBe(false);
    expect(file.text).toBe("# Edited");
    expect(file.base?.revision).toBe("saved");
  });

  it("bounds the save wait during continuous typing", async () => {
    const { session, file } = await setup();
    for (let i = 0; i < 6; i++) {
      editFile(session, file, `# Edit ${i}`);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(calls().filter((call) => call.operation === "save")).toHaveLength(1);
    expect(file.text).toBe("# Edit 5");
  });

  it("never stages or saves a read-only provider and still permits source inspection", async () => {
    const { session, file } = await setup(false);
    editFile(session, file, "# Forbidden");
    await saveFile(session, file);
    await vi.advanceTimersByTimeAsync(4000);
    expect(file.text).toBe("# Original");
    expect(calls().map((call) => call.operation)).toEqual(["snapshot", "read"]);
  });

  it("applies exactly the successful saved merged content without changing the selected file", async () => {
    const { session, file } = await setup();
    editFile(session, file, "# Local");
    invoke.mockImplementationOnce(async () => ({ status: "ok" }));
    await waitFor(() => file.recovery === "persisted");
    invoke.mockResolvedValueOnce({
      status: "saved",
      document: document("# Local\n\nExternal addition", "merged"),
    });
    expect(await saveFile(session, file)).toBe(true);
    expect(file.text).toBe("# Local\n\nExternal addition");
    expect(file.error).toBe("");
    expect(file.outcome).toBe(null);
    expect(session.selected).toBe("Notes/One.md");
  });

  it.each([false, true])(
    "uses the exact submitted base for continued same-line typing (external addition: %s)",
    async (externalChange) => {
      const { session, file } = await setup();
      const initial = "a\n\nOriginal ending\n";
      const submitted = "ab\n\nOriginal ending\n";
      const latest = "abc\n\nOriginal ending\n";
      file.text = initial;
      file.base = { text: initial, revision: blobHash(initial) };
      let disk = externalChange ? "a\n\nExternal ending\n" : initial;
      const response = deferred<FilesReply>();
      let writes = 0;
      let firstReply!: FilesReply;
      const previous = invoke.getMockImplementation()!;
      invoke.mockImplementation(async (request) => {
        if (request.operation !== "save") return previous(request);
        expect(request.base?.revision).toBe(blobHash(request.base!.text));
        disk = merge(request.text!, request.base!.text, disk);
        const reply: FilesReply = {
          status: "saved",
          document: document(disk, blobHash(disk)),
          submittedRevision: blobHash(request.text!),
        };
        if (++writes === 1) {
          firstReply = reply;
          return response.promise;
        }
        return reply;
      });
      editFile(session, file, submitted);
      await waitFor(() => file.recovery === "persisted");
      const saving = saveFile(session, file);
      await waitFor(() => writes === 1);
      editFile(session, file, latest);
      response.resolve(firstReply);
      await saving;
      expect(file.text).toBe(latest);
      expect(file.base).toEqual({
        text: submitted,
        revision: blobHash(submitted),
      });
      expect(file.dirty).toBe(true);
      await waitFor(() => file.recovery === "persisted");
      expect(await saveFile(session, file)).toBe(true);
      expect(file.text).toBe(
        externalChange ? "abc\n\nExternal ending\n" : latest,
      );
      expect(file.outcome).toBeNull();
      expect(writes).toBe(2);
    },
  );

  it("retains failed text across view access and never lets polling overwrite it", async () => {
    const { session, file } = await setup();
    editFile(session, file, "# Retained");
    await waitFor(() => file.recovery === "persisted");
    invoke.mockRejectedValueOnce(new Error("Disk is full"));
    expect(await saveFile(session, file)).toBe(false);
    await pollWorkspace(session);
    expect(workspaceSession(session.id).files[file.path]?.text).toBe(
      "# Retained",
    );
    expect(file.dirty).toBe(true);
    expect(file.error).toEqual(new Error("Disk is full"));
    expect(calls().filter((call) => call.operation === "read")).toHaveLength(1);
  });

  it("reports memory-only text when staging and writing both fail", async () => {
    const { session, file } = await setup();
    invoke.mockRejectedValue(new Error("No storage available"));
    editFile(session, file, "# Only in memory");
    await waitFor(() => file.recovery === "memory");
    expect(file.recovery).toBe("memory");
    expect(file.error).toEqual([
      "files.memoryOnly",
      new Error("No storage available"),
    ]);
    await saveFile(session, file);
    expect(file.text).toBe("# Only in memory");
    expect(file.dirty).toBe(true);
    expect(file.recovery).toBe("memory");
  });

  it("retains conflicts until an explicit candidate is successfully written", async () => {
    const { session, file } = await setup();
    editFile(session, file, "# Mine");
    await waitFor(() => file.recovery === "persisted");
    invoke.mockResolvedValueOnce({
      status: "conflict",
      base: document().version,
      editor: "# Mine",
      external: { text: "# Theirs", revision: "external" },
      token: "review",
    });
    await saveFile(session, file);
    const count = calls().length;
    await saveFile(session, file);
    expect(calls()).toHaveLength(count);
    invoke.mockRejectedValueOnce(new Error("Write failed"));
    await saveFile(session, file, { choice: "external" });
    expect(file.text).toBe("# Mine");
    expect(file.outcome?.token).toBe("review");
    expect(calls().at(-1)).toMatchObject({
      operation: "resolve",
      token: "review",
      choice: "external",
    });
  });

  it("does not recreate externally deleted files during autosave", async () => {
    const { session, file } = await setup();
    editFile(session, file, "# Keep this");
    await waitFor(() => file.recovery === "persisted");
    invoke.mockResolvedValueOnce({ status: "deleted" });
    await saveFile(session, file);
    await vi.advanceTimersByTimeAsync(5000);
    expect(file.outcome?.status).toBe("deleted");
    expect(file.text).toBe("# Keep this");
    expect(
      calls().some(
        (call) => call.operation === "create" || call.operation === "restore",
      ),
    ).toBe(false);
  });

  it("flushes every retained draft, not just the selected file", async () => {
    const { session, file } = await setup();
    await openFile(session, "Notes/Two.md");
    const second = session.files["Notes/Two.md"]!;
    editFile(session, file, "# First file");
    editFile(session, second, "# Second file");
    expect(await flushWorkspace(session)).toBe(true);
    const saves = calls().filter((call) => call.operation === "save");
    expect(saves.map((call) => call.path)).toEqual([
      "Notes/One.md",
      "Notes/Two.md",
    ]);
    expect(session.selected).toBe("Notes/Two.md");
  });

  it("ignores a clean polling read that returns after typing begins", async () => {
    const { session, file } = await setup();
    const response = deferred<FilesReply>();
    const previous = invoke.getMockImplementation()!;
    const reading = deferred<void>();
    invoke.mockImplementation((request: FilesRequest) => {
      if (request.operation !== "read") return previous(request);
      reading.resolve();
      return response.promise;
    });
    const polling = pollWorkspace(session);
    await reading.promise;
    editFile(session, file, "# Typed during read");
    response.resolve({
      status: "ok",
      document: document("# Stale read", "stale"),
    });
    await polling;
    expect(file.text).toBe("# Typed during read");
    expect(file.base?.revision).toBe("base");
  });

  it("passes exact non-Markdown filenames without URI decoding or fragment stripping", async () => {
    const { session } = await setup();
    invoke.mockResolvedValueOnce({ status: "binary" });
    invoke.mockResolvedValueOnce({ status: "ok" });
    await openFile(session, "Images/100% # plan.pdf");
    expect(calls().at(-1)).toEqual({
      workspaceId: session.id,
      operation: "openExternal",
      path: "Images/100% # plan.pdf",
    });
  });

  it("reloads the actual external version after discarding a conflicting draft", async () => {
    const { session, file } = await setup();
    editFile(session, file, "# Unsaved");
    await waitFor(() => file.recovery === "persisted");
    invoke.mockResolvedValueOnce({ status: "ok" });
    invoke.mockResolvedValueOnce({
      status: "ok",
      document: document("# Actual external file", "external"),
    });
    await discardFile(session, file);
    expect(file.text).toBe("# Actual external file");
    expect(file.base?.revision).toBe("external");
    expect(file.dirty).toBe(false);
    expect(
      calls()
        .slice(-2)
        .map((call) => call.operation),
    ).toEqual(["discard", "read"]);
  });

  it("keeps the compensating ancestor when a dismissed reversal conflict is edited and retried", async () => {
    const { session, file } = await setup();
    const ancestor = "Title after selected change\n\nOriginal footer\n";
    const external = "Title changed later\n\nIndependent later footer\n";
    const proposed = "Title before selected change\n\nOriginal footer\n";
    const base = { text: ancestor, revision: blobHash(ancestor) };
    retainConflict(session, file.path, {
      status: "conflict",
      base,
      editor: proposed,
      external: { text: external, revision: blobHash(external) },
      token: "reversal",
    });
    await waitFor(() => file.recovery === "persisted");
    expect(file.base).toEqual(base);
    const edited = proposed.replace("Title before", "Edited title before");
    editFile(session, file, edited);
    await waitFor(() => file.recovery === "persisted");
    invoke.mockImplementationOnce(async (request) => {
      if (request.operation !== "save")
        throw new Error(`Unexpected operation: ${request.operation}`);
      expect(request.base).toEqual(base);
      expect(() => merge(request.text, request.base.text, external)).toThrow();
      return {
        status: "conflict",
        base,
        editor: request.text,
        external: { text: external, revision: blobHash(external) },
        token: "review-again",
      };
    });
    expect(await saveFile(session, file)).toBe(false);
    expect(file.text).toBe(edited);
    expect(file.outcome?.external?.text).toContain("Independent later footer");
    expect(file.outcome?.token).toBe("review-again");
  });

  it("loads persisted recovery drafts without writing or normalizing them on view entry", async () => {
    const session = workspaceSession(`workspace-${++sequence}`);
    invoke.mockResolvedValue({
      status: "ok",
      snapshot: {
        writable: true,
        reason: null,
        entries: [],
        drafts: [{ path: "Lost.md", text: "# Recovered", base: null }],
      },
    });
    await loadWorkspace(session);
    await openFile(session, "Lost.md");
    expect(session.files["Lost.md"]?.text).toBe("# Recovered");
    expect(session.files["Lost.md"]?.recovery).toBe("persisted");
    expect(calls().map((call) => call.operation)).toEqual(["snapshot"]);
  });
});
