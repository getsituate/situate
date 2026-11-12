# Bounded context review

Use this worksheet for investigations that span many files or produce large search results. Keep the filled worksheet in the review response or an explicitly permitted private temporary file, not in tracked documentation.

## Establish scope

- State the question and allowed paths. Start with the supplied entry points and follow only directly relevant imports, callers, tests, and contracts.
- Inventory candidate files before reading their contents. Record why each file matters; a search hit is not evidence that the surrounding implementation was reviewed.
- Search for specific symbols within those paths. If results are truncated, narrow the query or divide the paths rather than assuming the visible hits are complete.

## Read in bounded windows

- Start with at most 150 lines per read and a combined batch budget of roughly 20 KiB. Reduce both for dense files or tools with smaller response limits. A per-file limit does not bound the combined output of parallel reads.
- Read large files in explicit, non-overlapping windows. Record the ranges actually received, not just requested. Include enough surrounding code to understand control flow and error handling.
- When any tool or aggregate output is truncated, mark the affected coverage as incomplete. Recover the omitted ranges with smaller reads before relying on them.
- Summarize stable findings with path and symbol references. Reuse those findings only while the source revision and relevant working-tree contents are unchanged.

## Coverage worksheet

```text
Question:
Allowed paths:
Revision and relevant working-tree changes:

File | Purpose | Received lines/symbols | Unread or truncated areas

Finding | Source location | Supporting test or observation | Uncertainty

Unresolved questions:
Checks executed and outcomes:
Checks not executed and reasons:
```

Conclude only about the inspected scope. Distinguish source inspection, test execution, and assumptions. Report remaining gaps explicitly; do not describe a module or document as fully reviewed when only search results or selected windows were read.
