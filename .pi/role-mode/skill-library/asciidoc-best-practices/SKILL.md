---
name: asciidoc-best-practices
description: Write and validate AsciiDoc architecture documents, including headings, includes, tables, source blocks, and cross-references.
---

# AsciiDoc

Inspect nearby documents and the actual rendering pipeline before choosing syntax or extensions. Use `.adoc` for architecture documents and preserve existing file and anchor conventions.

- Use `= Title` for a document title and consecutive `==`, `===` section levels. Avoid hard-coded chapter numbers when the build already numbers sections.
- Separate paragraphs, lists, and block declarations with blank lines. Use list continuation (`+`) when a block belongs to a list item.
- Use `[source,language]` with `----` delimiters for source listings. Use `|===` tables with explicit header options where needed.
- Give referenced sections stable `[[anchor-id]]` identifiers. Use `xref:` for document or section links and verify resolution in the intended renderer.
- Resolve `include::` paths relative to the including document. Keep includes within the intended public document set; never include private notes, secrets, or generated logs.
- Use attributes for values that genuinely repeat. Do not assume a diagram processor or remote include is available.

Render with the repository's configured toolchain when present, then inspect warnings, links, tables, and diagrams. Do not install new rendering dependencies or claim a successful render when only source checks ran. Report a missing renderer as a verification limit.
