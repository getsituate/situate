export interface DiffRow {
  kind: "same" | "added" | "removed";
  text: string;
  before: number | null;
  after: number | null;
  noNewline: boolean;
}
export interface FileDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  simplified: boolean;
}
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

export function fileDiff(before: string, after: string): FileDiff {
  const left = lines(before),
    right = lines(after);
  const edits: { kind: DiffRow["kind"]; token: string }[] = [];
  let prefix = 0,
    suffix = 0;
  while (
    prefix < left.length &&
    prefix < right.length &&
    left[prefix] === right[prefix]
  )
    prefix++;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  )
    suffix++;
  for (let i = 0; i < prefix; i++) edits.push({ kind: "same", token: left[i] });
  const a = left.slice(prefix, left.length - suffix),
    b = right.slice(prefix, right.length - suffix);
  const middle = compareTokens(a, b);
  const simplified = middle === null;
  if (middle) for (const edit of middle) edits.push(edit);
  else {
    for (const token of a) edits.push({ kind: "removed", token });
    for (const token of b) edits.push({ kind: "added", token });
  }
  for (let i = left.length - suffix; i < left.length; i++)
    edits.push({ kind: "same", token: left[i] });
  let oldLine = 0,
    newLine = 0,
    added = 0,
    removed = 0;
  const rows = edits.map(({ kind, token }): DiffRow => {
    if (kind === "added") added++;
    if (kind === "removed") removed++;
    return {
      kind,
      text: token.endsWith("\n") ? token.slice(0, -1) : token,
      before: kind === "added" ? null : ++oldLine,
      after: kind === "removed" ? null : ++newLine,
      noNewline: !token.endsWith("\n"),
    };
  });
  return { rows, added, removed, simplified };
}

function compareTokens(
  a: string[],
  b: string[],
): { kind: DiffRow["kind"]; token: string }[] | null {
  if (!a.length) return b.map((token) => ({ kind: "added", token }));
  if (!b.length) return a.map((token) => ({ kind: "removed", token }));
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  let work = 0;
  // Bound edit-distance search without hiding text when a replacement is too large.
  for (
    let distance = 0;
    distance <= Math.min(a.length + b.length, 512);
    distance++
  ) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      if (++work > 2000000) return null;
      let x =
        diagonal === -distance ||
        (diagonal !== distance &&
          (frontier.get(diagonal - 1) ?? -1) <
            (frontier.get(diagonal + 1) ?? -1))
          ? (frontier.get(diagonal + 1) ?? 0)
          : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        if (++work > 2000000) return null;
        x++;
        y++;
      }
      frontier.set(diagonal, x);
      if (x < a.length || y < b.length) continue;
      const result: { kind: DiffRow["kind"]; token: string }[] = [];
      for (let d = trace.length - 1; d >= 0; d--) {
        const previous = trace[d],
          k = x - y;
        const previousK =
          k === -d ||
          (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1))
            ? k + 1
            : k - 1;
        const previousX = previous.get(previousK) ?? 0,
          previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
          result.push({ kind: "same", token: a[--x] });
          y--;
        }
        if (d > 0) {
          if (x === previousX) result.push({ kind: "added", token: b[--y] });
          else result.push({ kind: "removed", token: a[--x] });
        }
      }
      return result.reverse();
    }
  }
  return null;
}

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
