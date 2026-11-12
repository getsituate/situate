# Legal-page layout

Legal notice and Privacy notice use the website's shared menu and footer. Legal wording remains in `website/legal/messages.en.json`; `website/legal/pages.json` supplies document structure. See the [legal review](../../website/legal/review.md) for scope and publication blockers.

## Preview and maintenance

Run the ordinary website preview:

```sh
node website/site.mjs
```

Open `http://127.0.0.1:4173/` and follow the footer links. Both pages also have direct routes, `/legal-notice.html` and `/privacy.html`.

The alternate launcher remains available on port 4178:

```sh
node design/website-legal/preview.mjs
```

It uses the same renderer and components, not a separate implementation. An optional positional argument selects a directory containing `pages.json` and `messages.en.json` for legal-copy review. `PORT` overrides the default port; both launchers bind only to localhost.

| Change                                    | Source                                                       |
| ----------------------------------------- | ------------------------------------------------------------ |
| Menu and footer structure or destinations | `website/components.mjs`                                     |
| Menu and footer appearance                | `website/components.css`                                     |
| Shared navigation labels                  | `website/messages.en.json`                                   |
| Legal wording and section order           | `website/legal/messages.en.json`, `website/legal/pages.json` |
| Legal document layout                     | `website/legal/render.mjs`, `website/legal/styles.css`       |

## Reading layout

Warm paper, plum text, the canonical wordmark and system typography carry the website identity. Legal pages contain no animated illustration, large marketing hero or motion controls. The reading column is limited to 65ch, with 17px body text and a 1.7 line height.

A contents rail sits beside the document on wide screens. At 960px and below, it becomes an expanded list above the complete text; below 512px, the list uses one column. This makes mobile pages longer but keeps navigation available without scripts and leaves the full document accessible to browser Find and printing. Collapsed sections would conceal text without improving the reading task.

Section anchors leave space below the shared sticky header. The contents rail scrolls with the document on short screens rather than introducing a nested scroll region. The common menu remains visible in a second header row on small screens. Footer links wrap, and the current legal page is identified with `aria-current="page"` and heavier underlined text.

The first keyboard target skips to the main content. Section links focus their headings. Native links, lists, addresses and landmarks retain browser behavior; no custom scrollspy or navigation state is required.

Print styling removes navigation, uses black text on white paper, exposes external link destinations, and keeps headings with following text where possible. Long sections can continue across pages.

## Checks

```sh
node website/legal/browser.test.mjs
```

The compatibility command `node design/website-legal/check.mjs` runs the same checks. Both accept the optional legal-catalog directory. `WEBSITE_PLAYWRIGHT_MODULE` or `PLAYWRIGHT_MODULE` can point to an existing Playwright installation; `WEBSITE_BROWSER_CHANNEL` selects an installed browser channel, defaulting to Chrome.

Checks cover exact catalog rendering, escaping, link safety, 1440/960/390/320px reflow, keyboard skip and section focus, contents links, shared navigation, no-JavaScript behavior, print output and absence of external requests during the tested flows. Screenshots and PDFs go to a temporary directory printed by the command.

These checks do not establish native-device, screen-reader, Safari/Firefox or PDF accessibility. The layout is a design choice, not evidence from a user study.

## Sources

- [Brand handbook](../brand/README.md), [typography](../brand/docs/tokens-and-typography.md), [layout guidance](../brand/docs/layout-and-components.md) and [provenance](../brand/docs/provenance.md).
- [Semantic HTML First](https://www.ui-skills.com/skills/kemiljk/semantic-html-first/llms.txt): native links and browser behavior rather than custom navigation controls. No external code is included.
