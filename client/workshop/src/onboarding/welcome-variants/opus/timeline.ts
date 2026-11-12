import type { BendPose } from "../../../brand/bend/performance";

export const durationMs = 11900;
/** Complete lockup used as the still composition. */
export const stillMs = 10900;

export interface Viewport {
  width: number;
  height: number;
}
type Point = [number, number];
type Range = readonly [number, number];

export const beats = {
  wake: [250, 700],
  camera: [500, 3400],
  ribbonFront: [300, 2200],
  ribbonBack: [700, 2500],
  ribbonMiddle: [1000, 2700],
  rock: [2500, 3700],
  burst: [2500, 3300],
  hello: [3800, 5600],
  captionHello: [4000, 4600, 5700, 6000],
  gather: [5700, 7400],
  captionGather: [6050, 6700, 7850, 8150],
  turn: [7900, 9200],
  wordmark: [9000, 9950],
  accent: [9850, 10250],
  tagline: [10050, 10600],
  /** Tagline leaves, then Bend steps down, then the wordmark moves to the header. */
  handoff: [11150, 11900],
  exitBend: [11300, 11800],
  exitWordmark: [11400, 11900],
} as const satisfies Record<string, readonly number[]>;

export const objectNames = ["page", "card", "book", "open", "leaf"] as const;
export type ObjectName = (typeof objectNames)[number];
/** Canvas size of each keepsake's artwork. */
export const objectArt: Record<ObjectName, { width: number; height: number }> =
  {
    page: { width: 160, height: 190 },
    card: { width: 210, height: 150 },
    book: { width: 160, height: 190 },
    open: { width: 200, height: 150 },
    leaf: { width: 150, height: 190 },
  };
const objectSize: Record<ObjectName, number> = {
  page: 0.36,
  card: 0.44,
  book: 0.34,
  open: 0.46,
  leaf: 0.28,
};
const objectArrival: Record<ObjectName, Range> = {
  page: [1300, 1950],
  card: [1550, 2200],
  book: [1800, 2450],
  open: [2050, 2700],
  leaf: [2300, 2950],
};
interface Placement {
  x: number;
  y: number;
  rotate: number;
}
/** Scattered placements in viewport fractions; gathered ones in Bend units around its center. */
const placements: Record<
  "landscape" | "portrait",
  Record<ObjectName, { scattered: Placement; gathered: Placement }>
> = {
  landscape: {
    page: {
      scattered: { x: 0.1, y: 0.2, rotate: -18 },
      gathered: { x: -0.7, y: -0.3, rotate: -12 },
    },
    card: {
      scattered: { x: 0.8, y: 0.86, rotate: -12 },
      gathered: { x: 0.56, y: 0.56, rotate: -7 },
    },
    book: {
      scattered: { x: 0.07, y: 0.74, rotate: 16 },
      gathered: { x: -0.56, y: 0.46, rotate: 10 },
    },
    open: {
      scattered: { x: 0.8, y: 0.24, rotate: 9 },
      gathered: { x: 0.5, y: -0.56, rotate: 7 },
    },
    leaf: {
      scattered: { x: 0.58, y: 0.86, rotate: 28 },
      gathered: { x: -0.8, y: 0.06, rotate: 22 },
    },
  },
  portrait: {
    page: {
      scattered: { x: 0.12, y: 0.14, rotate: -16 },
      gathered: { x: -0.6, y: -0.5, rotate: -12 },
    },
    card: {
      scattered: { x: 0.8, y: 0.95, rotate: -10 },
      gathered: { x: 0.64, y: 0.4, rotate: -8 },
    },
    book: {
      scattered: { x: 0.16, y: 0.94, rotate: 14 },
      gathered: { x: -0.64, y: 0.4, rotate: 10 },
    },
    open: {
      scattered: { x: 0.86, y: 0.16, rotate: 10 },
      gathered: { x: 0.58, y: -0.54, rotate: 8 },
    },
    leaf: {
      scattered: { x: 0.9, y: 0.48, rotate: 26 },
      gathered: { x: -0.78, y: 0.06, rotate: 20 },
    },
  },
};

const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));
const progress = (t: number, [start, end]: Range) =>
  clamp((t - start) / (end - start));
const smooth = (p: number) => p * p * (3 - 2 * p);
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeIn = (p: number) => p ** 3;
/** Ease-in-out for traveling motion. */
const travel = (p: number) =>
  p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
