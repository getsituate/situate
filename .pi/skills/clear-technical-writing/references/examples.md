# Editing examples

These examples illustrate editing choices, not a vocabulary replacement list. Product-specific details may only be added when the source establishes them.

## Direct action without losing a condition

Before:

> The invalidation of cached entries occurs upon successful completion of the configuration update.

After:

> After the configuration update succeeds, cached entries are invalidated.

The condition survives. The passive voice remains because the source does not name the actor. If verified context identifies the server as the actor, write: "After the configuration update succeeds, the server invalidates cached entries."

## Explain a concept using established facts

Source facts:

- The client saves edits in a local queue.
- When a connection is available, it sends queued edits to the server.
- An edit stays in the queue until the server acknowledges it.

Dense draft:

> The client implements acknowledgment-dependent retention of outbound mutations within its local queue.

Clear explanation:

> The client keeps edits in a local queue. When a connection is available, it sends them to the server. An edit stays in the queue until the server acknowledges it.

Do not add "This prevents duplicate edits" or "Edits cannot be lost." Neither guarantee follows from these facts.

## Preserve a precise technical term

Before:

> Consumers must ensure the idempotency of retryable operations.

After:

> Consumers must make retryable operations idempotent: repeating the same operation must have the same effect as performing it once.

Do not replace this with "Retries must be safe." That is less precise. Define the term only if the target reader needs it.

## Keep normative strength and exceptions

Before:

> Clients should retry failed requests, except when the response status is 401.

After:

> Clients should retry failed requests unless the response status is 401.

Incorrect:

> Clients must retry failed requests.

The incorrect version turns a recommendation into a requirement and removes the exception.

## Make a procedure scannable

Before:

> After setting PORT to 8080, start the service with service start, at which point it prints Ready if startup succeeds.

After:

> 1. Set `PORT` to `8080`.
> 2. Run `service start`.
>
> If startup succeeds, the service prints `Ready`.

Do not invent a shell assignment, configuration file location, or health-check URL. The source does not specify them.

## Report an explanation gap instead of inventing a reason

Source:

> The projection is rebuilt when the workspace opens.

Acceptable revision when no further context is available:

> When the workspace opens, the projection is rebuilt.

Separate review finding:

> Define what the projection contains and identify what rebuilds it. The passage does not explain either point.

Do not add a database, background worker, performance rationale, or recovery guarantee without evidence.

## Leave a useful reference entry alone

> `timeout_ms`: Request timeout in milliseconds. Default: `5000`. Must be greater than `0`.

This entry is already concise and precise. Do not replace it with a conversational paragraph or drop the unit and constraint.
