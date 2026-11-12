import type { BendPose } from "../bend-performance";

export interface JourneyInput {
  step: number;
  fromStep: number;
  travel: number;
  reaction: number;
  blocked?: boolean;
}

export const stage = {
  width: 500,
  height: 470,
  ground: 365,
  actorScale: 0.9,
} as const;
export const stationSpacing = 340;
const centers = [185, 255, 200, 270, 180] as const;
const poses: BendPose[] = [
  { wave: 0.66, gazeX: 0.45 },
  { present: 0.25, gazeX: -0.7, lean: -2 },
  { wave: 0.3, present: 0.38, gazeX: 0.7, gazeY: -0.15, lean: 1.5 },
  { present: 0.34, gazeX: -0.6, gazeY: 0.35, lean: -2.5 },
  { wave: 0.12, gazeX: 0.75, gazeY: 0.1, lean: 2 },
];
const poseKeys = [
  "stride",
  "phase",
  "wave",
  "wavePhase",
  "present",
  "blink",
  "wink",
  "mouth",
  "gazeX",
  "gazeY",
  "lean",
  "bob",
] as const;
const tau = Math.PI * 2;
export const clamp = (value: number, max = 1) =>
  Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;
const smooth = (value: number) => {
  const p = clamp(value);
  return p * p * (3 - 2 * p);
};
const ramp = (value: number, start: number, end: number) =>
  smooth((value - start) / (end - start));
const mix = (a: number, b: number, p: number) =>
  p === 0 ? a : p === 1 ? b : a + (b - a) * p;
const pulse = (value: number, start: number, end: number) => {
  const p = clamp((value - start) / (end - start));
  return p === 0 || p === 1 ? 0 : Math.sin(Math.PI * p) ** 2;
};
const station = (value: number) => Math.round(clamp(value, 4));
const ground = (x: number) => stage.ground + 8 * Math.sin((x * tau) / 900);
const rounded = (n: number) => Number(n.toFixed(4));

/** Cubic Hermite segments preserve a continuous wave and tangent when seeking. */
export function ribbonPath(
  camera: number,
  amplitude: number,
  baseline: number,
  wavelength: number,
  phase = 0,
  start = -100,
  end = 600,
) {
  const y = (x: number) =>
    baseline + amplitude * Math.sin(((x + camera) * tau) / wavelength + phase);
  const slope = (x: number) =>
    ((amplitude * tau) / wavelength) *
    Math.cos(((x + camera) * tau) / wavelength + phase);
  let path = `M${start} ${rounded(y(start))}`;
  for (let x = start; x < end; x += 50) {
    path += `C${rounded(x + 50 / 3)} ${rounded(y(x) + (slope(x) * 50) / 3)} ${rounded(x + 100 / 3)} ${rounded(y(x + 50) - (slope(x + 50) * 50) / 3)} ${x + 50} ${rounded(y(x + 50))}`;
  }
  return path;
}

export type PaperKind = "folder" | "links" | "map" | "tray";
const papers: {
  id: PaperKind;
  worldX: number;
  size: number;
  ratio: number;
  rise: number;
  rotation: number;
}[] = [
  {
    id: "folder",
    worldX: 353,
    size: 156,
    ratio: 164 / 200,
    rise: 133,
    rotation: -5,
  },
  {
    id: "links",
    worldX: 445,
    size: 128,
    ratio: 166 / 208,
    rise: 212,
    rotation: 3,
  },
  {
    id: "map",
    worldX: 1025,
    size: 156,
    ratio: 164 / 208,
    rise: 228,
    rotation: -3,
  },
  {
    id: "tray",
    worldX: 1160,
    size: 148,
    ratio: 138 / 200,
    rise: 121,
    rotation: -5,
  },
];

function fullPose(index: number): Required<BendPose> {
  const pose = Object.fromEntries(
    poseKeys.map((key) => [key, poses[index][key] ?? 0]),
  ) as Required<BendPose>;
  return grounded(pose);
}

// The rigid arch rocks about the rig's lower pivot. Counter-lift keeps its
// supporting end near the ground without bending, scaling or adding feet.
function grounded(pose: Required<BendPose>): Required<BendPose> {
  return { ...pose, stride: 0, phase: 0, bob: -Math.abs(pose.lean) * 1.15 };
}

