import jsTokens from "js-tokens";

export interface SourceToken {
  text: string;
  kind?: "keyword" | "string" | "number" | "comment";
}

const keywords = new Set(
  "as async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield".split(
    " ",
  ),
);

function append(
  tokens: SourceToken[],
  text: string,
  kind?: SourceToken["kind"],
) {
  if (!text) return;
  const last = tokens.at(-1);
  if (last && last.kind === kind) last.text += text;
  else tokens.push({ text, ...(kind ? { kind } : {}) });
}
export function highlightSource(text: string, path: string): SourceToken[] {
  if (!/\.(?:[cm]?js|json)$/i.test(path)) return [{ text }];
  const result: SourceToken[] = [];
  let consumed = 0,
    count = 0;
  for (const token of jsTokens(text)) {
    // Bound token work and DOM nodes for huge minified sources; keep the remaining bytes as plain text.
    if (++count > 12000) {
      append(result, text.slice(consumed));
      break;
    }
    const kind: SourceToken["kind"] = token.type.endsWith("Comment")
      ? "comment"
      : token.type === "NumericLiteral"
        ? "number"
        : token.type.includes("Template") ||
            token.type === "StringLiteral" ||
            token.type === "RegularExpressionLiteral"
          ? "string"
          : token.type === "IdentifierName" && keywords.has(token.value)
            ? "keyword"
            : undefined;
    append(result, token.value, kind);
    consumed += token.value.length;
  }
  return result;
}

export function highlightLines(text: string, path: string): SourceToken[][] {
  const lines: SourceToken[][] = [[]];
  for (const token of highlightSource(text, path)) {
    for (const [index, part] of token.text.split("\n").entries()) {
      if (index) lines.push([]);
      append(lines.at(-1)!, part, token.kind);
    }
  }
  return lines;
}
