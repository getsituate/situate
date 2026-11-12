export const visualPixelComparison: {
  threshold: number;
  maxDiffPixels: number;
};
export function visualGrep(profile: string, filter?: string): RegExp;
export function checkpointName(
  name: string,
  viewport: { width: number; height: number } | null,
  locale: string,
): string;
export function claimCheckpoint(
  outputDir: string,
  profile: string,
  name: string,
  owner: string,
): void;
