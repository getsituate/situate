import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import fixtures from "../../../contracts/files.json";
import {
  filesRequest,
  validateFilesReply,
  type FilesOperation,
  type FilesReplyFor,
  type FilesRequest,
} from "./api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.mocked(invoke).mockReset());

it.each(fixtures.valid)(
  "accepts the shared $name wire contract",
  async ({ request, reply }) => {
    vi.mocked(invoke).mockResolvedValueOnce(
      JSON.parse(JSON.stringify(reply)) as unknown,
    );
    expect(await filesRequest(request as FilesRequest)).toEqual(reply);
    expect(invoke).toHaveBeenCalledWith("files_request", { request });
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
  },
);

it.each(fixtures.invalidReplies)(
  "rejects $name at the frontend boundary",
  async ({ operation, reply }) => {
    vi.mocked(invoke).mockResolvedValueOnce(reply);
    await expect(
      filesRequest({ workspaceId: "workspace", operation } as FilesRequest),
    ).rejects.toThrow("Invalid file response.");
    expect(() =>
      validateFilesReply(operation as FilesOperation, reply),
    ).toThrow("Invalid file response.");
  },
);

it.each([null, [], "private text", 1])(
  "rejects a non-object reply without including its content",
  (reply) => {
    expect(() => validateFilesReply("read", reply)).toThrow(
      /^Invalid file response\.$/u,
    );
  },
);

it("preserves native permission errors", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(
    new Error("This workspace editor is closed."),
  );
  await expect(
    filesRequest({ workspaceId: "workspace", operation: "snapshot" }),
  ).rejects.toThrow("This workspace editor is closed.");
});

function acceptsRequest(request: FilesRequest): FilesRequest {
  return request;
}
function requestTypeExamples(): void {
  const common = { workspaceId: "workspace", path: "Note.md" };
  const base = { text: "Original", revision: "r1" };
  acceptsRequest({ ...common, operation: "save", text: "Draft", base });
  acceptsRequest({
    ...common,
    operation: "resolve",
    token: "review",
    choice: "editor",
  });
  // @ts-expect-error Save requires editor text.
  acceptsRequest({ ...common, operation: "save", base });
  // @ts-expect-error Save requires a path.
  acceptsRequest({
    workspaceId: "workspace",
    operation: "save",
    text: "Draft",
    base,
  });
  // @ts-expect-error Resolve requires a review token.
  acceptsRequest({ ...common, operation: "resolve", choice: "external" });
  // @ts-expect-error Resolve requires a version choice.
  acceptsRequest({ ...common, operation: "resolve", token: "review" });
  // @ts-expect-error Historical restoration and draft restoration are distinct requests.
  acceptsRequest({
    ...common,
    operation: "restore",
    revision: "r1",
    base,
    text: "Draft",
  });
  // @ts-expect-error Link context cannot be combined with an exact file path.
  acceptsRequest({
    ...common,
    operation: "openExternal",
    href: "image.png",
    destination: "Note.md",
  });
  acceptsRequest({
    ...common,
    operation: "save",
    base,
    text: "Draft",
    // @ts-expect-error Conflict fields cannot be added through an intermediate save request.
    choice: "editor",
  });
}
void requestTypeExamples;

function acceptsReadReply(reply: FilesReplyFor<"read">): FilesReplyFor<"read"> {
  return reply;
}
function responseTypeExamples(): void {
  // @ts-expect-error A successful read requires a document.
  acceptsReadReply({ status: "ok" });
  acceptsReadReply({
    status: "ok",
    // @ts-expect-error A read cannot return a workspace snapshot.
    snapshot: { writable: false, reason: null, entries: [], drafts: [] },
  });
  acceptsReadReply({
    // @ts-expect-error A read cannot report a successful save.
    status: "saved",
    document: {
      path: "Note.md",
      version: { text: "", revision: "r1" },
      html: "",
      issues: [],
    },
  });
}
void responseTypeExamples;
