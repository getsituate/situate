# Tokens and typography

[Handbook](../README.md) · [Token source](../tokens.json) · [Generated CSS](../tokens.css)

## Color roles

Use the CSS variables below rather than copying hex values into each new screen. The hex values make the palette inspectable in design tools. Names describe roles or recognizable colors; they are not product states.

| CSS variable            | Value     | Role                                                                 |
| ----------------------- | --------- | -------------------------------------------------------------------- |
| `--situate-paper`       | `#f6f3ee` | Page ground; warm neutral outside content surfaces                   |
| `--situate-surface`     | `#fffefa` | Content cards, dialogs, light buttons; not pure white                |
| `--situate-ink`         | `#30203e` | Main text, primary button, bounded dark illustration stage           |
| `--situate-muted`       | `#6a5c70` | Secondary text on paper or surface, never unreadably faint metadata  |
| `--situate-violet`      | `#8651ed` | Main illustration violet and selected brand accents                  |
| `--situate-violet-deep` | `#6232bc` | Text emphasis, selected controls, checkbox accent                    |
| `--situate-sky`         | `#48b7ff` | Bright illustration field and objects                                |
| `--situate-cobalt`      | `#305cf4` | Focus outline, strong blue illustration depth                        |
| `--situate-tangerine`   | `#ff874d` | Warm accent, wordmark dot, books and folded forms                    |
| `--situate-peach`       | `#ffc3a3` | Warm paper fold, object highlight, softer accent                     |
| `--situate-lemon`       | `#f4f06d` | Sparse bright highlight, completion scene, selection ground          |
| `--situate-line`        | `#d9d0df` | Quiet separators on light surfaces; not a sufficient control outline |

### Supporting tokens

These roles support the main palette without replacing it:

| CSS variable               | Value     | Role                                                                |
| -------------------------- | --------- | ------------------------------------------------------------------- |
| `--situate-control-line`   | `#8c7a97` | Visible control edge on paper or surface; stronger than a separator |
| `--situate-lilac`          | `#eee7f9` | Quiet supporting panel or illustrated-card field                    |
| `--situate-note`           | `#fff7e3` | Cream illustration paper and simple note surface                    |
| `--situate-plum`           | `#30203e` | Named dark illustration field, same value as ink                    |
| `--situate-on-plum-muted`  | `#d9c6ff` | Secondary text on a plum field only                                 |
| `--situate-bend-front`     | `#a77bff` | Character front material                                            |
| `--situate-bend-depth`     | `#56329b` | Character offset depth                                              |
| `--situate-bend-highlight` | `#d9c6ff` | Character edge highlight                                            |
| `--situate-bend-seam`      | `#7045bd` | Character inner edge                                                |
| `--situate-ribbon-depth`   | `#da592f` | Tangerine ribbon's darker offset layer                              |
| `--situate-book-line`      | `#ad9284` | Abstract book/page marks, not small UI text                         |

Bend's lavender body is **not** the violet UI token. Its front `#a77bff`, depth `#56329b`, highlight `#d9c6ff`, and inner edge `#7045bd` belong to the character renderer. Recoloring it with a primary-button token changes its identity. Keep artwork shading with its source instead of promoting every shade into the UI palette.

### Color combinations

- **Daily work:** paper ground, surface panel, ink content, muted supporting text, violet-deep selection. Use tangerine or sky in one small emblem rather than filling every section.
- **Welcome:** ink stage, violet and cobalt ribbons, a sky highlight, tangerine paper objects, sparse lemon. Keep the headline outside the illustration.
- **Reading vignette:** sky ground, cobalt depth, violet curve, cream pages, one lemon folded leaf.
- **Small achievement:** lemon field, ink text, violet Bend, one tangerine accent. This is an occasional composition, not the default task-completion treatment.

Color is never the only indicator of selected, completed, unavailable, or failed state. Include text, a native control state, an underline, or an icon with a meaningful label. The palette does not assign green to success or tangerine to danger. Destructive actions need explicit labels and a product-specific interaction design; do not improvise a new semantic color system from an illustration.

### Contrast reference

Approximate WCAG relative-luminance contrast for opaque sRGB pairs, rounded to two decimals:

| Foreground / background |   Ratio | Use                                           |
| ----------------------- | ------: | --------------------------------------------- |
| Ink / paper             | 13.53:1 | Body and headings                             |
| Ink / surface           | 14.84:1 | Content and labels                            |
| Muted / paper           |  5.62:1 | Supporting text                               |
| Muted / surface         |  6.16:1 | Supporting text                               |
| Violet-deep / paper     |  7.02:1 | Text emphasis and links                       |
| Surface / violet-deep   |  7.70:1 | Filled control label                          |
| Surface / violet        |  4.71:1 | Text can pass at full opacity; do not fade it |
| Surface / cobalt        |  5.25:1 | Filled control label                          |
| Ink / sky               |  6.77:1 | Illustration captions                         |
| Ink / tangerine         |  6.30:1 | Warm button label                             |
| Ink / peach             |  9.69:1 | Warm panel label                              |
| Ink / lemon             | 12.51:1 | Bright panel label                            |
| Line / surface          |  1.48:1 | Decorative division only                      |

Normal text needs at least 4.5:1; large text needs at least 3:1. Essential control boundaries and meaningful graphics need at least 3:1 against adjacent colors. A divider can be quiet when spacing and headings already communicate the grouping. An input whose boundary is needed to identify it cannot rely on `line` alone: use a stronger ink or muted outline. Recheck contrast for opacity, overlays, hover states, and the actual adjacent ground. These pairs are not a blanket accessibility certification.

## Typography

The interface uses fonts already available on the person's system. Do not download, bundle, or convert a font to match a screenshot.

