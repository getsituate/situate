# Compact composer controls

Proposal for the Conversation composer's model and thinking controls. Review in
**Conversation → Complete**, then use **Model choice example**, **Composer control
language**, and **Response state** in the separate controls window.

## Options

| Approach                                          | Selection path                                            | Benefit                                                                     | Cost / assumption                                                                                 |
| ------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Resolved values, separate menus — recommended** | Open the model or thinking value; choose directly         | Shows what the next message will use and keeps both choices one action away | Long model names need ellipsis; source marks need learning                                        |
| One combined “Model · Medium” menu                | Open the combined trigger; choose a setting, then a value | One disclosure affordance and a single place to inspect settings            | More navigation and a wider combined menu; model and thinking are less independently discoverable |
| Short “Default” triggers                          | Open each Default trigger to inspect or change it         | Smallest text when both choices are inherited                               | Repeats an ambiguous label and hides actual values until opened                                   |

The recommended option favors identifying the actual configuration over showing
policy names twice. It retains the existing independent menus, keyboard behavior,
and 44 px control height. The alternatives are interaction sketches, not additional
implemented views or usability findings.

## Compact and expanded views

- Model: resolved display name, with visual ellipsis only when needed. Full names,
  access, source and next-message scope remain available in the accessible label
  and description, pointer tooltip, and expanded model options.
- Thinking: resolved level, not the repeated text “Workspace default” or
  “Recommended”. Models without declared adjustable thinking omit this control;
  stored per-model choices remain untouched.
- **↳** means inherited workspace default, **☆** means explicit Recommended,
  and no mark means an explicit conversation value. Expanded options pair each
  mark with its full textual label. Marks are hidden from assistive technology;
  accessible names contain the source in words.
- Workspace default remains a distinct checked option even when its value is
  Recommended. Expanded default rows show the actual resolved model or level;
  a recommendation can be identified in their secondary line.
- Explicit Recommended must remain symbolic, not turn into a saved concrete
  model or level. The thinking menu demonstrates this distinction even when
  the inherited default resolves to the same level.
- The model menu has no redundant summary above its options.

The existing workshop model adapter supports inheritance and explicit model IDs,
but not an explicit symbolic Recommended model override. This proposal does not
extend that adapter or fake that choice by saving a resolved ID. Production's
explicit Recommended model choice should use ☆, retain its existing semantics,
and show its resolved model in the expanded option. The model-menu design owns
the production expanded rows, including the actual model inside Workspace default.

## Layout

Mini Bend and its replaceable phrase occupy the left side immediately below the
input. Controls occupy the right edge, with a 260 px maximum and at most 45% of a
wide working row. Phrase text can wrap instead of being forced into one ellipsized
line. At a pane width of 480 px or less, activity has its own left-aligned row and
controls remain right-aligned on the following row. Idle removes the activity
row but does not move controls to the left.

The breakpoint follows pane width, including split-pane desktop use, not a mobile
device label. Long names and translations shrink within the controls group, not
the activity area. Full option names wrap in the existing bounded popup. The
composer's left-side plus attachment action is unchanged.

## Scope and evidence

Selection continues to configure the next message in this conversation on this
device. It does not change workspace defaults, another conversation, the comment
model, or an active request. Loading, saving, uncertain persistence, unavailable
models and unsupported thinking retain their existing guards and recovery.
No new dialogs or activity generation, typing, timing or motion behavior are
introduced.

REQ-0015 defines identifiable device-local access and model selection;
REQ-0039 defines the working indication and replaceable phrase. These layouts
do not revise those requirements.

The main unresolved usability assumption is recognition of source marks and
the unlabeled thinking value. A useful next evaluation: ask a person to identify
the next model and level, explain whether each follows a default, explicitly
choose Recommended, then return to inheritance. Compare errors and menu openings
with the combined-menu sketch. If source recognition fails, prefer a short
textual source indicator over an unexplained icon-only control.

Browser rendering and synthetic iOS geometry do not qualify native keyboard
delivery, safe areas, VoiceOver, Dynamic Type or touch behavior on a device.
The language control translates the compact controls and their option labels,
not the entire workshop or existing model-recovery messages.

Simplification guidance: [UI Skills — Distill](https://www.ui-skills.com/skills/pbakaus/distill).
An Inspo search for compact chat selectors returned a ChatGPT landing/login
capture, not useful application-control evidence; it did not determine this design.
No external code or assets are included.