const ease = (t: number, range: Range) => smooth(progress(t, range));
const envelope = (t: number, a: number, b: number, c: number, d: number) =>
  ease(t, [a, b]) * (1 - ease(t, [c, d]));
const pulse = (t: number, center: number, radius: number) => {
  const p = Math.abs(t - center) / radius;
  return p >= 1 ? 0 : (1 + Math.cos(p * Math.PI)) / 2;
};
const mix = (a: number, b: number, p: number) => a + (b - a) * p;
const n = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};
const pt = ([x, y]: Point) => `${n(x)} ${n(y)}`;
/** Higher precision for scale factors. */
const fine = (value: number) => Math.round(value * 1e5) / 1e5;

/** Per-word reveal for a caption's overall reveal progress. */
export function wordProgress(reveal: number, index: number, count: number) {
  const span = 0.55;
  const start = count > 1 ? (index / (count - 1)) * (1 - span) : 0;
  return easeOut(clamp((reveal - start) / span));
}

/** Position of the entry screen's header wordmark, used as the handoff target. */
export function headerSlot({ width }: Viewport) {
  if (width <= 760) return { x: 18, y: 23, width: 126 };
  const pad = clamp(width * 0.04, 18, 56);
  return {
    x: pad + Math.max(0, (width - pad * 2 - 1280) / 2),
    y: 33,
    width: 126,
  };
}

export function layout(viewport: Viewport) {
  const w = Math.max(1, viewport.width);
  const h = Math.max(1, viewport.height);
  const portrait = h > w * 1.15;
  if (portrait) {
    const size = clamp(Math.min(w * 0.68, h * 0.34), 120, 380);
    const wordmark = Math.min(w * 0.56, 240);
    const wordmarkHeight = (wordmark * 44) / 165;
    const crownGap = Math.max(20, size * 0.08);
    const taglineGap = size * 0.07 + 12;
    // Wordmark, Bend and tagline are centered together as the final lockup.
    const lockup = wordmarkHeight + crownGap + size * 0.632 + taglineGap + 50;
    const wordmarkY = Math.max(76, (h - lockup) / 2);
    const crown = wordmarkY + wordmarkHeight + crownGap;
    const center: Point = [w / 2, crown + size * 0.316];
    const textTop = center[1] + size * 0.64;
    return {
      w,
      h,
      portrait,
      size,
      center,
      text: {
        left: 24,
        top: textTop,
        width: w - 48,
        align: "center" as const,
        anchor: "top" as const,
      },
      wordmark: { x: (w - wordmark) / 2, y: wordmarkY, width: wordmark },
      taglineTop: center[1] + size * 0.316 + taglineGap,
    };
  }
  const size = clamp(Math.min(h * 0.56, w * 0.38), 140, 500);
  const center: Point = [w * 0.33, h * 0.52];
  const left = Math.max(w * 0.53, center[0] + size * 0.56);
  const textWidth = Math.min(w * 0.38, 520, w - left - 32);
  const wordmark = Math.min(textWidth * 0.9, 420);
  const wordmarkHeight = (wordmark * 44) / 165;
  return {
    w,
    h,
    portrait,
    size,
    center,
    text: {
      left,
      top: h * 0.5,
      width: textWidth,
      align: "start" as const,
      anchor: "middle" as const,
    },
    wordmark: { x: left, y: h * 0.5 - wordmarkHeight - 10, width: wordmark },
    taglineTop: h * 0.5 + 18,
  };
}
export type Layout = ReturnType<typeof layout>;

