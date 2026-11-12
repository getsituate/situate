# Brand transfer exercise: a listening room

This exercise checks whether the brand handbook is sufficient to make a new Situate composition. It is not a product requirement, a usability test, or a production implementation brief.

## Starting material

Start at [the brand handbook](../README.md) and follow its references. Use the handbook, tokens, character kit, artwork, and visual reference in `design/brand/`. Do not use archived explorations, Git history, external design references, screenshots from earlier work, or undocumented visual instructions from another contributor. Existing product documentation remains authoritative for product meaning.

Work in a fresh context and a separate worktree. Do not change the handbook, tokens, character generator, or existing examples during the exercise. Record missing or conflicting guidance rather than silently fixing those sources.

## Make

Build an offline, responsive **Listening room** for one person's musical interests. Use fictional album names and synthetic notes.

The composition needs:

- A welcoming illustrated moment and a quieter area for practical use.
- An album collection, a listening note, and one reversible task interaction.
- A new component suited to this context, rather than a renamed version of an existing example.
- An original record or turntable motif and a new situation involving Bend and that object. Assemble the situation from the character kit; an existing pose can be used in a new relationship. Do not redraw the body from memory.
- A finite gesture that supports that situation, with a still alternative and a motion control.
- An understandable empty or incomplete-input state and a way to recover.

Keep product examples local and disclose their simulated scope outside the fictitious product messages. Do not add a music service, audio playback, external requests, account connections, AI functionality, or persistence claims.

Write files under `design/brand/examples/listening-room/`. Include a short implementation note naming the sources used, local controls, test commands, guidance gaps, and known limitations. Record new artwork's provenance in that implementation note. The reviewer registers accepted artwork in the central manifest after the attempt; do not cross the write boundary to update it yourself. Preserve original work and repository licensing boundaries. No new runtime dependencies or downloaded assets are needed.

## Review criteria

The reviewer inspects the first submitted version before supplying corrections.

| Area          | What to inspect                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Color roles, wordmark, type hierarchy, curve language, dimensional treatment, and separation of expressive and quiet areas match the handbook.                       |
| Character     | The crown face, open arch, depth, highlights, and arm attachment remain consistent. New hands or props do not hide the face or cut the body details at the shoulder. |
| New material  | There is a context-specific composition, component, motif, and character interaction—not only swapped labels.                                                        |
| Motion        | Gestures end, pause correctly, respect reduced motion, and are not prerequisites for completing user actions.                                                        |
| Interaction   | Local controls work, state changes are clear, reversal/recovery is available where promised, and no simulated action implies a real external result.                 |
| Accessibility | Labels, keyboard operation, focus visibility, contrast, readable small-screen layout, and nonanimated meaning are inspected.                                         |
| Reuse         | Existing token and character sources are used; exceptions and documentation gaps are named. No hidden dependency on historical designs is introduced.                |

Record concrete evidence and failures rather than assigning an unsupported overall quality score. Separate an expert's visual judgment from assertions checked by code or a browser. Report any revisions after the first submission. One successful exercise does not establish that every new contributor will reproduce the identity, nor that users recognize the character's emotions.
