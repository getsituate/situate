export const transitionDuration = 2700;
export const panelExit = 250;
export const panelHandoff = 2350;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => {
  const p = clamp(n);
  return p * p * (3 - 2 * p);
};
const ramp = (t: number, start: number, end: number) =>
  ease((t - start) / (end - start));
export function transitionFrame(time: number, from: number, to: number) {
  const duration = transitionDuration;
  const t = Number.isFinite(time)
    ? Math.max(0, Math.min(duration, time))
    : duration;
  const incoming = t >= panelHandoff;
  const enter = ramp(t, panelHandoff, duration);
  const leave = ramp(t, 0, panelExit);
  return {
    time: t,
    phase:
      t < panelExit
        ? "leaving"
        : t < 1150
          ? "completion"
          : t < panelHandoff
            ? "travel"
            : t < duration
              ? "entering"
              : "idle",
    from,
    to,
    incoming,
    activeStep: incoming ? to : from,
    panelOpacity: incoming ? enter : 1 - leave,
    panelY: incoming ? (1 - enter) * 8 : -leave * 6,
    reaction: t > 750 && t < 1150 ? Math.sin(Math.PI * ramp(t, 750, 1150)) : 0,
    journeyProgress: clamp((t - 1150) / (panelHandoff - 1150)),
    check: to > from ? ramp(t, 250, 750) : 0,
    activation: enter,
    sparkle:
      to > from && t > 750 && t < 1050
        ? Math.sin(Math.PI * ramp(t, 750, 1050))
        : 0,
    sparkleRadius: 17 + 10 * ramp(t, 750, 1050),
  };
}
export type SetupTransitionFrame = ReturnType<typeof transitionFrame>;
