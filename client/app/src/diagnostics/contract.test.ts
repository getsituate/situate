import { describe, expect, it } from "vitest";
import catalog from "../../../contracts/diagnostics.json";
import { createContext, validateContext, validateEvent } from "./contract";

describe("diagnostic wire v1", () => {
  it.each(catalog.valid)("admits the shared valid fixture %#", (fixture) => {
    expect(validateEvent(fixture)).toEqual(fixture);
  });
  it.each(catalog.invalid)(
    "rejects the shared invalid fixture %#",
    (fixture) => {
      expect(validateEvent(fixture)).toBeUndefined();
    },
  );
  it("copies only reviewed scalars without invoking accessors or serialization hooks", () => {
    let invoked = false;
    const unsafe = {
      get action() {
        invoked = true;
        return "save";
      },
    };
    expect(
      validateEvent({ ...catalog.valid[0], attributes: unsafe }),
    ).toBeUndefined();
    expect(
      validateEvent({
        ...catalog.valid[0],
        attributes: {
          toJSON() {
            invoked = true;
            return {};
          },
        },
      }),
    ).toBeUndefined();
    expect(invoked).toBe(false);
    const attributes = { count: 2 };
    const accepted = validateEvent({ ...catalog.valid[0], attributes });
    attributes.count = 9;
    expect(accepted?.attributes.count).toBe(2);
    expect(Object.isFrozen(accepted?.attributes)).toBe(true);
  });
  it("rejects malformed numbers, unbounded text, errors and producer-owned identities", () => {
    for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, 0.1]) {
      expect(
        validateEvent({ ...catalog.valid[0], sequence: value }),
      ).toBeUndefined();
      expect(
        validateEvent({ ...catalog.valid[0], timestamp_ms: value }),
      ).toBeUndefined();
    }
    for (const attributes of [
      { error: new Error("PRIVATE_SENTINEL") },
      { action: "PRIVATE_SENTINEL".repeat(10000) },
      { duration_ms: 86400001 },
      { count: 0.5 },
      { payload: {} },
    ]) {
      expect(
        validateEvent({ ...catalog.valid[0], attributes }),
      ).toBeUndefined();
    }
    for (const key of [
      "workspace_id",
      "device_id",
      "session_id",
      "origin",
      "producer_id",
      "message",
    ]) {
      expect(
        validateEvent({ ...catalog.valid[0], [key]: "PRIVATE_SENTINEL" }),
      ).toBeUndefined();
    }
  });
  it("creates immutable explicit root and child contexts", () => {
    const root = createContext(undefined, "agent")!;
    const child = createContext(root)!;
    expect(child.trace_id).toBe(root.trace_id);
    expect(child.parent_span_id).toBe(root.span_id);
    expect(child.span_id).not.toBe(root.span_id);
    expect(child.initiator).toBe("agent");
    expect(Object.isFrozen(child)).toBe(true);
    expect(
      validateContext({ ...child, workspace_id: "PRIVATE_SENTINEL" }),
    ).toBeUndefined();
  });
});
