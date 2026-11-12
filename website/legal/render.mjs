import {
  escapeHtml,
  translator,
  renderHeader,
  renderFooter,
} from "../components.mjs";

function link(value) {
  if (!/^(https:\/\/|mailto:|tel:)/i.test(value))
    throw new Error("Unsupported link destination");
  return escapeHtml(value);
}

export function renderLegalPage(page, messages) {
  const text = translator(messages);
  const ids = new Set(["top", "main", "contents", "page-title"]);
  for (const section of page.sections) {
    if (!/^[a-z][a-z0-9-]*$/.test(section.id) || ids.has(section.id))
      throw new Error("Invalid or duplicate section ID");
    ids.add(section.id);
  }
  const block = (entry) => {
    switch (entry.type) {
      case "paragraph":
        return `<p>${text(entry.key)}</p>`;
      case "address":
        return `<address>${entry.keys.map(text).join("<br>")}</address>`;
      case "list":
        return `<ul>${entry.keys.map((key) => `<li>${text(key)}</li>`).join("")}</ul>`;
      case "link":
        return `<p><a href="${link(entry.href)}">${text(entry.key)}</a></p>`;
      default:
        throw new Error(`Unsupported block type: ${entry.type}`);
    }
  };
  const title = text("legal.pageTitle").replace("{title}", text(page.titleKey));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<link rel="icon" href="/design/brand/assets/app-icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/design/brand/tokens.css">
<link rel="stylesheet" href="/legal/styles.css">
<link rel="stylesheet" href="/components.css">
<script src="/navigation.js" defer></script>
</head>
<body id="top" class="legal-page">
<a class="skip" href="#main">${text("skip")}</a>
${renderHeader(messages, { pathname: page.path })}
<main id="main" class="shell" tabindex="-1">
<header class="document-heading"><h1 id="page-title">${text(page.titleKey)}</h1>${page.summaryKey ? `<p>${text(page.summaryKey)}</p>` : ""}</header>
<div class="document-layout">
<nav class="contents" aria-labelledby="contents"><h2 id="contents">${text("legal.contents")}</h2>
<ul>${page.sections.map((section) => `<li><a href="#${section.id}">${text(section.headingKey)}</a></li>`).join("")}</ul>
</nav>
<article aria-labelledby="page-title">
${page.sections.map((section) => `<section aria-labelledby="${section.id}"><h2 id="${section.id}" tabindex="-1">${text(section.headingKey)}</h2>${section.blocks.map(block).join("\n")}</section>`).join("\n")}
</article>
</div>
</main>
${renderFooter(messages, { pathname: page.path })}
</body>
</html>`;
}
