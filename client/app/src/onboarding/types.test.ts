import { expect, it } from "vitest";
import { isOnboardingSnapshot, newOnboardingRecord } from "./types";

it("defaults new conversational progress and accepts legacy schema-one records", () => {
  const record = newOnboardingRecord();
  expect(record).toMatchObject({
    schemaVersion: 1,
    conversationId: null,
    fresh: false,
    intent: "help",
    entered: false,
  });
  for (const field of [
    "conversationId",
    "fresh",
    "intent",
    "entered",
  ] as const) {
    delete record[field];
  }
  expect(
    isOnboardingSnapshot({ record, revision: "a".repeat(40), writable: true }),
  ).toBe(true);
});

it("validates conversational fields and requires confirmed instructions for entry", () => {
  const snapshot = {
    record: newOnboardingRecord(),
    revision: "a".repeat(40),
    writable: true,
  };
  for (const [field, value] of [
    ["conversationId", ""],
    ["conversationId", "Setup/1"],
    ["conversationId", "a".repeat(65)],
    ["conversationId", false],
    ["conversationId", undefined],
    ["fresh", null],
    ["fresh", "true"],
    ["fresh", undefined],
    ["intent", "other"],
    ["intent", null],
    ["intent", undefined],
    ["entered", null],
    ["entered", 1],
    ["entered", undefined],
    ["entered", true],
  ]) {
    expect(
      isOnboardingSnapshot({
        ...snapshot,
        record: { ...snapshot.record, [field as string]: value },
      }),
    ).toBe(false);
  }
  for (const step of ["access", "method"]) {
    expect(
      isOnboardingSnapshot({
        ...snapshot,
        record: {
          ...snapshot.record,
          step,
          entered: true,
          instructionRevision: "a".repeat(40),
        },
      }),
    ).toBe(false);
  }
  expect(
    isOnboardingSnapshot({
      ...snapshot,
      record: { ...snapshot.record, step: "complete" },
    }),
  ).toBe(true);
  for (const step of ["proposal", "sources", "review", "support", "complete"]) {
    expect(
      isOnboardingSnapshot({
        ...snapshot,
        record: { ...snapshot.record, step, entered: true },
      }),
    ).toBe(false);
    for (const intent of ["keep", "change", "help"]) {
      expect(
        isOnboardingSnapshot({
          ...snapshot,
          record: {
            ...snapshot.record,
            step,
            intent,
            conversationId: "setup-1",
            fresh: true,
            entered: true,
            instructionRevision: "a".repeat(40),
          },
        }),
      ).toBe(true);
    }
  }
});

it("reads legacy progress and separate bounded open points without accepting unknown fields", () => {
  const snapshot = {
    record: newOnboardingRecord(),
    revision: "a".repeat(40),
    writable: true,
  };
  expect(isOnboardingSnapshot(snapshot)).toBe(true);
  expect(
    isOnboardingSnapshot({
      ...snapshot,
      record: { ...snapshot.record, openPoints: ["Choose a review rhythm."] },
    }),
  ).toBe(true);
  for (const openPoints of [
    null,
    undefined,
    [""],
    ["ä".repeat(1025)],
    Array(9).fill("Question"),
  ]) {
    expect(
      isOnboardingSnapshot({
        ...snapshot,
        record: { ...snapshot.record, openPoints },
      }),
    ).toBe(false);
  }
  expect(
    isOnboardingSnapshot({
      ...snapshot,
      record: { ...snapshot.record, unknown: [] },
    }),
  ).toBe(false);
});
