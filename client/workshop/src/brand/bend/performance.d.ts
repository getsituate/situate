export interface BendPose {
  stride?: number;
  phase?: number;
  wave?: number;
  wavePhase?: number;
  present?: number;
  blink?: number;
  wink?: number;
  mouth?: number;
  gazeX?: number;
  gazeY?: number;
  lean?: number;
  bob?: number;
}
export interface BendRig {
  set(pose: BendPose): void;
  reset(): void;
  destroy(): void;
}
declare const performance: { create(svg: SVGSVGElement): BendRig };
export default performance;
