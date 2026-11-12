# Accessibility contracts

Use semantic HTML and named controls. Shared components provide their documented interactions; custom components must retain keyboard operation, visible focus and accessible state feedback. Selection, errors and progress must be understandable without color or motion alone.

Bind Field.controlAttrs to exactly one control. Help and validation belong outside placeholders. Name icon-only actions and keep interactive elements unnested. Dialogs need an accessible title, appropriate initial focus and focus restoration.

Keep content and controls reachable with text growth, narrow panes and reduced motion. Normal text needs at least 4.5:1 contrast; large text and essential control boundaries need at least 3:1.

Test accessibility where tooling permits. Programmatic preview clicks do not prove keyboard access, and screenshot review does not establish assistive-technology support.
