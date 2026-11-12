import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Chromium can round antialiased borders differently by a color level.
export const visualPixelComparison = { threshold: 0.01, maxDiffPixels: 0 };

export function visualGrep(profile, filter = "") {
  if (!["desktop", "mobile"].includes(profile))
    throw new Error("Unknown visual profile.");
  return new RegExp(
    `^(?=[\\s\\S]*@visual-${profile}(?:\\s|$))(?=[\\s\\S]*(?:${filter}))`,
  );
}

export function checkpointName(name, viewport, locale) {
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(name))
    throw new Error(
      "Visual checkpoints need a lowercase, dot-separated state name.",
    );
  if (
    !viewport ||
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width < 1 ||
    viewport.height < 1
  )
    throw new Error("Visual checkpoints require a fixed viewport.");
  if (!/^[A-Za-z0-9-]+$/.test(locale))
    throw new Error("Visual checkpoints require an explicit locale.");
  return `${name}-${viewport.width}x${viewport.height}-${locale}.png`;
}

export function claimCheckpoint(outputDir, profile, name, owner) {
  const directory = join(outputDir, "checkpoint-owners", profile);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${name}.json`);
  try {
    writeFileSync(path, JSON.stringify({ owner }), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = JSON.parse(readFileSync(path, "utf8"));
    throw new Error(
      `Baseline ${profile}/${name} has multiple writers: ${previous.owner} and ${owner}. Keep one capture owner per state and viewport before updating.`,
      { cause: error },
    );
  }
}
