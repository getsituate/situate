import type { DiffRow } from "../files/line-diff";

export type DiffPart =
  | { kind: "line"; index: number; row: DiffRow }
  | { kind: "gap"; index: number; count: number };
export function diffParts(
  rows: DiffRow[],
  revealed: Record<number, number> = {},
): DiffPart[] {
  const visible = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind !== "same")
      for (
        let n = Math.max(0, index - 3);
        n <= Math.min(rows.length - 1, index + 3);
        n++
      )
        visible.add(n);
  });
  const parts: DiffPart[] = [];
  let index = 0;
  while (index < rows.length) {
    if (visible.has(index)) {
      parts.push({ kind: "line", index, row: rows[index] });
      index++;
      continue;
    }
    const start = index;
    while (index < rows.length && !visible.has(index)) index++;
    const shown = Math.min(revealed[start] ?? 0, index - start);
    for (let n = start; n < start + shown; n++)
      parts.push({ kind: "line", index: n, row: rows[n] });
    if (start + shown < index)
      parts.push({ kind: "gap", index: start, count: index - start - shown });
  }
  return parts;
}
