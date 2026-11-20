# Copy import

Establish what to copy, where it should go, and how to interpret source fields and tasks. Ask only about gaps that affect the transfer. Use the agreed source convention to distinguish tasks from ordinary checklists. Leave originals unchanged and publish copies through versioned storage.

## Prepare and publish

- Convert notes and agreed tasks to Situate Markdown. Preserve titles, body text, links, attachment metadata, and source fields, including unknown and nested metadata. Preserve task meanings and source statuses, including cancellation markers such as `[-]`. Retain and report malformed metadata and unsupported statuses rather than substituting new values.
- Run conversion code without saving helper scripts. Keep mappings in memory; do not create staging directories, manifests, duplicate source files, or audit files.
- Use `write` for a new converted text file and `create_batch` for multiple files or attachments. Use `sourcePath` for unchanged bytes, including PDFs, images, and other attachments. Do not encode binaries as text or copy them into user-content destinations through shell. Preserve attachment names and relative paths where possible; update links when destinations change. Prepare destination folders and split inputs to fit the tool and transport limits.
- Use checkbox lines with same-line YAML metadata comments for converted tasks, for example `- [ ] Task title <!-- situate-task-id: null -->`. Use null instead of retaining source task IDs. Use acknowledged saved text or read published files to obtain assigned IDs, then retarget links between imported tasks through revision-checked edits. Do not invent IDs or treat planned mappings as published targets.

## Reconcile and report

Count only acknowledged destinations as published. Keep successful copies. Inspect existing files before retrying missing destinations, and never replay a completed or uncertain write or batch. Report missing or blocked files and attachments, unresolved links, and uncertain outcomes in chat. Save a separate report only if requested.
