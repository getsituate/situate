export function newMarkdownPath(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  if (!name || name === "." || name === ".." || name.lastIndexOf(".") > 0)
    return path;
  return `${path}.md`;
}
