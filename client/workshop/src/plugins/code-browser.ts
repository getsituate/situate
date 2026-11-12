export interface CodeFile {
  path: string;
  kind: "markdown" | "text" | "image" | "binary";
  text?: string;
}
export interface CodeBrowserState {
  selected: string;
  expanded: string[];
  query: string;
  mode: "preview" | "source";
  pane: "tree" | "file";
  status: "ready" | "loading" | "error" | "empty";
}
export const createCodeBrowser = (): CodeBrowserState => ({
  selected: "AGENTS.md",
  expanded: [],
  query: "",
  mode: "preview",
  pane: "file",
  status: "ready",
});
export interface CodeRow {
  path: string;
  name: string;
  depth: number;
  folder: boolean;
  expanded?: boolean;
}
export function codeRows(
  files: CodeFile[],
  state: CodeBrowserState,
  directories: string[] = [],
): CodeRow[] {
  const query = state.query.trim().toLowerCase();
  const matches = files.filter((file) =>
    file.path.toLowerCase().includes(query),
  );
  const folders = new Set<string>();
  const paths = [
    ...matches.map((file) => file.path),
    ...directories
      .filter((path) => path.toLowerCase().includes(query))
      .map((path) => path + "/"),
  ];
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      folders.add(parts.slice(0, i).join("/"));
  }
  const rows: CodeRow[] = [];
  const parent = (path: string) => path.split("/").slice(0, -1).join("/");
  function visit(path: string, depth: number) {
    for (const folder of [...folders]
      .filter((f) => parent(f) === path)
      .sort()) {
      const expanded = !!query || state.expanded.includes(folder);
      rows.push({
        path: folder,
        name: folder.split("/").at(-1)!,
        depth,
        folder: true,
        expanded,
      });
      if (expanded) visit(folder, depth + 1);
    }
    for (const file of matches
      .filter((f) => parent(f.path) === path)
      .sort((a, b) => a.path.localeCompare(b.path)))
      rows.push({
        path: file.path,
        name: file.path.split("/").at(-1)!,
        depth,
        folder: false,
      });
  }
  visit("", 0);
  return rows;
}
