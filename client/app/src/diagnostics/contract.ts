import {
  attributes,
  events,
  levels,
  initiators,
} from "../../../contracts/diagnostics.json";

const catalog = { attributes, events, levels, initiators };

export type Level = "trace" | "debug" | "info" | "warn" | "error";
export type Category =
  | "app"
  | "ui"
  | "workspace"
  | "storage"
  | "agent"
  | "model"
  | "tool"
  | "plugin"
  | "sync"
  | "diagnostics";
export type Initiator = "user" | "agent" | "background";
export type EventName = keyof typeof catalog.events;
export interface Context {
  readonly trace_id: string;
  readonly span_id: string;
  readonly parent_span_id?: string;
  readonly initiator: Initiator;
}
export type Attributes = Readonly<
  Partial<Record<keyof typeof catalog.attributes, string | number>>
>;
export interface EventInput {
  readonly schema_version: 1;
  readonly event: EventName;
  readonly level: Level;
  readonly category: Category;
  readonly timestamp_ms: number;
  readonly sequence: number;
  readonly context?: Context;
  readonly attributes: Attributes;
}

function fields(
  value: unknown,
  allowed: readonly string[],
  required = allowed,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return;
  const copy: Record<string, unknown> = Object.create(null);
  let count = 0;
  for (const key in value) {
    if (++count > allowed.length || !allowed.includes(key)) return;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return;
    copy[key] = descriptor.value;
  }
  if (Object.getOwnPropertySymbols(value).length) return;
  if (!required.every((key) => Object.hasOwn(copy, key))) return;
  return copy;
}
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function validateContext(value: unknown): Context | undefined {
  try {
    const data = fields(
      value,
      ["trace_id", "span_id", "parent_span_id", "initiator"],
      ["trace_id", "span_id", "initiator"],
    );
    if (
      !data ||
      !uuid(data.trace_id) ||
      !uuid(data.span_id) ||
      (Object.hasOwn(data, "parent_span_id") && !uuid(data.parent_span_id)) ||
      !catalog.initiators.includes(data.initiator as string)
    )
      return;
    return Object.freeze({ ...data }) as unknown as Context;
  } catch {
    return;
  }
}

export function validateEvent(value: unknown): EventInput | undefined {
  try {
    const data = fields(
      value,
      [
        "schema_version",
        "event",
        "level",
        "category",
        "timestamp_ms",
        "sequence",
        "context",
        "attributes",
      ],
      [
        "schema_version",
        "event",
        "level",
        "category",
        "timestamp_ms",
        "sequence",
        "attributes",
      ],
    );
    if (
      !data ||
      data.schema_version !== 1 ||
      typeof data.event !== "string" ||
      data.event.length > 64 ||
      !Object.hasOwn(catalog.events, data.event) ||
      !(catalog.events[data.event as EventName] as string[]).includes(
        data.category as string,
      ) ||
      !catalog.levels.includes(data.level as string) ||
      !integer(data.timestamp_ms) ||
      !integer(data.sequence)
    )
      return;
    const attributes = fields(
      data.attributes,
      Object.keys(catalog.attributes),
      [],
    );
    if (!attributes) return;
    for (const [key, value] of Object.entries(attributes)) {
      const rule = catalog.attributes[key as keyof typeof catalog.attributes];
      if (Array.isArray(rule)) {
        if (typeof value !== "string" || !rule.includes(value)) return;
      } else if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < rule.min ||
        value > rule.max ||
        ("integer" in rule && rule.integer && !Number.isSafeInteger(value))
      )
        return;
    }
    const context = Object.hasOwn(data, "context")
      ? validateContext(data.context)
      : undefined;
    if (Object.hasOwn(data, "context") && !context) return;
    return Object.freeze({
      ...data,
      ...(context ? { context } : {}),
      attributes: Object.freeze({ ...attributes }),
    }) as unknown as EventInput;
  } catch {
    return;
  }
}

export function createContext(
  parent?: Context,
  initiator: Initiator = "user",
): Context | undefined {
  try {
    const captured = parent === undefined ? undefined : validateContext(parent);
    if (parent !== undefined && !captured) return;
    return validateContext({
      trace_id: captured?.trace_id ?? crypto.randomUUID(),
      span_id: crypto.randomUUID(),
      ...(captured ? { parent_span_id: captured.span_id } : {}),
      initiator: captured?.initiator ?? initiator,
    });
  } catch {
    return;
  }
}
