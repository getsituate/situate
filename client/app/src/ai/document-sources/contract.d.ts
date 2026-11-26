export interface DocumentReference {
  source: { pluginId: string; instanceId: string };
  id: string;
  identity: "stable" | "path";
  revision?: string;
}

export interface LibraryDescriptor {
  version: 2;
  source: DocumentReference["source"];
  label: string;
  scope: {
    id: string;
    included: string[];
    excluded: string[];
    constraints: string[];
  };
  searchCoverage: ("filename" | "text")[];
  limits: { maxItems: number };
}

export interface LibraryDocument {
  ref: DocumentReference;
  title: string;
  mimeType: string;
  excerpt?: string;
}

export interface LibraryContinuation {
  source: DocumentReference["source"];
  scopeId: string;
  operation: "list" | "search";
  query: string | null;
  token: string;
}

export type LibraryError =
  | "unsupported"
  | "permission"
  | "authentication"
  | "not-found"
  | "unavailable"
  | "cancelled"
  | "too-large";
export type LibraryFailure = { status: "error"; error: { code: LibraryError } };
export type LibraryPage =
  | LibraryFailure
  | {
      status: "ok" | "partial";
      items: LibraryDocument[];
      truncated: boolean;
      next?: LibraryContinuation;
      reason?: "limit" | "source-partial";
    };
export type LibraryOriginal =
  | LibraryFailure
  | {
      status: "ok";
      document: LibraryDocument;
      original: OriginalHandle;
    };

export interface LibraryDetailField {
  id: string;
  label: string;
  value: string;
}
export type LibraryDetails =
  | LibraryFailure
  | { status: "ok"; ref: DocumentReference; fields: LibraryDetailField[] };

export const LIBRARY_VERSION: 2;
export const LIBRARY_DETAILS_EXPORT: "documentLibraryDetails";
export interface OriginalHandle {
  id: string;
  size: number;
}
export const MAX_ORIGINAL_BYTES: number;
export const ORIGINAL_CHUNK_BYTES: number;
export const LIBRARY_EXPORTS: Readonly<{
  describe: "documentLibraryDescribe";
  list: "documentLibraryList";
  search: "documentLibrarySearch";
  readOriginal: "documentLibraryReadOriginal";
}>;
export function validateLibraryDescriptor(
  value: unknown,
  pluginId?: string,
  exports?: readonly string[],
): LibraryDescriptor;
export function validateLibraryReference(value: unknown): DocumentReference;
export function validateLibraryRequest(
  descriptor: LibraryDescriptor,
  operation: "list" | "search" | "readOriginal" | "details",
  args: unknown,
): unknown;
export function validateLibraryResult(
  descriptor: LibraryDescriptor,
  operation: "list" | "search",
  args: unknown,
  value: unknown,
): LibraryPage;
export function validateLibraryResult(
  descriptor: LibraryDescriptor,
  operation: "readOriginal",
  args: unknown,
  value: unknown,
): LibraryOriginal;
export function validateLibraryResult(
  descriptor: LibraryDescriptor,
  operation: "details",
  args: unknown,
  value: unknown,
): LibraryDetails;
