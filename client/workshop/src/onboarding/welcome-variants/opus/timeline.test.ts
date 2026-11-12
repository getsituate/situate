import { describe, expect, it } from "vitest";
import {
  beats,
  durationMs,
  headerSlot,
  layout,
  stillMs,
  welcomeFrame,
  wordProgress,
} from "./timeline";

const desktop = { width: 1280, height: 900 };
const viewports = [
  desktop,
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];

describe("welcome score", () => {
  it("is a finite film with a still lockup before its handoff", () => {
    expect(durationMs).toBeGreaterThanOrEqual(7000);
    expect(durationMs).toBeLessThanOrEqual(12500);
    expect(stillMs).toBeGreaterThan(beats.tagline[1]);
    expect(stillMs).toBeLessThan(beats.handoff[0]);
  });

  it("is pure: seeking in any order returns identical frames", () => {
    const times = [0, 4600, 11800, 2000, 8800, 0, 10900];
    const fresh = times.map((t) => JSON.stringify(welcomeFrame(t, desktop)));
    const later = [...times]
      .reverse()
      .map((t) => JSON.stringify(welcomeFrame(t, desktop)))
      .reverse();
    expect(later).toEqual(fresh);
  });

  it("clamps invalid and out-of-range times", () => {
    expect(welcomeFrame(-500, desktop)).toEqual(welcomeFrame(0, desktop));
    expect(welcomeFrame(Number.NaN, desktop)).toEqual(welcomeFrame(0, desktop));
    expect(welcomeFrame(durationMs + 9000, desktop)).toEqual(
      welcomeFrame(durationMs, desktop),
    );
  });

  it("opens on a close-up of Bend with closed eyes and nothing else drawn", () => {
    const first = welcomeFrame(0, desktop);
    expect(first.bend.pose.blink).toBe(1);
    expect(first.tone).toBe("ink");
    expect(Object.values(first.ribbons).some((r) => r.visible)).toBe(false);
    expect(Object.values(first.objects).some((o) => o.visible)).toBe(false);
    expect(first.wordmark.visible).toBe(false);
    expect(first.bend.transform).toMatch(/scale\((2|3)\.\d+\)/);
    expect(welcomeFrame(beats.wake[1], desktop).bend.pose.blink).toBe(0);
  });

  it("turns from the ink stage to paper exactly when the page is laid", () => {
    const before = welcomeFrame(beats.turn[1] - 1, desktop);
    const after = welcomeFrame(beats.turn[1], desktop);
    expect(before.tone).toBe("ink");
    expect(before.page.flap).not.toBe("");
    expect(after.tone).toBe("paper");
    expect(after.worldVisible).toBe(false);
    expect(after.page.flap).toBe("");
    expect(welcomeFrame(beats.turn[0], desktop).page.laid).toBe("");
  });

  it("holds a complete static lockup before the handoff", () => {
    const still = welcomeFrame(stillMs, desktop);
    expect(still.wordmark.strokes.every((p) => p === 1)).toBe(true);
    expect(still.wordmark.accent.opacity).toBe(1);
    expect(still.captions.tagline).toEqual({
      reveal: 1,
      exit: 0,
      visible: true,
    });
    expect(still.captions.hello.visible).toBe(false);
    expect(still.captions.gather.visible).toBe(false);
    expect(still.bend.pose.wave).toBe(0);
    expect(still.controls).toBe(1);
    const { time: _a, ...holdStart } = welcomeFrame(10650, desktop);
    const { time: _b, ...holdEnd } = welcomeFrame(beats.handoff[0], desktop);
    expect(holdEnd).toEqual(holdStart);
  });

  it("ends with the wordmark in the entry header and Bend out of view", () => {
    for (const viewport of viewports) {
      const end = welcomeFrame(durationMs, viewport);
      const slot = headerSlot(viewport);
      const scale = slot.width / 165;
      expect(end.wordmark.transform).toBe(
        `translate(${Math.round(slot.x * 100) / 100} ${slot.y}) scale(${Math.round(scale * 1e5) / 1e5})`,
      );
      expect(end.captions.tagline.visible).toBe(false);
      expect(end.controls).toBe(1);
      expect(end.bend.top + (64 * end.layout.size) / 320).toBeGreaterThan(
        viewport.height,
      );
    }
  });

  it("composes portrait screens without cropping Bend or the text", () => {
    for (const viewport of viewports) {
      const l = layout(viewport);
      expect(l.portrait).toBe(viewport.height > viewport.width * 1.15);
      const half = (152 / 320) * l.size * 0.5;
      expect(l.center[0] - half).toBeGreaterThan(0);
      expect(l.center[0] + half).toBeLessThan(viewport.width);
      expect(l.center[1] - 0.316 * l.size).toBeGreaterThan(60);
      expect(l.center[1] + 0.316 * l.size).toBeLessThan(viewport.height);
      expect(l.text.left).toBeGreaterThanOrEqual(24);
      expect(l.text.left + l.text.width).toBeLessThanOrEqual(viewport.width);
      expect(l.wordmark.x + l.wordmark.width).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(l.wordmark.y).toBeGreaterThanOrEqual(60);
    }
  });

  it("reveals caption words in order and completely", () => {
    for (const count of [1, 3, 9]) {
      for (let i = 0; i < count; i++) {
        expect(wordProgress(0, i, count)).toBe(0);
        expect(wordProgress(1, i, count)).toBe(1);
        if (i > 0)
          expect(wordProgress(0.4, i, count)).toBeLessThanOrEqual(
            wordProgress(0.4, i - 1, count),
          );
      }
    }
  });

  it("matches the entry header geometry", () => {
    expect(headerSlot({ width: 1440, height: 900 })).toEqual({
      x: 80,
      y: 33,
      width: 126,
    });
    expect(headerSlot({ width: 1280, height: 900 }).x).toBeCloseTo(51.2);
    expect(headerSlot({ width: 390, height: 844 })).toEqual({
      x: 18,
      y: 23,
      width: 126,
    });
  });
});
