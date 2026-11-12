import { beforeEach, expect, test, vi } from "vitest";
import { filesRequest } from "../files/api";
import {
  mergeReferences,
  captureReference,
  resolveReferences,
  validReference,
  referenceKey,
  type ContentReference,
} from "./content-references";
vi.mock("../files/api", () => ({ filesRequest: vi.fn() }));
const live: ContentReference = {
  kind: "live",
  workspaceId: "one",
  path: "notes/topic.md",
  anchorRevision: "a".repeat(40),
};
const historical: ContentReference = {
  workspaceId: "one",
  path: "notes/topic.md",
  kind: "historical",
  revision: "b".repeat(40),
};
beforeEach(() => vi.mocked(filesRequest).mockReset());
function document(text: string, revision = "current", path = live.path) {
  return {
    status: "ok" as const,
    reference: live,
    document: { path, version: { text, revision }, html: "", issues: [] },
  };
}
test("live reads use current source and historical reads pin exact paths and revisions", async () => {
  vi.mocked(filesRequest).mockResolvedValueOnce(document("Current source"));
  expect(await resolveReferences("one", [live], "Question")).toContain(
    "Current source",
  );
  expect(filesRequest).toHaveBeenLastCalledWith({
    operation: "resolveReference",
    workspaceId: "one",
    reference: live,
  });
  vi.mocked(filesRequest).mockResolvedValueOnce(
    document("Old source", historical.revision),
  );
  expect(await resolveReferences("one", [historical], "Question")).toContain(
    "Old source",
  );
  expect(filesRequest).toHaveBeenLastCalledWith({
    operation: "revision",
    workspaceId: "one",
    path: live.path,
    revision: historical.revision,
    exactPath: true,
  });
});
test("foreign, invalid and obsolete selectors fail before reading", async () => {
  await expect(resolveReferences("two", [live], "Question")).rejects.toThrow(
    "native.content.reference.invalid",
  );
  for (const value of [
    { ...live, path: "../secret" },
    { ...live, path: "/absolute" },
    { ...live, path: "a\\b" },
    { ...live, revision: "unexpected" },
    { ...live, anchorRevision: undefined },
    { ...live, anchorRevision: "HEAD" },
    { ...live, anchorRevision: "A".repeat(40) },
    { ...live, anchorRevision: "a".repeat(40) + "\n" },
    { ...live, fileId: "11111111-1111-4111-8111-111111111111" },
    {
      kind: "live",
      workspaceId: "one",
      path: live.path,
      fileId: "11111111-1111-4111-8111-111111111111",
    },
    { kind: "live", workspaceId: "one", path: live.path },
    { ...historical, revision: "HEAD" },
    { ...historical, revision: historical.revision + "\n" },
  ]) {
    expect(validReference(value)).toBe(false);
    await expect(
      resolveReferences("one", [value as ContentReference], ""),
    ).rejects.toThrow("native.content.reference.invalid");
  }
  expect(filesRequest).not.toHaveBeenCalled();
});
test("missing, substituted and oversized sources fail closed", async () => {
  vi.mocked(filesRequest).mockResolvedValueOnce({ status: "deleted" });
  await expect(resolveReferences("one", [live], "")).rejects.toThrow(
    "references.unavailable",
  );
  vi.mocked(filesRequest).mockResolvedValueOnce(document("Wrong revision"));
  await expect(resolveReferences("one", [historical], "")).rejects.toThrow(
    "references.unavailable",
  );
  vi.mocked(filesRequest).mockResolvedValueOnce(
    document("Wrong path", historical.revision, "other.md"),
  );
  await expect(resolveReferences("one", [historical], "")).rejects.toThrow(
    "references.unavailable",
  );
  vi.mocked(filesRequest).mockResolvedValueOnce(
    document("x".repeat(128 * 1024 + 1)),
  );
  await expect(resolveReferences("one", [live], "")).rejects.toThrow(
    "references.tooLarge",
  );
});
test("duplicate selections retain their original selector", () => {
  expect(mergeReferences([live, { ...live }])).toEqual([live]);
});
test("capture binds the explicitly selected saved version and rejects anchor-free replies", async () => {
  vi.mocked(filesRequest).mockResolvedValue({ status: "ok", reference: live });
  expect(await captureReference("one", live.path, "selected-revision")).toEqual(
    live,
  );
  expect(filesRequest).toHaveBeenCalledWith({
    operation: "captureReference",
    workspaceId: "one",
    path: live.path,
    expectedRevision: "selected-revision",
  });
  vi.mocked(filesRequest).mockResolvedValue({
    status: "ok",
    reference: {
      kind: "live",
      workspaceId: "one",
      path: live.path,
    } as ContentReference,
  });
  await expect(captureReference("one", live.path)).rejects.toThrow(
    "native.content.reference.invalid",
  );
});
test.each(["notes/topic.md", "notes/data.txt"])(
  "native resolution returns a managed move without replacing the original selector: %s",
  async (path) => {
    const reference = { ...live, path };
    vi.mocked(filesRequest).mockResolvedValue({
      ...document("Moved content", "current", "archive/moved"),
      reference,
    });
    expect(await resolveReferences("one", [reference], "Question")).toContain(
      '"path":"archive/moved"',
    );
    expect(reference.path).toBe(path);
  },
);
test("reference keys distinguish original paths, anchors, historical revisions and workspaces", () => {
  const distinct = [
    live,
    { ...live, anchorRevision: "b".repeat(40) },
    { ...live, path: "archive/topic.md" },
    { ...live, workspaceId: "two" },
    historical,
  ];
  expect(new Set(distinct.map(referenceKey)).size).toBe(5);
  expect(mergeReferences([...distinct, { ...live }])).toEqual(distinct);
});
test("a resolver cannot substitute a Git anchor or rewrite its original path", async () => {
  for (const reference of [
    { ...live, anchorRevision: "b".repeat(40) },
    { ...live, path: "archive/topic.md" },
  ]) {
    vi.mocked(filesRequest).mockResolvedValueOnce({
      ...document("Replacement"),
      reference,
    });
    await expect(resolveReferences("one", [live], "Question")).rejects.toThrow(
      "references.unavailable",
    );
  }
});
