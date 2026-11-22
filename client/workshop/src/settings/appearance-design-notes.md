# Workspace appearance

Proposal in the design workshop. Select **Workspace appearance**, then choose **Default accent · Violet** (`settings-appearance`) or **Light accent · Lemon** (`settings-appearance-light`) as the starting state. Both IDs also remain direct URL entry points.

## Interaction

Settings → Appearance offers six color pairs. The larger part of each swatch shows the workspace accent; the smaller part shows its companion. Selecting a pair changes the current workspace immediately. The setting retains only the workspace accent: Violet is the default, paired with Peach.

Visible choices are preferable to a dropdown: all six colors can be compared without opening a menu, and switching takes one action. A separate theme gallery or custom color picker would add an unnecessary step and introduce choices outside the current palette. The labeled tiles retain a checkmark and border in addition to their color, with native radio keyboard behavior.

## Palette and boundaries

The [brand color roles](../../../../design/brand/docs/tokens-and-typography.md) supply violet, cobalt, sky, tangerine, peach and lemon. Neutral surfaces and Bend's character materials are not additional accent choices. Bright fills retain the brand values; lighter fills use plum labels. Darker related tones serve text and essential edges, while quiet tints serve selections. These derived UI tones are workshop proposals, not changes to the canonical palette.

Violet, Cobalt, and Sky pair with Peach. Tangerine, Peach, and Lemon pair with Sky. The workspace accent marks interface highlights and primary actions. The companion tints file previews, attachments, and the invitation to create a plugin. Neither color recolors the wordmark, Bend, plugin artwork, document imagery, or warnings. The workspace picker outside an active workspace uses the default appearance. Plugin-defined themes under REQ-0027 remain a separate capability; precedence between custom plugin styling and workspace accents is not decided here.

State is synthetic and in memory. Disk persistence, save failures, synchronization and cross-device behavior are not modeled. A fixed local palette has no loading or empty state. The workshop's existing English settings interface is retained; appearance strings live in its localization catalog.

## Review

Try choosing a light color, opening Files, and switching between Field notes and Reading room. On a phone-sized view, check whether the immediate change is understandable without a separate miniature preview. This is an expert design hypothesis, not user-research evidence.

Browser coverage exercises all colors, contrast pairs, keyboard selection, workspace isolation, preview reload, reset, and constrained widths with simulated iOS/Android safe areas. Simulated profiles do not establish native mobile behavior or screen-reader support.

Accessible names, native controls and focus guidance were informed by [UI Skills: Fixing Accessibility](https://www.ui-skills.com/skills/ibelick/fixing-accessibility). Inspo search returned marketing pages rather than relevant appearance controls; no external layout or assets were adopted.
