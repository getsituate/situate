import { describe, expect, it } from "vitest";
import { recordingFrames, restingFrame } from "./activity-motion";

describe("recording feedback", () => {
  it("gives the bars a deterministic, seamless phrase", () => {
    for (let index = 0; index < 7; index++) {
      const frames = recordingFrames("speaking", index);
      expect(frames).toEqual(recordingFrames("speaking", index));
      expect(frames[0]).toEqual(frames.at(-1));
      expect(
        new Set(frames.map((frame) => frame.transform)).size,
      ).toBeGreaterThan(4);
      for (const frame of frames) {
        const scale = Number(String(frame.transform).slice(7, -1));
        expect(scale).toBeGreaterThanOrEqual(0.125);
        expect(scale).toBeLessThanOrEqual(0.925);
      }
    }
  });

  it("settles completely during silence and keeps quiet speech distinct", () => {
    for (let index = 0; index < 7; index++) {
      const frames = recordingFrames("silence", index);
      expect(
        frames.every((frame) => frame.transform === frames[0]!.transform),
      ).toBe(true);
      expect(frames[0]).toEqual(restingFrame("silence", index));
      expect(restingFrame("quiet", index)).not.toEqual(
        restingFrame("speaking", index),
      );
    }
  });
});
