import type { Page } from "@playwright/test";
import { legacyChatLayout, type LayoutFixtureOptions } from "./layout-fixture";
import type { FilesReply, FilesRequest } from "../../src/files/api";
import { workspaceFixture, shellState } from "./workspace-fixture";

declare global {
  interface Window {
    __filesTest: {
      calls: FilesRequest[];
      setFailure(value: boolean): void;
      setSnapshotFailure(value: boolean): void;
      setConflict(value: boolean): void;
      setChanged(value: boolean): void;
      setDeleted(value: boolean): void;
      setMerged(text: string): void;
      holdRead(path: string): void;
      releaseRead(): void;
      holdRevision(): void;
      releaseRevision(): void;
      external(path: string, text: string): void;
      emit(name: string, payload: unknown): void;
    };
  }
}

export async function filesFixture(
  page: Page,
  options: {
    layout?: LayoutFixtureOptions;
    writable?: boolean;
    failSave?: boolean;
    mobile?: boolean;
    historyMessage?: string;
    extraFiles?: Record<string, string>;
  } = {},
): Promise<void> {
  await workspaceFixture(
    page,
    { ...shellState, mobile: options.mobile ?? false },
    { layout: options.layout ?? { records: { garden: legacyChatLayout() } } },
  );
  await page.addInitScript((options) => {
    const workspace = {
      id: "garden",
      name: "Garden notes",
      display: "/Documents/Garden notes",
    };
    const state = {
      ready: true,
      mobile: options.mobile ?? false,
      known: [workspace],
      open: [workspace],
      current: workspace as typeof workspace | null,
      failures: [],
      error: null,
    };
    const original =
      "---\nsituate-id: 90c830ce-e6b7-4e27-a6bf-754587491492\ncustom-field: untouched\n---\n\n# A small garden\n\nLeave room for the unexpected.\n\n- [ ] Plant lavender\n- [x] Water the herbs\n\n## This week\n\nChoose a quiet corner for reading.\n";
    const files: Record<string, string> = {
      "Notes/Garden.md": original,
      "Notes/Reading.md": "# Reading list\n\nA book for the weekend.",
      ...options.extraFiles,
    };
    const folders = new Set(["Notes"]);
    const calls: FilesRequest[] = [];
    let preferences = {
      language: "en",
      formats: { time: "12", date: "mdy", number: "dot-comma" },
      writable: options.writable ?? true,
    };
    const drafts: Record<
      string,
      {
        path: string;
        text: string;
        base: { text: string; revision: string } | null;
      }
    > = {};
    const reviewEditors: Record<string, string> = {};
    let serial = 1;
    const capturedPaths = new Map<string, string>();
    let failSave = options.failSave ?? false;
    let failSnapshot = false;
    let conflict = false;
    let changed = false;
    let deleted = false;
    let merged: string | null = null;
    let readGate: Promise<void> | null = null;
    let readPath = "";
    let releaseRead: (() => void) | undefined;
    let revisionGate: Promise<void> | null = null;
    let releaseRevision: (() => void) | undefined;
    const callbacks: Record<number, (event: unknown) => void> = {};
    const listeners: Record<string, number[]> = {};
    const escape = (text: string) =>
      text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    const sourceOffset = (offset: number) =>
      offset < 0 ? "" : ` data-source-offset="${offset}"`;
    const rendered = (text: string) =>
      `<h1${sourceOffset(text.search(/^# /mu))}>${escape(text.match(/^# (.+)/mu)?.[1] ?? "Garden notes")}</h1><p${sourceOffset(text.indexOf("Leave room for the unexpected."))}>Leave room for the unexpected.</p><h2>This week</h2><p>Choose a quiet corner for reading.</p><ul><li><input type="checkbox" disabled> Plant lavender</li><li><input type="checkbox" disabled checked> Water the herbs</li></ul><blockquote>Make a little space for what comes next.</blockquote><p><a href="Reading.md">Reading list</a> · <a href="https://example.org/gardens">Garden guide</a></p>`;
    const doc = (path: string, text = files[path] ?? "", htmlText = text) => ({
      path,
      version: { text, revision: `content-${serial}` },
      html: /\.(?:md|markdown)$/iu.test(path) ? rendered(htmlText) : "",
      issues: [],
    });
    Object.defineProperty(window, "__filesTest", {
      value: {
        calls,
        setFailure: (value: boolean) => {
          failSave = value;
        },
        setSnapshotFailure: (value: boolean) => {
          failSnapshot = value;
        },
        setConflict: (value: boolean) => {
          conflict = value;
        },
        setChanged: (value: boolean) => {
          changed = value;
        },
        setDeleted: (value: boolean) => {
          deleted = value;
        },
        setMerged: (text: string) => {
          merged = text;
        },
        holdRead: (path: string) => {
          readPath = path;
          readGate = new Promise((resolve) => {
            releaseRead = resolve;
          });
        },
        releaseRead: () => {
          releaseRead?.();
          readGate = null;
        },
        holdRevision: () => {
          revisionGate = new Promise((resolve) => {
            releaseRevision = resolve;
          });
        },
        releaseRevision: () => {
          releaseRevision?.();
          revisionGate = null;
        },
        external: (path: string, text: string) => {
          files[path] = text;
          serial++;
        },
        emit: (name: string, payload: unknown) => {
          for (const handler of listeners[name] ?? [])
            callbacks[handler]?.({ event: name, id: handler, payload });
        },
      },
    });
    const ipcCalls = Reflect.get(window, "__ipcCalls") as {
      command: string;
      args: Record<string, unknown>;
    }[];
    const host = Reflect.get(window, "__TAURI_INTERNALS__");
    const nativeInvoke = host.invoke.bind(host);
    Object.assign(host, {
      transformCallback: (callback: (event: unknown) => void) => {
        const id = Object.keys(callbacks).length + 1;
        callbacks[id] = callback;
        return id;
      },
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command.startsWith("ai_")) return nativeInvoke(command, args);
        ipcCalls.push({ command, args });
        if (command === "plugin_recovery_mode") return false;
        if (command === "plugin_runtime")
          return { plugins: [], revision: null };
        if (command === "plugin:event|listen") {
          (listeners[String(args.event)] ??= []).push(Number(args.handler));
          return Number(args.handler);
        }
        if (command === "plugin:event|unlisten") return;
        if (command === "dictation_snapshot")
          return {
            supported: true,
            model: "waiting",
            progress: 0,
            busy: false,
            owner: null,
          };
        if (command === "workspace_snapshot") return structuredClone(state);
        if (command === "layout_load")
          return window.__layoutTest.load(String(args.workspaceId));
        if (command === "layout_save")
          return window.__layoutTest.save(
            String(args.workspaceId),
            args.expectedRevision as string | null,
            args.data,
          );
        if (command === "localization_snapshot")
          return structuredClone(preferences);
        if (command === "localization_update") {
          if (!preferences.writable) throw "native.localization.readOnly";
          const expected = args.expected as typeof preferences | undefined;
          if (
            expected?.language !== preferences.language ||
            (["time", "date", "number"] as const).some(
              (key) => expected?.formats?.[key] !== preferences.formats[key],
            )
          )
            throw "native.localization.changed";
          preferences = {
            ...(args.preferences as typeof preferences),
            writable: preferences.writable,
          };
          return structuredClone(preferences);
        }
        if (command === "workspace_action") {
          if (args.action === "close") {
            state.current = null;
            state.open = [];
          }
          return true;
        }
        if (command !== "files_request") return nativeInvoke(command, args);
        const request = JSON.parse(
          JSON.stringify(args.request),
        ) as FilesRequest;
        calls.push(structuredClone(request));
        const path = request.path ?? "";
        const reply: FilesReply = { status: "ok" };
        switch (request.operation) {
          case "snapshot":
            if (failSnapshot)
              throw new Error("native.content.reference.invalid");
            return {
              status: "ok",
              snapshot: {
                writable: options.writable ?? true,
                canExport: !options.mobile,
                reason:
                  options.writable === false
                    ? "native.files.provider.readOnly"
                    : null,
                entries: [
                  ...[...folders].map((path) => ({
                    path,
                    isDirectory: true,
                  })),
                  ...Object.keys(files).map((path) => ({
                    path,
                    isDirectory: false,
                  })),
                  { path: "Map.pdf", isDirectory: false },
                ],
                drafts: Object.values(drafts),
                ...(request.includeDeleted
                  ? {
                      deleted: [
                        {
                          path: "Notes/Old garden.md",
                          revision: "retained-revision",
                          isDirectory: false,
                        },
                      ],
                    }
                  : {}),
              },
            };
          case "captureReference": {
            if (
              !(path in files) ||
              (request.expectedRevision !== undefined &&
                request.expectedRevision !== doc(path).version.revision)
            )
              throw new Error("references.unavailable");
            const anchorRevision = serial.toString(16).padStart(40, "0");
            capturedPaths.set(JSON.stringify([path, anchorRevision]), path);
            return {
              status: "ok",
              reference: {
                kind: "live",
                workspaceId: request.workspaceId,
                path,
                anchorRevision,
              },
            };
          }
          case "resolveReference": {
            const reference = request.reference;
            const resolved =
              reference.kind === "live"
                ? capturedPaths.get(
                    JSON.stringify([reference.path, reference.anchorRevision]),
                  )
                : undefined;
            if (!resolved || !(resolved in files))
              throw new Error("references.unavailable");
            return {
              status: "ok",
              reference,
              document: doc(resolved),
            };
          }
          case "read":
            if (path === readPath) await readGate;
            if (path === "Map.pdf") return { status: "binary" };
            return {
              status: "ok",
              document: doc(path, files[path], request.text ?? files[path]),
            };
          case "stage":
            drafts[path] = {
              path,
              text: request.text!,
              base: request.base ?? null,
            };
            return reply;
          case "save":
            if (failSave) throw new Error("The disk is full.");
            if (deleted) return { status: "deleted" };
            if (conflict) {
              reviewEditors[path] = request.text;
              return {
                status: "conflict",
                base: request.base,
                token: changed ? "new-review" : "review",
                editor: request.text,
                external: {
                  text: "# Changed garden\n\nKeep the existing trees.",
                  revision: "external",
                },
              } satisfies FilesReply;
            }
            if (
              request.text?.includes("changed-id") &&
              !request.confirmIdChange
            )
              return { status: "identityConfirmation" };
            files[path] = merged ?? request.text!;
            merged = null;
            delete drafts[path];
            serial++;
            return { status: "saved", document: doc(path) };
          case "resolve":
            if (changed) {
              changed = false;
              return { status: "changed" };
            }
            if (failSave) throw new Error("The disk is full.");
            if (
              request.choice === "editor" &&
              reviewEditors[path] === undefined
            )
              throw new Error("No retained conflict.");
            files[path] =
              request.choice === "editor"
                ? reviewEditors[path]!
                : "# Changed garden\n\nKeep the existing trees.";
            delete drafts[path];
            conflict = false;
            serial++;
            return { status: "saved", document: doc(path) };
          case "history":
            return {
              status: "ok",
              history: [
                {
                  revision: "deleted-revision",
                  message: "Remove note",
                  timestamp: 1791101000,
                  path,
                  deleted: true,
                },
                {
                  revision: "retained-revision",
                  message: options.historyMessage ?? "Add a reading corner",
                  timestamp: 1791100000,
                  path: request.exactPath ? "Archive/Old garden.md" : path,
                },
              ],
            };
          case "revision":
            if (revisionGate) await revisionGate;
            return {
              status: "ok",
              document: doc(path, "# Earlier garden\n\nA quiet corner."),
            };
          case "openExternal":
            return path.endsWith(".md")
              ? { status: "ok", document: doc(path) }
              : reply;
          case "discard":
            delete drafts[path];
            return reply;
          case "create":
            if (request.destination) {
              files[request.destination] = request.text ?? "";
              return {
                status: "savedHistoryFailed",
                document: doc(request.destination),
                message: "native.content.history.fileChanged",
              } satisfies FilesReply;
            }
            files[path] = request.text ?? "";
            return { status: "saved", document: doc(path) };
          case "mkdir":
            folders.add(path);
            return reply;
          case "rename": {
            const destination = request.destination!;
            for (const name of Object.keys(files)) {
              if (name === path || name.startsWith(`${path}/`)) {
                files[destination + name.slice(path.length)] = files[name]!;
                delete files[name];
              }
            }
            for (const [key, current] of capturedPaths) {
              if (current === path || current.startsWith(`${path}/`))
                capturedPaths.set(
                  key,
                  destination + current.slice(path.length),
                );
            }
            serial++;
            for (const folder of [...folders]) {
              if (folder === path || folder.startsWith(`${path}/`)) {
                folders.add(destination + folder.slice(path.length));
                folders.delete(folder);
              }
            }
            return reply;
          }
          case "copy":
            files[request.destination!] = files[path]!;
            return reply;
          case "delete":
            for (const [key, current] of capturedPaths) {
              if (current === path || current.startsWith(`${path}/`))
                capturedPaths.delete(key);
            }
            delete files[path];
            serial++;
            return reply;
          case "export":
            return { status: "cancelled" };
          case "detach":
          case "quitReady":
          case "cancelQuit":
            return reply;
          case "restore":
          case "historicalCopy":
          case "revert":
            return {
              status: "partialFailure",
              message: "native.content.destination.occupied",
              changedPaths: [],
              recoveryRevision: "retained-revision",
            };
          default:
            throw new Error(
              `Unsupported fixture operation: ${request.operation}`,
            );
        }
      },
    });
  }, options);
}
