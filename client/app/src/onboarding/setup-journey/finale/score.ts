import { journeyFrame, ribbonPath } from "../journey";

export const finaleDuration = 5800;
export interface FinaleState {
  status: "idle" | "playing" | "done";
  timeMs: number | null;
  paused: boolean;
  run: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface StageSize {
  width: number;
  height: number;
}
export const newFinale = (): FinaleState => ({
  status: "idle",
  timeMs: null,
  paused: false,
  run: 0,
});
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const ramp = (t: number, a: number, b: number) => ease((t - a) / (b - a));
const pulse = (t: number, a: number, b: number) => {
  const p = clamp((t - a) / (b - a));
  return p === 0 || p === 1 ? 0 : Math.sin(Math.PI * p) ** 2;
};
export function finaleTiming(milliseconds: number) {
  const time = Number.isFinite(milliseconds)
    ? Math.min(finaleDuration, Math.max(0, milliseconds))
    : finaleDuration;
  const reveal = ramp(time, 4420, 5350);
  return {
    time,
    expand: ramp(time, 120, 1000),
    uiOpacity: 1 - ramp(time, 0, 380),
    titleOpacity: ramp(time, 650, 1050) * (1 - ramp(time, 2350, 2900)),
    // The unfolded sheet covers the viewport before the backdrop releases.
    backdropOpacity: time < 4420 ? 1 : 0,
    overlayOpacity: 1 - reveal,
    reveal,
    workspaceScale: mix(1.045, 1, ramp(time, 4400, 5650)),
  };
}

export function finaleFrame(
  milliseconds: number,
  viewport: StageSize,
  origin?: Rect,
) {
  const timing = finaleTiming(milliseconds),
    { time, expand } = timing;
  const width = Math.max(
    1,
    Number.isFinite(viewport.width) ? viewport.width : 1280,
  );
  const height = Math.max(
    1,
    Number.isFinite(viewport.height) ? viewport.height : 900,
  );
  const narrow = width < 701;
  const start =
    origin ??
    (narrow
      ? {
          x: (width - Math.min(240, width * 0.62)) / 2,
          y: 164,
          width: Math.min(240, width * 0.62),
          height: Math.min(240, width * 0.62) * 0.94,
        }
      : {
          x: width * 0.04,
          y: 186,
          width: width * 0.37,
          height: width * 0.3478,
        });
  const art = journeyFrame({ step: 4, fromStep: 4, travel: 1, reaction: 0 });
  art.rail = ribbonPath(art.camera * 0.8, 66, 185, 780, 0, -2000, 2500);
  art.road = ribbonPath(art.camera, 8, 405, 900, 0, -2000, 2500);

  const prepare = pulse(time, 850, 1150),
    hop = pulse(time, 1150, 1700);
  const landing = pulse(time, 1700, 1950);
  const delight = ramp(time, 920, 1300) * (1 - ramp(time, 2000, 2450));
  const invitation = ramp(time, 2100, 2700);
  art.actor.y += 2 * prepare - 18 * hop + 1.4 * landing;
  art.actor.pose.lean += -3 * prepare + 2.2 * hop + 1.5 * invitation;
  art.actor.pose.bob = -Math.abs(art.actor.pose.lean) * 1.15;
  art.actor.pose.wave = mix(art.actor.pose.wave, 0.98, delight);
  art.actor.pose.present = 0.9 * delight + 0.6 * invitation;
  art.actor.pose.gazeY -= 0.7 * delight;
  art.actor.pose.gazeX = mix(art.actor.pose.gazeX, 0.95, invitation);
  art.actor.pose.mouth = 0.4 * delight;
  art.actor.pose.blink = 0.8 * pulse(time, 1800, 1940);
  art.actor.pose.wink = 0.65 * pulse(time, 2320, 2520);
  art.shadow.rx *= 1 - 0.12 * hop;
  art.shadow.ry *= 1 - 0.2 * hop;

  const dock = ramp(time, 280, 900);
  art.leaf = {
    x: mix(art.leaf.x, art.desk.x + 72, dock),
    y: mix(art.leaf.y, art.desk.y - 177, dock),
    rotation: mix(art.leaf.rotation, 4, dock),
  };
  const unfold = ramp(time, 2650, 3350);
  art.desk.noteRotation = mix(art.desk.noteRotation, 0, unfold);
  art.desk.noteY = mix(-126, -176, unfold);
  const old = [
    [-2, -3],
    [46, -3],
    [54, 14],
    [5, 14],
  ];
  const opened = [
    [-42, -77],
    [90, -77],
    [90, 87],
    [-42, 87],
  ];
  const corners = old.map(([x, y], i) => ({
    x: mix(x, opened[i][0], unfold),
    y: mix(y, opened[i][1], unfold),
  }));
  const sheetPath = `M${corners.map((p) => `${p.x} ${p.y}`).join("L")}Z`;
  const sheet = {
    path: sheetPath,
    linesOpacity: 1 - ramp(time, 2650, 3100),
    paperMix: unfold,
  };

  const scale = Math.min(
    width / (narrow ? 420 : 640),
    height / (narrow ? 600 : 490),
  );
  const stageX = width / 2 - 250 * scale;
  const stageY =
    height * (narrow ? (height < 450 ? 0.7 : 0.64) : 0.77) - 373 * scale;
  const zoom = ramp(time, 3050, 4420);
  const targetScale = Math.max(width / 132, height / 164) * 1.08;
  const cameraScale =
    mix(start.width / 500, scale, expand) * (targetScale / scale) ** zoom;
  const paperCenter = {
    x: art.desk.x + art.desk.noteX + 24,
    y: art.desk.y + art.desk.noteY + 5,
  };
  const camera = {
    scale: cameraScale,
    x:
      zoom === 0
        ? mix(start.x, stageX, expand)
        : width / 2 - mix(250, paperCenter.x, zoom) * cameraScale,
    y:
      zoom === 0
        ? mix(start.y, stageY, expand)
        : height / 2 -
          mix((height / 2 - stageY) / scale, paperCenter.y, zoom) * cameraScale,
  };
  const clip = {
    x: mix(start.x, 0, expand),
    y: mix(start.y, 0, expand),
    width: mix(start.width, width, expand),
    height: mix(start.height, height, expand),
  };
  const offscreen = start.y + start.height < 0 || start.y > height;
  const artOpacity = offscreen ? ramp(time, 250, 800) : 1;
  const rockets = [0, 1].map((id) => {
    const startTime = 1100 + id * 180;
    const p = clamp((time - startTime) / 580);
    const from = { x: id ? 455 : 45, y: 365 };
    const edge = Math.max(48, width * 0.075);
    const to = {
      x: narrow
        ? id
          ? 445
          : 55
        : ((id ? width - edge : edge) - stageX) / scale,
      y: id ? 88 : 63,
    };
    const x = mix(from.x, to.x, p),
      y = mix(from.y, to.y, 1 - (1 - p) ** 2);
    return {
      id,
      x,
      y,
      rotation: (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI,
      opacity:
        ramp(time, startTime, startTime + 110) *
        (1 - ramp(time, startTime + 540, startTime + 630)),
      trail: `M${from.x} ${from.y}Q${from.x} ${y + (365 - y) * 0.25} ${x} ${y}`,
      burst: to,
      burstTime: startTime + 550,
    };
  });
  const confetti = rockets
    .flatMap((rocket) =>
      Array.from({ length: 24 }, (_, i) => {
        const p = clamp((time - rocket.burstTime - (i % 4) * 22) / 1320);
        const angle = i * 2.39996 - Math.PI / 2;
        const spread = 30 + (i % 5) * 10;
        return {
          id: rocket.id * 24 + i,
          x: rocket.burst.x + Math.cos(angle) * spread * (1 - (1 - p) ** 3),
          y:
            rocket.burst.y +
            Math.sin(angle) * spread * (1 - (1 - p) ** 3) +
            195 * p * p,
          rotation: i * 31 + p * (i % 2 ? 230 : -180),
          opacity:
            ramp(time, rocket.burstTime, rocket.burstTime + 85) *
            (1 -
              ramp(
                time,
                rocket.burstTime + 700 + (i % 4) * 40,
                rocket.burstTime + 1260 + (i % 4) * 40,
              )),
          color: [
            "var(--situate-violet)",
            "var(--situate-tangerine)",
            "var(--situate-lemon)",
            "var(--situate-sky)",
          ][i % 4],
          ribbon: i % 5 === 0,
        };
      }),
    )
    .filter((bit) => bit.opacity > 0);
  return {
    ...timing,
    width,
    height,
    art,
    camera,
    clip,
    sheet,
    rockets,
    confetti,
    artOpacity,
    paperCenter,
    paperCorners: corners,
  };
}
export type FinaleFrame = ReturnType<typeof finaleFrame>;
