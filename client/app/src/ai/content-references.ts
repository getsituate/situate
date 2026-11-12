export type ContentReference =
  | {
      kind: "live";
      workspaceId: string;
      path: string;
      anchorRevision: string;
    }
  | { kind: "historical"; workspaceId: string; path: string; revision: string };

export function validReferencePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= 4096 &&
    !value.includes("\\") &&
    !/\p{Cc}/u.test(value) &&
    !value.split("/").some((part) => !part || part === "." || part === "..") &&
    !value.includes(":")
  );
}
export function validReference(value: unknown): value is ContentReference {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    (item.kind === "live" || item.kind === "historical") &&
    typeof item.workspaceId === "string" &&
    !!item.workspaceId &&
    new TextEncoder().encode(item.workspaceId).length <= 256 &&
    !/\p{Cc}/u.test(item.workspaceId) &&
    validReferencePath(item.path) &&
    Object.keys(item).every((key) =>
      [
        "kind",
        "workspaceId",
        "path",
        ...(item.kind === "historical" ? ["revision"] : ["anchorRevision"]),
      ].includes(key),
    ) &&
    (item.kind === "live"
      ? typeof item.anchorRevision === "string" &&
        item.anchorRevision.length === 40 &&
        /^[a-f0-9]{40}$/.test(item.anchorRevision)
      : typeof item.revision === "string" &&
        item.revision.length === 40 &&
        /^[a-f0-9]{40}$/.test(item.revision))
  );
}
export function referenceKey(reference: ContentReference): string {
  return JSON.stringify([
    reference.kind,
    reference.workspaceId,
    reference.path,
    reference.kind === "historical"
      ? reference.revision
      : reference.anchorRevision,
  ]);
}
export function mergeReferences(
  references: ContentReference[],
): ContentReference[] {
  return [
    ...new Map(
      references.map((reference) => [referenceKey(reference), reference]),
    ).values(),
  ];
}
export async function captureReference(
  scope: string,
  path: string,
  expectedRevision?: string,
): Promise<ContentReference> {
  return (await import("./reference-runtime")).captureReference(
    scope,
    path,
    expectedRevision,
  );
}
export async function resolveReference(
  scope: string,
  reference: ContentReference,
  render = false,
) {
  return (await import("./reference-runtime")).resolveReference(
    scope,
    reference,
    render,
  );
}
export async function resolveReferences(
  scope: string,
  references: ContentReference[],
  text: string,
): Promise<string> {
  if (!references.length) return text;
  return (await import("./reference-runtime")).resolveReferences(
    scope,
    references,
    text,
  );
}