function ribbonPaths(l: Layout) {
  const { w, h, size } = l;
  const P = (x: number, y: number): Point => [x * w, y * h];
  // Through the opening of the arch at camera rest.
  const opening: Point = [l.center[0], l.center[1] + size * 0.14];
  const curve = (start: Point, ...points: Point[]) =>
    `M${pt(start)}C${points.slice(0, 3).map(pt).join(" ")}S${points
      .slice(3)
      .map(pt)
      .join(" ")}`;
  if (l.portrait) {
    return {
      back: curve(
        P(-0.12, 0.1),
        P(0.22, -0.04),
        P(0.46, 0.26),
        P(0.7, 0.13),
        P(1.02, 0.02),
        P(1.14, 0.12),
      ),
      middle: curve(
        P(1.14, 0.9),
        P(0.86, 0.78),
        P(0.66, 1.08),
        P(0.42, 0.98),
        P(0.12, 0.84),
        P(-0.14, 1.0),
      ),
      front: curve(
        P(-0.14, 0.24),
        P(0.12, 0.2),
        [opening[0] - w * 0.3, opening[1]],
        opening,
        P(0.86, 0.5),
        P(1.14, 0.46),
      ),
    };
  }
  return {
    back: curve(
      P(-0.08, 0.32),
      P(0.16, 0.02),
      P(0.38, 0.46),
      P(0.6, 0.2),
      P(0.88, -0.04),
      P(1.08, 0.16),
    ),
    middle: curve(
      P(1.08, 0.94),
      P(0.86, 0.7),
      P(0.62, 1.04),
      P(0.42, 0.84),
      P(0.14, 0.52),
      P(-0.08, 0.7),
    ),
    front: curve(
      P(-0.08, 0.86),
      P(0.06, 0.98),
      [opening[0] - w * 0.16, opening[1] + h * 0.02],
      opening,
      [opening[0] + w * 0.17, opening[1] - h * 0.5],
      P(0.6, -0.12),
    ),
  };
}

interface Camera {
  zoom: number;
  world: Point;
  screen: Point;
}
/** One camera: a close-up on Bend's crown that pulls back to the composed view. */
function camera(l: Layout, t: number): Camera {
  const scale = l.size / 320;
  const face: Point = [l.center[0], l.center[1] - 78 * scale];
  const start = clamp((Math.min(l.w, l.h) * 0.78) / (152 * scale), 1.6, 3.2);
  const p = travel(progress(t, beats.camera));
  const settle = travel(progress(t, [3600, 7800]));
  const zoom =
    Math.exp(mix(Math.log(start), Math.log(1.08), p)) - 0.08 * settle;
  return {
    zoom,
    world: [mix(face[0], l.center[0], p), mix(face[1], l.center[1], p)],
    screen: [mix(l.w / 2, l.center[0], p), mix(l.h * 0.46, l.center[1], p)],
  };
}
function cameraTransform(view: Camera, depth: number) {
  const scale = 1 + (view.zoom - 1) * depth;
  return `translate(${pt(view.screen)}) scale(${fine(scale)}) translate(${n(-view.world[0])} ${n(-view.world[1])})`;
}

// Half-plane polygon clipping keeps points where dot(p, normal) <= limit.
function clip(polygon: Point[], normal: Point, limit: number): Point[] {
  const out: Point[] = [];
  const side = (p: Point) => p[0] * normal[0] + p[1] * normal[1] - limit;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa <= 0) out.push(a);
    if (sa * sb < 0) {
      const k = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    }
  }
  return out;
}
/** Folds a point over the line; `lift` < 1 foreshortens the folded part as if raised from the page. */
const fold = (p: Point, normal: Point, limit: number, lift: number): Point => {
  const d = p[0] * normal[0] + p[1] * normal[1] - limit;
  return [p[0] - (1 + lift) * d * normal[0], p[1] - (1 + lift) * d * normal[1]];
};
const polygonPath = (polygon: Point[]) =>
  polygon.length < 3 ? "" : `M${polygon.map(pt).join("L")}Z`;

