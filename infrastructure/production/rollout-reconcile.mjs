import { isDeepStrictEqual } from "node:util";

function require(condition, detail) {
  if (!condition) throw new Error(`Cannot reconcile: ${detail}.`);
}

// Terraform's after_unknown is a tree: a true leaf may materialize to any
// value; absent/false leaves must still match the saved plan exactly.
function matches(actual, planned, unknown) {
  if (unknown === true) return true;
  if (!unknown || typeof unknown !== "object")
    return isDeepStrictEqual(actual, planned);
  if (Array.isArray(unknown) || Array.isArray(planned)) {
    return (
      Array.isArray(actual) &&
      Array.isArray(planned) &&
      actual.length === planned.length &&
      Object.keys(unknown).every((key) => Number(key) < planned.length) &&
      actual.every((value, index) =>
        matches(value, planned[index], unknown[index]),
      )
    );
  }
  if (!actual || typeof actual !== "object" || Array.isArray(actual))
    return false;
  const wanted = Object.keys({ ...planned, ...unknown });
  return (
    Object.keys(actual).every((key) => wanted.includes(key)) &&
    wanted.every((key) => matches(actual[key], planned?.[key], unknown[key]))
  );
}

export function verifyAppliedOutcome(original, observed) {
  require(observed?.format_version === "1.2" &&
    observed.complete === true &&
    observed.applyable === false &&
    observed.errored === false &&
    !observed.resource_drift?.length &&
    !observed.deferred_changes?.length &&
    Array.isArray(
      observed.resource_changes,
    ), "the fresh plan must observe no changes or drift");
  const changes = new Map();
  for (const row of observed.resource_changes) {
    require(row.mode === "managed" &&
      !row.previous_address &&
      !row.deposed &&
      !row.change?.importing &&
      row.change?.actions?.length === 1 &&
      row.change.actions[0] === "no-op" &&
      !changes.has(
        row.address,
      ), "the fresh plan contains an unexpected operation");
    changes.set(row.address, row.change.after);
  }
  for (const { address, change } of original.resource_changes) {
    if (change.actions[0] === "delete") {
      require(!changes.has(address), "the removed resource is still present");
    } else {
      require(changes.has(address) &&
        matches(
          changes.get(address),
          change.after,
          change.after_unknown,
        ), "current resource values do not match the attempted plan");
      changes.delete(address);
    }
  }
  require(!changes.size, "the fresh plan includes unrelated resources");
}
