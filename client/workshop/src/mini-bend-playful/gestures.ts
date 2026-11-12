import type { BendFrame } from "./curves";

export const gestures = [
  { id: "peek", label: "Peek around the corner" },
  { id: "lap", label: "Take the long way around" },
  { id: "overshoot", label: "Slide too far" },
  { id: "sides", label: "Left, right, then centre" },
  { id: "wave", label: "A little wave" },
  { id: "tiptoe", label: "Sneak across" },
  { id: "stretch", label: "Stretch and settle" },
  { id: "hop", label: "Gather courage and hop" },
  { id: "dance", label: "Two-step dance" },
  { id: "bow", label: "Take a modest bow" },
] as const;
export type Gesture = (typeof gestures)[number]["id"];
export type Variant = Gesture | "mixed";

export const INITIAL_REST_MS = 1800;
// A reproducible score makes resets and visual comparisons repeatable.
const order: Gesture[] = [
  "peek",
  "wave",
  "lap",
  "stretch",
  "sides",
  "tiptoe",
  "overshoot",
  "bow",
  "hop",
  "dance",
  "stretch",
  "lap",
  "dance",
  "peek",
  "hop",
  "wave",
  "bow",
  "overshoot",
  "tiptoe",
  "sides",
  "hop",
  "tiptoe",
  "wave",
  "sides",
  "bow",
  "dance",
  "peek",
  "stretch",
  "lap",
  "overshoot",
];
const rests = [5200, 7800, 6400, 8800, 5900];
export function nextGesture(variant: Variant, index: number): Gesture {
  return variant === "mixed" ? order[index % order.length] : variant;
}
export function restAfter(index: number): number {
  return rests[index % rests.length];
}

// Reposition only while fully outside the clipped stage; never slide across it invisibly.
function frames(
  poses: [number, number, number, number, number?][],
  direction: number,
): Keyframe[] {
  return poses.map(([offset, x, y, rotation, hidden]) => ({
    offset,
    transform: `translate(${x * direction}px, ${y}px) rotate(${rotation * direction}deg)`,
    ...(hidden === undefined ? {} : { opacity: hidden ? 0 : 1 }),
  }));
}
function bodyScore(
  gesture: Gesture,
  direction: 1 | -1,
): { duration: number; body: Keyframe[]; eyes: Keyframe[] } {
  const eyes: Keyframe[] = [
    { offset: 0, transform: "translateX(0px)" },
    { offset: 0.24, transform: `translateX(${direction}px)` },
    { offset: 0.68, transform: `translateX(${-direction}px)` },
    { offset: 1, transform: "translateX(0px)" },
  ];
  switch (gesture) {
    case "wave":
      return {
        duration: 3300,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0],
            [0.2, -2, -1, -6],
            [0.36, -2, -1, -6],
            [0.52, -2, -1, -4],
            [0.68, -2, -1, -6],
            [0.84, 0, 0, 2],
            [1, 0, 0, 0],
          ],
          direction,
        ),
      };
    case "tiptoe":
      return {
        duration: 3700,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0],
            [0.15, -4, -2, -5],
            [0.3, -4, 0, 2],
            [0.46, 3, -2, 5],
            [0.6, 3, 0, -2],
            [0.77, 0, -2, -3],
            [1, 0, 0, 0],
          ],
          direction,
        ),
      };
    case "stretch":
      return {
        duration: 3500,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0],
            [0.2, 0, 2, 0],
            [0.44, 0, -3, -4],
            [0.66, 0, -3, 4],
            [0.84, 0, 1, 0],
            [1, 0, 0, 0],
          ],
          direction,
        ),
      };
    case "hop":
      return {
        duration: 3100,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0],
            [0.26, 0, 2, -3],
            [0.4, 0, 2, 0],
            [0.55, 1, -5, 5],
            [0.7, 2, 1, -3],
            [0.84, 0, -1, 2],
            [1, 0, 0, 0],
          ],
          direction,
        ),
      };
    case "dance":
      return {
        duration: 3800,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0],
            [0.15, -3, -1, -8],
            [0.3, -3, 0, 3],
            [0.46, 3, -1, 8],
            [0.6, 3, 0, -3],
            [0.76, -1, -2, -5],
            [0.9, 0, 1, 2],
            [1, 0, 0, 0],
          ],
          direction,
        ),
      };
    case "bow":
      return {
        duration: 3400,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0],
            [0.18, 0, -1, -3],
            [0.4, 1, 2, 12],
            [0.6, 1, 2, 12],
            [0.8, 0, -1, -4],
            [1, 0, 0, 0],
          ],
          direction,
        ),
      };
    case "peek":
      return {
        duration: 3400,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0, 0],
            [0.16, 0, 38, -8, 0],
            [0.17, 0, 38, -8, 1],
            [0.22, 38, 0, -12, 1],
            [0.23, 38, 0, -12, 0],
            [0.37, 19, 0, -12, 0],
            [0.49, 19, 0, -12, 0],
            [0.59, 38, 0, -8, 0],
            [0.68, 38, 0, -8, 0],
            [0.86, 0, 0, 3, 0],
            [1, 0, 0, 0, 0],
          ],
          direction,
        ),
      };
    case "lap":
      return {
        duration: 3200,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0, 0],
            [0.1, 4, -1, -7, 0],
            [0.2, 12, 0, 6, 0],
            [0.31, 24, -1, -6, 0],
            [0.4, 40, 0, 0, 0],
            [0.41, 40, 0, 0, 1],
            [0.53, -40, 0, 0, 1],
            [0.54, -40, 0, 0, 0],
            [0.65, -22, -1, 7, 0],
            [0.76, -11, 0, -6, 0],
            [0.89, -3, -1, 3, 0],
            [1, 0, 0, 0, 0],
          ],
          direction,
        ),
      };
    case "overshoot":
      return {
        duration: 3100,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0, 0],
            [0.17, -40, 0, -8, 0],
            [0.28, -40, 0, -8, 0],
            [0.52, 9, 0, 11, 0],
            [0.64, 9, 0, 11, 0],
            [0.76, 4, -1, -5, 0],
            [0.86, 4, 0, 0, 0],
            [0.94, 0, -1, 3, 0],
            [1, 0, 0, 0, 0],
          ],
          direction,
        ),
      };
    case "sides":
      return {
        duration: 4000,
        eyes,
        body: frames(
          [
            [0, 0, 0, 0, 0],
            [0.12, 0, 38, 0, 0],
            [0.13, 0, 38, 0, 1],
            [0.18, -40, 0, 12, 1],
            [0.19, -40, 0, 12, 0],
            [0.29, -20, 0, 12, 0],
            [0.38, -20, 0, 12, 0],
            [0.46, -40, 0, 12, 0],
            [0.47, -40, 0, 12, 1],
            [0.52, 40, 0, -12, 1],
            [0.53, 40, 0, -12, 0],
            [0.63, 20, 0, -12, 0],
            [0.71, 20, 0, -12, 0],
            [0.79, 40, 0, 0, 0],
            [0.8, 40, 0, 0, 1],
            [0.84, 0, 38, 0, 1],
            [0.85, 0, 38, 0, 0],
            [0.96, 0, -2, 0, 0],
            [1, 0, 0, 0, 0],
          ],
          direction,
        ),
      };
  }
}

