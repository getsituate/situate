export interface BendFrame {
  offset: number;
  angle: number;
}

export function bendAt(frames: BendFrame[], progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  const next = frames.findIndex((frame) => frame.offset > p);
  if (next < 0) return frames.at(-1)?.angle ?? 0;
  if (next === 0) return frames[0].angle;
  const a = frames[next - 1];
  const b = frames[next];
  const t = (p - a.offset) / (b.offset - a.offset);
  // Zero velocity and acceleration at each held pose prevent a mechanical reversal.
  const eased = t * t * t * (t * (t * 6 - 15) + 10);
  return a.angle + (b.angle - a.angle) * eased;
}

export function limbPath(x: number, degrees: number): string {
  const angle = (Math.max(-125, Math.min(125, degrees)) * Math.PI) / 180;
  const length = 10;
  if (Math.abs(angle) < 0.0001)
    return `M${x} 15 C${x} 18.333 ${x} 21.667 ${x} 25`;
  // A constant-length circular bend stays tangent to the crown at its fixed root.
  const radius = length / angle;
  const endX = x - radius * (1 - Math.cos(angle));
  const endY = 15 + radius * Math.sin(angle);
  const handle = (4 / 3) * radius * Math.tan(angle / 4);
  const n = (value: number) => Number(value.toFixed(3));
  return `M${x} 15 C${x} ${n(15 + handle)} ${n(endX + handle * Math.sin(angle))} ${n(endY - handle * Math.cos(angle))} ${n(endX)} ${n(endY)}`;
}
