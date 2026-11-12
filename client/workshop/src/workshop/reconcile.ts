const equal = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function identity(value: unknown): string | undefined {
  if (!record(value)) return;
  return typeof value.key === "string"
    ? value.key
    : typeof value.id === "string"
      ? value.id
      : undefined;
}
function merge(base: unknown, requested: unknown, current: unknown): unknown {
  if (equal(base, requested)) return current;
  if (equal(base, current)) return requested;
  if (record(base) && record(requested) && record(current)) {
    const result = { ...current };
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(requested),
    ])) {
      if (!Object.hasOwn(requested, key)) {
        if (equal(base[key], current[key])) delete result[key];
      } else {
        Object.defineProperty(result, key, {
          value: merge(base[key], requested[key], current[key]),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return result;
  }
  if (
    Array.isArray(base) &&
    Array.isArray(requested) &&
    Array.isArray(current) &&
    base.length === requested.length
  ) {
    const keys = base.map(identity);
    if (
      keys.every((key) => key !== undefined) &&
      new Set(keys).size === keys.length
    ) {
      if (!equal(keys, requested.map(identity))) return current;
      return current.map((item) => {
        const key = identity(item);
        const index = key === undefined ? -1 : keys.indexOf(key);
        return index < 0 ? item : merge(base[index], requested[index], item);
      });
    }
    if (base.length === current.length)
      return current.map((item, index) =>
        merge(base[index], requested[index], item),
      );
  }
  return current;
}

// A control action may complete while an older preview edit is in transit.
export function reconcile<T>(base: T | undefined, requested: T, current: T): T {
  return base === undefined
    ? requested
    : (merge(base, requested, current) as T);
}
