import { describe, expect, it } from "vitest";
import {
  contentEnvelope,
  createPlatformState,
  profiles,
  selectProfile,
  targetSize,
  type PlatformId,
} from "./model";

describe("platform profiles", () => {
  it("keeps the five named environments", () => {
    expect(profiles.map(({ id, label }) => [id, label])).toEqual([
      ["mac", "macOS"],
      ["windows", "Windows 11"],
      ["kde", "Linux · KDE Plasma 6 / Breeze"],
      ["ios", "iOS"],
      ["android", "Android"],
    ]);
  });

  it.each<[PlatformId, number, number, number, number, number]>([
    ["mac", 1040, 700, 0, 0, 0],
    ["windows", 1040, 700, 0, 0, 0],
    ["kde", 1040, 700, 0, 0, 0],
    ["ios", 390, 844, 59, 34, 260],
    ["android", 412, 852, 32, 24, 272],
  ])(
    "%s keeps its target size and content insets without a drawn titlebar",
    (id, width, height, top, bottom, keyboard) => {
      const state = createPlatformState(id);
      expect(targetSize(state)).toEqual({ width, height });
      expect(contentEnvelope(state)).toEqual({
        width,
        height: height - top - bottom,
        top,
        bottom,
        keyboard: 0,
      });
      expect(contentEnvelope({ ...state, keyboardOpen: true })).toEqual({
        width,
        height: height - top - bottom - keyboard,
        top,
        bottom,
        keyboard,
      });
    },
  );

  it("keeps environment state serializable and transitions immutable", () => {
    const initial = { ...createPlatformState("ios"), keyboardOpen: true };
    expect(JSON.parse(JSON.stringify(initial))).toEqual(initial);
    expect(selectProfile(initial, "android")).toEqual({
      profile: "android",
      keyboardOpen: true,
    });
    expect(selectProfile(initial, "mac")).toEqual({
      profile: "mac",
      keyboardOpen: false,
    });
    expect(initial).toEqual({ profile: "ios", keyboardOpen: true });
    expect(createPlatformState()).toEqual({
      profile: "mac",
      keyboardOpen: false,
    });
  });

  it("uses the actual content rectangle rather than forcing target dimensions", () => {
    expect(
      contentEnvelope(
        { profile: "ios", keyboardOpen: true },
        { width: 320, height: 568 },
      ),
    ).toEqual({ width: 320, height: 215, top: 59, bottom: 34, keyboard: 260 });
  });

  it.each([0, 1, 40, 90, 100, 320, 568, 844])(
    "bounds all reserved regions within a %spx viewport",
    (height) => {
      const envelope = contentEnvelope(
        { profile: "ios", keyboardOpen: true },
        { width: 320, height },
      );
      expect(
        envelope.top + envelope.bottom + envelope.keyboard + envelope.height,
      ).toBe(height);
      for (const value of Object.values(envelope))
        expect(value).toBeGreaterThanOrEqual(0);
      expect(envelope.top).toBeLessThanOrEqual(59);
      expect(envelope.bottom).toBeLessThanOrEqual(34);
      expect(envelope.keyboard).toBeLessThanOrEqual(260);
    },
  );

  it.each([-1, NaN, Infinity])(
    "rejects invalid viewport dimension %s",
    (value) => {
      expect(() =>
        contentEnvelope(createPlatformState(), { width: value, height: 800 }),
      ).toThrow(RangeError);
      expect(() =>
        contentEnvelope(createPlatformState(), { width: 390, height: value }),
      ).toThrow(RangeError);
    },
  );
});
