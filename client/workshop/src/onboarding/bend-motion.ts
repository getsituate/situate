export type BendMoment =
  "welcome" | "listen" | "gather" | "shape" | "ready" | "arrive" | "blocked";
export interface BendTrack {
  part: string;
  frames: Keyframe[];
}
export function bendScore(moment: BendMoment): {
  duration: number;
  tracks: BendTrack[];
} {
  const figure = (values: string[]) => ({
    part: "figure",
    frames: values.map((transform) => ({ transform })),
  });
  const arm = (values: number[]) => ({
    part: "right-arm",
    frames: values.map((value) => ({ transform: `rotate(${value}deg)` })),
  });
  switch (moment) {
    case "welcome":
      return {
        duration: 1400,
        tracks: [
          figure([
            "none",
            "translateY(-3px) rotate(-2deg)",
            "translateY(-2px) rotate(1deg)",
            "none",
          ]),
          arm([0, -18, 12, -12, 0]),
        ],
      };
    case "listen":
      return {
        duration: 1600,
        tracks: [
          figure([
            "none",
            "translateY(2px) rotate(2deg)",
            "translateY(2px) rotate(2deg)",
            "none",
          ]),
        ],
      };
    case "gather":
      return {
        duration: 1300,
        tracks: [
          figure([
            "none",
            "translateY(3px) rotate(-3deg)",
            "translateY(-3px) rotate(1deg)",
            "none",
          ]),
        ],
      };
    case "shape":
      return {
        duration: 1000,
        tracks: [
          figure([
            "none",
            "translateX(2px) rotate(2deg)",
            "translateX(2px) rotate(2deg)",
            "none",
          ]),
          arm([0, -5, -5, 0]),
        ],
      };
    case "arrive":
      return {
        duration: 1100,
        tracks: [
          figure([
            "none",
            "translateY(3px) rotate(-2deg)",
            "translateY(-8px) rotate(2deg)",
            "none",
          ]),
        ],
      };
    default:
      return { duration: 0, tracks: [] };
  }
}
