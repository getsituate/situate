import type { EditorFile } from "../editor/model";
import copy from "../localization/en.import-result.json" with { type: "json" };
export const importPageSize = 10;
export const importCollectionThreshold = 50;
const numbers = new Intl.NumberFormat("en");
const order = new Intl.Collator("en", { numeric: true });
export const fileCount = (count: number) =>
  (count === 1 ? copy.oneFile : copy.fileCount).replace(
    "{count}",
    numbers.format(count),
  );
export const relativePath = (file: EditorFile) =>
  [file.folder, file.name].filter(Boolean).join("/");
export interface ImportEntry {
  kind: "file" | "folder";
  key: string;
  name: string;
  path: string;
  parent: string;
  count: number;
}
export function importIndex(files: EditorFile[]) {
  const live = files.filter((file) => !file.deleted);
  const folders = new Map<string, ImportEntry>();
  const children = new Map<string, ImportEntry[]>([["", []]]);
  for (const file of live) {
    const parts = file.folder.split("/").filter(Boolean);
    let parent = "";
    for (const part of parts) {
      const path = parent ? `${parent}/${part}` : part;
      if (!folders.has(path)) {
        const folder: ImportEntry = {
          kind: "folder",
          key: `folder:${path}`,
          name: part,
          path,
          parent,
          count: 0,
        };
        folders.set(path, folder);
        children.set(path, []);
        children.get(parent)!.push(folder);
      }
      folders.get(path)!.count++;
      parent = path;
    }
    children.get(parent)!.push({
      kind: "file",
      key: file.key,
      name: file.name,
      path: relativePath(file),
      parent,
      count: 1,
    });
  }
  for (const entries of children.values())
    entries.sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1) ||
        order.compare(a.name, b.name) ||
        order.compare(a.key, b.key),
    );
  const searchable = [...children.values()]
    .flat()
    .filter((entry) => entry.kind === "file")
    .sort(
      (a, b) => order.compare(a.name, b.name) || order.compare(a.path, b.path),
    );
  return { live, folders, children, searchable };
}
export function importPage<T>(items: T[], requested: number) {
  const last = Math.max(0, Math.ceil(items.length / importPageSize) - 1);
  const page = Number.isFinite(requested)
    ? Math.max(0, Math.min(last, Math.floor(requested)))
    : 0;
  const start = page * importPageSize;
  const entries = items.slice(start, start + importPageSize);
  return {
    entries,
    page,
    last,
    label: copy.range
      .replace("{start}", numbers.format(items.length ? start + 1 : 0))
      .replace("{end}", numbers.format(start + entries.length))
      .replace("{total}", numbers.format(items.length)),
  };
}
export type ImportRow =
  | { kind: "entry"; entry: ImportEntry; depth: number }
  | {
      kind: "page";
      folder: string;
      depth: number;
      page: number;
      last: number;
      label: string;
    };
export function importRows(
  index: ReturnType<typeof importIndex>,
  expanded: Set<string>,
  pages: Map<string, number>,
): ImportRow[] {
  const rows: ImportRow[] = [];
  function visit(folder: string, depth: number) {
    const page = importPage(
      index.children.get(folder) ?? [],
      pages.get(folder) ?? 0,
    );
    for (const entry of page.entries) {
      rows.push({ kind: "entry", entry, depth });
      if (entry.kind === "folder" && expanded.has(entry.path))
        visit(entry.path, depth + 1);
    }
    if (page.last)
      rows.push({
        kind: "page",
        folder,
        depth,
        page: page.page,
        last: page.last,
        label: page.label,
      });
  }
  visit("", 0);
  return rows;
}
export function searchImports(
  index: ReturnType<typeof importIndex>,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase("en");
  return index.searchable.filter((entry) =>
    entry.path.toLocaleLowerCase("en").includes(needle),
  );
}