```css
/* Display headings */
font-family:
  "Avenir Next", ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif;

/* Body, labels, controls */
font-family: "Avenir Next", system-ui, sans-serif;
```

Avenir Next may be present on some Apple systems. `ui-rounded` and Arial Rounded availability differ by browser and OS. The final `system-ui` fallback is intentional. Weight 650 may map to a nearby installed weight rather than render as a continuous variable weight. Test line breaks, control widths, and vertical alignment on the fonts actually available; never hard-code text height to an Avenir screenshot.

### Type recipes

| Context                   | Size                       | Line height | Weight    | Letter spacing  |
| ------------------------- | -------------------------- | ----------- | --------- | --------------- |
| Hero                      | `clamp(54px, 6.3vw, 94px)` | 1.02        | 650       | `-.065em`       |
| Large section heading     | `clamp(38px, 4.1vw, 62px)` | 1.08        | 600       | `-.055em`       |
| Workspace context heading | 37 px                      | 1.08        | 600–700   | `-.05em`        |
| Illustrated card heading  | 33 px                      | 1.08        | 600–700   | `-.045em`       |
| Supporting panel heading  | 26 px                      | 1.08        | 600–700   | `-.045em`       |
| Dialog title              | 20 px (`1.25rem`)          | 1.3         | 650       | normal          |
| General body              | 16 px                      | 1.55        | 400       | normal          |
| Hero introduction         | 17 px                      | 1.65        | 400       | normal          |
| Work row / action         | 14 px                      | 1.55        | 400 / 600 | normal          |
| Note excerpt              | 13 px                      | 1.7         | 400       | normal          |
| Secondary caption         | 12–13 px                   | 1.55        | 400       | normal          |
| Short eyebrow             | 11 px                      | 1.55        | 700       | `.10em`–`.13em` |

The token defaults use `text-body: 1rem`, `text-small: .875rem`, `text-caption: .8125rem`, `text-title: 2rem`, and `text-lead: 1.25rem`. At a 16 px root, these are 16, 14, 13, 32, and 20 px. The 20 px lead is a general specimen scale; the denser welcome introduction above uses 17 px. Source-specific optical sizes such as a 37 px workspace title remain legitimate component recipes rather than another global scale. `font-mono` is for code and token values in technical documentation, never the default product voice.

The narrow breakpoint uses a hero of `clamp(45px, 10vw, 67px)`, section headings near 39 px, and workspace headings near 32 px. Do not shrink essential controls or body copy simply to keep a desktop column arrangement. Increase the compact recipes when content is long or the context demands sustained reading; use 16 px body text for prose-heavy views.

Uppercase is limited to short eyebrows and section labels. Keep names, actions, statuses, and sentences in sentence case. Tight negative tracking belongs to large display headings, not paragraphs or button labels. Limit a welcome headline to two or three short lines, with one emphasized phrase in violet-deep; do not alternate the color of individual words.

### Text width and growth

- Hero title: maximum 1000 px; introduction: about 500 px.
- Illustrated card paragraph: maximum 400 px.
- Work-side explanation: about 370 px.
- Longer explanatory prose: approximately 60–70 characters per line.
- Let labels and rows wrap. Do not ellipsize the only available action name or error explanation.
- Use relative sizing in an implementation where it supports zoom and user preferences; the pixel recipes describe visual scale at the default browser size.

## Spacing and shape

Choose the nearest established value before adding a new one:

| Purpose                              | Values                 |
| ------------------------------------ | ---------------------- |
| Tight relationships                  | 4, 6, 8 px             |
| Labels, icon gaps, compact grouping  | 10, 12, 14, 16 px      |
| Rows, card padding, repeated gutters | 18, 20, 21, 24 px      |
| Panel padding and section grouping   | 28, 30, 32, 36, 38 px  |
| Major margins                        | 42, 48, 64, 80, 100 px |
| Small object corners                 | 6–9 px                 |
| Note card                            | 15 px                  |
| Dialog                               | 24 px                  |
| Main panel / vignette                | 28 px; 22–23 px narrow |
| Hero stage                           | 32 px; 23 px narrow    |
| Buttons / compact tabs               | 99 px pill radius      |

The shared spacing tokens are `space-1: 4px`, `space-2: 8px`, `space-3: 12px`, `space-4: 16px`, `space-6: 24px`, `space-8: 32px`, `space-12: 48px`, `space-16: 64px`, `space-20: 80px`, and `space-25: 100px`. Two optical inset tokens preserve `space-note-inset: 21px` and `space-panel-inset: 38px`. Prefix each name with `--situate-` in CSS.

The reference also defines comfortable rows at 60 px minimum and compact rows at 48 px minimum. These are two reusable density examples, not a promise of a product density preference. Both keep `target-min: 44px`. Long content may make either row taller; minimum height is not a clipping height.

This is not a rule that every measurement must be a multiple of four. The visual proportions include optical adjustments such as 21 px note padding and 38 px work-panel padding. Preserve rhythm rather than forcing those values onto a new mathematical grid.

Use 1 px borders for divisions and surface edges. Reserve pronounced depth for illustrations. Daily cards are mostly flat; the occasional floating control can use a small hard shadow, not a stack of diffuse dashboard shadows.

## Wordmark is artwork, not a font

The Situate wordmark is an original path-based SVG with rounded strokes and a tangerine dot. Its geometry is fixed and does not change with installed fonts. Use the canonical artwork linked from [illustration](illustration.md); do not typeset “Situate” in Avenir and treat it as the logo. Plain text is an accessible or constrained fallback, not an exact visual substitute.

A dark ink artboard supports the illustration palette. It does not define an inverse application theme, theme switching, or an accessibility guarantee for every token on dark backgrounds.