/** A sheet laid down from the lower-right corner, its unlaid part folded back over the fold line. */
function pageTurn(l: Layout, p: number) {
  const { w, h } = l;
  if (p <= 0) return { laid: "", shadow: "", flap: "", edge: "", done: false };
  const rect: Point[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  if (p >= 1)
    return {
      laid: polygonPath(rect),
      shadow: "",
      flap: "",
      edge: "",
      done: true,
    };
  const length = Math.hypot(1, 0.66);
  // Unit direction from the lower-right corner into the viewport.
  const into: Point = [-1 / length, -0.66 / length];
  const reach = w * -into[0] + h * -into[1];
  // Coordinates measured along `into`, from the corner.
  const offset = -(w * into[0] + h * into[1]);
  const limit = p * reach - offset;
  const laid = clip(rect, into, limit);
  const away: Point = [-into[0], -into[1]];
  const flap = clip(rect, away, -limit).map((point) =>
    fold(point, into, limit, 0.5),
  );
  const band = Math.min(16, Math.max(6, l.size * 0.035));
  const edge = clip(flap, away, -(limit - band));
  const depth = Math.min(14, Math.max(6, l.size * 0.03));
  const shadow = clip(
    flap.map(([x, y]): Point => [x + away[0] * depth, y + away[1] * depth]),
    into,
    limit,
  );
  return {
    laid: polygonPath(laid),
    shadow: polygonPath(shadow),
    flap: polygonPath(flap),
    edge: polygonPath(edge),
    done: false,
  };
}

function bendPose(t: number, portrait: boolean): BendPose {
  const rock = progress(t, beats.rock);
  const tilt =
    rock > 0 && rock < 1
      ? 4.4 * Math.sin(rock * Math.PI * 3) * (1 - rock) ** 1.3
      : 0;
  // Follows the tangerine line as it is drawn.
  const follow =
    -0.9 * envelope(t, 800, 1100, 1300, 1600) +
    0.8 * envelope(t, 1450, 1800, 2200, 2600);
  const anticipate = envelope(t, 3700, 3900, 3950, 4200);
  const wave = envelope(t, 3850, 4250, 5150, 5600);
  const lookLeft = envelope(t, 5650, 5850, 6100, 6300);
  const lookRight = envelope(t, 6200, 6400, 6700, 6950);
  const watch = envelope(t, 7850, 8150, 8650, 9000);
  const read = envelope(t, 9050, 9300, 9950, 10250);
  const duck = envelope(t, 11150, 11320, 11360, 11600);
  const present = ease(t, [5800, 6600]) * (1 - 0.62 * ease(t, [9000, 10100]));
  return {
    wave,
    wavePhase:
      ((clamp(t, beats.hello[0], beats.hello[1]) - 4250) / 1000) *
      Math.PI *
      3.2,
    present,
    blink: Math.max(
      1 - ease(t, beats.wake),
      pulse(t, 3500, 110),
      pulse(t, 10450, 120),
    ),
    wink: pulse(t, 5350, 170),
    mouth:
      0.5 * pulse(t, 4350, 170) +
      0.38 * pulse(t, 4700, 150) +
      0.5 * pulse(t, 5020, 170) +
      0.22 * pulse(t, 6350, 260),
    gazeX:
      follow -
      lookLeft +
      0.9 * lookRight +
      0.9 * watch +
      (portrait ? 0 : 0.9 * read),
    gazeY:
      -0.3 * Math.abs(follow) + 0.8 * watch - (portrait ? 0.9 : 0.2) * read,
    lean:
      tilt +
      1.6 * anticipate -
      1.8 * wave -
      1.1 * lookLeft +
      1.1 * lookRight +
      1.2 * duck,
    bob: -0.45 * Math.abs(tilt) - 1.2 * pulse(t, 5350, 240) - 2.5 * duck,
  };
}

export interface TextFrame {
  reveal: number;
  exit: number;
  visible: boolean;
}
function caption(t: number, [a, b, c, d]: readonly number[]): TextFrame {
  const reveal = progress(t, [a!, b!]);
  const exit = d === undefined ? 0 : easeIn(progress(t, [c!, d]));
  return { reveal, exit, visible: reveal > 0 && exit < 1 };
}

/** Pure description of the scene at an elapsed time; independent of earlier frames. */
export function welcomeFrame(timeMs: number, viewport: Viewport) {
  const t = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, durationMs);
  const l = layout(viewport);
  const { size, center } = l;
  const view = camera(l, t);
  const paths = ribbonPaths(l);
  const ribbonWidth = clamp(Math.sqrt(l.w * l.h) * 0.06, 30, 80);
  const ribbon = (range: Range, depth: number, drift: Point) => {
    const p = easeOut(progress(t, range));
    const d = travel(progress(t, [range[1], 8200]));
    return {
      draw: fine(1 - p),
      visible: p > 0,
      transform: `${cameraTransform(view, depth)} translate(${n(drift[0] * d)} ${n(drift[1] * d)})`,
    };
  };
  const unit = size;
  const kind = l.portrait ? "portrait" : "landscape";
  const objects = Object.fromEntries(
    objectNames.map((name, index) => {
      const place = placements[kind][name];
      const arrive = easeOut(progress(t, objectArrival[name]));
      const gather = travel(
        progress(t, [
          beats.gather[0] + index * 110,
          beats.gather[1] - 400 + index * 110,
        ]),
      );
      const from: Point = [place.scattered.x * l.w, place.scattered.y * l.h];
      const to: Point = [
        center[0] + place.gathered.x * unit,
        center[1] + place.gathered.y * unit,
      ];
      const art = objectArt[name];
      const scale = (objectSize[name] * unit) / art.width;
      const x = mix(from[0], to[0], gather);
      const y = mix(from[1], to[1], gather) + (1 - arrive) * unit * 0.14;
      const rotate =
        mix(place.scattered.rotate, place.gathered.rotate, gather) +
        (1 - arrive) * (index % 2 ? -24 : 24);
      return [
        name,
        {
          transform: `translate(${n(x)} ${n(y)}) rotate(${n(rotate)}) scale(${fine(Math.max(0.001, arrive) * scale)} ${fine(scale)}) translate(${n(-art.width / 2)} ${n(-art.height / 2)})`,
          visible: arrive > 0,
        },
      ];
    }),
  ) as Record<ObjectName, { transform: string; visible: boolean }>;

  const bloom = easeOut(progress(t, beats.burst));
  const burstSize = unit * 0.5;
  const turnProgress = travel(progress(t, beats.turn));
  const page = pageTurn(l, turnProgress);

  const scale = size / 320;
  const canvasTop = center[1] - 178 * scale;
  const below = l.h - (canvasTop + 64 * scale) + 12;
  const bendY = canvasTop + easeIn(progress(t, beats.exitBend)) * below;
  const bendX = center[0] - 160 * scale;

  const strokes = Array.from({ length: 9 }, (_, index) => {
    const start = beats.wordmark[0] + index * 78;
    return fine(easeOut(progress(t, [start, start + 330])));
  });
  const accent = smooth(progress(t, beats.accent));
  const target = headerSlot(viewport);
  const glide = travel(progress(t, beats.exitWordmark));
  const mark = {
    x: mix(l.wordmark.x, target.x, glide),
    y: mix(l.wordmark.y, target.y, glide),
    width: mix(l.wordmark.width, target.width, glide),
  };

  return {
    time: t,
    layout: l,
    controls: 1,
    tone: page.done ? ("paper" as const) : ("ink" as const),
    worldVisible: !page.done,
    ribbonWidth: n(ribbonWidth),
    paths,
    ribbons: {
      back: ribbon(beats.ribbonBack, 0.45, [l.w * 0.012, -l.h * 0.008]),
      middle: ribbon(beats.ribbonMiddle, 0.65, [-l.w * 0.014, l.h * 0.01]),
      front: ribbon(beats.ribbonFront, 0.85, [l.w * 0.006, -l.h * 0.006]),
    },
    objectsTransform: cameraTransform(view, 1),
    objects,
    burst: {
      visible: bloom > 0,
      transform: `${cameraTransform(view, 0.9)} translate(${n(center[0] - unit * 0.34)} ${n(center[1] - unit * 0.5)}) rotate(${n((1 - bloom) * -50)}) scale(${fine((bloom * burstSize) / 200)}) translate(-100 -100)`,
    },
    page,
    bend: {
      transform: `${cameraTransform(view, 1)} translate(${n(bendX)} ${n(bendY)}) scale(${fine(scale)})`,
      /** Canvas top edge before the camera is applied. */
      top: n(bendY),
      pose: bendPose(t, l.portrait),
    },
    wordmark: {
      visible: strokes[0]! > 0,
      transform: `translate(${n(mark.x)} ${n(mark.y)}) scale(${fine(mark.width / 165)})`,
      strokes,
      accent: {
        visible: accent > 0,
        transform: `translate(0 ${n((1 - accent) * -14)}) rotate(${n((1 - accent) * -28)} 31 6)`,
        opacity: n(clamp(accent * 2.5)),
      },
    },
    captions: {
      hello: caption(t, beats.captionHello),
      gather: caption(t, beats.captionGather),
      tagline: (() => {
        const frame = caption(t, beats.tagline);
        const exit = smooth(progress(t, [beats.handoff[0], 11450]));
        return { ...frame, exit, visible: frame.reveal > 0 && exit < 1 };
      })(),
    },
  };
}
export type WelcomeFrame = ReturnType<typeof welcomeFrame>;
