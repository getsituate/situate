import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyAppliedOutcome } from "./rollout-reconcile.mjs";

const row = (address, action, after, after_unknown = {}) => ({
  address,
  mode: "managed",
  change: { actions: [action], after, after_unknown },
});
const staged = {
  id: "123",
  image: "42",
  labels: { source_revision: "fixture" },
};
const old = { id: "99", image: "41" };
const original = {
  resource_changes: [
    row("server.old", "delete", null),
    row(
      "server.next",
      "create",
      { image: staged.image, labels: staged.labels },
      { id: true },
    ),
    row("volume", "no-op", old),
  ],
};
const fresh = {
  format_version: "1.2",
  complete: true,
  applyable: false,
  errored: false,
  resource_changes: [
    row("server.next", "no-op", staged),
    row("volume", "no-op", old),
  ],
};

test("reconcile confirms a fully applied outcome with materialized provider values", () => {
  assert.doesNotThrow(() => verifyAppliedOutcome(original, fresh));
  for (const observed of [
    { ...fresh, resource_drift: [row("volume", "update", {})] },
    { ...fresh, applyable: true },
    {
      ...fresh,
      resource_changes: [
        ...fresh.resource_changes,
        row("server.old", "no-op", {}),
      ],
    },
    {
      ...fresh,
      resource_changes: [
        ...fresh.resource_changes,
        row("unrelated", "no-op", {}),
      ],
    },
    {
      ...fresh,
      resource_changes: [
        row("server.next", "no-op", { ...staged, image: "43" }),
        fresh.resource_changes[1],
      ],
    },
    { ...fresh, resource_changes: fresh.resource_changes.slice(0, 1) },
  ])
    assert.throws(
      () => verifyAppliedOutcome(original, observed),
      /Cannot reconcile/,
    );
});
