import { Marked } from "marked";

function stripClosedTags(text) {
  const parts = [];
  let start = 0;
  for (;;) {
    const open = text.indexOf("<", start);
    if (open === -1) break;
    const close = text.indexOf(">", open + 1);
    if (close === -1) break;
    parts.push(text.slice(start, open));
    start = close + 1;
  }
  parts.push(text.slice(start));
  return parts.join("");
}

function slugger() {
  const counts = new Map();
  return (text) => {
    const base =
      stripClosedTags(text.toLocaleLowerCase("en"))
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .replace(/\s+/g, "-") || "section";
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

export function inspectMarkdown(body) {
  const parser = new Marked();
  const links = [];
  const headings = [];
  const slug = slugger();
  parser.walkTokens(parser.lexer(body), (token) => {
    if (token.type === "link" || token.type === "image") links.push(token.href);
    if (token.type === "heading") headings.push(slug(token.text));
  });
  return { links, headings };
}

export function renderMarkdown(body) {
  const slug = slugger();
  const parser = new Marked({
    renderer: {
      heading({ tokens, depth, text }) {
        return `<h${depth} id="section-${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>`;
      },
    },
  });
  return parser.parse(body);
}

export function resolveDocumentLink(href, file) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
  const url = new URL(href, `https://catalog.invalid/${file}`);
  return {
    file: decodeURIComponent(url.pathname.slice(1)),
    section: decodeURIComponent(url.hash.slice(1)),
  };
}