const deskWorldX = 1700;
function world(
  position: number,
  actorX: number,
  pose: Required<BendPose>,
  wind = 0,
  arrival = 0,
) {
  const camera = position * stationSpacing;
  const groundY = ground(camera + actorX);
  const leafX = 60 + position * 174;
  const deskY = ground(deskWorldX);
  const alignNote = ramp(arrival, 0.54, 0.7);
  const dockPage = ramp(arrival, 0.08, 0.44);
  const noteX = -45 + 4 * alignNote;
  return {
    position,
    camera,
    arrival,
    paperBits: [] as PaperBit[],
    backdropX: -camera * 0.42,
    rail: ribbonPath(camera * 0.8, 66 + wind * 12, 185, 780, wind * 0.24),
    road: ribbonPath(camera, 8, stage.ground + 35, 900),
    objects: papers.map(({ worldX, ...paper }) => ({
      ...paper,
      x: worldX - camera,
      y: ground(worldX) - paper.rise,
      height: paper.size * paper.ratio,
    })),
    posts: [445, 1025].map((x) => ({ x: x - camera, y: ground(x) })),
    plants: [30, 715, 1100, 1390, 1818].map((x, index) => ({
      x: x - camera,
      y: ground(x),
      size: index % 2 ? 0.65 : 0.85,
      tilt: index % 2 ? 14 : -12,
    })),
    leaf: {
      x: mix(
        leafX - camera * 0.32 + wind * 58,
        deskWorldX - camera + 72,
        dockPage,
      ),
      y: mix(
        72 + 22 * Math.sin(position * 1.6) - wind * 15,
        deskY - 161,
        dockPage,
      ),
      rotation: mix(-15 + position * 27 + wind * 25, -5, dockPage),
    },
    desk: {
      x: deskWorldX - camera,
      y: deskY + 34,
      noteX,
      noteY: -126,
      noteRotation: mix(-10, 0, alignNote),
    },
    actor: {
      x: actorX - 160 * stage.actorScale,
      y: groundY - 278 * stage.actorScale,
      scale: stage.actorScale,
      pose,
    },
    shadow: { x: actorX + 4, y: groundY + 1, rx: 65, ry: 7 },
    folds: Array.from({ length: 21 }, (_, i) => {
      const x = i * 100 - camera;
      return { x, y: ground(x + camera) + 38 };
    }),
  };
}

/** Complete decorative state; movement exists only in the supplied inputs. */
export function journeyFrame(input: JourneyInput) {
  const from = station(input.fromStep),
    to = station(input.step),
    t = clamp(input.travel);
  const a = fullPose(from),
    b = fullPose(to);
  if (from === to) return world(to, centers[to], b);
  if (input.blocked) return world(from, centers[from], a);
  if (t === 1) return world(to, centers[to], b);
  if (t === 0) {
    const nod = clamp(input.reaction);
    return world(
      from,
      centers[from],
      grounded({ ...a, lean: a.lean + 1.4 * nod, gazeY: a.gazeY + 0.4 * nod }),
    );
  }
  const direction = Math.sign(to - from);
  const movement = ramp(t, 0.08, 0.84);
  const active = ramp(t, 0.04, 0.16) * (1 - ramp(t, 0.75, 0.95));
  const pose = fullPose(from);
  for (const key of poseKeys) pose[key] = mix(a[key], b[key], movement);
  const rock = Math.sin(movement * Math.PI * 5) * active;
  pose.lean += direction * (4.1 * rock - 2.8 * pulse(t, 0, 0.18));
  pose.present *= 1 - active * 0.55;
  pose.wave *= 1 - active * 0.75;
  pose.gazeX = mix(pose.gazeX, direction * 0.85, active * 0.7);
  pose.blink = 0.85 * pulse(t, 0.07, 0.17);

  // One absent-minded glance: the passing leaf steals attention, then Bend
  // remembers the direction of travel. This is a single finite reaction.
  const distracted = to === 2 && direction > 0;
  const glance = distracted ? pulse(t, 0.3, 0.79) : 0;
  pose.gazeX = mix(pose.gazeX, -0.9, glance);
  pose.gazeY = mix(pose.gazeY, -0.9, glance);
  pose.mouth = 0.38 * glance;
  pose.wave += 0.38 * pulse(t, 0.67, 0.91) * Number(distracted);
  pose.wavePhase = 0.8 * pulse(t, 0.71, 0.95) * Number(distracted);
  if (to === 4) {
    pose.gazeX = mix(pose.gazeX, 0.9, pulse(t, 0.62, 1));
    pose.present += 0.25 * pulse(t, 0.72, 1);
    pose.mouth += 0.18 * pulse(t, 0.65, 0.91);
  }
  pose.lean = Math.min(6, Math.max(-6, pose.lean));
  const x = mix(centers[from], centers[to], movement) + direction * rock * 4;
  return world(
    mix(from, to, movement),
    x,
    grounded(pose),
    distracted ? glance : 0.4 * active,
  );
}

/** An explicitly confirmed ending, separate from reaching the fifth form. */
export function arrivalFrame(progress: number) {
  const t = clamp(progress);
  if (t === 0)
    return journeyFrame({ fromStep: 4, step: 4, travel: 1, reaction: 0 });
  const approach = ramp(t, 0, 0.42);
  const relax = ramp(t, 0.7, 0.93);
  const pose = fullPose(4);
  pose.lean = mix(2, 3.5, approach) + 1.6 * pulse(t, 0, 0.4);
  pose.lean = mix(pose.lean, -1, relax);
  pose.present = 0.4 * ramp(t, 0.4, 0.5) + 0.25 * relax;
  pose.wave = 0.12 * (1 - approach);
  pose.gazeX = 0.85 * (1 - relax);
  pose.gazeY = 0.5 * pulse(t, 0.39, 0.76);
  pose.blink = 0.85 * pulse(t, 0.69, 0.84);
  pose.wink = 0.45 * pulse(t, 0.84, 0.97);
  return world(4, mix(centers[4], 203, approach), grounded(pose), 0, t);
}

export interface PaperBit {
  id: number;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  color: string;
}
export type JourneyFrame = ReturnType<typeof journeyFrame>;
