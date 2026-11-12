# Architecture documentation

Read [Situate Architecture](index.adoc). The document follows the [arc42 chapter structure](https://arc42.org/overview), with `index.adoc` as the entry point. Each numbered chapter file includes topic files from a directory with the same basename, such as [`04-solution-strategy/`](04-solution-strategy/).

[ADR-0015](09-architecture-decisions/ADR-0015-client-encrypted-git-pack-transport.adoc) proposes client-encrypted incremental Git packs and records the rationale and alternatives. The [encrypted Git synchronization concept](08-cross-cutting-concepts/encrypted-git-synchronization.adoc) in chapter 8 covers candidate mechanisms, protection boundaries, conversation branching and unresolved integration, recovery and operating risks. Neither is an implemented service or finalized protocol.

## Render locally

With [Asciidoctor](https://docs.asciidoctor.org/asciidoctor/latest/install/) installed, run from the repository root:

```sh
asciidoctor --failure-level WARN -o docs/architecture/index.html docs/architecture/index.adoc
```

Open `docs/architecture/index.html` in a browser. The generated file is ignored by Git. Render at this location to preserve relative links to repository sources; linked Markdown files remain source documents, not generated HTML pages. No diagram extension is required.

## Update diagrams

Diagram sources (`.dot`) and rendered SVGs are kept together in `diagrams/`. With [Graphviz](https://graphviz.org/) installed, regenerate them locally from the repository root:

```sh
for source in docs/architecture/diagrams/*.dot; do
  dot -Tsvg "$source" -o "${source%.dot}.svg"
done
```

Sequence diagrams use PlantUML sources (`.puml`) beside their rendered SVGs. With [PlantUML](https://plantuml.com/) installed, regenerate them locally:

```sh
plantuml -tsvg -nometadata docs/architecture/diagrams/*.puml
```

Review the rendered diagrams for readable labels and unclipped edges before committing both source and SVG changes. The diagrams describe the target design, not implementation evidence; proposals are explicitly labeled.

## Maintain the document

- Keep chapter headings and introductions in the numbered chapter files. Edit topics in their matching directories and add `include::` entries to the chapter file in reading order. Render `index.adoc` to check the assembled document. Section numbering comes from the entry point; preserve explicit anchors when moving sections or changing headings.
- Topic files use `{architecture-repository-root}`, `{architecture-docs-root}` and `{architecture-diagrams-root}` for relative source links and images where needed. Chapter files set these paths for the assembled document; topic files supply fallbacks for rendering in their own directory.
- Solution Strategy topic files use `{strategy-requirements-root}` for catalog links and `{strategy-diagrams-root}` for diagram images. The chapter sets paths for the assembled document; topic files supply fallbacks for rendering individually in their own directory.
- Reference the [requirements catalog](../../requirements/README.md) rather than maintaining a second specification. Keep proposals, accepted decisions, and implementation evidence distinguishable.
- The CEO leads product goals and domain terminology. The CTO leads technical strategy, structural and runtime views, deployment, concepts, decisions, and risks. Constraints, context, and quality scenarios need both perspectives.
- Add individual AsciiDoc decision records to `09-architecture-decisions/` when decisions are made and include them from `09-architecture-decisions.adoc`. Do not add placeholder decisions to populate the index.
