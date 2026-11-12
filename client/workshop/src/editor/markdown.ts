export interface MarkdownBlock {
  tag: string;
  text: string;
  offset: number;
  children?: MarkdownBlock[];
  checked?: boolean;
}
export function markdownBlocks(content: string): MarkdownBlock[] {
  const headerLength =
    /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content)?.[0].length || 0;
  const body = content
    .slice(headerLength)
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, " "));
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [],
    paragraphOffset = 0,
    code: string[] | null = null,
    codeOffset = 0,
    offset = headerLength;
  let list: MarkdownBlock | null = null;
  const flush = () => {
    if (paragraph.length) {
      blocks.push({
        tag: "p",
        text: paragraph.join(" "),
        offset: paragraphOffset,
      });
      paragraph = [];
    }
  };
  for (const line of body.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    if (line.startsWith("```")) {
      flush();
      list = null;
      if (code) {
        blocks.push({ tag: "pre", text: code.join("\n"), offset: codeOffset });
        code = null;
      } else {
        code = [];
        codeOffset = offset;
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      list = null;
      continue;
    }
    const heading = /^(#{1,6}) (.+)$/.exec(line),
      item = /^(?:([-*]) |(\d+)\. )(.+)$/.exec(line);
    if (heading) {
      flush();
      list = null;
      blocks.push({
        tag: "h" + heading[1].length,
        text: heading[2],
        offset: start + heading[1].length + 1,
      });
    } else if (item) {
      flush();
      const tag = item[2] ? "ol" : "ul";
      if (!list || list.tag !== tag) {
        list = { tag, text: "", offset: start, children: [] };
        blocks.push(list);
      }
      const checkbox = /^\[([ xX])\] (.*)$/.exec(item[3]);
      list.children!.push({
        tag: "li",
        text: checkbox ? checkbox[2] : item[3],
        offset: start + line.indexOf(item[3]),
        ...(checkbox ? { checked: checkbox[1] !== " " } : {}),
      });
    } else if (line.startsWith("> ")) {
      flush();
      list = null;
      blocks.push({
        tag: "blockquote",
        text: line.slice(2),
        offset: start + 2,
      });
    } else if (/^---+$/.test(line)) {
      flush();
      list = null;
      blocks.push({ tag: "hr", text: "", offset: start });
    } else {
      list = null;
      if (!paragraph.length) paragraphOffset = start;
      paragraph.push(line);
    }
  }
  flush();
  if (code)
    blocks.push({ tag: "pre", text: code.join("\n"), offset: codeOffset });
  return blocks.length
    ? blocks
    : [
        {
          tag: "p",
          text: "This file is empty. Click here to start writing.",
          offset: content.length,
        },
      ];
}
export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}
export function diffLines(older: string, current: string): DiffLine[] {
  const left = older.split("\n"),
    right = current.split("\n"),
    rows: DiffLine[] = [];
  // Bound comparison work for large pasted documents without dropping their text.
  if (left.length * right.length > 250000)
    return [
      ...left.map((text) => ({ kind: "removed" as const, text })),
      ...right.map((text) => ({ kind: "added" as const, text })),
    ];
  const matrix = Array.from(
    { length: left.length + 1 },
    () => new Uint32Array(right.length + 1),
  );
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      matrix[i][j] =
        left[i] === right[j]
          ? 1 + matrix[i + 1][j + 1]
          : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
  let i = 0,
    j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      rows.push({ kind: "same", text: left[i++] });
      j++;
    } else if (
      j < right.length &&
      (i === left.length || matrix[i][j + 1] >= matrix[i + 1][j])
    )
      rows.push({ kind: "added", text: right[j++] });
    else rows.push({ kind: "removed", text: left[i++] });
  }
  return rows;
}