function limb(angles: number[], amplitude: number): BendFrame[] {
  return angles.map((angle, i) => ({
    offset: i / (angles.length - 1),
    angle: angle * amplitude,
  }));
}
export function gestureScore(
  gesture: Gesture,
  direction: 1 | -1 = 1,
  variation = 0,
) {
  const score = bodyScore(gesture, direction);
  const amplitude = [1, 0.85, 1.12][variation % 3];
  const duration = Math.round(score.duration * [1, 1.06, 0.94][variation % 3]);
  let left = [0, 12, -10, 12, -8, 0];
  let right = [0, -10, 12, -10, 8, 0];
  if (gesture === "wave") {
    left = [0, 0, 4, 0, 0, 0, 0];
    right = [0, -45, -90, -55, -90, -45, 0];
  }
  if (gesture === "stretch") {
    left = [0, 12, 30, 30, 8, 0];
    right = [0, -12, -30, -30, -8, 0];
  }
  if (gesture === "hop") {
    left = [0, 18, 24, -12, 16, 0];
    right = left.map((angle) => -angle);
  }
  if (gesture === "bow") {
    left = [0, -8, -15, -15, 5, 0];
    right = [0, 8, 15, 15, -5, 0];
  }
  if (gesture === "peek" || gesture === "sides") {
    left = [0, 0, 20, 12, 0];
    right = [0, -8, -14, 0, 0];
  }
  if (direction === -1)
    [left, right] = [right.map((angle) => -angle), left.map((angle) => -angle)];
  return {
    ...score,
    duration,
    left: limb(left, amplitude),
    right: limb(right, amplitude),
  };
}

export function idleEyes(index: number): Keyframe[] {
  const look = index % 2 ? -1 : 1;
  return [
    { offset: 0, transform: "translate(0px, 0px) scaleY(1)" },
    { offset: 0.18, transform: `translate(${look}px, .4px) scaleY(1)` },
    { offset: 0.38, transform: `translate(${look}px, .4px) scaleY(1)` },
    { offset: 0.5, transform: "translate(0px, 0px) scaleY(1)" },
    { offset: 0.66, transform: "translate(0px, 0px) scaleY(1)" },
    { offset: 0.68, transform: "translate(0px, 0px) scaleY(.12)" },
    { offset: 0.7, transform: "translate(0px, 0px) scaleY(1)" },
    { offset: 0.84, transform: "translate(0px, 0px) scaleY(1)" },
    {
      offset: 0.86,
      transform: `translate(0px, 0px) scaleY(${index % 3 === 0 ? 0.12 : 1})`,
    },
    { offset: 0.88, transform: "translate(0px, 0px) scaleY(1)" },
    { offset: 1, transform: "translate(0px, 0px) scaleY(1)" },
  ];
}
