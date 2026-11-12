---
name: clean-code-principles
description: Keep non-trivial implementation and scoped refactoring direct, cohesive, and free of speculative abstractions, unrelated cleanup, or undefined fallback behavior.
---

# Clean code principles

## Keep the change local

Start from the requested behavior and the existing boundary that owns it. Use nearby conventions unless they cause the problem being fixed. Rename misleading names in the affected code, not whole modules for stylistic consistency.

Check existing helpers, platform capabilities, and installed dependencies before adding another abstraction or package. A new dependency needs a current benefit, acceptable maintenance cost, and suitable redistribution terms.

## Extract concepts, not line counts

Extract a helper when it isolates a meaningful decision or invariant, reduces difficult control flow, or keeps behavior that must change together consistent. Function length alone is not a reason to split it.

Similar-looking code can represent different concepts. Keep small duplication when sharing would couple unrelated behavior; share an invariant when separate implementations risk inconsistent results. Prefer a concrete helper to a configurable framework.

Introduce interfaces, strategies, extension points, and configuration only for a present requirement or an established architectural boundary. A possible second implementation is not enough. Preserve useful existing boundaries rather than bypassing them to reduce the diff.

## Make failure semantics explicit

Keep expected domain outcomes distinct from unexpected failures, following the repository's conventions. Propagate or translate errors at the boundary that can handle them; empty collections, default values, and success responses must not conceal failed work.

Add retries, fallback paths, compatibility behavior, and defensive branches only for an identified failure mode with defined semantics. Consider partial writes, duplicate effects, cancellation, and cleanup where the changed operation can encounter them. Validate untrusted input at its trust boundary; simplicity is not a reason to remove that protection.

Use existing logging conventions and an appropriate owning boundary rather than logging and rethrowing at every layer. Keep secrets and private content out of diagnostics.

## Review the diff

Before finishing, check each changed hunk against the task. Remove abandoned helpers, unused options, exploratory edits, and unrelated cleanup. Any new abstraction should have a current use that justifies its indirection.

For comments and API contracts, use `code-documentation-guidelines`. Prefer the smaller equally correct solution, without trading away data integrity, security, accessibility, or supported contracts.
