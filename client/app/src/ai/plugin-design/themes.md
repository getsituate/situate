# Workspace themes

Return a `themes` array from the plugin's UI entry to offer a theme in **Settings → Appearance → Theme**. Situate displays the title with the plugin's name. Registration adds an option; the user selects it. Do not set CSS variables on the document or navigate to settings from the plugin.

```js
export default function createUi(host) {
  if (host.themeApi !== 1) return {};
  return {
    themes: [
      {
        id: "reading-paper",
        title: "Reading paper",
        preview: {
          color: "#285d84",
          icon: { path: "M5 4H19V20H5ZM8 8H16M8 12H16M8 16H13" },
        },
        variables: {
          "--situate-paper": "#edf4ff",
          "--situate-text-body": "18px",
          "--situate-space-3": "14px",
        },
      },
    ],
  };
}
```

Keep existing contributions when adding `themes` to a UI entry. The capability check allows the same entry to omit `themes` on older hosts. Use an ID of 1–64 ASCII letters, digits, periods, underscores or hyphens. Keep it stable across updates; a new installation doesn't inherit the previous installation's selection. A UI entry can offer up to 16 distinct themes, each with a nonblank title of up to 128 characters and at least one variable.

For a theme with a dark sidebar and chat background, set `brandAssets: "on-dark"` on the theme entry, alongside `variables`. Situate uses the light sidebar wordmark and adjusts Bend and Mini Bend in chat. Omit the field or use `"on-light"` for the standard artwork. This does not change theme colors, system appearance, or the app icon.

`preview` is optional and only affects the card in the theme chooser. Set `color` to a CSS color for the swatch and selection outline. Set `icon` to a shared icon name such as `folder`, or supply `{ path }` with SVG path data drawn in a 24 × 24 view box. Situate draws the path as an outline in the swatch color. Supply path data, not SVG markup or a URL. Without a preview, Situate uses a plug icon and derives the swatch color from the theme.

Use the names returned by the `themes` resource, with its prefix. Each override is a nonempty CSS value string. The catalog shows examples; use any CSS value that fits the property where the variable is used. Situate does not restrict value formats or ranges or block a theme based on contrast. Brand defaults are listed where fixed; the remaining color values depend on the selected built-in theme. Omitted variables keep their built-in values. Check text, links and keyboard focus against any surfaces you change. Themes apply to workspace views, including Settings and Plugins. The recovery interface and error dialogs retain their built-in appearance.

Use synthetic data for plugin checks. A plugin view preview does not select a workspace theme. After checked activation, tell the user the theme's title and where to select it.
