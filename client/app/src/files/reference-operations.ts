import type { ContentReference } from "./content-reference";

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
