export type AssignmentRevision = {
  revision: string;
  path: string;
} & (
  | { status: "available"; text: string }
  | { status: "loading" | "unavailable" | "unsupported" }
);

export interface AssignmentChange {
  id: string;
  operation: "added" | "modified" | "deleted" | "renamed";
  /** Null means absent in that revision, not unavailable history. */
  before: AssignmentRevision | null;
  after: AssignmentRevision | null;
  attribution: "recorded" | "uncertain";
}

export interface AssignmentChangesState {
  status: "ready" | "loading" | "error" | "unavailable";
  changes: readonly AssignmentChange[];
}

export interface ChangesNavigation {
  selected: string;
  query: string;
  pane: "list" | "file";
  page: number;
  listScroll: number;
  fileScroll: number;
  revealed: Record<number, number>;
  lineLimit: number;
}

export function createChangesNavigation(): ChangesNavigation {
  return {
    selected: "",
    query: "",
    pane: "list",
    page: 0,
    listScroll: 0,
    fileScroll: 0,
    revealed: {},
    lineLimit: 400,
  };
}

export function restoreChangesNavigation(value: unknown): ChangesNavigation {
  const defaults = createChangesNavigation();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return defaults;
  const source = value as Record<string, unknown>;
  for (const key of ["selected", "query"] as const)
    if (typeof source[key] === "string")
      defaults[key] = source[key].slice(0, 4096);
  if (source.pane === "file") defaults.pane = "file";
  for (const key of ["page", "listScroll", "fileScroll", "lineLimit"] as const)
    if (
      typeof source[key] === "number" &&
      Number.isSafeInteger(source[key]) &&
      source[key] >= 0
    )
      defaults[key] = source[key];
  if (!defaults.lineLimit) defaults.lineLimit = 400;
  if (
    source.revealed &&
    typeof source.revealed === "object" &&
    !Array.isArray(source.revealed)
  )
    for (const [key, count] of Object.entries(source.revealed))
      if (
        /^\d+$/.test(key) &&
        typeof count === "number" &&
        Number.isSafeInteger(count) &&
        count >= 0
      )
        defaults.revealed[Number(key)] = count;
  return defaults;
}

export function changePath(change: AssignmentChange): string {
  return (change.after ?? change.before)?.path ?? "";
}

export function inspectionChanges(
  changes: readonly AssignmentChange[],
  query: string,
): AssignmentChange[] {
  const term = query.trim().toLowerCase();
  return changes
    .filter((change) =>
      [change.before?.path, change.after?.path].some((path) =>
        path?.toLowerCase().includes(term),
      ),
    )
    .sort((a, b) =>
      changePath(a).localeCompare(changePath(b), "en", { numeric: true }),
    );
}
